import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { ApiError } from '../common/errors';
import { withTransaction } from '../database/pool';
import {
  AuthenticatedUser,
  canReadClinicalContent,
  canReadClinicalHistory,
  canRecordEncounter,
} from '../common/authorization';
import { AuditService } from '../audit/audit.service';
import { AppointmentRow, EncounterDto } from '../appointments/appointment.types';

interface EncounterRow {
  id: number;
  cita_id: number;
  version: number;
  reemplaza_a: number | null;
  autor_profesional_id: number;
  notas: string;
  diagnostico: string;
  creado_en: Date;
}

const APPOINTMENT_OWNERSHIP = `
  SELECT c.id, c.paciente_id, c.profesional_id, c.franja_inicio, c.franja_fin, c.estado,
         p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
         pr.nombre AS profesional_nombre, pr.apellido AS profesional_apellido,
         pr.especialidad AS profesional_especialidad
  FROM cita c
  JOIN paciente p ON p.id = c.paciente_id
  JOIN profesional pr ON pr.id = c.profesional_id
`;

@Injectable()
export class EncountersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  private async appointmentRow(id: number): Promise<AppointmentRow | null> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_OWNERSHIP} WHERE c.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async latestEncounter(appointmentId: number): Promise<EncounterDto | null> {
    const result = await this.pool.query<EncounterRow>(
      `SELECT id, cita_id, version, reemplaza_a, autor_profesional_id, notas,
              diagnostico, creado_en
       FROM encuentro WHERE cita_id = $1
       ORDER BY version DESC LIMIT 1`,
      [appointmentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.toDto(row);
  }

  async attachmentsFor(encounterId: number): Promise<EncounterDto['attachments']> {
    const result = await this.pool.query<{
      id: number;
      encuentro_id: number;
      nombre_original: string;
      tipo_mime: string;
      tamano_bytes: number;
      creado_en: Date;
    }>(
      `SELECT id, encuentro_id, nombre_original, tipo_mime, tamano_bytes, creado_en
       FROM adjunto WHERE encuentro_id = $1 ORDER BY creado_en ASC, id ASC`,
      [encounterId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      encounterId: row.encuentro_id,
      filename: row.nombre_original,
      contentType: row.tipo_mime,
      sizeBytes: row.tamano_bytes,
      createdAt: row.creado_en.toISOString(),
    }));
  }

  private async toDto(row: EncounterRow): Promise<EncounterDto> {
    return {
      id: row.id,
      appointmentId: row.cita_id,
      version: row.version,
      replacesEncounterId: row.reemplaza_a,
      authorProfessionalId: row.autor_profesional_id,
      notes: row.notas,
      diagnosis: row.diagnostico,
      createdAt: row.creado_en.toISOString(),
      attachments: await this.attachmentsFor(row.id),
    };
  }

  async recordEncounter(
    user: AuthenticatedUser,
    appointmentId: number,
    input: { notes: string; diagnosis: string },
  ): Promise<EncounterDto> {
    const appointment = await this.appointmentRow(appointmentId);
    if (!appointment) {
      throw new ApiError('NOT_FOUND', 'Appointment not found');
    }
    const ownership = {
      patientId: appointment.paciente_id,
      professionalId: appointment.profesional_id,
    };
    if (!canRecordEncounter(user, ownership)) {
      throw new ApiError(
        'FORBIDDEN',
        'Only the assigned professional can record an encounter',
      );
    }
    if (appointment.estado === 'cancelled') {
      throw new ApiError(
        'CONFLICT',
        'A cancelled appointment cannot receive an encounter',
      );
    }
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query<{ id: number; version: number }>(
        `SELECT id, version FROM encuentro WHERE cita_id = $1
         ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [appointmentId],
      );
      const last = previous.rows[0];
      const version = (last?.version ?? 0) + 1;
      const inserted = await client.query<{ id: number; creado_en: Date }>(
        `INSERT INTO encuentro
           (cita_id, autor_profesional_id, notas, diagnostico, version, reemplaza_a)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, creado_en`,
        [
          appointmentId,
          user.professionalId,
          input.notes,
          input.diagnosis,
          version,
          last?.id ?? null,
        ],
      );
      await client.query(
        `UPDATE cita SET estado = 'attended', actualizado_en = now()
         WHERE id = $1 AND estado = 'scheduled'`,
        [appointmentId],
      );
      const encounterId = inserted.rows[0].id;
      await this.audit.record(
        {
          actorId: user.id,
          action: 'encuentro.create',
          resourceType: 'encuentro',
          resourceId: encounterId,
          detail: { appointmentId, version },
        },
        client,
      );
      return {
        id: encounterId,
        appointmentId,
        version,
        replacesEncounterId: last?.id ?? null,
        authorProfessionalId: user.professionalId as number,
        notes: input.notes,
        diagnosis: input.diagnosis,
        createdAt: inserted.rows[0].creado_en.toISOString(),
        attachments: [],
      };
    });
  }

  async clinicalHistory(
    user: AuthenticatedUser,
    patientId: number,
  ): Promise<{
    patientId: number;
    patientName: string;
    encounters: EncounterDto[];
  }> {
    const patientResult = await this.pool.query<{
      id: number;
      nombre: string;
      apellido: string;
    }>('SELECT id, nombre, apellido FROM paciente WHERE id = $1', [patientId]);
    const patient = patientResult.rows[0];
    if (!patient) {
      throw new ApiError('NOT_FOUND', 'Patient not found');
    }

    let hasAssignedAppointment = false;
    if (user.professionalId !== null) {
      const assigned = await this.pool.query(
        'SELECT 1 FROM cita WHERE paciente_id = $1 AND profesional_id = $2 LIMIT 1',
        [patientId, user.professionalId],
      );
      hasAssignedAppointment = (assigned.rowCount ?? 0) > 0;
    }
    if (!canReadClinicalHistory(user, patientId, hasAssignedAppointment)) {
      throw new ApiError('FORBIDDEN');
    }

    const encounters = await this.pool.query<EncounterRow>(
      `SELECT e.id, e.cita_id, e.version, e.reemplaza_a, e.autor_profesional_id,
              e.notas, e.diagnostico, e.creado_en
       FROM encuentro e
       JOIN cita c ON c.id = e.cita_id
       WHERE c.paciente_id = $1
       ORDER BY e.creado_en DESC, e.id DESC`,
      [patientId],
    );

    const items: EncounterDto[] = [];
    for (const row of encounters.rows) {
      items.push(await this.toDto(row));
    }

    await this.audit.record({
      actorId: user.id,
      action: 'historia.read',
      resourceType: 'paciente',
      resourceId: patientId,
    });

    return {
      patientId,
      patientName: `${patient.nombre} ${patient.apellido}`,
      encounters: items,
    };
  }

  async clinicalSummary(
    user: AuthenticatedUser,
    appointment: AppointmentRow,
  ): Promise<EncounterDto | null> {
    if (
      !canReadClinicalContent(user, {
        patientId: appointment.paciente_id,
        professionalId: appointment.profesional_id,
      })
    ) {
      return null;
    }
    const encounter = await this.latestEncounter(appointment.id);
    await this.audit.record({
      actorId: user.id,
      action: 'encuentro.read',
      resourceType: 'cita',
      resourceId: appointment.id,
    });
    return encounter;
  }

  async assignedPatients(
    user: AuthenticatedUser,
  ): Promise<Array<{ id: number; name: string; appointments: number }>> {
    if (user.professionalId === null) {
      throw new ApiError('FORBIDDEN');
    }
    const result = await this.pool.query<{
      id: number;
      nombre: string;
      apellido: string;
      total: string;
    }>(
      `SELECT p.id, p.nombre, p.apellido, count(c.id)::text AS total
       FROM cita c JOIN paciente p ON p.id = c.paciente_id
       WHERE c.profesional_id = $1
       GROUP BY p.id, p.nombre, p.apellido
       ORDER BY p.apellido, p.nombre`,
      [user.professionalId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: `${row.nombre} ${row.apellido}`,
      appointments: Number.parseInt(row.total, 10),
    }));
  }
}

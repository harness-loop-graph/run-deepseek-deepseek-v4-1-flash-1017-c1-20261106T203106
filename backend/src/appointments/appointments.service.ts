import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { ApiError } from '../common/errors';
import { withTransaction } from '../database/pool';
import {
  AuthenticatedUser,
  canReadAppointmentDetail,
} from '../common/authorization';
import { AuditService } from '../audit/audit.service';
import { EncountersService } from '../encounters/encounters.service';
import {
  AppointmentDto,
  AppointmentRow,
  EncounterDto,
  toAppointmentDto,
} from './appointment.types';
import { defaultRange, endOfDayUtc, startOfDayUtc, toDateOnly } from '../common/dates';

const APPOINTMENT_SELECT = `
  SELECT c.id, c.paciente_id, c.profesional_id, c.franja_inicio, c.franja_fin, c.estado,
         p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
         pr.nombre AS profesional_nombre, pr.apellido AS profesional_apellido,
         pr.especialidad AS profesional_especialidad
  FROM cita c
  JOIN paciente p ON p.id = c.paciente_id
  JOIN profesional pr ON pr.id = c.profesional_id
`;

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly encounters: EncountersService,
  ) {}

  async listOwnAppointments(user: AuthenticatedUser): Promise<AppointmentDto[]> {
    if (user.patientId === null) {
      throw new ApiError('FORBIDDEN', 'The account has no patient profile');
    }
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
       WHERE c.paciente_id = $1
       ORDER BY c.franja_inicio DESC`,
      [user.patientId],
    );
    return result.rows.map(toAppointmentDto);
  }

  async findById(id: number): Promise<AppointmentRow | null> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT} WHERE c.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getAppointmentDetail(
    user: AuthenticatedUser,
    id: number,
  ): Promise<AppointmentDto & { encounter: EncounterDto | null }> {
    const row = await this.findById(id);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'Appointment not found');
    }
    if (
      !canReadAppointmentDetail(user, {
        patientId: row.paciente_id,
        professionalId: row.profesional_id,
      })
    ) {
      throw new ApiError('FORBIDDEN');
    }
    const encounter = await this.encounters.clinicalSummary(user, row);
    return { ...toAppointmentDto(row), encounter };
  }

  async agenda(
    user: AuthenticatedUser,
    filters: { from?: string; to?: string; professionalId?: number },
  ): Promise<{
    from: string;
    to: string;
    professionalId: number | null;
    days: Array<{ date: string; appointments: AppointmentDto[] }>;
  }> {
    const range = defaultRange();
    const from = filters.from ?? range.from;
    const to = filters.to ?? range.to;
    if (from > to) {
      throw new ApiError('VALIDATION_ERROR', 'from must be before or equal to to');
    }
    const professionalId =
      user.professionalId !== null
        ? user.professionalId
        : (filters.professionalId ?? null);

    const params: unknown[] = [
      startOfDayUtc(from).toISOString(),
      endOfDayUtc(to).toISOString(),
    ];
    let where = 'WHERE c.franja_inicio >= $1 AND c.franja_inicio <= $2';
    if (professionalId !== null) {
      params.push(professionalId);
      where += ` AND c.profesional_id = $${params.length}`;
    }
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT} ${where} ORDER BY c.franja_inicio ASC, c.id ASC`,
      params,
    );
    const grouped = new Map<string, AppointmentDto[]>();
    for (const row of result.rows) {
      const key = toDateOnly(row.franja_inicio);
      const list = grouped.get(key) ?? [];
      list.push(toAppointmentDto(row));
      grouped.set(key, list);
    }
    return {
      from,
      to,
      professionalId,
      days: [...grouped.entries()].map(([date, appointments]) => ({
        date,
        appointments,
      })),
    };
  }

  async cancel(user: AuthenticatedUser, id: number): Promise<void> {
    const row = await this.findById(id);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'Appointment not found');
    }
    if (user.patientId === null || row.paciente_id !== user.patientId) {
      throw new ApiError('FORBIDDEN', 'Only the owning patient can cancel');
    }
    if (row.estado === 'cancelled') {
      throw new ApiError('CONFLICT', 'The appointment is already cancelled');
    }
    await withTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE cita SET estado = 'cancelled', actualizado_en = now()
         WHERE id = $1 AND estado <> 'cancelled'`,
        [id],
      );
      if (updated.rowCount === 0) {
        throw new ApiError('CONFLICT', 'The appointment is already cancelled');
      }
      await this.audit.record(
        {
          actorId: user.id,
          action: 'cita.cancel',
          resourceType: 'cita',
          resourceId: id,
        },
        client,
      );
    });
  }
}

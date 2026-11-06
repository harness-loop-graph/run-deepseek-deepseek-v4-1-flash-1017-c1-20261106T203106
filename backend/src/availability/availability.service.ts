import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { ApiError } from '../common/errors';
import { AuthenticatedUser, canSearchAvailability } from '../common/authorization';
import { endOfDayUtc, startOfDayUtc } from '../common/dates';

export interface Slot {
  start: string;
  end: string;
}

@Injectable()
export class AvailabilityService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async freeSlots(
    user: AuthenticatedUser,
    query: { professionalId: number; from: string; to: string },
  ): Promise<Slot[]> {
    if (!canSearchAvailability(user)) {
      throw new ApiError('FORBIDDEN');
    }
    const from = startOfDayUtc(query.from);
    const to = endOfDayUtc(query.to);
    if (from.getTime() > to.getTime()) {
      throw new ApiError('VALIDATION_ERROR', 'from must be before or equal to to');
    }
    const professional = await this.pool.query(
      'SELECT 1 FROM profesional WHERE id = $1',
      [query.professionalId],
    );
    if (professional.rowCount === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Unknown professionalId');
    }
    const result = await this.pool.query<{ franja_inicio: Date; franja_fin: Date }>(
      `SELECT d.franja_inicio, d.franja_fin
       FROM disponibilidad d
       WHERE d.profesional_id = $1
         AND d.franja_inicio >= $2
         AND d.franja_inicio <= $3
         AND d.franja_inicio > now()
         AND NOT EXISTS (
           SELECT 1 FROM cita c
           WHERE c.profesional_id = d.profesional_id
             AND c.franja_inicio = d.franja_inicio
             AND c.estado <> 'cancelled'
         )
       ORDER BY d.franja_inicio ASC`,
      [query.professionalId, from.toISOString(), to.toISOString()],
    );
    return result.rows.map((row) => ({
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }

  async listProfessionals(): Promise<
    Array<{ id: number; name: string; surname: string; specialty: string }>
  > {
    const result = await this.pool.query<{
      id: number;
      nombre: string;
      apellido: string;
      especialidad: string;
    }>(
      'SELECT id, nombre, apellido, especialidad FROM profesional ORDER BY apellido, nombre',
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.nombre,
      surname: row.apellido,
      specialty: row.especialidad,
    }));
  }

  async replaceAvailability(
    professionalId: number,
    slots: Array<{ start: string; end: string }>,
  ): Promise<Slot[]> {
    const professional = await this.pool.query(
      'SELECT 1 FROM profesional WHERE id = $1',
      [professionalId],
    );
    if (professional.rowCount === 0) {
      throw new ApiError('NOT_FOUND', 'Professional not found');
    }
    const parsed = slots
      .map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))
      .map((slot) => {
        if (
          Number.isNaN(slot.start.getTime()) ||
          Number.isNaN(slot.end.getTime()) ||
          slot.end.getTime() <= slot.start.getTime()
        ) {
          throw new ApiError('VALIDATION_ERROR', 'Each slot needs start < end');
        }
        return slot;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let index = 1; index < parsed.length; index += 1) {
      if (parsed[index].start.getTime() < parsed[index - 1].end.getTime()) {
        throw new ApiError('VALIDATION_ERROR', 'Availability slots must not overlap');
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM disponibilidad WHERE profesional_id = $1', [
        professionalId,
      ]);
      for (const slot of parsed) {
        await client.query(
          `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
           VALUES ($1, $2, $3)
           ON CONFLICT (profesional_id, franja_inicio) DO UPDATE
             SET franja_fin = EXCLUDED.franja_fin`,
          [professionalId, slot.start.toISOString(), slot.end.toISOString()],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const stored = await this.pool.query<{ franja_inicio: Date; franja_fin: Date }>(
      `SELECT franja_inicio, franja_fin FROM disponibilidad
       WHERE profesional_id = $1 ORDER BY franja_inicio ASC`,
      [professionalId],
    );
    return stored.rows.map((row) => ({
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }

  async availabilityOf(
    professionalId: number,
  ): Promise<Array<{ id: number; start: string; end: string }>> {
    const result = await this.pool.query<{
      id: number;
      franja_inicio: Date;
      franja_fin: Date;
    }>(
      `SELECT id, franja_inicio, franja_fin FROM disponibilidad
       WHERE profesional_id = $1 AND franja_inicio >= now()
       ORDER BY franja_inicio ASC LIMIT 400`,
      [professionalId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }
}

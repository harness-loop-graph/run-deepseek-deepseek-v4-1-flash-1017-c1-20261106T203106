import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { ApiError } from '../common/errors';

export interface SlotRecord {
  start: string;
  end: string;
}

export interface BookingContext {
  findSlot(professionalId: number, slotStart: string): Promise<SlotRecord | null>;
  findActiveBooking(
    professionalId: number,
    slotStart: string,
  ): Promise<{ id: number } | null>;
  insertAppointment(input: {
    patientId: number;
    professionalId: number;
    slotStart: string;
    slotEnd: string;
  }): Promise<{ id: number }>;
  recordAudit(input: {
    actorId: number;
    action: string;
    resourceType: string;
    resourceId: number;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export class SlotConflictError extends Error {
  constructor() {
    super('The slot is already booked');
    this.name = 'SlotConflictError';
  }
}

/**
 * Serializes booking attempts for the same professional slot. The PostgreSQL
 * implementation locks the availability row (SELECT ... FOR UPDATE) inside a
 * transaction, so concurrent requests are ordered and only one inserts.
 */
export abstract class BookingStore {
  abstract run<T>(
    professionalId: number,
    slotStart: string,
    work: (context: BookingContext) => Promise<T>,
  ): Promise<T>;

  abstract professionalExists(professionalId: number): Promise<boolean>;
}

@Injectable()
export class PgBookingStore extends BookingStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  async professionalExists(professionalId: number): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM profesional WHERE id = $1',
      [professionalId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async run<T>(
    professionalId: number,
    slotStart: string,
    work: (context: BookingContext) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT franja_inicio, franja_fin FROM disponibilidad
         WHERE profesional_id = $1 AND franja_inicio = $2
         FOR UPDATE`,
        [professionalId, slotStart],
      );
      const context: BookingContext = {
        findSlot: async (profId, start) => {
          const row = locked.rows[0];
          if (!row) {
            return null;
          }
          void profId;
          void start;
          return {
            start: (row.franja_inicio as Date).toISOString(),
            end: (row.franja_fin as Date).toISOString(),
          };
        },
        findActiveBooking: async (profId, start) => {
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM cita
             WHERE profesional_id = $1 AND franja_inicio = $2 AND estado <> 'cancelled'`,
            [profId, start],
          );
          return existing.rows[0] ?? null;
        },
        insertAppointment: async (input) => {
          try {
            const inserted = await client.query<{ id: number }>(
              `INSERT INTO cita (paciente_id, profesional_id, franja_inicio, franja_fin, estado)
               VALUES ($1, $2, $3, $4, 'scheduled') RETURNING id`,
              [
                input.patientId,
                input.professionalId,
                input.slotStart,
                input.slotEnd,
              ],
            );
            return inserted.rows[0];
          } catch (error) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code?: string }).code === '23505'
            ) {
              throw new SlotConflictError();
            }
            throw error;
          }
        },
        recordAudit: async (input) => {
          await client.query(
            `INSERT INTO auditoria (usuario_id, accion, recurso_tipo, recurso_id, detalle)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              input.actorId,
              input.action,
              input.resourceType,
              input.resourceId,
              JSON.stringify(input.detail),
            ],
          );
        },
      };
      const result = await work(context);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof SlotConflictError) {
        throw new ApiError('CONFLICT', 'The slot is already booked');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors';
import { AuthenticatedUser } from '../common/authorization';
import { BookingStore } from './booking.store';

export interface BookingResult {
  id: number;
  patientId: number;
  professionalId: number;
  start: string;
  end: string;
  status: string;
}

/**
 * Transactional booking (RF-13). Validation and the insert happen inside the
 * store's transaction; the store serializes concurrent attempts on the same
 * professional slot so exactly one of them can succeed.
 */
@Injectable()
export class BookingService {
  constructor(private readonly store: BookingStore) {}

  async book(
    user: AuthenticatedUser,
    input: { professionalId: number; slotStart: string },
  ): Promise<BookingResult> {
    if (user.patientId === null) {
      throw new ApiError('FORBIDDEN', 'Only patients can book appointments');
    }
    const slotStart = new Date(input.slotStart);
    if (Number.isNaN(slotStart.getTime())) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'slotStart must be an ISO-8601 timestamp',
      );
    }
    const startIso = slotStart.toISOString();
    const patientId = user.patientId;

    const exists = await this.store.professionalExists(input.professionalId);
    if (!exists) {
      throw new ApiError('VALIDATION_ERROR', 'Unknown professionalId');
    }

    return this.store.run(
      input.professionalId,
      startIso,
      async (context) => {
        const slot = await context.findSlot(input.professionalId, startIso);
        if (!slot) {
          throw new ApiError('VALIDATION_ERROR', 'The slot is not available');
        }
        if (new Date(slot.start).getTime() <= Date.now()) {
          throw new ApiError('VALIDATION_ERROR', 'The slot is in the past');
        }
        const active = await context.findActiveBooking(
          input.professionalId,
          startIso,
        );
        if (active) {
          throw new ApiError('CONFLICT', 'The slot is already booked');
        }
        const inserted = await context.insertAppointment({
          patientId,
          professionalId: input.professionalId,
          slotStart: startIso,
          slotEnd: slot.end,
        });
        await context.recordAudit({
          actorId: user.id,
          action: 'cita.create',
          resourceType: 'cita',
          resourceId: inserted.id,
          detail: { professionalId: input.professionalId, slotStart: startIso },
        });
        return {
          id: inserted.id,
          patientId,
          professionalId: input.professionalId,
          start: startIso,
          end: slot.end,
          status: 'scheduled',
        };
      },
    );
  }
}

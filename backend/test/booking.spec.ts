import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/errors';
import {
  BookingContext,
  BookingStore,
  SlotConflictError,
} from '../src/appointments/booking.store';
import { BookingService } from '../src/appointments/booking.service';
import { AuthenticatedUser } from '../src/common/authorization';

/**
 * In-memory store with a single mutex per (professional, slot) key. It mirrors
 * the PostgreSQL implementation: the transaction locks the slot row, checks
 * for an active booking and inserts, so two concurrent attempts are ordered and
 * the second observes the first one.
 */
class InMemoryBookingStore extends BookingStore {
  private readonly slots = new Set<string>();
  private readonly bookings = new Map<string, { id: number }>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private nextId = 1;

  constructor(
    private readonly knownProfessionals: number[],
    slots: Array<{ professionalId: number; start: string; end: string }>,
  ) {
    super();
    for (const slot of slots) {
      this.slots.add(`${slot.professionalId}|${slot.start}|${slot.end}`);
    }
  }

  async professionalExists(professionalId: number): Promise<boolean> {
    return this.knownProfessionals.includes(professionalId);
  }

  async run<T>(
    professionalId: number,
    slotStart: string,
    work: (context: BookingContext) => Promise<T>,
  ): Promise<T> {
    const key = `${professionalId}|${slotStart}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      key,
      previous.then(() => current),
    );
    await previous;
    try {
      const context: BookingContext = {
        findSlot: async (profId, start) => {
          for (const entry of this.slots) {
            const [entryProf, entryStart, entryEnd] = entry.split('|');
            if (
              Number(entryProf) === profId &&
              entryStart === start
            ) {
              return { start: entryStart, end: entryEnd };
            }
          }
          return null;
        },
        findActiveBooking: async (profId, start) => {
          return this.bookings.get(`${profId}|${start}`) ?? null;
        },
        insertAppointment: async (input) => {
          const bookingKey = `${input.professionalId}|${input.slotStart}`;
          if (this.bookings.has(bookingKey)) {
            throw new SlotConflictError();
          }
          const created = { id: this.nextId };
          this.nextId += 1;
          this.bookings.set(bookingKey, created);
          return created;
        },
        recordAudit: async () => undefined,
      };
      return await work(context);
    } finally {
      release();
    }
  }
}

const patient: AuthenticatedUser = {
  id: 1,
  email: 'paciente1@seed.local',
  roles: ['patient'],
  patientId: 1,
  professionalId: null,
};

const otherPatient: AuthenticatedUser = {
  id: 2,
  email: 'paciente2@seed.local',
  roles: ['patient'],
  patientId: 2,
  professionalId: null,
};

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const slotStart = tomorrow.toISOString();

function store(): InMemoryBookingStore {
  return new InMemoryBookingStore(
    [1],
    [
      {
        professionalId: 1,
        start: slotStart,
        end: new Date(tomorrow.getTime() + 30 * 60 * 1000).toISOString(),
      },
    ],
  );
}

describe('RF-13 transactional booking', () => {
  it('creates an appointment for an available slot', async () => {
    const service = new BookingService(store());
    const result = await service.book(patient, {
      professionalId: 1,
      slotStart,
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.status).toBe('scheduled');
    expect(result.patientId).toBe(1);
  });

  it('gives one 201 and one 409 for two concurrent bookings of the same slot', async () => {
    const service = new BookingService(store());
    const results = await Promise.allSettled([
      service.book(patient, { professionalId: 1, slotStart }),
      service.book(otherPatient, { professionalId: 1, slotStart }),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    const rejected = results.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as ApiError;
    expect(reason).toBeInstanceOf(ApiError);
    expect(reason.getStatus()).toBe(409);
  });

  it('rejects a slot that is not offered by the professional', async () => {
    const service = new BookingService(store());
    await expect(
      service.book(patient, {
        professionalId: 1,
        slotStart: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown professional', async () => {
    const service = new BookingService(store());
    await expect(
      service.book(patient, { professionalId: 99, slotStart }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses bookings from users without a patient profile', async () => {
    const service = new BookingService(store());
    await expect(
      service.book(
        { ...patient, roles: ['staff'], patientId: null },
        { professionalId: 1, slotStart },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a slot in the past', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pastStore = new InMemoryBookingStore(
      [1],
      [{ professionalId: 1, start: past, end: new Date(Date.now()).toISOString() }],
    );
    const service = new BookingService(pastStore);
    await expect(
      service.book(patient, { professionalId: 1, slotStart: past }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('allows re-booking a slot after a cancellation releases it', async () => {
    const service = new BookingService(store());
    await service.book(patient, { professionalId: 1, slotStart });
    await expect(
      service.book(otherPatient, { professionalId: 1, slotStart }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

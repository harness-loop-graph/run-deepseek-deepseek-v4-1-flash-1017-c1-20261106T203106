import { describe, expect, it } from 'vitest';
import { ArgumentMetadata } from '@nestjs/common';
import { createValidationPipe } from '../src/common/validation.pipe';
import { ApiError } from '../src/common/errors';
import {
  CreateAppointmentDto,
  CreateEncounterDto,
  CreateUserDto,
  ReplaceAvailabilityDto,
} from '../src/auth/dto';

const bodyMetadata = (metatype: unknown): ArgumentMetadata => ({
  type: 'body',
  metatype: metatype as ArgumentMetadata['metatype'],
  data: undefined,
});

describe('RF-12 input validation', () => {
  it('rejects undeclared fields with 422 instead of ignoring them', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        { email: 'user@seed.local', roles: ['staff'], isAdmin: true },
        bodyMetadata(CreateUserDto),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
  });

  it('rejects undeclared nested fields with 422', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        {
          slots: [
            {
              start: '2026-11-09T08:00:00.000Z',
              end: '2026-11-09T08:30:00.000Z',
              price: 10,
            },
          ],
        },
        bodyMetadata(ReplaceAvailabilityDto),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
  });

  it('rejects an invalid appointment payload with 422', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        { professionalId: 'one', slotStart: 'tomorrow' },
        bodyMetadata(CreateAppointmentDto),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects an empty encounter payload with 422', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform({ notes: '', diagnosis: '' }, bodyMetadata(CreateEncounterDto)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts a declared payload and transforms numbers explicitly', async () => {
    const pipe = createValidationPipe();
    const result = (await pipe.transform(
      { professionalId: 2, slotStart: '2026-11-09T08:00:00.000Z' },
      bodyMetadata(CreateAppointmentDto),
    )) as CreateAppointmentDto;
    expect(result.professionalId).toBe(2);
    expect(result.slotStart).toBe('2026-11-09T08:00:00.000Z');
  });

  it('accepts a valid user payload', async () => {
    const pipe = createValidationPipe();
    const result = (await pipe.transform(
      { email: 'New.User@Seed.local', roles: ['patient'] },
      bodyMetadata(CreateUserDto),
    )) as CreateUserDto;
    expect(result.email).toBe('new.user@seed.local');
    expect(result.roles).toEqual(['patient']);
  });
});

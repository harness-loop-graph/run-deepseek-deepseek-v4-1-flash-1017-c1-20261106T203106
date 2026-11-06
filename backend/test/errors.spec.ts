import { describe, expect, it } from 'vitest';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ApiError } from '../src/common/errors';
import { verifyPkce } from '../src/auth/crypto';
import { createHash, randomBytes } from 'crypto';

interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function run(exception: unknown): Captured {
  const captured: Captured = { status: 0, body: null, headers: {} };
  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = { method: 'GET', url: '/test' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('RF-16 error handling', () => {
  it('renders the envelope for known API errors', () => {
    const result = run(new ApiError('FORBIDDEN'));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You are not allowed to perform this operation',
      },
    });
  });

  it('never leaks a stack trace, SQL or filesystem path for unknown errors', () => {
    const error = new Error(
      'select * from usuario where id = 1 at /app/src/database/pool.ts:42:13',
    );
    error.stack = `Error: select * from usuario\n    at Query.<anonymous> (/app/src/database/pool.ts:42:13)`;
    const result = run(error);
    expect(result.status).toBe(500);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('/app/');
    expect(serialized).not.toContain('select');
    expect(serialized).not.toContain('    at ');
    expect(result.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('scrubs SQL and paths that arrive through framework exceptions', () => {
    const result = run(
      new HttpException(
        'insert into cita failed at /var/lib/appointment.ts',
        500,
      ),
    );
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('/var/lib');
    expect(serialized).not.toContain('insert into');
    expect(result.status).toBe(500);
  });

  it('maps validation errors to 422 with a safe message', () => {
    const result = run(new ApiError('VALIDATION_ERROR', 'slotStart is invalid'));
    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'slotStart is invalid' },
    });
  });

  it('maps rate limiting to 429', () => {
    const result = run(new ApiError('RATE_LIMITED'));
    expect(result.status).toBe(429);
  });

  it('maps payload and media type errors', () => {
    expect(run(new ApiError('PAYLOAD_TOO_LARGE')).status).toBe(413);
    expect(run(new ApiError('UNSUPPORTED_MEDIA_TYPE')).status).toBe(415);
  });

  it('maps multer file size failures to 413 without internals', () => {
    const error = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });
    const result = run(error);
    expect(result.status).toBe(413);
    expect(JSON.stringify(result.body)).not.toContain('MulterError');
  });
});

describe('RF-07/RF-08 PKCE verification', () => {
  const verifier = 'a'.repeat(43) + 'Z-_9';

  function challengeFor(value: string): string {
    return createHash('sha256')
      .update(value)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  it('accepts the matching verifier', () => {
    expect(verifyPkce(verifier, challengeFor(verifier))).toBe(true);
  });

  it('rejects a different verifier', () => {
    expect(verifyPkce(verifier, challengeFor('b'.repeat(50)))).toBe(false);
  });

  it('rejects malformed verifiers', () => {
    expect(verifyPkce('short', challengeFor(verifier))).toBe(false);
    expect(verifyPkce('x'.repeat(200), challengeFor(verifier))).toBe(false);
    expect(verifyPkce('bad*chars'.repeat(8), challengeFor(verifier))).toBe(false);
  });

  it('rejects a random challenge', () => {
    const random = randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyPkce(verifier, random)).toBe(false);
  });
});

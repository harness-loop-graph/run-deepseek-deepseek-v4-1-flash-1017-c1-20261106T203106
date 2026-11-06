import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { ApiError } from './errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter used by the guards below. Limits are per key (IP for the
 * auth endpoints, user id for booking) and every rejection carries
 * `Retry-After` in seconds (RF-14).
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private window(key: string, windowMs: number): Bucket {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh: Bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  /** Returns Retry-After seconds when the window is exhausted. */
  retryAfter(key: string, limit: number, windowMs = 60_000): number | null {
    const current = this.window(key, windowMs);
    if (current.count >= limit) {
      return Math.max(1, Math.ceil((current.resetAt - Date.now()) / 1000));
    }
    return null;
  }

  record(key: string, windowMs = 60_000): void {
    this.window(key, windowMs).count += 1;
  }

  /** Consumes one unit and returns Retry-After when the limit is exceeded. */
  consume(key: string, limit: number, windowMs = 60_000): number | null {
    const retryAfter = this.retryAfter(key, limit, windowMs);
    if (retryAfter !== null) {
      return retryAfter;
    }
    this.record(key, windowMs);
    return null;
  }

  /**
   * A successful authentication clears the window: the auth limit exists to
   * stop credential brute force, not to throttle legitimate sign-ins.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

function limitFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function clientIp(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

export function authKey(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return `auth:${clientIp(request)}`;
}

function reject(response: Response, retryAfter: number): never {
  response.setHeader('Retry-After', String(retryAfter));
  throw new ApiError(
    'RATE_LIMITED',
    `Too many requests. Retry after ${retryAfter} seconds.`,
  );
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const retryAfter = this.limiter.retryAfter(
      authKey(http.getRequest()),
      limitFromEnv('AUTH_RATE_LIMIT_PER_MINUTE', 5),
    );
    if (retryAfter !== null) {
      reject(http.getResponse<Response>(), retryAfter);
    }
    return true;
  }
}

/**
 * Counts rejected authentication attempts (401/400) against the per-IP window
 * and resets the window after a successful authentication.
 */
@Injectable()
export class AuthFailureInterceptor implements NestInterceptor {
  constructor(private readonly limiter: RateLimiter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse<Response>();
    const key = authKey(request);
    return next.handle().pipe(
      tap(() => {
        if (response.statusCode < 400) {
          this.limiter.reset(key);
        }
      }),
      catchError((error: unknown) => {
        this.limiter.record(key);
        return throwError(() => error);
      }),
    );
  }
}

@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const user = request.user as { id?: number } | undefined;
    const key =
      user?.id !== undefined ? `booking:user:${user.id}` : 'booking:anonymous';
    const retryAfter = this.limiter.consume(
      key,
      limitFromEnv('BOOKING_RATE_LIMIT_PER_MINUTE', 10),
    );
    if (retryAfter !== null) {
      reject(http.getResponse<Response>(), retryAfter);
    }
    return true;
  }
}

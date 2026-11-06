export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  seedPassword: string;
  spaOrigin: string;
  uploadDir: string;
  authRateLimitPerMinute: number;
  bookingRateLimitPerMinute: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  authorizationRequestTtlSeconds: number;
  maxUploadBytes: number;
  oauthClientId: string;
  oauthRedirectUri: string;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw;
}

export function loadConfig(): AppConfig {
  return {
    port: readInt('PORT', 3000),
    database: {
      host: readString('DATABASE_HOST', 'localhost'),
      port: readInt('DATABASE_PORT', 5432),
      user: readString('DATABASE_USER', 'medapp'),
      password: readString('DATABASE_PASSWORD', 'medapp'),
      name: readString('DATABASE_NAME', 'medapp'),
    },
    seedPassword: readString('SEED_PASSWORD', 'Seed!Passw0rd'),
    spaOrigin: readString('SPA_ORIGIN', 'http://localhost:8080'),
    uploadDir: readString('UPLOAD_DIR', './uploads'),
    authRateLimitPerMinute: readInt('AUTH_RATE_LIMIT_PER_MINUTE', 5),
    bookingRateLimitPerMinute: readInt('BOOKING_RATE_LIMIT_PER_MINUTE', 10),
    accessTokenTtlSeconds: readInt('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlSeconds: readInt('REFRESH_TOKEN_TTL_SECONDS', 28800),
    authorizationCodeTtlSeconds: readInt('AUTHORIZATION_CODE_TTL_SECONDS', 120),
    authorizationRequestTtlSeconds: readInt('AUTHORIZATION_REQUEST_TTL_SECONDS', 600),
    maxUploadBytes: readInt('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
    oauthClientId: 'medapp-spa',
    oauthRedirectUri: 'http://localhost:8080/auth/callback',
  };
}

export const APP_CONFIG = 'APP_CONFIG';
export const PG_POOL = 'PG_POOL';

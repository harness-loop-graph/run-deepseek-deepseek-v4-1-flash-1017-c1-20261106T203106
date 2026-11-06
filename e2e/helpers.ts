import { expect, type Page } from '@playwright/test';

export const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
export const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Seed!Passw0rd';
export const CLIENT_ID = 'medapp-spa';
export const REDIRECT_URI = 'http://localhost:8080/auth/callback';

export const USERS = {
  patient1: 'paciente1@seed.local',
  patient2: 'paciente2@seed.local',
  patient3: 'paciente3@seed.local',
  gomez: 'gomez@seed.local',
  lopez: 'lopez@seed.local',
  staff: 'staff@seed.local',
  admin: 'admin@seed.local',
} as const;

export function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Signs in through the SPA's SCR-01 form. The SPA posts the credentials to the
 * API, exchanges the PKCE authorization code and lands on its home route.
 */
export async function login(page: Page, email: string): Promise<void> {  await page.goto('/login');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(SEED_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-email')).toHaveCount(0, {
    timeout: 20_000,
  });
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('login-email')).toBeVisible();
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Full authorization-code + PKCE flow against the API, used by tests that need
 * deterministic data setup without going through the UI.
 */
export async function apiLogin(email: string): Promise<string> {
  const { createHash, randomBytes } = await import('node:crypto');
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(
    createHash('sha256').update(verifier).digest(),
  );
  const state = base64Url(randomBytes(16));
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const authorize = await fetch(`${API_BASE_URL}/auth/authorize?${query}`, {
    redirect: 'manual',
  });
  const location = authorize.headers.get('location');
  if (!location) {
    throw new Error('EP-01 did not redirect to the login form');
  }
  const requestId = new URL(location, API_BASE_URL).searchParams.get(
    'request_id',
  );
  const page = await (
    await fetch(`${API_BASE_URL}/auth/login?request_id=${requestId}`)
  ).text();
  const hidden: Record<string, string> = {};
  for (const match of page.matchAll(
    /<input type="hidden" name="([^"]+)" value="([^"]*)" \/>/g,
  )) {
    hidden[match[1]] = match[2];
  }
  const submitted = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...hidden,
      email,
      password: SEED_PASSWORD,
    }),
    redirect: 'manual',
  });
  const redirect = submitted.headers.get('location');
  if (!redirect) {
    throw new Error(`EP-01 login failed with status ${submitted.status}`);
  }
  const code = new URL(redirect).searchParams.get('code');
  const tokenResponse = await fetch(`${API_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokens = (await tokenResponse.json()) as { access_token: string };
  if (tokenResponse.status !== 200) {
    throw new Error(`EP-02 failed with status ${tokenResponse.status}`);
  }
  return tokens.access_token;
}

export async function apiCall<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed as T };
}

export interface ApiAppointment {
  id: number;
  start: string;
  patientId: number;
  professionalId: number;
}

/**
 * Ensures the patient has an appointment with the given professional inside
 * the next `rangeDays` days. Reuses an existing appointment when possible so
 * the suite stays idempotent across runs.
 */
export async function ensureAppointment(
  patientEmail: string,
  professionalId: number,
  rangeDays = 6,
): Promise<ApiAppointment> {
  const token = await apiLogin(patientEmail);
  const existing = await apiCall<ApiAppointment[]>(token, '/me/appointments');
  const reusable = existing.body.find(
    (appointment) =>
      appointment.professionalId === professionalId &&
      appointment.status !== 'cancelled' &&
      new Date(appointment.start).getTime() > Date.now(),
  );
  if (reusable) {
    return reusable;
  }
  const availability = await apiCall<Array<{ start: string }>>(
    token,
    `/availability?professionalId=${professionalId}&from=${isoDate(0)}&to=${isoDate(rangeDays)}`,
  );
  for (const slot of availability.body) {
    const created = await apiCall<ApiAppointment>(token, '/appointments', {
      method: 'POST',
      body: { professionalId, slotStart: slot.start },
    });
    if (created.status === 201) {
      return created.body;
    }
  }
  throw new Error('No free slot could be booked for the test patient');
}

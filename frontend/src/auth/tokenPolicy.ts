/**
 * Token policy (RF-08 / RF-23)
 *
 * - Access token (15 min TTL) is kept in memory only: never written to
 *   localStorage, so a page reload re-runs the PKCE flow.
 * - Refresh token (8 h TTL) is kept in sessionStorage so a reload of the tab can
 *   refresh silently; it is cleared on logout and when the tab closes.
 * - Proactive refresh: a timer renews the access token 60 s before expiry, and
 *   every request that gets a 401 triggers one refresh attempt.
 * - Logout revokes the refresh token with EP-04 and clears both stores.
 */
import { apiRequest, ApiClientError } from '../api/client';
import type { TokenResponse } from '../types';

const REFRESH_STORAGE_KEY = 'medapp.refresh_token';
const REFRESH_MARGIN_MS = 60_000;

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  user: TokenResponse['user'];
}

export function readStoredRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_STORAGE_KEY);
}

export function writeStoredRefreshToken(token: string | null): void {
  if (token === null) {
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(REFRESH_STORAGE_KEY, token);
}

export function toStoredSession(tokens: TokenResponse): StoredSession {
  const now = Date.now();
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now + tokens.expires_in * 1000,
    refreshExpiresAt: now + tokens.refresh_expires_in * 1000,
    user: tokens.user,
  };
}

export function shouldRefreshProactively(session: StoredSession): boolean {
  return Date.now() >= session.expiresAt - REFRESH_MARGIN_MS;
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
  clientId: string,
): Promise<TokenResponse> {
  return apiRequest<TokenResponse>('/auth/token', {
    method: 'POST',
    body: {
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    },
  });
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return apiRequest<TokenResponse>('/auth/token/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await apiRequest<void>('/auth/revoke', {
      method: 'POST',
      body: { token },
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return;
    }
    throw error;
  }
}

import { createHash, randomBytes, randomUUID } from 'crypto';

export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes));
}

export function newId(): string {
  return randomUUID();
}

export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) {
    return false;
  }
  const computed = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  return computed === codeChallenge;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

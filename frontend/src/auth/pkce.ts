export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomString(48);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

export function createState(): string {
  return randomString(24);
}

export interface PendingAuthorization {
  verifier: string;
  state: string;
}

const PENDING_KEY = 'medapp.pending_authorization';

export function savePendingAuthorization(pending: PendingAuthorization): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function readPendingAuthorization(): PendingAuthorization | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingAuthorization>;
    if (typeof parsed.verifier === 'string' && typeof parsed.state === 'string') {
      return { verifier: parsed.verifier, state: parsed.state };
    }
  } catch {
    return null;
  }
  return null;
}

export function clearPendingAuthorization(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

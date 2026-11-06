export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(code: string, message: string, status: number, retryAfter: number | null) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const DEFAULT_API_BASE = 'http://localhost:3000';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  DEFAULT_API_BASE;

export const OAUTH_CLIENT_ID = 'medapp-spa';
export const OAUTH_REDIRECT_URI = `${window.location.origin}/auth/callback`;

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { error?: unknown };
  if (typeof candidate.error !== 'object' || candidate.error === null) {
    return false;
  }
  const inner = candidate.error as { code?: unknown; message?: unknown };
  return typeof inner.code === 'string' && typeof inner.message === 'string';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(
      'NETWORK_ERROR',
      'The server is unreachable. Check your connection and try again.',
      0,
      null,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      const retryHeader = response.headers.get('retry-after');
      throw new ApiClientError(
        payload.error.code,
        payload.error.message,
        response.status,
        retryHeader ? Number.parseInt(retryHeader, 10) : null,
      );
    }
    throw new ApiClientError(
      'INTERNAL_ERROR',
      'The request failed. Please try again.',
      response.status,
      null,
    );
  }

  return payload as T;
}

export async function apiUpload<T>(
  path: string,
  file: File,
  token: string,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: form,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiClientError(
        payload.error.code,
        payload.error.message,
        response.status,
        null,
      );
    }
    throw new ApiClientError(
      'INTERNAL_ERROR',
      'The upload failed. Please try again.',
      response.status,
      null,
    );
  }
  return payload as T;
}

export async function apiDownload(
  path: string,
  token: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (isApiErrorBody(payload)) {
      throw new ApiClientError(
        payload.error.code,
        payload.error.message,
        response.status,
        null,
      );
    }
    throw new ApiClientError(
      'INTERNAL_ERROR',
      'The download failed. Please try again.',
      response.status,
      null,
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match ? match[1] : null };
}

export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfter !== null) {
      return `${error.message}. Retry in ${error.retryAfter}s.`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

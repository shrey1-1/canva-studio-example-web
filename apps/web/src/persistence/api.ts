/**
 * HTTP client for the Canvas Studio server (/api, proxied to the server in development).
 * Every request sends the session cookie and the CSRF header the server requires.
 */

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

/** The server could not be reached at all (not running, or offline). */
export class OfflineError extends ApiError {
  override name = 'OfflineError';
  constructor() {
    super(0, 'Cannot reach the Canvas Studio server. Check that it is running (npm run dev).');
  }
}

type Body = Record<string, unknown> | Blob | undefined;

export async function api<T = unknown>(method: string, path: string, body?: Body, init: { query?: Record<string, string | number>; contentType?: string } = {}): Promise<T> {
  const url = `/api${path}${init.query ? `?${new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)]))}` : ''}`;
  const headers: Record<string, string> = { 'X-Requested-With': 'canvas-studio' };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers['Content-Type'] = init.contentType ?? body.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new OfflineError();
  }
  // The dev proxy answers 502/504 when the server is down.
  if (res.status === 502 || res.status === 504) throw new OfflineError();
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? ((await res.json()) as Record<string, unknown>) : null;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`, data ?? {});
  }
  return (data ?? (await res.blob())) as T;
}

/** Fetches a binary resource (e.g. an image) with the session cookie. */
export async function apiBlob(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  } catch {
    throw new OfflineError();
  }
  return res;
}

let onUnauthorized: (() => void) | undefined;
/** Called when any request finds the session expired (the auth store signs the user out). */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

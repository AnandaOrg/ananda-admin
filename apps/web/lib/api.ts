// Thin client for the NestJS API, served under /api on the same origin.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
  /** No answer from the server (offline, DNS, connection reset). */
  get isNetwork() {
    return this.status === 0;
  }
  /** Someone else changed the record since it was loaded (409 with code `conflict`, or a stale state). */
  get isConflict() {
    return this.status === 409 && this.code !== 'looking_back';
  }
  get isServer() {
    return this.status >= 500;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isForbidden() {
    return this.status === 403;
  }
  /** Rejected because the app is showing figures as of a past day. */
  get isLookingBack() {
    return this.code === 'looking_back';
  }
}

export interface RequestOptions {
  /** Two-step code for sensitive actions (sent as x-two-step-code). */
  code?: string;
  signal?: AbortSignal;
  /** Send this request without the "as of" date even while looking back. */
  live?: boolean;
}

/**
 * "As of" date (YYYY-MM-DD) chosen in the header calendar, or null for today. Sent as `x-as-of` so the
 * API answers figures as they were at the end of that day and refuses changes (see lib/asof.tsx).
 */
let asOf: string | null = null;
export function setApiAsOf(d: string | null) {
  asOf = d;
}
export function getApiAsOf() {
  return asOf;
}

/** Calls that are about the person, not the business data: allowed while looking back. */
const LIVE = /^\/(auth|notifications|ai)(\/|$)/;

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (opts.code) headers['x-two-step-code'] = opts.code;
  if (asOf && !opts.live && !LIVE.test(path)) headers['x-as-of'] = asOf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ananda:network', { detail: false }));
    throw new ApiError(0, NETWORK_MESSAGE, 'offline');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ananda:network', { detail: true }));
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string | string[]; code?: string; fields?: Record<string, string> };
    const msg = Array.isArray(d.message) ? d.message[0] : d.message;
    const fallback = res.status >= 500 ? SERVER_MESSAGE : 'Something went wrong. Try again.';
    const err = new ApiError(res.status, res.status >= 500 ? SERVER_MESSAGE : msg || fallback, d.code, d.fields);
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ananda:unauthorized', { detail: d.code }));
    throw err;
  }
  return data as T;
}

export const NETWORK_MESSAGE = 'Check your connection and try again.';
export const SERVER_MESSAGE = 'Something went wrong on our side. Try again in a minute.';

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

/** Builds a query string from defined values only. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

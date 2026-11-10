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
}

export interface RequestOptions {
  /** Two-step code for sensitive actions (sent as x-two-step-code). */
  code?: string;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (opts.code) headers['x-two-step-code'] = opts.code;
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string | string[]; code?: string; fields?: Record<string, string> };
    const msg = Array.isArray(d.message) ? d.message[0] : d.message;
    const err = new ApiError(res.status, msg || 'Something went wrong. Try again.', d.code, d.fields);
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ananda:unauthorized', { detail: d.code }));
    throw err;
  }
  return data as T;
}

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

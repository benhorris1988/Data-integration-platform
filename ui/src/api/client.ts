// Thin fetch wrapper. All API calls go through `request()` so the dev proxy,
// error shape, and (future) auth header live in one place.

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodySnippet: string;
  constructor(status: number, url: string, message: string, bodySnippet: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

// VITE_API_BASE_URL is mostly empty in development (the Vite proxy at /api
// targets the orchestrator) and in production (same-origin). Set it to an
// absolute URL only when the UI is hosted on a different domain than the API.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = JSON.parse(text);
      if (typeof j?.detail === 'string') msg = j.detail;
      else if (Array.isArray(j?.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg ?? '').join('; ');
    } catch {
      /* body is not JSON; keep the status line */
    }
    throw new ApiError(res.status, url, msg, text.slice(0, 400));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Server-Sent Events helper. Returns an unsubscribe function. The caller
// owns the EventSource and decides what to do on each event.
export function subscribe(
  path: string,
  onEvent: (type: string, data: unknown) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `${BASE}${path}`;
  const es = new EventSource(url, { withCredentials: true });
  const handler = (e: MessageEvent) => {
    let parsed: unknown = e.data;
    try {
      parsed = JSON.parse(e.data);
    } catch {
      /* keep raw string */
    }
    onEvent(e.type, parsed);
  };
  // Wildcard listening — sse-starlette names events ("run.started", "step.progress", …),
  // so addEventListener for the ones we care about. EventSource also emits 'message'
  // for unnamed payloads, and we don't use those.
  const events = [
    'run.started',
    'run.finished',
    'run.error',
    'step.started',
    'step.progress',
    'step.finished',
    'ping',
  ];
  for (const t of events) es.addEventListener(t, handler);
  if (onError) es.onerror = onError;
  return () => {
    for (const t of events) es.removeEventListener(t, handler);
    es.close();
  };
}

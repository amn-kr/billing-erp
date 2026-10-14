import { useSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Gets a new access token from the refresh cookie. Several callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!r.ok) {
        useSession.getState().setToken(null);
        return false;
      }
      const body = (await r.json()) as { accessToken: string };
      useSession.getState().setToken(body.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

const NETWORK = 'No internet connection.';

/** JSON call to the API. Retries once after refreshing an expired access token. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, retry = true): Promise<T> {
  const token = useSession.getState().accessToken;
  let r: Response;
  try {
    r = await fetch('/api' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: { ...init.headers, ...(init.body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, NETWORK);
  }
  if (r.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  if (!r.ok) {
    let msg = 'Something went wrong.';
    let code: string | undefined;
    try {
      const b = (await r.json()) as { message?: string | string[]; code?: string };
      if (b.message) msg = Array.isArray(b.message) ? b.message[0]! : b.message;
      code = b.code;
    } catch {
      /* not JSON */
    }
    if (r.status === 429) msg = 'Too many tries. Wait a minute and try again.';
    throw new ApiError(r.status, msg, code);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/** Calls that return a new access token (sign-in, create shop, switch shop, join). */
export async function apiWithToken<T extends { accessToken: string }>(path: string, body?: unknown): Promise<T> {
  const res = await api<T>(path, { method: 'POST', body: body ?? {} });
  useSession.getState().setToken(res.accessToken);
  return res;
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    useSession.getState().setToken(null);
  }
}

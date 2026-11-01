/**
 * The panel's own connection to the API: its own token (in memory) and refresh cookie (erp_ort on
 * /api/owner/auth), never the shop app's. Without a panel sign-in it sends the person to the sign-in page.
 */
let token: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class OwnerApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function refreshOwner(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch('/api/owner/auth/refresh', { method: 'POST', credentials: 'include' });
      token = r.ok ? ((await r.json()) as { accessToken: string }).accessToken : null;
      return r.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export const toSignIn = () => window.location.replace('/login');

export async function ownerApi<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/owner' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: { ...(init.body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new OwnerApiError(0, 'No internet connection.');
  }
  if (r.status === 401 && retry) {
    if (await refreshOwner()) return ownerApi<T>(path, init, false);
    toSignIn();
  }
  if (!r.ok) {
    let msg = 'Something went wrong.';
    try {
      const b = (await r.json()) as { message?: string | string[] };
      if (b.message) msg = Array.isArray(b.message) ? b.message[0]! : b.message;
    } catch {
      /* not JSON */
    }
    if (r.status === 429) msg = 'Too many tries. Wait a minute and try again.';
    throw new OwnerApiError(r.status, msg);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export async function ownerSignOut(): Promise<void> {
  try {
    await fetch('/api/owner/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    token = null;
    toSignIn();
  }
}

/**
 * Which file of the web app (apps/web/dist) answers an address, in single-PC mode — the same rules as
 * the live site's (Render: /login → login.html, anything else → index.html). null: not a page
 * (the API, or a file such as /assets/… that express.static serves itself).
 */
/**
 * Google sign-in for Drive backups (a "Desktop app" client) sends the web browser back to this
 * computer's bare address, http://127.0.0.1:<port>/?state=…&code=… (the form Google documents for
 * desktop apps): that visit goes on to the API's Drive step. null: an ordinary visit.
 */
export function googleReturn(method: string, urlPath: string, query: Record<string, unknown>): string | null {
  if (method !== 'GET' || urlPath !== '/' || typeof query.state !== 'string' || (typeof query.code !== 'string' && typeof query.error !== 'string')) return null;
  const q = new URLSearchParams();
  for (const k of ['state', 'code', 'error', 'scope']) if (typeof query[k] === 'string') q.set(k, query[k] as string);
  return `/api/backup/drive/callback?${q}`;
}

export function pageFor(method: string, urlPath: string): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return null;
  // a real file (assets, privacy.html …) is served as it is
  if (/\.[a-z0-9]+$/i.test(urlPath)) return null;
  if (urlPath === '/login' || urlPath.startsWith('/login/')) return 'login.html';
  return 'index.html';
}

/**
 * Which file of the web app (apps/web/dist) answers an address, in single-PC mode — the same rules as
 * the live site's (Render: /login → login.html, anything else → index.html). null: not a page
 * (the API, or a file such as /assets/… that express.static serves itself).
 */
export function pageFor(method: string, urlPath: string): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return null;
  // a real file (assets, privacy.html …) is served as it is
  if (/\.[a-z0-9]+$/i.test(urlPath)) return null;
  if (urlPath === '/login' || urlPath.startsWith('/login/')) return 'login.html';
  return 'index.html';
}

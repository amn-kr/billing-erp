/**
 * A pretend Google (sign-in tokens, Drive folders and files) for tests: the API's Drive tests and the
 * Windows app's restore drill. Client "test-client" / "test-secret"; sign-in code "good-code".
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const REFRESH = 'rt-SECRET-refresh-token-123';
const FOLDER = 'application/vnd.google-apps.folder';

export interface FakeGoogle {
  base: string;
  g: {
    folders: Map<string, { name: string; trashed: boolean }>;
    files: Map<string, { name: string; parent: string; bytes: Buffer }>;
    sessions: Map<string, { name: string; parent: string }>;
    calls: { method: string; path: string; auth: string; body: string }[];
    account: string; revoked: boolean; full: boolean; shortUpload: boolean; scope: string; n: number;
  };
  reset(): void;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage) => new Promise<Buffer>((ok) => { const parts: Buffer[] = []; req.on('data', (c: Buffer) => parts.push(c)); req.on('end', () => ok(Buffer.concat(parts))); });

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const g: FakeGoogle['g'] = {
    folders: new Map(), files: new Map(), sessions: new Map(), calls: [],
    account: 'owner@gmail.com', revoked: false, full: false, shortUpload: false, scope: DRIVE_SCOPE, n: 0,
  };
  let base = '';
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const body = await readBody(req);
    const authz = String(req.headers.authorization ?? '');
    g.calls.push({ method: req.method!, path: url.pathname + url.search, auth: authz, body: body.length < 2000 ? body.toString() : `(${body.length} bytes)` });
    const json = (code: number, v: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/token') {
      const f = new URLSearchParams(body.toString());
      if (f.get('client_id') !== 'test-client' || f.get('client_secret') !== 'test-secret') return json(401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        if (f.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'at-first', refresh_token: REFRESH, scope: g.scope, expires_in: 3600 });
      }
      if (f.get('refresh_token') !== REFRESH || g.revoked) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `at-${++g.n}`, expires_in: 3600 });
    }
    if (!authz.startsWith('Bearer at-') || (g.revoked && authz !== 'Bearer at-first')) return json(401, { error: { code: 401 } });
    if (url.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: g.account } });
    // listing (drive.file: only what this app made): folders, or the files in one folder
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const inFolder = q.match(/'([^']+)' in parents/)?.[1];
      if (q.includes(`mimeType='${FOLDER}'`)) {
        return json(200, { files: [...g.folders].filter(([, f]) => !f.trashed).map(([id, f]) => ({ id, name: f.name })) });
      }
      if (inFolder) {
        return json(200, { files: [...g.files].filter(([, f]) => f.parent === inFolder).map(([id, f]) => ({ id, name: f.name, size: String(f.bytes.length) })) });
      }
      return json(400, { error: { code: 400 } });
    }
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse(body.toString()) as { name: string; mimeType: string };
      const id = `folder-${++g.n}`;
      g.folders.set(id, { name: meta.name, trashed: false });
      return json(200, { id });
    }
    const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one && req.method === 'GET') {
      const id = decodeURIComponent(one[1]!);
      if (url.searchParams.get('alt') === 'media') {
        const f = g.files.get(id);
        if (!f) return json(404, { error: { code: 404 } });
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(f.bytes);
      }
      const folder = g.folders.get(id);
      return folder ? json(200, { id, trashed: folder.trashed }) : json(404, { error: { code: 404 } });
    }
    if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      if (g.full) return json(403, { error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }] } });
      const meta = JSON.parse(body.toString()) as { name: string; parents: string[] };
      if (!g.folders.has(meta.parents[0]!)) return json(404, { error: { code: 404 } });
      const s = `s${++g.n}`;
      g.sessions.set(s, { name: meta.name, parent: meta.parents[0]! });
      return json(200, {}, { location: `${base}/upload/session/${s}` });
    }
    const up = url.pathname.match(/^\/upload\/session\/(.+)$/);
    if (up && req.method === 'PUT') {
      const s = g.sessions.get(up[1]!)!;
      const id = `file-${++g.n}`;
      g.files.set(id, { name: s.name, parent: s.parent, bytes: body });
      return json(200, { id, size: String(g.shortUpload ? body.length - 1 : body.length) });
    }
    json(404, { error: { code: 404 } });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    g,
    reset: () => Object.assign(g, { revoked: false, full: false, shortUpload: false, scope: DRIVE_SCOPE, account: 'owner@gmail.com' }),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

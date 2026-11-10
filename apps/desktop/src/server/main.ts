/**
 * Single-PC mode's server, run by the Windows app in its own process (Electron utilityProcess):
 * the same API as the live server (apps/api, compiled), plus the web app's pages, from one address on
 * this computer only (http://127.0.0.1:<port>). Before it starts it sets up the books' database and
 * applies any new migrations (migrate.ts).
 *
 * The app passes everything in its environment (BILLING_LOCAL_*), and is told "ready" or the error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prepare, readMigrations } from './migrate';
import { pageFor } from './pages';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is missing`);
  return v;
};

const tell = (m: { ready: true; port: number; migrated: string[] } | { error: string }) => {
  const port = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort;
  if (port) port.postMessage(m);
  else console.log(JSON.stringify(m));
};

/**
 * If the app itself is gone (killed, crashed) this server stops too, within 2 seconds, so it never keeps
 * the app's address busy for the next start.
 */
function followParent() {
  const parent = Number(process.env.BILLING_LOCAL_PARENT_PID);
  if (!parent) return;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}

async function main() {
  followParent();
  const port = Number(env('BILLING_LOCAL_PORT'));
  const dbPort = Number(env('BILLING_LOCAL_DB_PORT'));
  const appPassword = env('BILLING_LOCAL_APP_PASSWORD');
  const web = env('BILLING_LOCAL_WEB');
  const database = 'billing_erp';

  const migrated = await prepare({ port: dbPort, adminPassword: env('BILLING_LOCAL_ADMIN_PASSWORD'), appPassword, database, migrations: readMigrations(env('BILLING_LOCAL_MIGRATIONS')) });

  // the API's settings (apps/api/src/config.ts), for this computer only
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: `postgresql://erp_app:${encodeURIComponent(appPassword)}@127.0.0.1:${dbPort}/${database}`,
    JWT_SECRET: env('BILLING_LOCAL_JWT_SECRET'),
    WEB_ORIGINS: origin,
    APP_URL: origin,
    // plain http on this computer: the sign-in cookie cannot be "secure"
    COOKIE_SECURE: 'false',
    DEMO_ENABLED: 'false',
    // backups (Settings › General › Backup & restore), locked with this PC's recovery key; folders and
    // pen drives on this computer (the live server never has them)
    BACKUP_MASTER_KEY: env('BILLING_LOCAL_BACKUP_KEY'),
    BACKUP_WORKER: 'on',
    BACKUP_FOLDERS: 'on',
    // the books are on this computer's disk, not a hosting plan with a size limit
    DB_SPACE_LIMIT_MB: '102400',
  });
  // the passwords stay in this process's settings only as the connection above (and the API's settings)
  for (const k of ['BILLING_LOCAL_ADMIN_PASSWORD', 'BILLING_LOCAL_APP_PASSWORD', 'BILLING_LOCAL_JWT_SECRET', 'BILLING_LOCAL_BACKUP_KEY']) delete process.env[k];

  require('reflect-metadata');
  // loaded only now: the API reads its settings when it starts
  const { createApp } = require('../../../api/dist/app.factory') as { createApp(): Promise<unknown> };
  const app = (await createApp()) as {
    useStaticAssets(dir: string, o: { index: boolean; maxAge: string }): void;
    use(fn: (req: { method: string; path: string }, res: { sendFile(p: string): void; setHeader(k: string, v: string): void }, next: () => void) => void): void;
    listen(port: number, host: string): Promise<unknown>;
  };

  // the web app's pages: files as they are, every screen's address → index.html, /login → login.html
  app.useStaticAssets(web, { index: false, maxAge: '1h' });
  app.use((req: { method: string; path: string }, res: { sendFile(p: string): void; setHeader(k: string, v: string): void }, next: () => void) => {
    const page = pageFor(req.method, req.path);
    if (!page) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(web, page));
  });
  if (!fs.existsSync(path.join(web, 'index.html'))) throw new Error(`The app's pages are missing: ${web}`);

  await app.listen(port, '127.0.0.1');
  tell({ ready: true, port, migrated });
}

main().catch((e: unknown) => {
  tell({ error: e instanceof Error ? e.message : String(e) });
  setTimeout(() => process.exit(1), 100);
});

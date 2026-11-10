/**
 * Single-PC mode, start to finish: the shop's database (db.ts) and the server (server/main.ts, in its own
 * process), then the app opens at http://127.0.0.1:<port>. Closing the app stops the server and then the
 * database cleanly. When the app's version changed since the last start, a copy of the stopped database
 * is made first (<root>/backups), so an upgrade can always be undone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { LocalDatabase } from './db';
import { formatKey } from './recovery';
import { freePort, loadSettings, saveSettings } from './state';

export interface LocalPaths {
  /** <userData>/local */
  root: string;
  /** PostgreSQL's bin/, lib/, share/ */
  pgDir: string;
  /** server.cjs, node_modules/, migrations/ */
  serverDir: string;
  /** the web app's pages */
  webDir: string;
}

export interface Local {
  origin: string;
  stop(): Promise<void>;
  /** this PC's recovery key (opens its backups on any computer), and when it was last printed */
  recovery(): Promise<{ key: string; printedAt: string | null }>;
  markPrinted(): Promise<void>;
}

const today = () => new Date().toISOString().slice(0, 10);

/** the app's Google sign-in client (empty: Drive not set up); url: a pretend Google in tests */
export interface GoogleClient { id: string; secret: string; url: string }

export async function startLocal(p: LocalPaths, version: string, google: GoogleClient = { id: '', secret: '', url: '' }, cloudUrl = ''): Promise<Local> {
  fs.mkdirSync(p.root, { recursive: true });
  const settings = await loadSettings(p.root);
  const db = new LocalDatabase({ pgDir: p.pgDir, root: p.root });

  if (!db.exists()) {
    await db.create(settings.adminPassword);
  } else if (settings.lastVersion && settings.lastVersion !== version) {
    // an app update: copy the books as they are before the new version upgrades them
    if (await db.running()) await db.stop();
    db.backup(`before-${version}-${today()}`);
  }

  await db.start(await freePort());

  // the app keeps its address from start to start (sign-in and screen choices belong to it); after a crash
  // the old server may hold it for a moment more (it stops on its own within 2 s), so wait a little first
  let port = await freePort(settings.appPort);
  for (let i = 0; i < 20 && port !== settings.appPort; i++) {
    await new Promise((r) => setTimeout(r, 250));
    port = await freePort(settings.appPort);
  }
  if (port !== settings.appPort) saveSettings(p.root, { ...settings, appPort: port });

  const log = fs.openSync(path.join(p.root, 'server.log'), 'a');
  let server: UtilityProcess | null = null;
  let stopping = false;
  let restarts = 0;

  const fork = () => new Promise<void>((ready, fail) => {
    const child = utilityProcess.fork(path.join(p.serverDir, 'server.cjs'), [], {
      serviceName: 'Billing server',
      stdio: 'pipe',
      env: {
        ...process.env,
        BILLING_LOCAL_PORT: String(port),
        BILLING_LOCAL_PARENT_PID: String(process.pid),
        BILLING_LOCAL_DB_PORT: String(db.port),
        BILLING_LOCAL_ADMIN_PASSWORD: settings.adminPassword,
        BILLING_LOCAL_APP_PASSWORD: settings.appPassword,
        BILLING_LOCAL_JWT_SECRET: settings.jwtSecret,
        BILLING_LOCAL_BACKUP_KEY: settings.backupKey!,
        BILLING_LOCAL_GOOGLE_ID: google.id,
        BILLING_LOCAL_GOOGLE_SECRET: google.secret,
        BILLING_LOCAL_GOOGLE_URL: google.url,
        BILLING_LOCAL_CLOUD_URL: cloudUrl,
        BILLING_LOCAL_WEB: p.webDir,
        BILLING_LOCAL_MIGRATIONS: path.join(p.serverDir, 'migrations'),
      },
    });
    server = child;
    child.stdout?.on('data', (d: Buffer) => fs.writeSync(log, d));
    child.stderr?.on('data', (d: Buffer) => fs.writeSync(log, d));
    const timer = setTimeout(() => fail(new Error('The server did not start within 2 minutes; see server.log')), 120_000);
    child.on('message', (m: { ready?: boolean; error?: string; migrated?: string[] }) => {
      if (m.ready) {
        clearTimeout(timer);
        if (m.migrated?.length) fs.writeSync(log, `Upgraded the books: ${m.migrated.join(', ')}\n`);
        ready();
      } else if (m.error) {
        clearTimeout(timer);
        fail(new Error(m.error));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (stopping || server !== child) return;
      fs.writeSync(log, `The server stopped unexpectedly (code ${code})\n`);
      // start it again (a few times), so a one-off failure does not leave the app without its server
      if (restarts++ < 3) fork().catch((e: unknown) => fs.writeSync(log, `Restart failed: ${String(e)}\n`));
    });
  });

  try {
    await fork();
  } catch (e) {
    stopping = true;
    (server as UtilityProcess | null)?.kill();
    await db.stop();
    throw e;
  }
  saveSettings(p.root, { ...(await loadSettings(p.root)), lastVersion: version });

  return {
    origin: `http://127.0.0.1:${port}`,
    async recovery() {
      const s = await loadSettings(p.root);
      return { key: formatKey(s.backupKey!), printedAt: s.keyPrintedAt ?? null };
    },
    async markPrinted() {
      saveSettings(p.root, { ...(await loadSettings(p.root)), keyPrintedAt: new Date().toISOString() });
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      const child = server as UtilityProcess | null;
      if (child) {
        const gone = new Promise<void>((r) => { child.once('exit', () => r()); setTimeout(r, 5000); });
        child.kill();
        await gone;
      }
      await db.stop();
      fs.closeSync(log);
    },
  };
}

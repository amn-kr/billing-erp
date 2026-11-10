/**
 * Single-PC mode's own settings, kept in the app's folder (<userData>/local/settings.json):
 * the database passwords, the sign-in key, and the app's fixed address port. Made once, on first start.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { makeKey } from './recovery';

export interface LocalSettings {
  /** PostgreSQL's own superuser (setup and upgrades only) */
  adminPassword: string;
  /** the role the server uses (erp_app: row-level security applies) */
  appPassword: string;
  /** signs the sign-in tokens */
  jwtSecret: string;
  /**
   * The app's address is http://127.0.0.1:<appPort>. Kept the same from start to start: the sign-in
   * and the screen choices belong to the address. Changed only if another program takes it.
   */
  appPort: number;
  /** the app version that last started successfully (a new one backs up the database first) */
  lastVersion?: string;
  /**
   * Locks this PC's backups (the API's BACKUP_MASTER_KEY): the "recovery key" the owner prints, needed to
   * open the backups on another computer. 32 characters A–Z and 2–7 (recovery.ts).
   */
  backupKey?: string;
  /** when the owner last printed the recovery key (until then Settings reminds them) */
  keyPrintedAt?: string;
}

const secret = () => crypto.randomBytes(32).toString('base64url');

/** A port nothing is listening on, on this computer only. */
export function freePort(prefer = 0): Promise<number> {
  return new Promise((done, fail) => {
    const s = net.createServer();
    s.unref();
    s.once('error', (e: NodeJS.ErrnoException) => (prefer && e.code === 'EADDRINUSE' ? freePort(0).then(done, fail) : fail(e)));
    s.listen(prefer, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => done(port));
    });
  });
}

export function settingsFile(root: string) {
  return path.join(root, 'settings.json');
}

/** Read the settings, or make them the first time. */
export async function loadSettings(root: string): Promise<LocalSettings> {
  const file = settingsFile(root);
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalSettings;
    if (s.adminPassword && s.appPassword && s.jwtSecret && s.appPort) {
      // books made before backups existed get their key now
      if (!s.backupKey) saveSettings(root, Object.assign(s, { backupKey: makeKey() }));
      return s;
    }
  } catch { /* first start */ }
  const s: LocalSettings = { adminPassword: secret(), appPassword: secret(), jwtSecret: secret(), appPort: await freePort(), backupKey: makeKey() };
  saveSettings(root, s);
  return s;
}

export function saveSettings(root: string, s: LocalSettings) {
  fs.mkdirSync(root, { recursive: true });
  // written whole, then swapped in, so a power cut never leaves half a file
  const file = settingsFile(root);
  fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

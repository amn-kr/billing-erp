/**
 * Backup statuses for the Backup & restore screen's pictures and flows (Settings › General), at the
 * frozen test clock: Google Drive and the folder on this computer are connected in later steps, so
 * these looks are shown with the server's answer filled in by the test.
 */
import type { Page, Route } from '@playwright/test';

const NOW = new Date('2026-10-01T14:00:00+05:30');
const t = (sec: number) => new Date(+NOW - sec * 1000).toISOString();
const ok = (sec: number) => ({ lastOkAt: t(sec), failingSince: null, error: null, waiting: 0 });
const drive = (x = {}) => ({ enabled: true, connected: true, folder: 'Billing ERP Backup - Verma Traders', account: 'pooja.verma@gmail.com', lastSnapshotAt: t(13 * 3600 - 300), ...ok(40), ...x });
const local = (x = {}) => ({ enabled: true, connected: true, folder: 'ERP backups', account: '', lastSnapshotAt: t(13 * 3600 - 300), ...ok(95), ...x });
const base = (x: object) => ({ keySet: true, dest: null, drive: null, local: null, snapshot: { lastAt: t(13 * 3600 - 300) }, space: { usedMb: 38, limitMb: 500 }, failMinutes: 15, now: NOW.toISOString(), ...x });

export const BKP = {
  /** nothing chosen yet (the General tab's picture) */
  none: base({ snapshot: { lastAt: null } }),
  drive: base({ dest: 'drive', drive: drive() }),
  computer: base({ dest: 'local', local: local() }),
  both: base({ dest: 'both', drive: drive(), local: local() }),
  driveRed: base({ dest: 'both', drive: drive({ lastOkAt: t(23 * 60 + 40), failingSince: t(23 * 60), error: 'Can’t reach Google Drive.', waiting: 37 }), local: local() }),
  retrying: base({ dest: 'drive', drive: drive({ lastOkAt: t(4 * 60 + 10), failingSince: t(3 * 60), error: 'Can’t reach Google Drive.', waiting: 6 }) }),
  firstTime: base({ dest: 'both', drive: drive({ connected: false, lastOkAt: null, lastSnapshotAt: null }), local: local({ connected: false, lastOkAt: null, lastSnapshotAt: null }), snapshot: { lastAt: null } }),
  spaceLow: base({ dest: 'drive', drive: drive(), space: { usedMb: 441, limitMb: 500 } }),
  /** failing for `min` minutes */
  failingFor: (min: number) => base({ dest: 'drive', drive: drive({ lastOkAt: t(min * 60 + 30), failingSince: t(min * 60), error: 'Can’t reach Google Drive.', waiting: 3 }) }),
};

export const TEST_RESTORE = {
  from: 'drive', fullCopyAt: t(13 * 3600 - 300), changes: 214, upTo: t(40), matches: true, differences: [],
  invoices: 1284, parties: 312, items: 1046, purchaseBills: 418, paymentsReceived: 906, salesTotalThisYear: '4872310.00',
};
export const RESTORED = { businessId: '00000000-0000-4000-8000-000000000001', code: 'BE-1099', name: 'Verma Traders' };

/** Answers /api/backup/* with `status` (changeable later through the returned setter); the rest goes to the real server. */
export async function fakeBackup(page: Page, status: object): Promise<{ set: (s: object) => void; restoreBody: () => unknown }> {
  let current = status;
  let body: unknown = null;
  await page.route('**/api/backup/status', (r: Route) => r.fulfill({ json: current }));
  await page.route('**/api/backup/test-restore', (r: Route) => r.fulfill({ json: TEST_RESTORE }));
  await page.route('**/api/backup/restore', (r: Route) => { body = r.request().postDataJSON(); return r.fulfill({ json: RESTORED }); });
  return { set: (s) => { current = s; }, restoreBody: () => body };
}

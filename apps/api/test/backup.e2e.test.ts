import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type BackupDestination } from '@prisma/client';
import request from 'supertest';
import { todayIst } from '@billing/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, member, owner, startApp } from './helpers';
import { resetConfig } from '../src/config';
import { BackupService, type Sender } from '../src/modules/backup/backup.service';
import { lockFile, openFile, sha256 } from '../src/modules/backup/crypto';
import type { SnapshotBody } from '../src/modules/backup/restore';

/**
 * Real-time backup: every save lands in the change list, the sender delivers it to a place
 * (here a pretend Google Drive) only counting it once the place confirms, retries while the
 * place is down, and a restore rebuilds the books from the latest full copy + later changes.
 */
const KEY = 'api-test-backup-master-key-0123456789abcdef';
let app: INestApplication;
let db: PrismaClient;
let svc: BackupService;
const http = () => request(app.getHttpServer());
const D = todayIst();

/** A pretend Google Drive that keeps files in memory and can be switched off. */
class FakeDrive implements Sender {
  files = new Map<string, Buffer>();
  connected = true;
  down = false;
  noConfirm = false;
  ready() { return this.connected; }
  async put(d: BackupDestination, name: string, file: Buffer) {
    if (this.down) throw new Error('Can’t reach Google Drive.');
    const ref = `${d.businessId}/${name}`;
    this.files.set(ref, Buffer.from(file));
    if (this.noConfirm) throw new Error('Google Drive did not confirm the file.');
    return { ref };
  }
  async get(_d: BackupDestination, f: { ref: string }) {
    const b = this.files.get(f.ref);
    if (!b) throw new Error('File not found.');
    return b;
  }
}
const drive = new FakeDrive();

const asShop = <T>(businessId: string | null, fn: (tx: PrismaClient) => Promise<T>, worker = false) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId ?? ''}, true), set_config('app.worker', ${worker ? 'backup' : ''}, true)`;
    return fn(tx as unknown as PrismaClient);
  });

beforeAll(async () => {
  process.env.BACKUP_MASTER_KEY = KEY;
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
  svc = app.get(BackupService);
  svc.registerSender('drive', drive);
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});
beforeEach(() => {
  Object.assign(drive, { connected: true, down: false, noConfirm: false });
});

type S = Awaited<ReturnType<typeof owner>>;
const party = (o: S, name: string) => http().post('/api/parties').set(auth(o)).send({ name }).expect(201);
const status = async (o: S) => (await http().get('/api/backup/status').set(auth(o)).expect(200)).body;
const useDrive = (o: S) => http().put('/api/backup/destination').set(auth(o)).send({ dest: 'drive' }).expect(200);
const dest = (o: S) => asShop(o.businessId, (tx) => tx.backupDestination.findFirstOrThrow({ where: { kind: 'drive' } }));
const files = (o: S) => asShop(o.businessId, (tx) => tx.backupFile.findMany({ orderBy: { createdAt: 'asc' } }));

/** A shop with two items, a party and an invoice. */
async function shop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540', openingDate: D }).expect(201)).body;
  await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200', openingDate: D }).expect(201);
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000', openingDate: D }).expect(201)).body;
  const inv = (await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '3', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201)).body;
  return { o, fan, verma, inv };
}

describe('change list', () => {
  it('every shop table copies its changes into the change list', async () => {
    const rows = await db.$queryRaw<{ t: string; has: boolean }[]>`
      SELECT c.relname AS t, EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = c.relname || '_backup') AS has
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        AND (c.relname = 'businesses' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped))
        AND c.relname NOT IN ('sessions', 'invites', 'change_log', 'backup_destinations', 'backup_files')`;
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.has).map((r) => r.t)).toEqual([]);
  });

  it('a save and its change are written together; an undone save leaves no change', async () => {
    const o = await owner(app);
    await party(o, 'Verma Traders');
    const changes = await asShop(o.businessId, (tx) => tx.changeLog.findMany({ where: { tbl: 'parties' } }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ op: 'I', seq: null, data: { name: 'Verma Traders', business_id: o.businessId } });
    const before = await asShop(o.businessId, (tx) => tx.changeLog.count());
    await expect(asShop(o.businessId, async (tx) => {
      await tx.taxRate.updateMany({ data: { note: 'changed, then undone' } });
      throw new Error('undo');
    })).rejects.toThrow('undo');
    expect(await asShop(o.businessId, (tx) => tx.changeLog.count())).toBe(before);
  });

  it('one shop never sees another shop’s changes or backup places', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await useDrive(a);
    await useDrive(b);
    const seen = await asShop(a.businessId, (tx) => tx.changeLog.findMany());
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every((c) => c.businessId === a.businessId)).toBe(true);
    expect(await asShop(null, (tx) => tx.changeLog.count())).toBe(0);
    expect(await asShop(null, (tx) => tx.backupDestination.count())).toBe(0);
    // the every-minute sender may list which shops have places, but still sees no shop's changes
    const listed = await asShop(null, (tx) => tx.backupDestination.findMany(), true);
    expect(listed.map((d) => d.businessId)).toEqual(expect.arrayContaining([a.businessId, b.businessId]));
    expect(await asShop(null, (tx) => tx.changeLog.count(), true)).toBe(0);
    await expect(asShop(a.businessId, (tx) => tx.changeLog.deleteMany({}))).rejects.toThrow(/permission denied/);
  });

  it('numbers a shop’s changes 1, 2, 3 … in the order they were saved', async () => {
    const o = await owner(app);
    await svc.seal(o.businessId);
    const first = await asShop(o.businessId, (tx) => tx.changeLog.findMany({ orderBy: { id: 'asc' } }));
    expect(first.map((c) => Number(c.seq))).toEqual(first.map((_, k) => k + 1));
    await party(o, 'Verma Traders');
    await party(o, 'Gupta Stores');
    await svc.seal(o.businessId);
    const all = await asShop(o.businessId, (tx) => tx.changeLog.findMany({ orderBy: { id: 'asc' } }));
    expect(all.map((c) => Number(c.seq))).toEqual(all.map((_, k) => k + 1));
    // the last party saved has the highest number (its audit entry comes after it)
    expect(all.filter((c) => c.tbl === 'parties').at(-1)!.data).toMatchObject({ name: 'Gupta Stores' });
  });
});

describe('sending backups', () => {
  it('sends a full copy, then the changes; only this shop’s key opens them', async () => {
    const o = await owner(app);
    expect((await useDrive(o)).body).toMatchObject({ keySet: true, dest: 'drive', drive: { enabled: true, connected: true } });
    await party(o, 'Verma Traders');
    await svc.runDue();
    const f = await files(o);
    expect(f.map((x) => x.kind)).toEqual(['snapshot', 'changes']);
    const d = await dest(o);
    expect(d.cursorSeq).toBe(f[1]!.toSeq);
    const st = await status(o);
    expect(st.drive).toMatchObject({ waiting: 0, failingSince: null, error: null });
    expect(st.drive.lastOkAt).toBeTruthy();
    expect(st.snapshot.lastAt).toBeTruthy();
    const snap = openFile<{ tables: Record<string, { name?: string }[]> }>(KEY, o.businessId, drive.files.get(f[0]!.ref)!);
    expect(snap.body.tables.businesses![0]!.name).toBe('Gupta Electricals & Hardware');
    const ch = openFile<{ changes: { t: string; d: { name?: string } }[] }>(KEY, o.businessId, drive.files.get(f[1]!.ref)!);
    // the party and the audit entries of this session (choosing Drive, adding the party)
    expect(ch.body.changes.filter((c) => c.t === 'parties').map((c) => c.d.name)).toEqual(['Verma Traders']);
    const other = await owner(app);
    expect(() => openFile(KEY, other.businessId, drive.files.get(f[1]!.ref)!)).toThrow('another shop');
    // nothing new: nothing is sent, the place is still up to date
    expect((await http().post('/api/backup/now').set(auth(o)).expect(200)).body.results).toEqual({ drive: 'up_to_date' });
    expect(await files(o)).toHaveLength(2);
  });

  it('keeps changes waiting while the place is down, retries, then sends each change exactly once', async () => {
    const o = await owner(app);
    await useDrive(o);
    const start = (await dest(o)).cursorSeq;
    await svc.runDue();
    drive.down = true;
    await party(o, 'Verma Traders');
    await party(o, 'Gupta Stores');
    await svc.runDue();
    let st = await status(o);
    expect(st.drive).toMatchObject({ error: 'Can’t reach Google Drive.' });
    expect(st.drive.failingSince).toBeTruthy();
    expect(st.drive.waiting).toBeGreaterThanOrEqual(2);
    let d = await dest(o);
    expect(d.attempts).toBe(1);
    expect(+d.nextTryAt! - Date.now()).toBeGreaterThan(50_000);
    // not due again yet: the every-minute round leaves it alone
    await svc.runDue();
    expect((await dest(o)).attempts).toBe(1);
    // "Backup now" tries straight away; the wait grows (2 minutes)
    expect((await http().post('/api/backup/now').set(auth(o)).expect(200)).body.results).toEqual({ drive: 'failed' });
    d = await dest(o);
    expect(d.attempts).toBe(2);
    expect(+d.nextTryAt! - Date.now()).toBeGreaterThan(110_000);
    drive.down = false;
    expect((await http().post('/api/backup/now').set(auth(o)).expect(200)).body.results).toEqual({ drive: 'sent' });
    st = await status(o);
    expect(st.drive).toMatchObject({ waiting: 0, failingSince: null, error: null });
    // the change files follow on from each other with no gap and no repeat
    const ch = (await files(o)).filter((f) => f.kind === 'changes');
    let at = start;
    for (const f of ch) {
      expect(f.afterSeq).toBe(at);
      at = f.toSeq;
    }
    const sent = ch.reduce((n, f) => n + f.changes, 0);
    expect(sent).toBe(await asShop(o.businessId, (tx) => tx.changeLog.count({ where: { seq: { gt: start } } })));
  });

  it('does not count a file as sent until the place confirms it', async () => {
    const o = await owner(app);
    await useDrive(o);
    await svc.runDue();
    const before = await dest(o);
    const n = (await files(o)).length;
    drive.noConfirm = true;
    await party(o, 'Verma Traders');
    await http().post('/api/backup/now').set(auth(o)).expect(200);
    expect((await dest(o)).cursorSeq).toBe(before.cursorSeq);
    expect(await files(o)).toHaveLength(n);
    drive.noConfirm = false;
    await http().post('/api/backup/now').set(auth(o)).expect(200);
    const f = (await files(o)).at(-1)!;
    expect(f).toMatchObject({ kind: 'changes', afterSeq: before.cursorSeq });
    expect((await dest(o)).cursorSeq).toBe(f.toSeq);
  });

  it('makes a new full copy once a day (India time)', async () => {
    const o = await owner(app);
    await useDrive(o);
    await svc.runDue();
    await party(o, 'Verma Traders');
    await http().post('/api/backup/now').set(auth(o)).expect(200);
    expect((await files(o)).filter((f) => f.kind === 'snapshot')).toHaveLength(1);
    await asShop(o.businessId, (tx) => tx.backupDestination.updateMany({ data: { lastSnapshotAt: new Date(Date.now() - 26 * 3600_000) } }));
    await http().post('/api/backup/now').set(auth(o)).expect(200);
    expect((await files(o)).filter((f) => f.kind === 'snapshot')).toHaveLength(2);
  });

  it('waits quietly while the place is not connected', async () => {
    const o = await owner(app);
    drive.connected = false;
    await useDrive(o);
    await svc.runDue();
    expect(await files(o)).toHaveLength(0);
    expect((await status(o)).drive).toMatchObject({ connected: false, failingSince: null, error: null });
  });

  it('sends nothing while the server has no master key', async () => {
    const o = await owner(app);
    await useDrive(o);
    process.env.BACKUP_MASTER_KEY = '';
    resetConfig();
    try {
      expect(await svc.run(o.businessId, (await dest(o)).id, { now: true })).toBe('off');
      expect((await status(o)).keySet).toBe(false);
    } finally {
      process.env.BACKUP_MASTER_KEY = KEY;
      resetConfig();
    }
    expect(await files(o)).toHaveLength(0);
  });

  it('switching a place off and on again starts it afresh with a full copy', async () => {
    const o = await owner(app);
    await useDrive(o);
    await svc.runDue();
    expect((await http().put('/api/backup/destination').set(auth(o)).send({ dest: null }).expect(200)).body.dest).toBe(null);
    await party(o, 'Verma Traders');
    await svc.runDue();
    expect((await files(o)).map((f) => f.kind)).toEqual(['snapshot', 'changes']);
    await useDrive(o);
    await svc.runDue();
    expect((await files(o)).map((f) => f.kind)).toEqual(['snapshot', 'changes', 'snapshot', 'changes']);
    const audit = (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; after: unknown }[];
    expect(audit.filter((a) => a.entity === 'backup_destination').map((a) => a.after)).toEqual([{ dest: 'drive' }, { dest: null }, { dest: 'drive' }]);
  });
});

describe('restore', () => {
  it('test restore rebuilds the books from the backup without touching them', async () => {
    const { o, inv } = await shop();
    await useDrive(o);
    await svc.runDue();
    await party(o, 'Gupta Stores'); // after the full copy: comes from the change files
    await svc.runDue();
    const r = (await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(200)).body;
    const parties = (await http().get('/api/parties').set(auth(o)).expect(200)).body as unknown[];
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as unknown[];
    expect(r).toMatchObject({ from: 'drive', matches: true, differences: [], invoices: 1, parties: parties.length, items: items.length, salesTotalThisYear: inv.total });
    expect(r.changes).toBeGreaterThanOrEqual(1);
    const me = (await http().get('/api/me').set(auth(o)).expect(200)).body;
    expect(me.memberships).toHaveLength(1);
    const audit = (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string }[];
    expect(audit[0]!.action).toBe('test_restore');
  });

  it('refuses a backup file that was changed', async () => {
    const o = await owner(app);
    await useDrive(o);
    await svc.runDue();
    const snap = (await files(o))[0]!;
    const bytes = drive.files.get(snap.ref)!;
    bytes[200] = bytes[200]! ^ 1;
    const r = await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(400);
    expect(r.body.message).toMatch(/has been changed or damaged/);
  });

  it('restores into new books and keeps the current books as they are', async () => {
    const { o, inv, fan } = await shop();
    await useDrive(o);
    await svc.runDue();
    await http().post('/api/backup/restore').set(auth(o)).send({ from: 'drive' }).expect(400);
    const r = (await http().post('/api/backup/restore').set(auth(o)).send({ from: 'drive', confirm: true }).expect(200)).body;
    expect(r.businessId).not.toBe(o.businessId);
    expect(r.code).toMatch(/^BE-\d+$/);
    expect(r.name).toBe('Gupta Electricals & Hardware');
    // the current books: untouched, with a note in the audit log
    const oldSales = (await http().get('/api/sales').set(auth(o)).expect(200)).body as { id: string }[];
    expect(oldSales.map((s) => s.id)).toEqual([inv.id]);
    const oldAudit = (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; after: { intoBooks?: string } }[];
    expect(oldAudit[0]).toMatchObject({ action: 'restore', after: { intoBooks: r.code } });
    // the restored books: same figures, new ids, only the owner as a member
    const sw = (await http().post('/api/businesses/switch').set(auth(o)).send({ businessId: r.businessId }).expect(201)).body;
    const n = { token: sw.accessToken as string };
    const sales = (await http().get('/api/sales').set(auth(n)).expect(200)).body as { id: string; number: string; total: string; partyName: string; balance: string }[];
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ number: inv.number, total: inv.total, partyName: 'Verma Traders', balance: inv.total });
    expect(sales[0]!.id).not.toBe(inv.id);
    const pick = (l: { name: string; balance?: string; stock?: string }[]) => l.map((x) => [x.name, x.balance ?? x.stock]).sort();
    expect(pick((await http().get('/api/parties').set(auth(n)).expect(200)).body)).toEqual(pick((await http().get('/api/parties').set(auth(o)).expect(200)).body));
    const items = (await http().get('/api/items').set(auth(n)).expect(200)).body as { id: string; name: string; stock: string }[];
    expect(pick(items)).toEqual(pick((await http().get('/api/items').set(auth(o)).expect(200)).body));
    expect(items.find((i) => i.name === fan.name)).toMatchObject({ stock: '22.000' });
    expect(items.map((i) => i.id)).not.toContain(fan.id);
    const members = (await http().get('/api/members').set(auth(n)).expect(200)).body.members as { email: string }[];
    expect(members.map((m) => m.email)).toEqual([o.email]);
    const audit = (await http().get('/api/audit').set(auth(n)).expect(200)).body as { action: string }[];
    expect(audit.map((a) => a.action)).toContain('restore');
    // the next invoice number carries on from the backup
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(n)).expect(200)).body.number).toBe('INV-0002');
  });

  it('restored books keep the transaction passcode switched on, with the same passcode (made-up)', async () => {
    const { o, inv } = await shop();
    await http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: '4826' }).expect(200);
    await useDrive(o);
    await svc.runDue();
    const r = (await http().post('/api/backup/restore').set(auth(o)).send({ from: 'drive', confirm: true }).expect(200)).body;
    const n = { token: (await http().post('/api/businesses/switch').set(auth(o)).send({ businessId: r.businessId }).expect(201)).body.accessToken as string };
    expect((await http().get('/api/settings/passcode').set(auth(n)).expect(200)).body).toEqual({ set: true, enabled: true });
    const id = ((await http().get('/api/sales').set(auth(n)).expect(200)).body as { id: string; number: string }[]).find((s) => s.number === inv.number)!.id;
    await http().post(`/api/sales/${id}/cancel`).set(auth(n)).send({}).expect(403);
    await http().post(`/api/sales/${id}/cancel`).set(auth(n)).set('x-txn-passcode', '4826').send({}).expect(200);
  });

  it('deleted documents stay deleted (hidden, kept) in the restored books — from the full copy and from later changes', async () => {
    const { o, inv, fan, verma } = await shop();
    const line = { itemId: fan.id, name: fan.name, qty: '2', price: '1890', discPct: '0', gstRate: '18' };
    const inv2 = (await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [line] }).expect(201)).body;
    await http().post(`/api/sales/${inv2.id}/delete`).set(auth(o)).send({ reason: 'Typed twice' }).expect(200);
    await useDrive(o);
    await svc.runDue();
    // after the full copy: comes from the change files
    const pay = (await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '500', mode: 'Cash', allocations: [{ to: inv.id, amount: '500' }] }).expect(201)).body;
    await http().post(`/api/receipts/${pay.id}/delete`).set(auth(o)).send({}).expect(200);
    await svc.runDue();
    const r = (await http().post('/api/backup/restore').set(auth(o)).send({ from: 'drive', confirm: true }).expect(200)).body;
    const n = { token: (await http().post('/api/businesses/switch').set(auth(o)).send({ businessId: r.businessId }).expect(201)).body.accessToken as string };
    expect(((await http().get('/api/sales').set(auth(n)).expect(200)).body as { number: string; balance: string }[]).map((x) => [x.number, x.balance])).toEqual([[inv.number, inv.total]]);
    expect((await http().get('/api/receipts').set(auth(n)).expect(200)).body).toEqual([]);
    const items = (await http().get('/api/items').set(auth(n)).expect(200)).body as { name: string; stock: string }[];
    expect(items.find((i) => i.name === fan.name)!.stock).toBe('22.000');
    const kept = await asShop(r.businessId, async (tx) => ({
      sales: await tx.salesDocument.findMany({ where: { deletedAt: { not: null } }, select: { number: true, deleteReason: true, cancelledAt: true, deletedAt: true } }),
      pays: await tx.payment.count({ where: { deletedAt: { not: null }, cancelledAt: { not: null } } }),
    }));
    expect(kept.sales).toHaveLength(1);
    expect(kept.sales[0]).toMatchObject({ number: inv2.number, deleteReason: 'Typed twice' });
    expect(kept.sales[0]!.cancelledAt!.getTime()).toBe(kept.sales[0]!.deletedAt!.getTime());
    expect(kept.pays).toBe(1);
    // the deleted number is still taken in the restored books
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(n)).expect(200)).body.number).toBe('INV-0003');
  });

  it('an old backup, made before Delete existed, restores with nothing deleted', async () => {
    const { o, inv, fan, verma } = await shop();
    const inv2 = (await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201)).body;
    await http().post(`/api/sales/${inv2.id}/cancel`).set(auth(o)).send({}).expect(200);
    await http().post('/api/receipts').set(auth(o)).send({ partyId: verma.id, date: D, amount: '500', mode: 'Cash', allocations: [{ to: inv.id, amount: '500' }] }).expect(201);
    await useDrive(o);
    await svc.runDue();
    // take the new columns out of the full copy, as an older version of the app wrote it
    const snap = (await files(o)).find((f) => f.kind === 'snapshot')!;
    const { header, body } = openFile<SnapshotBody>(KEY, o.businessId, drive.files.get(snap.ref)!);
    for (const t of ['sales_documents', 'payments']) {
      expect(body.tables[t]!.length).toBeGreaterThan(0);
      for (const row of body.tables[t]!) { delete row.deleted_at; delete row.deleted_by; delete row.delete_reason; }
    }
    const old = lockFile(KEY, { business: header.business, kind: header.kind, afterSeq: header.afterSeq, toSeq: header.toSeq, createdAt: header.createdAt }, body);
    drive.files.set(snap.ref, old);
    await asShop(o.businessId, (tx) => tx.backupFile.update({ where: { id: snap.id }, data: { sha256: sha256(old) } }));
    const r = (await http().post('/api/backup/restore').set(auth(o)).send({ from: 'drive', confirm: true }).expect(200)).body;
    const n = { token: (await http().post('/api/businesses/switch').set(auth(o)).send({ businessId: r.businessId }).expect(201)).body.accessToken as string };
    // the cancelled invoice still shows as cancelled; nothing is hidden
    expect(((await http().get('/api/sales').set(auth(n)).expect(200)).body as { number: string; cancelled: boolean }[]).map((x) => [x.number, x.cancelled])).toEqual([[inv2.number, true], [inv.number, false]]);
    const rows = await asShop(r.businessId, (tx) => tx.salesDocument.findMany({ select: { deletedAt: true, deletedBy: true, deleteReason: true } }));
    expect(rows).toEqual([{ deletedAt: null, deletedBy: null, deleteReason: '' }, { deletedAt: null, deletedBy: null, deleteReason: '' }]);
    expect(((await http().get('/api/receipts').set(auth(n)).expect(200)).body as { amount: string }[]).map((x) => x.amount)).toEqual(['500.00']);
  });

  it('says what is missing before anything was backed up', async () => {
    const o = await owner(app);
    expect((await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(404)).body.message).toBe('Nothing has been backed up to this place yet.');
    drive.connected = false;
    await useDrive(o);
    await svc.runDue();
    drive.connected = true;
    expect((await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(400)).body.message).toMatch(/no full copy/);
  });
});

describe('who may do what', () => {
  it('staff see whether backups work but cannot change places or restore', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/backup/status').set(auth(staff)).expect(200);
    await http().put('/api/backup/destination').set(auth(staff)).send({ dest: 'drive' }).expect(403);
    await http().post('/api/backup/now').set(auth(staff)).expect(403);
    await http().post('/api/backup/test-restore').set(auth(staff)).send({ from: 'drive' }).expect(403);
    await http().post('/api/backup/restore').set(auth(staff)).send({ from: 'drive', confirm: true }).expect(403);
  });

  it('checks what is sent in', async () => {
    const o = await owner(app);
    expect((await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'dropbox' }).expect(400)).body.field).toBe('dest');
    await http().post('/api/backup/test-restore').set(auth(o)).send({}).expect(400);
  });
});

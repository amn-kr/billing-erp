import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { todayIst } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, owner, startApp } from './helpers';
import { BackupService } from '../src/modules/backup/backup.service';
import { normaliseKey, prune } from '../src/modules/backup/folder';

/**
 * The Windows app's single-PC mode (BACKUP_FOLDERS=on): backups into a folder or pen drive, which
 * waits quietly while the pen drive is out, and a restore from those files on another computer with
 * the recovery key.
 */
// a recovery key as the Windows app makes it: 32 letters and digits 2–7
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let app: INestApplication;
let svc: BackupService;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const D = todayIst();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'billing-backup-'));

beforeAll(async () => {
  process.env.BACKUP_MASTER_KEY = KEY;
  process.env.BACKUP_FOLDERS = 'on';
  app = await startApp();
  svc = app.get(BackupService);
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  delete process.env.BACKUP_FOLDERS;
  await db.$disconnect();
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
async function shop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540', openingDate: D }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  const sell = () => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201);
  await sell();
  return { o, sell };
}
const status = async (o: S) => (await http().get('/api/backup/status').set(auth(o)).expect(200)).body;
const destId = (o: S) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
    return (await tx.backupDestination.findFirstOrThrow({ where: { kind: 'local' } })).id;
  });
const files = (dir: string) => fs.readdirSync(dir).filter((n) => n.endsWith('.berp')).sort();

describe('backups into a folder or pen drive', () => {
  it('goes into "<folder>/<app> Backup - <shop code>": a full copy, then each change', async () => {
    const { o, sell } = await shop();
    const folder = tmp();
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'local' }).expect(200);
    const st = (await http().put('/api/backup/local/folder').set(auth(o)).send({ folder }).expect(200)).body;
    expect(st.local).toMatchObject({ enabled: true, connected: true, folder });
    const id = await destId(o);
    expect(await svc.run(o.businessId, id)).toBe('sent');
    const [dir] = fs.readdirSync(folder);
    expect(dir).toMatch(/ Backup - BE-\d+$/);
    expect(files(path.join(folder, dir!)).filter((n) => n.startsWith('full-'))).toHaveLength(1);
    const before = files(path.join(folder, dir!)).filter((n) => n.startsWith('changes-')).length;
    await sell();
    expect(await svc.run(o.businessId, id, { now: true })).toBe('sent');
    expect(files(path.join(folder, dir!)).filter((n) => n.startsWith('changes-'))).toHaveLength(before + 1);
    // no half-written files left behind
    expect(fs.readdirSync(path.join(folder, dir!)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('waits quietly while the pen drive is out, and catches up when it is back', async () => {
    const { o, sell } = await shop();
    const folder = tmp();
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'local' }).expect(200);
    await http().put('/api/backup/local/folder').set(auth(o)).send({ folder }).expect(200);
    const id = await destId(o);
    await svc.run(o.businessId, id);
    const away = folder + '-out';
    fs.renameSync(folder, away);
    await sell();
    expect(await svc.run(o.businessId, id, { now: true })).toBe('not_ready');
    const s = await status(o);
    expect(s.local).toMatchObject({ connected: false, failingSince: null, error: null });
    expect(s.local.waiting).toBeGreaterThan(0);
    fs.renameSync(away, folder);
    expect(await svc.run(o.businessId, id, { now: true })).toBe('sent');
    expect((await status(o)).local.waiting).toBe(0);
  });

  it('refuses a folder that is not there', async () => {
    const { o } = await shop();
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'local' }).expect(200);
    const r = await http().put('/api/backup/local/folder').set(auth(o)).send({ folder: path.join(tmp(), 'no-such-folder') }).expect(400);
    expect(r.body.message).toMatch(/can’t be found/);
  });

  it('keeps the newest 7 full copies and the changes after the oldest of them', () => {
    const dir = tmp();
    const t = (d: number) => `2026-11-${String(d).padStart(2, '0')}T10-00-00`;
    for (let d = 1; d <= 9; d++) {
      fs.writeFileSync(path.join(dir, `full-${t(d)}.berp`), 'x');
      fs.writeFileSync(path.join(dir, `changes-${t(d)}-${d}.berp`), 'x');
    }
    prune(dir, 7);
    const left = files(dir);
    expect(left.filter((n) => n.startsWith('full-'))).toHaveLength(7);
    expect(left).not.toContain(`full-${t(2)}.berp`);
    expect(left).toContain(`full-${t(3)}.berp`);
    expect(left).not.toContain(`changes-${t(2)}-2.berp`);
    expect(left).toContain(`changes-${t(3)}-3.berp`);
  });
});

describe('restore from the files on another computer', () => {
  it('opens with the recovery key and becomes new books with the same figures', async () => {
    const { o, sell } = await shop();
    const folder = tmp();
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'local' }).expect(200);
    await http().put('/api/backup/local/folder').set(auth(o)).send({ folder }).expect(200);
    const id = await destId(o);
    await svc.run(o.businessId, id);
    await sell();
    await svc.run(o.businessId, id, { now: true });

    // another computer: a new owner and shop, the pen drive's folder and the key as printed (dashes, small letters)
    const other = await owner(app);
    const typed = KEY.toLowerCase().match(/.{4}/g)!.join('-');
    const t = (await http().post('/api/backup/files/test').set(auth(other)).send({ folder, key: typed }).expect(200)).body;
    expect(t).toMatchObject({ invoices: 2, parties: 1, items: 1, otherShops: 0 });
    expect(t.changes).toBeGreaterThan(0);

    await http().post('/api/backup/files/restore').set(auth(other)).send({ folder, key: typed }).expect(400);
    const done = (await http().post('/api/backup/files/restore').set(auth(other)).send({ folder, key: typed, confirm: true }).expect(200)).body;
    expect(done.code).toMatch(/^BE-\d+$/);
    const sw = await http().post('/api/businesses/switch').set(auth(other)).send({ businessId: done.businessId }).expect(201);
    const token = { token: sw.body.accessToken as string };
    const sales = (await http().get('/api/sales').set(auth(token)).expect(200)).body as { number: string }[];
    expect(sales.map((s) => s.number).sort()).toEqual(['INV-0001', 'INV-0002']);
    // numbering carries on in the restored books
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(token)).expect(200)).body.number).toBe('INV-0003');
  });

  it('a wrong key, or a folder with no backups, is said plainly', async () => {
    const { o } = await shop();
    const folder = tmp();
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'local' }).expect(200);
    await http().put('/api/backup/local/folder').set(auth(o)).send({ folder }).expect(200);
    await svc.run(o.businessId, await destId(o));
    const wrong = await http().post('/api/backup/files/test').set(auth(o)).send({ folder, key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }).expect(400);
    expect(wrong.body.message).toMatch(/recovery key does not open/);
    const empty = await http().post('/api/backup/files/test').set(auth(o)).send({ folder: tmp(), key: KEY }).expect(400);
    expect(empty.body.message).toMatch(/No backup files/);
  });

  it('a typed key forgives spaces, small letters and 0 / 1 / 8', () => {
    expect(normaliseKey(' abcd-efgh 0I1B8 ')).toBe('ABCDEFGHOIIBB');
  });
});

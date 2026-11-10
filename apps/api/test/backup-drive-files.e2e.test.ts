import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { todayIst } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, owner, startApp } from './helpers';
import { BackupService } from '../src/modules/backup/backup.service';
import { startFakeGoogle, type FakeGoogle } from './fake-google';

/**
 * Google Drive in the Windows app's single-PC mode (BACKUP_FOLDERS=on), against a pretend Google:
 * the sign-in ends on a short page in the computer's web browser, and on another computer the books
 * come back from the Drive with the recovery key (the books' own Drive folder is never the one restored).
 */
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const APP_URL = 'http://127.0.0.1:47123';
let app: INestApplication;
let db: PrismaClient;
let svc: BackupService;
let fake: FakeGoogle;
const http = () => request(app.getHttpServer());
const D = todayIst();

beforeAll(async () => {
  fake = await startFakeGoogle();
  Object.assign(process.env, {
    BACKUP_MASTER_KEY: KEY, BACKUP_FOLDERS: 'on', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_ACCOUNTS_URL: fake.base, GOOGLE_OAUTH2_URL: fake.base, GOOGLE_API_URL: fake.base, APP_URL,
  });
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
  svc = app.get(BackupService);
});
afterAll(async () => {
  for (const k of ['BACKUP_FOLDERS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_URL']) delete process.env[k];
  await db.$disconnect();
  await app.close();
  await fake.close();
});

type S = Awaited<ReturnType<typeof owner>>;
const driveId = (o: S) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
    return (await tx.backupDestination.findFirstOrThrow({ where: { kind: 'drive' } })).id;
  });

/** "Connect Google Drive": the address Google is opened at, then Google sending the browser back */
async function connect(o: S) {
  await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'drive' }).expect(200);
  const { url } = (await http().post('/api/backup/drive/connect').set(auth(o)).expect(201)).body as { url: string };
  const google = new URL(url);
  // Google sends the browser back to this computer's bare address (the PC's server passes it on to the callback)
  expect(google.searchParams.get('redirect_uri')).toBe(`${APP_URL}/`);
  return http().get(`/api/backup/drive/callback?code=good-code&state=${encodeURIComponent(google.searchParams.get('state')!)}`);
}

describe('Google Drive from the Windows app (single-PC mode)', () => {
  it('the sign-in ends on a page in the web browser that says to go back to the app', async () => {
    const o = await owner(app);
    const back = await connect(o);
    expect(back.status).toBe(200);
    expect(back.text).toContain('data-result="connected"');
    expect(back.text).toContain('Google Drive is connected');
    expect((await http().get('/api/backup/status').set(auth(o)).expect(200)).body.drive).toMatchObject({ connected: true, account: 'owner@gmail.com' });
    // cancelled at Google
    const { url } = (await http().post('/api/backup/drive/connect').set(auth(o)).expect(201)).body as { url: string };
    const cancelled = await http().get(`/api/backup/drive/callback?error=access_denied&state=${encodeURIComponent(new URL(url).searchParams.get('state')!)}`).expect(200);
    expect(cancelled.text).toContain('data-result="cancelled"');
  });

  it('on another computer the books come back from Google Drive with the recovery key', async () => {
    // this computer: a shop with two bills, backed up to Drive
    const a = await owner(app);
    const fan = (await http().post('/api/items').set(auth(a)).send({ name: 'Ceiling fan 1200mm', sale: '1890', gstRate: 18, openingQty: '25', openingDate: D }).expect(201)).body;
    const verma = (await http().post('/api/parties').set(auth(a)).send({ name: 'Verma Traders' }).expect(201)).body;
    const sell = () => http().post('/api/sales').set(auth(a)).send({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201);
    await sell();
    await connect(a);
    expect(await svc.run(a.businessId, await driveId(a))).toBe('sent');
    await sell();
    expect(await svc.run(a.businessId, await driveId(a), { now: true })).toBe('sent');

    // another computer: a throwaway shop, the same Google account; its own (newer) Drive folder is not the one restored
    const b = await owner(app);
    await connect(b);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await svc.run(b.businessId, await driveId(b))).toBe('sent');
    const t = (await http().post('/api/backup/files/test').set(auth(b)).send({ from: 'drive', key: KEY.toLowerCase() }).expect(200)).body;
    expect(t).toMatchObject({ invoices: 2, parties: 1, items: 1 });
    const done = (await http().post('/api/backup/files/restore').set(auth(b)).send({ from: 'drive', key: KEY, confirm: true }).expect(200)).body;
    const sw = await http().post('/api/businesses/switch').set(auth(b)).send({ businessId: done.businessId }).expect(201);
    const token = { token: sw.body.accessToken as string };
    expect(((await http().get('/api/sales').set(auth(token)).expect(200)).body as { number: string }[]).map((s) => s.number).sort()).toEqual(['INV-0001', 'INV-0002']);
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(token)).expect(200)).body.number).toBe('INV-0003');
  });

  it('a wrong key, or no Drive connected, is said plainly', async () => {
    const c = await owner(app);
    const none = await http().post('/api/backup/files/test').set(auth(c)).send({ from: 'drive', key: KEY }).expect(400);
    expect(none.body.message).toMatch(/Connect Google Drive first/);
    await connect(c);
    const wrong = await http().post('/api/backup/files/test').set(auth(c)).send({ from: 'drive', key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }).expect(400);
    expect(wrong.body.message).toMatch(/recovery key does not open the backups in this Google Drive/);
  });
});

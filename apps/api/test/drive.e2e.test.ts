import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, member, owner, startApp, SHOP } from './helpers';
import { BRAND } from '@billing/shared';
import { resetConfig } from '../src/config';
import { BackupService } from '../src/modules/backup/backup.service';
import { DRIVE_SCOPE } from '../src/modules/backup/drive';
import { REFRESH, startFakeGoogle, type FakeGoogle } from './fake-google';

/**
 * Google Drive as a backup place, against a pretend Google (sign-in, tokens and Drive) running in
 * this test: connecting asks only for "files this app created", the login is kept locked, backups go
 * into the shop's own folder and are checked, and every Drive problem is reported in plain words.
 */
const KEY = 'api-test-drive-master-key-0123456789abcdefgh';
let app: INestApplication;
let db: PrismaClient;
let svc: BackupService;
let base = '';
const http = () => request(app.getHttpServer());

let fake: FakeGoogle;
let g: FakeGoogle['g'];
const reset = () => fake.reset();

beforeAll(async () => {
  fake = await startFakeGoogle();
  g = fake.g;
  base = fake.base;
  Object.assign(process.env, {
    BACKUP_MASTER_KEY: KEY, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_ACCOUNTS_URL: base, GOOGLE_OAUTH2_URL: base, GOOGLE_API_URL: base, APP_URL: 'http://localhost:5173',
  });
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
  svc = app.get(BackupService);
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
  await fake.close();
});
beforeEach(reset);

type S = Awaited<ReturnType<typeof owner>>;
const asShop = <T>(businessId: string, fn: (tx: PrismaClient) => Promise<T>) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
const dest = (o: S) => asShop(o.businessId, (tx) => tx.backupDestination.findFirstOrThrow({ where: { kind: 'drive' } }));
const status = async (o: S) => (await http().get('/api/backup/status').set(auth(o)).expect(200)).body;
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const back = async (o: S, q: string) => {
  const url = (await http().post('/api/backup/drive/connect').set(auth(o)).expect(201)).body.url as string;
  const r = await http().get(`/api/backup/drive/callback?state=${encodeURIComponent(stateOf(url))}&${q}`).expect(302);
  return r.headers.location as string;
};
/** an owner with Google Drive chosen and connected */
async function connected() {
  const o = await owner(app);
  await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'drive' }).expect(200);
  expect(await back(o, 'code=good-code')).toBe('http://localhost:5173/settings?drive=connected');
  return o;
}
const now = (o: S) => http().post('/api/backup/now').set(auth(o)).expect(200);

describe('connecting Google Drive', () => {
  it('sends the owner to Google asking only for files this app created', async () => {
    const o = await owner(app);
    const url = new URL((await http().post('/api/backup/drive/connect').set(auth(o)).expect(201)).body.url);
    expect(url.origin + url.pathname).toBe(`${base}/o/oauth2/v2/auth`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'test-client', redirect_uri: 'http://localhost:5173/api/backup/drive/callback', response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent',
    });
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('keeps Google’s login locked: never in the screens’ answers or the activity log', async () => {
    const o = await connected();
    const d = await dest(o);
    expect(d.secret.startsWith('v1.')).toBe(true);
    expect(d.secret).not.toContain(REFRESH);
    const st = await status(o);
    expect(st).toMatchObject({ driveSetUp: true, dest: 'drive', drive: { connected: true, reconnect: false, account: 'owner@gmail.com' } });
    expect(JSON.stringify(st)).not.toContain('v1.');
    const audit = (await http().get('/api/audit').set(auth(o)).expect(200)).body as { entity: string; after: unknown }[];
    expect(audit.find((a) => a.entity === 'backup_drive')!.after).toEqual({ connected: true, account: 'owner@gmail.com' });
    expect(JSON.stringify(audit)).not.toContain(REFRESH);
    // another shop can't use this shop's locked login
    const other = await owner(app);
    const { openSecret } = await import('../src/modules/backup/crypto');
    expect(openSecret(KEY, o.businessId, d.secret)).toBe(REFRESH);
    expect(() => openSecret(KEY, other.businessId, d.secret)).toThrow();
  });

  it('a cancelled or tampered sign-in stores nothing', async () => {
    const o = await owner(app);
    await http().put('/api/backup/destination').set(auth(o)).send({ dest: 'drive' }).expect(200);
    expect(await back(o, 'error=access_denied')).toBe('http://localhost:5173/settings?drive=cancelled');
    expect(await back(o, 'code=wrong-code')).toBe('http://localhost:5173/settings?drive=failed');
    const r = await http().get('/api/backup/drive/callback?state=made-up&code=good-code').expect(302);
    expect(r.headers.location).toBe('http://localhost:5173/settings?drive=failed');
    // a sign-in that didn't give the Drive permission is refused
    g.scope = 'openid';
    expect(await back(o, 'code=good-code')).toBe('http://localhost:5173/settings?drive=failed');
    expect((await dest(o)).secret).toBe('');
    expect((await status(o)).drive.connected).toBe(false);
  });

  it('only the owner may connect, and only when Drive is set up on the server', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'manager');
    await http().post('/api/backup/drive/connect').set(auth(staff)).expect(403);
    process.env.GOOGLE_CLIENT_ID = '';
    resetConfig();
    try {
      expect((await http().post('/api/backup/drive/connect').set(auth(o)).expect(400)).body.message).toBe('Google Drive isn’t set up on this server yet.');
    } finally {
      process.env.GOOGLE_CLIENT_ID = 'test-client';
      resetConfig();
    }
  });
});

describe('backing up to Google Drive', () => {
  it('makes the shop’s folder, puts a full copy and the changes in it, and restores from it', async () => {
    const o = await connected();
    await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201);
    expect((await now(o)).body.results).toEqual({ drive: 'sent' });
    const folders = [...g.folders].filter(([, f]) => f.name === `${BRAND.backupFolder} - ${SHOP.name}`);
    expect(folders.length).toBeGreaterThanOrEqual(1);
    const folderId = (((await dest(o)).settings) as { folderId: string }).folderId;
    const mine = [...g.files.values()].filter((f) => f.parent === folderId);
    expect(mine.map((f) => f.name.split('-')[0])).toEqual(['full', 'changes']);
    // every call to Drive carried a short-lived access token, never the refresh token
    expect(g.calls.filter((c) => c.path.startsWith('/drive') || c.path.startsWith('/upload')).every((c) => c.auth.startsWith('Bearer at-'))).toBe(true);
    expect(g.calls.some((c) => c.path.includes(REFRESH))).toBe(false);
    const st = await status(o);
    expect(st.drive).toMatchObject({ connected: true, folder: `${BRAND.backupFolder} - ${SHOP.name}`, account: 'owner@gmail.com', waiting: 0, error: null });
    const r = (await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(200)).body;
    expect(r).toMatchObject({ from: 'drive', matches: true, parties: 1 });
  });

  it('asks to connect again when Google access was removed, and carries on after', async () => {
    const o = await connected();
    await now(o);
    const folderId = (((await dest(o)).settings) as { folderId: string }).folderId;
    g.revoked = true;
    await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201);
    expect((await now(o)).body.results).toEqual({ drive: 'failed' });
    let st = await status(o);
    expect(st.drive).toMatchObject({ reconnect: true, error: 'Google Drive access was removed. Press “Connect again”.' });
    expect(st.drive.waiting).toBeGreaterThanOrEqual(1);
    g.revoked = false;
    expect(await back(o, 'code=good-code')).toBe('http://localhost:5173/settings?drive=connected');
    st = await status(o);
    expect(st.drive).toMatchObject({ reconnect: false, error: null, failingSince: null });
    expect((await now(o)).body.results).toEqual({ drive: 'sent' });
    // the same Google account keeps its folder
    expect((((await dest(o)).settings) as { folderId: string }).folderId).toBe(folderId);
    expect((await status(o)).drive.waiting).toBe(0);
  });

  it('a folder moved to the bin is replaced, starting again with a full copy', async () => {
    const o = await connected();
    await now(o);
    const first = (((await dest(o)).settings) as { folderId: string }).folderId;
    g.folders.get(first)!.trashed = true;
    await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201);
    expect((await now(o)).body.results).toEqual({ drive: 'failed' });
    expect((await status(o)).drive.error).toBe('The backup folder was removed from Google Drive. A new one is made on the next try.');
    expect((await dest(o)).lastSnapshotAt).toBeNull();
    expect((await now(o)).body.results).toEqual({ drive: 'sent' });
    const second = (((await dest(o)).settings) as { folderId: string }).folderId;
    expect(second).not.toBe(first);
    expect([...g.files.values()].filter((f) => f.parent === second).map((f) => f.name.split('-')[0])).toEqual(['full', 'changes']);
    expect((await http().post('/api/backup/test-restore').set(auth(o)).send({ from: 'drive' }).expect(200)).body).toMatchObject({ matches: true, parties: 1 });
  });

  it('says so in plain words when Drive is full, or keeps only part of a file', async () => {
    const o = await connected();
    await now(o);
    const cursor = (await dest(o)).cursorSeq;
    g.full = true;
    await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201);
    await now(o);
    expect((await status(o)).drive.error).toBe('Google Drive is full. Free some space in Google Drive.');
    g.full = false;
    g.shortUpload = true;
    await now(o);
    expect((await status(o)).drive.error).toBe('Google Drive didn’t confirm the whole file. The app sends it again.');
    expect((await dest(o)).cursorSeq).toBe(cursor);
    g.shortUpload = false;
    expect((await now(o)).body.results).toEqual({ drive: 'sent' });
    expect((await status(o)).drive).toMatchObject({ error: null, waiting: 0 });
  });
});

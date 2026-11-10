import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIst } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp, uniqueEmail } from './helpers';
import { movedId, unknownColumns } from '../src/modules/backup/cloud';

/**
 * Move to cloud (Phase 6, step 7): a single-PC shop's books go into the online app once. Here one server
 * plays both parts (CLOUD_URL is itself): the PC packs and sends the books, the "online app" makes them a
 * shop of the online account, and the counts are compared. The Windows app's test does it across two servers.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = todayIst();

const freePort = () => new Promise<number>((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); });

beforeAll(async () => {
  const port = await freePort();
  Object.assign(process.env, { BACKUP_MASTER_KEY: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', BACKUP_FOLDERS: 'on', CLOUD_URL: `http://127.0.0.1:${port}` });
  app = await startApp();
  await app.listen(port, '127.0.0.1');
});
afterAll(async () => {
  for (const k of ['BACKUP_FOLDERS', 'CLOUD_URL']) delete process.env[k];
  await app.close();
});

async function pcShop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', gstRate: 18, openingQty: '25', openingDate: D }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000', openingDate: D }).expect(201)).body;
  for (let i = 0; i < 2; i++) await http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] }).expect(201);
  return o;
}

describe('Move to cloud', () => {
  it('a new online account gets the whole books, with the same counts and numbering', async () => {
    const pc = await pcShop();
    const email = uniqueEmail('cloud');
    const r = (await http().post('/api/cloud/move').set(auth(pc)).send({ email, password: 'online password 1', create: true, name: 'Ravi Gupta', confirm: true }).expect(200)).body;
    expect(r).toMatchObject({ matches: true, already: false, email });
    expect(r.code).toMatch(/^BE-\d+$/);
    expect(r.here).toMatchObject({ invoices: 2, parties: 1, items: 1 });
    expect(r.online).toEqual(r.here);

    // the online account opens the moved books
    const login = (await http().post('/api/auth/login').send({ email, password: 'online password 1' }).expect(200)).body;
    const me = (await http().get('/api/me').set(auth({ token: login.accessToken })).expect(200)).body;
    const books = me.business?.code === r.code ? { token: login.accessToken } : { token: (await http().post('/api/businesses/switch').set(auth({ token: login.accessToken })).send({ businessId: me.memberships.find((m: { businessCode: string }) => m.businessCode === r.code).businessId }).expect(201)).body.accessToken };
    const sales = (await http().get('/api/sales').set(auth(books)).expect(200)).body as { number: string }[];
    expect(sales.map((s) => s.number).sort()).toEqual(['INV-0001', 'INV-0002']);
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(books)).expect(200)).body.number).toBe('INV-0003');
  });

  it('moving again (a retry) finds the same online shop: never two copies', async () => {
    const pc = await pcShop();
    const email = uniqueEmail('cloud');
    const first = (await http().post('/api/cloud/move').set(auth(pc)).send({ email, password: 'online password 1', create: true, confirm: true }).expect(200)).body;
    const again = (await http().post('/api/cloud/move').set(auth(pc)).send({ email, password: 'online password 1', confirm: true }).expect(200)).body;
    expect(again).toMatchObject({ code: first.code, already: true, matches: true });
    const login = (await http().post('/api/auth/login').send({ email, password: 'online password 1' }).expect(200)).body;
    const me = (await http().get('/api/me').set(auth({ token: login.accessToken })).expect(200)).body;
    expect(me.memberships).toHaveLength(1);
  });

  it('a wrong password, and a missing “I understand”, are said plainly', async () => {
    const pc = await pcShop();
    const email = uniqueEmail('cloud');
    await http().post('/api/auth/register').send({ email, password: 'online password 1', name: '' }).expect(201);
    const wrong = await http().post('/api/cloud/move').set(auth(pc)).send({ email, password: 'not it', confirm: true }).expect(400);
    expect(wrong.body.message).toMatch(/^The online app says: /);
    const noTick = await http().post('/api/cloud/move').set(auth(pc)).send({ email, password: 'online password 1' }).expect(400);
    expect(noTick.body.message).toMatch(/I understand/);
  });

  it('the online app refuses books with columns it doesn’t know yet (it must be updated first)', async () => {
    const someone = await owner(app);
    const r = await http().post('/api/cloud/import').set(auth(someone)).send({ source: { id: someone.businessId, code: 'BE-1', name: 'x' }, columns: { parties: ['id', 'a_column_from_the_future'] }, data: 'AA==' }).expect(409);
    expect(r.body.message).toMatch(/needs an update/);
    expect(unknownColumns({ parties: ['id', 'name'] }, [{ name: 'parties', columns: ['id', 'name', 'phone'] } as never])).toEqual([]);
  });

  it('the moved shop’s id is the same for the same books and person, and different otherwise', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const u = '22222222-2222-4222-8222-222222222222';
    expect(movedId(a, u)).toBe(movedId(a, u));
    expect(movedId(a, u)).not.toBe(movedId(u, a));
    expect(movedId(a, u)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

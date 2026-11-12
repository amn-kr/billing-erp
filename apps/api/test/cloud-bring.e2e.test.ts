import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIst } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp, uniqueEmail } from './helpers';
import { pcId } from '../src/modules/backup/cloud';

/**
 * Bring my online books to this PC (Phase 6, step 7b): an online shop's whole books come down to a "This PC
 * only" PC once; the same email and password then work there, and online the shop becomes view-only. Here one
 * server plays both parts (CLOUD_URL is itself, so the account already exists "on the PC" with the same
 * password); the Windows app's test does it across two servers, with no account on the PC at first.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = todayIst();
const PASSWORD = 'correct horse 1';

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

/** An online shop with an item, a party and 2 invoices. */
async function onlineShop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', gstRate: 18, openingQty: '25', openingDate: D }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000', openingDate: D }).expect(201)).body;
  const sale = { date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] };
  for (let i = 0; i < 2; i++) await http().post('/api/sales').set(auth(o)).send(sale).expect(201);
  return { ...o, sale };
}

describe('Bring my online books to this PC', () => {
  it('on the PC, an email with no account here says so plainly; a wrong password is still “wrong”', async () => {
    const none = await http().post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: 'whatever 1' }).expect(401);
    expect(none.body).toMatchObject({ code: 'not_on_pc', message: 'There’s no account with this email on this computer yet. Your online account is separate.' });
    const o = await owner(app);
    const wrong = await http().post('/api/auth/login').send({ email: o.email, password: 'not it at all' }).expect(401);
    expect(wrong.body.message).toBe('Email or password is wrong.');
    expect(wrong.body.code).toBeUndefined();
  });

  it('lists only the shops the account owns, then brings one down whole; online it becomes view-only', async () => {
    const o = await onlineShop();
    // a shop where this person is only staff is not offered
    const other = await owner(app);
    const staff = await member(app, other, 'manager');
    expect((await http().post('/api/cloud/bring/shops').send({ email: staff.email, password: PASSWORD }).expect(200)).body.shops).toEqual([]);

    const { shops } = (await http().post('/api/cloud/bring/shops').send({ email: o.email, password: PASSWORD }).expect(200)).body;
    expect(shops).toEqual([expect.objectContaining({ id: o.businessId, name: 'Gupta Electricals & Hardware', movedToPcOn: null })]);

    const noTick = await http().post('/api/cloud/bring').send({ email: o.email, password: PASSWORD, businessId: o.businessId }).expect(400);
    expect(noTick.body.message).toMatch(/I understand/);

    const r = await http().post('/api/cloud/bring').send({ email: o.email, password: PASSWORD, businessId: o.businessId, confirm: true }).expect(200);
    expect(r.body).toMatchObject({ matches: true, already: false, name: 'Gupta Electricals & Hardware' });
    expect(r.body.here).toMatchObject({ invoices: 2, parties: 1, items: 1 });
    expect(r.body.online).toEqual(r.body.here);
    expect(String(r.headers['set-cookie'])).toMatch(/erp_rt=/);

    // signed in on the PC's books: same bills, the numbering carries on
    const pc = { token: r.body.accessToken as string };
    const me = (await http().get('/api/me').set(auth(pc)).expect(200)).body;
    expect(me.business).toMatchObject({ id: pcId(o.businessId), code: r.body.code, movedToPcOn: null });
    const sales = (await http().get('/api/sales').set(auth(pc)).expect(200)).body as { number: string }[];
    expect(sales.map((s) => s.number).sort()).toEqual(['INV-0001', 'INV-0002']);
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(pc)).expect(200)).body.number).toBe('INV-0003');

    // online: looking works, every change is refused with the plain reason
    const onlineMe = (await http().get('/api/me').set(auth(o)).expect(200)).body;
    expect(onlineMe.business.movedToPcOn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await http().get('/api/sales').set(auth(o)).expect(200)).body).toHaveLength(2);
    await http().post('/api/sales/cost').set(auth(o)).send({ lines: [] }).expect((x) => expect(x.status).not.toBe(403));
    const refused = await http().post('/api/sales').set(auth(o)).send(o.sale).expect(403);
    expect(refused.body).toMatchObject({ code: 'moved_to_pc' });
    expect(refused.body.message).toMatch(/^These books were moved to a PC on \d{1,2} \w{3} \d{4}\. You can look and print here; billing happens on that PC\.$/);
    await http().post('/api/parties').set(auth(o)).send({ name: 'Someone new' }).expect(403);
    // the PC's books are not view-only
    await http().post('/api/sales').set(auth(pc)).send({ ...o.sale, partyId: undefined }).expect((x) => expect(x.body.code).not.toBe('moved_to_pc'));

    // listed as moved; taking them again is refused
    const again = (await http().post('/api/cloud/bring/shops').send({ email: o.email, password: PASSWORD }).expect(200)).body.shops;
    expect(again.find((s: { id: string }) => s.id === o.businessId).movedToPcOn).toMatch(/^\d{4}-/);
    const exp = await http().post('/api/cloud/export').set(auth(o)).send({ businessId: o.businessId }).expect(409);
    expect(exp.body.code).toBe('moved_to_pc');
  });

  it('a retry after the books came down finds the same books here: never two copies', async () => {
    const o = await onlineShop();
    const first = (await http().post('/api/cloud/bring').send({ email: o.email, password: PASSWORD, businessId: o.businessId, confirm: true }).expect(200)).body;
    const again = (await http().post('/api/cloud/bring').send({ email: o.email, password: PASSWORD, businessId: o.businessId, confirm: true }).expect(200)).body;
    expect(again).toMatchObject({ code: first.code, already: true });
    const me = (await http().get('/api/me').set(auth({ token: again.accessToken })).expect(200)).body;
    // the online shop and the one on "the PC" (the same server here)
    expect(me.memberships).toHaveLength(2);
  });

  it('only the owner can take a shop’s books; a wrong online password is said plainly', async () => {
    const o = await onlineShop();
    const staff = await member(app, o, 'manager');
    const r = await http().post('/api/cloud/export').set(auth(staff)).send({ businessId: o.businessId }).expect(403);
    expect(r.body.message).toBe('Only the shop’s owner can bring its books to a PC.');
    await http().post('/api/cloud/moved-to-pc').set(auth(staff)).send({ businessId: o.businessId, pcCode: 'BE-1' }).expect(403);
    const bad = await http().post('/api/cloud/bring').send({ email: o.email, password: 'not it at all', businessId: o.businessId, confirm: true }).expect(400);
    expect(bad.body.message).toBe('The online app says: Email or password is wrong.');
    // nothing changed online
    expect((await http().get('/api/me').set(auth(o)).expect(200)).body.business.movedToPcOn).toBeNull();
  });
});

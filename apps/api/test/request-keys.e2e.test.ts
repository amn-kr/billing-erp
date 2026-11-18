import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db.service';
import { auth, member, owner, startApp } from './helpers';

/**
 * One-time keys against double bills (owner, 18 Nov 2026; step 8.1b): a save sent twice with the
 * same key is saved once, and the repeat gets the first answer back.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';
const KEY = 'idempotency-key';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
async function shop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25' }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  const body = { date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] };
  return { o, fan, verma, body };
}
const sale = (o: { token: string }, body: object, key?: string) => {
  const r = http().post('/api/sales').set(auth(o));
  return (key ? r.set(KEY, key) : r).send(body);
};
const count = async (o: S) => ((await http().get('/api/sales').set(auth(o)).expect(200)).body as unknown[]).length;
const stock = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;

describe('one-time keys', () => {
  it('the same bill sent twice is saved once; the repeat gets the same answer', async () => {
    const { o, fan, body } = await shop();
    const a = await sale(o, body, 'phone-key-0001').expect(201);
    const b = await sale(o, body, 'phone-key-0001').expect(201);
    expect(b.body).toEqual(a.body);
    expect(a.body.number).toBe('INV-0001');
    expect(await count(o)).toBe(1);
    expect(await stock(o, fan.id)).toBe('24.000');
    // a new key is a new bill
    expect((await sale(o, body, 'phone-key-0002').expect(201)).body.number).toBe('INV-0002');
  });

  it('two copies arriving at the same moment still make one bill', async () => {
    const { o, body } = await shop();
    const all = await Promise.all([1, 2, 3].map(() => sale(o, body, 'phone-key-race')));
    const ok = all.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of all.filter((x) => x.status !== 201)) expect(r.body.code).toBe('request_in_progress');
    expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
    expect(await count(o)).toBe(1);
  });

  it('a save that fails forgets its key, so it can be sent again with changes', async () => {
    const { o, fan } = await shop();
    const p = (await http().post('/api/parties').set(auth(o)).send({ name: 'Small Shop', creditLimit: '1000' }).expect(201)).body;
    const body = { date: D, dueDate: D, partyId: p.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '1890', discPct: '0', gstRate: '18' }] };
    expect((await sale(o, body, 'phone-key-limit').expect(409)).body.code).toBe('over_credit_limit');
    await sale(o, { ...body, confirmOverLimit: true }, 'phone-key-limit').expect(201);
    expect(await count(o)).toBe(1);
  });

  it('the same key for a different save, or by another person, is refused', async () => {
    const { o, body } = await shop();
    await sale(o, body, 'phone-key-0003').expect(201);
    expect((await sale(o, { ...body, notes: 'changed' }, 'phone-key-0003').expect(422)).body.code).toBe('request_key_reused');
    const staff = await member(app, o, 'manager');
    expect((await sale(staff, body, 'phone-key-0003').expect(422)).body.code).toBe('request_key_reused');
    expect(await count(o)).toBe(1);
  });

  it('keys belong to one shop: another shop may use the same key', async () => {
    const a = await shop();
    const b = await shop();
    await sale(a.o, a.body, 'phone-key-shared').expect(201);
    expect((await sale(b.o, b.body, 'phone-key-shared').expect(201)).body.number).toBe('INV-0001');
    expect(await count(b.o)).toBe(1);
  });

  it('a key left half-way by a stopped server waits, then is given up after 2 minutes', async () => {
    const { o, body } = await shop();
    const db = app.get(DbService);
    const as = <T,>(fn: Parameters<DbService['scoped']>[1]) => db.scoped({ businessId: o.businessId }, fn) as Promise<T>;
    const sub = (JSON.parse(Buffer.from(o.token.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
    await sale(o, body, 'phone-key-first').expect(201);
    // what this save looks like (the key itself is not part of it)
    const fp = (await db.scoped({ businessId: o.businessId }, (tx) => tx.requestKey.findFirstOrThrow({ where: { key: 'phone-key-first' } }))).fingerprint;
    // the same save was half-way when the server stopped
    await as(async (tx) => tx.requestKey.create({ data: { businessId: o.businessId, key: 'phone-key-stuck', userId: sub, fingerprint: fp } }));
    expect((await sale(o, body, 'phone-key-stuck').expect(409)).body.code).toBe('request_in_progress');
    await as(async (tx) => tx.requestKey.update({ where: { businessId_key: { businessId: o.businessId, key: 'phone-key-stuck' } }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } }));
    expect((await sale(o, body, 'phone-key-stuck').expect(201)).body.number).toBe('INV-0002');
    expect((await sale(o, body, 'phone-key-stuck').expect(201)).body.number).toBe('INV-0002');
  });

  it('old keys are removed after 7 days; a bad key is refused; saves without a key work as before', async () => {
    const { o, body } = await shop();
    const db = app.get(DbService);
    const sub = (JSON.parse(Buffer.from(o.token.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
    await db.scoped({ businessId: o.businessId }, (tx) => tx.requestKey.create({ data: { businessId: o.businessId, key: 'phone-key-old', userId: sub, fingerprint: 'x', status: 200, createdAt: new Date(Date.now() - 8 * 24 * 3600_000) } }));
    await sale(o, body, 'phone-key-new1').expect(201);
    expect(await db.scoped({ businessId: o.businessId }, (tx) => tx.requestKey.count({ where: { key: 'phone-key-old' } }))).toBe(0);
    expect((await sale(o, body, 'bad key!').expect(400)).body.code).toBe('request_key');
    await sale(o, body).expect(201);
    await sale(o, body).expect(201);
    expect(await count(o)).toBe(3);
  });
});

import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/**
 * Transaction passcode: when switched on, the server refuses to change or cancel a saved document
 * without it — whatever screen (or none) sends the call. Made-up passcodes only.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-01';
const PASS = '4826';
const NEW = '913570';
const H = 'x-txn-passcode';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
const state = async (o: { token: string }) => (await http().get('/api/settings/passcode').set(auth(o)).expect(200)).body;
const turnOn = (o: S, passcode = PASS) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode }).expect(200);
const audit = async (o: S) => (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; after: Record<string, unknown> | null }[];

async function expense(o: S) {
  const cash = (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body[0];
  await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '10000' }).expect(200);
  const tea = (await http().get('/api/expense-categories').set(auth(o)).expect(200)).body.find((c: { name: string }) => c.name === 'Tea & refreshments');
  const body = (amt: string) => ({ date: D, categoryId: tea.id, mode: 'Cash', payee: 'Sharma Tea Stall', lines: [{ name: 'Tea', amt }] });
  const x = (await http().post('/api/expenses').set(auth(o)).send(body('640')).expect(201)).body;
  return { x, body };
}

async function sale(o: S) {
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingDate: D }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  const body = (qty: string) => ({ date: D, dueDate: D, partyId: verma.id, lines: [{ itemId: fan.id, name: fan.name, qty, price: '1890', discPct: '0', gstRate: '18' }] });
  const inv = (await http().post('/api/sales').set(auth(o)).send(body('3')).expect(201)).body;
  return { inv, body };
}

/** Every edit / cancel call the passcode protects. */
const GUARDED: [method: 'put' | 'post', path: (id: string) => string][] = [
  ['put', (id) => `/api/sales/${id}`],
  ['post', (id) => `/api/sales/${id}/cancel`],
  ['put', (id) => `/api/quotations/brand/${id}`],
  ['post', (id) => `/api/purchases/${id}/cancel`],
  ['put', (id) => `/api/expenses/${id}`],
  ['post', (id) => `/api/expenses/${id}/cancel`],
  ['post', (id) => `/api/banking/entries/${id}/cancel`],
  ['post', (id) => `/api/banking/cheques/${id}/undo`],
  ['post', (id) => `/api/stock-adjustments/${id}/cancel`],
  ['post', (id) => `/api/stock-transfers/${id}/cancel`],
];

describe('transaction passcode', () => {
  it('starts off; turning on the first time needs a 4 to 6 digit passcode; never returns it or its hash', async () => {
    const o = await owner(app);
    expect(await state(o)).toEqual({ set: false, enabled: false });
    expect((await http().post('/api/settings/passcode/on').set(auth(o)).send({}).expect(400)).body.message).toBe('Choose a 4 to 6 digit passcode.');
    for (const bad of ['123', '1234567', '12a4']) await http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: bad }).expect(400);
    const r = (await turnOn(o)).body;
    expect(r).toEqual({ set: true, enabled: true });
    expect(await state(o)).toEqual({ set: true, enabled: true });
    const all = JSON.stringify(await audit(o));
    expect(all).not.toContain(PASS);
    expect(all).not.toMatch(/argon|passcode_hash|passcodeHash/);
    expect((await audit(o))[0]).toMatchObject({ action: 'create', entity: 'txn_passcode', after: { enabled: true } });
  });

  it('every edit and cancel call refuses without the passcode when it is on — and works as before when off', async () => {
    const o = await owner(app);
    for (const [m, p] of GUARDED) {
      const r = await http()[m](p(randomUUID())).set(auth(o)).send({});
      expect(r.status, p('id')).not.toBe(403);
    }
    await turnOn(o);
    for (const [m, p] of GUARDED) {
      const r = await http()[m](p(randomUUID())).set(auth(o)).send({}).expect(403);
      expect(r.body, p('id')).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
      // with the passcode the call goes through to the document (here: not found / not valid)
      const ok = await http()[m](p(randomUUID())).set(auth(o)).set(H, PASS).send({});
      expect(ok.status, p('id')).not.toBe(403);
    }
  });

  it('a saved expense is changed and cancelled only with the right passcode; new documents never need it', async () => {
    const o = await owner(app);
    await turnOn(o);
    const { x, body } = await expense(o);
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).send(body('700')).expect(403);
    const wrong = await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, '0000').send(body('700')).expect(403);
    expect(wrong.body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body[0]).toMatchObject({ total: '640.00' });
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, PASS).send(body('700')).expect(200);
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body[0]).toMatchObject({ total: '700.00' });
    // asked every time: the next change needs it again
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).send(body('710')).expect(403);
    await http().post(`/api/expenses/${x.id}/cancel`).set(auth(o)).expect(403);
    await http().post(`/api/expenses/${x.id}/cancel`).set(auth(o)).set(H, PASS).expect(201);
    expect((await http().get('/api/expenses').set(auth(o)).expect(200)).body).toEqual([]);
    const a = await audit(o);
    expect(a.filter((e) => e.action === 'passcode_used').map((e) => [e.entityId, e.after])).toEqual([
      [x.id, { for: 'cancel', document: 'expense' }],
      [x.id, { for: 'edit', document: 'expense' }],
    ]);
    expect(a.filter((e) => e.action === 'passcode_failed')).toHaveLength(1);
    expect(a.find((e) => e.action === 'passcode_failed')).toMatchObject({ entity: 'txn_passcode', entityId: x.id, after: { for: 'edit' } });
    expect(JSON.stringify(a)).not.toContain(PASS);
  });

  it('a saved invoice: edit and cancel need the passcode; a new invoice does not', async () => {
    const o = await owner(app);
    await turnOn(o);
    const { inv, body } = await sale(o);
    await http().put(`/api/sales/${inv.id}`).set(auth(o)).send(body('4')).expect(403);
    await http().put(`/api/sales/${inv.id}`).set(auth(o)).set(H, PASS).send(body('4')).expect(200);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({}).expect(403);
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.cancelled).toBe(false);
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).set(H, PASS).send({}).expect(200);
    expect((await http().get(`/api/sales/${inv.id}`).set(auth(o)).expect(200)).body.cancelled).toBe(true);
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const o = await owner(app);
    await turnOn(o);
    const { x, body } = await expense(o);
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, '1111').send(body('1')).expect(403)).body.message);
    expect(msgs).toEqual(['Wrong passcode. 4 tries left.', 'Wrong passcode. 3 tries left.', 'Wrong passcode. 2 tries left.', 'Wrong passcode. 1 try left.', 'Too many wrong tries. Try again in 60 seconds.']);
    expect((await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, PASS).send(body('1')).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect((await audit(o)).filter((e) => e.action === 'passcode_failed')).toHaveLength(5);
  });

  it('turning off needs the passcode; the settings save can’t switch it off', async () => {
    const o = await owner(app);
    await turnOn(o);
    await http().patch('/api/settings').set(auth(o)).send({ txnPasscode: false, enabled: false }).expect(200);
    expect(await state(o)).toEqual({ set: true, enabled: true });
    await http().post('/api/settings/passcode/off').set(auth(o)).send({}).expect(400);
    expect((await http().post('/api/settings/passcode/off').set(auth(o)).send({ passcode: '0000' }).expect(403)).body.message).toBe('Wrong passcode. 4 tries left.');
    expect((await http().post('/api/settings/passcode/off').set(auth(o)).send({ passcode: PASS }).expect(200)).body).toEqual({ set: true, enabled: false });
    const { x, body } = await expense(o);
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).send(body('700')).expect(200);
    // on again: the saved passcode is used again, no new one needed
    expect((await http().post('/api/settings/passcode/on').set(auth(o)).send({}).expect(200)).body).toEqual({ set: true, enabled: true });
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, PASS).send(body('710')).expect(200);
    const a = await audit(o);
    expect(a.filter((e) => e.entity === 'txn_passcode' && e.action === 'update').map((e) => e.after)).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('Change Passcode needs the current one; the old one stops working', async () => {
    const o = await owner(app);
    await turnOn(o);
    await http().post('/api/settings/passcode/check').set(auth(o)).send({ passcode: '0000' }).expect(403);
    await http().post('/api/settings/passcode/check').set(auth(o)).send({ passcode: PASS }).expect(204);
    await http().post('/api/settings/passcode/change').set(auth(o)).send({ current: '0000', passcode: NEW }).expect(403);
    expect((await http().post('/api/settings/passcode/change').set(auth(o)).send({ current: PASS, passcode: NEW }).expect(200)).body).toEqual({ set: true, enabled: true });
    const { x, body } = await expense(o);
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, PASS).send(body('700')).expect(403);
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, NEW).send(body('700')).expect(200);
    expect((await audit(o)).some((e) => e.action === 'update' && e.after?.passcode === 'changed')).toBe(true);
  });

  it('Forgot passcode: only the shop owner, with their account password', async () => {
    const o = await owner(app);
    await turnOn(o);
    const mgr = await member(app, o, 'manager');
    expect((await http().post('/api/settings/passcode/reset').set(auth(mgr)).send({ password: 'correct horse 1', passcode: NEW }).expect(403)).body.message).toBe('Only the shop owner can set a new passcode this way.');
    expect((await http().post('/api/settings/passcode/reset').set(auth(o)).send({ password: 'wrong password', passcode: NEW }).expect(403)).body.message).toBe('Wrong password. 4 tries left.');
    await http().post('/api/settings/passcode/reset').set(auth(o)).send({ password: 'correct horse 1', passcode: NEW }).expect(200);
    const { x, body } = await expense(o);
    await http().put(`/api/expenses/${x.id}`).set(auth(o)).set(H, NEW).send(body('700')).expect(200);
    expect((await audit(o)).some((e) => e.action === 'update' && e.after?.passcode === 'reset with account password')).toBe(true);
  });

  it('staff need the passcode too; billing staff can’t switch it; another shop is not affected', async () => {
    const o = await owner(app);
    await turnOn(o);
    const staff = await member(app, o, 'billing_staff');
    expect(await state(staff)).toEqual({ set: true, enabled: true });
    await http().post('/api/settings/passcode/off').set(auth(staff)).send({ passcode: PASS }).expect(403);
    const { inv, body } = await sale(o);
    await http().put(`/api/sales/${inv.id}`).set(auth(staff)).send(body('4')).expect(403);
    await http().put(`/api/sales/${inv.id}`).set(auth(staff)).set(H, PASS).send(body('4')).expect(200);
    const other = await owner(app);
    expect(await state(other)).toEqual({ set: false, enabled: false });
    const e = await expense(other);
    await http().put(`/api/expenses/${e.x.id}`).set(auth(other)).send(e.body('700')).expect(200);
  });
});

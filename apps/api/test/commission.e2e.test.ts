import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

/** Electrician commission: earned as customers pay, paid from cash / bank or adjusted against his bills. */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-01';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

describe('commission', () => {
  it('commission is earned as the customer pays; paying more than earned is refused; cash payouts show in the cash book', async () => {
    const o = await owner(app);
    const mcb = (await http().post('/api/items').set(auth(o)).send({ name: 'MCB 32A double pole', sale: '420', purchase: '310', gstRate: 18, category: 'Switches & MCBs', openingQty: '50' }).expect(201)).body;
    const mehta = (await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals', kind: 'customer' }).expect(201)).body;
    const sunil = (await http().post('/api/referrers').set(auth(o)).send({ name: 'Sunil Electrician', phone: '9839044556', city: 'Lucknow' }).expect(201)).body;
    const cash = ((await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { id: string }[])[0]!;
    await http().put(`/api/banking/accounts/${cash.id}`).set(auth(o)).send({ openingBalance: '1000' }).expect(200);
    // 2 MCBs at 420 + 10% commission = 462 each; nothing paid yet
    const inv = (await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: mehta.id, referrerId: sunil.id, roundOff: false, lines: [{ itemId: mcb.id, name: mcb.name, qty: '2', price: '462', basePrice: '420', discPct: '0', gstRate: '18' }], payments: [] }).expect(201)).body;
    let [s] = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    // 42 × 2 = 84 with GST inside the price; commission leaves the GST out (84 / 1.18), as the prototype's INV-0108
    expect(s).toMatchObject({ name: 'Sunil Electrician', bills: 1, comm: '71.19', earned: '0.00', due: '0.00' });
    expect((await http().post('/api/commission/payouts').set(auth(o)).send({ referrerId: sunil.id, amount: '10', mode: 'Cash' }).expect(400)).body.message).toBe('Only 0.00 is payable now — the rest is earned as the customer pays.');
    // the customer pays in full: all of it is earned
    await http().post('/api/receipts').set(auth(o)).send({ partyId: mehta.id, date: D, amount: inv.total, mode: 'UPI', ref: 'UPI 1', allocations: [{ to: inv.id, amount: inv.total }] }).expect(201);
    [s] = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    expect(s.earned).toBe(s.comm);
    const r = (await http().post('/api/commission/payouts').set(auth(o)).send({ referrerId: sunil.id, amount: s.due, mode: 'Cash', note: 'October' }).expect(201)).body;
    expect(r).toMatchObject({ number: 'CP-0001', adjusted: false });
    [s] = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    expect(s.due).toBe('0.00');
    const book = (await http().get(`/api/banking/accounts/${cash.id}/book`).set(auth(o)).expect(200)).body;
    expect(book.entries.find((e: { kind: string }) => e.kind === 'Commission paid')).toMatchObject({ kind: 'Commission paid', party: 'Sunil Electrician', ref: 'CP-0001', amt: '-' + r.amount });
  });

  it('“Adjust against his bills” pays his own oldest dues with the commission', async () => {
    const o = await owner(app);
    const mcb = (await http().post('/api/items').set(auth(o)).send({ name: 'MCB 32A double pole', sale: '420', purchase: '310', gstRate: 18, category: 'Switches & MCBs', openingQty: '50' }).expect(201)).body;
    const mehta = (await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals', kind: 'customer' }).expect(201)).body;
    const sunil = (await http().post('/api/referrers').set(auth(o)).send({ name: 'Sunil Electrician', phone: '9839044556' }).expect(201)).body;
    const own = (await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: sunil.partyId, roundOff: false, lines: [{ itemId: mcb.id, name: mcb.name, qty: '1', price: '420', discPct: '0', gstRate: '18' }], payments: [] }).expect(201)).body;
    await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'cash', partyId: null, cashName: 'Walk-in', referrerId: sunil.id, roundOff: false, lines: [{ itemId: mcb.id, name: mcb.name, qty: '3', price: '462', basePrice: '420', discPct: '0', gstRate: '18' }], payments: [{ mode: 'Cash', amount: '9999', ref: '' }] }).expect(201);
    const [s] = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    expect(s.partyBalance).toBe(own.total);
    const r = (await http().post('/api/commission/payouts').set(auth(o)).send({ referrerId: sunil.id, amount: '50', mode: 'Adjust' }).expect(201)).body;
    expect(r).toMatchObject({ number: 'CP-0001', adjusted: true });
    const [s2] = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    expect(s2.payouts[0]).toMatchObject({ mode: 'Adjusted in his account', note: `PI-0002 · ${own.number}` });
    expect(s2.partyBalance).toBe((Number(own.total) - 50).toFixed(2));
    void mehta;
  });

  it('a party put in the Electricians group shows up as an electrician', async () => {
    const o = await owner(app);
    await http().post('/api/parties').set(auth(o)).send({ name: 'Imran Electricals', kind: 'customer', group: 'Electricians', phone: '9721144556' }).expect(201);
    const C = (await http().get('/api/commission').set(auth(o)).expect(200)).body;
    expect(C.map((x: { name: string }) => x.name)).toContain('Imran Electricals');
  });
});

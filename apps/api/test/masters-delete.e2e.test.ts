import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/**
 * Delete for items and parties (Oct 2026): only when never used. An opening stock or opening balance
 * alone is allowed (put back / set to zero). A used one is refused with what uses it and can be made
 * inactive instead. Nothing is erased: a deleted one is hidden everywhere, also from "Show inactive".
 * No passcode (only documents have one). Every edit, delete and make inactive / active is in the audit log.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = { token: string };
type Row = { id: string; name: string };
const item = async (o: S, name: string, extra: object = {}) => (await http().post('/api/items').set(auth(o)).send({ name, sale: '100', gstRate: 18, ...extra }).expect(201)).body as Row & { stock: string };
const party = async (o: S, name: string, extra: object = {}) => (await http().post('/api/parties').set(auth(o)).send({ name, ...extra }).expect(201)).body as Row & { balance: string };
const line = (it: Row, qty = '1', price = '100') => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const pline = (it: Row, qty = '1', rate = '50') => ({ itemId: it.id, name: it.name, qty, rate, discPct: '0', gstRate: '18' });
const sale = async (o: S, body: object) => (await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', payments: [], ...body }).expect(201)).body as { id: string; total: string };
const buy = async (o: S, body: object) => (await http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, ...body }).expect(201)).body as { id: string };
const usage = async (o: S, what: 'items' | 'parties', id: string) => (await http().get(`/api/${what}/${id}/usage`).set(auth(o)).expect(200)).body as { canDelete: boolean; message: string };
const del = (o: S, what: 'items' | 'parties', id: string) => http().post(`/api/${what}/${id}/delete`).set(auth(o)).send({});
const names = async (o: S, what: 'items' | 'parties', archived = false) => ((await http().get(`/api/${what}${archived ? '?archived=true' : ''}`).set(auth(o)).expect(200)).body as Row[]).map((x) => x.name);
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; userId: string | null; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
const refused = (name: string, uses: string) => `${name} is used in ${uses}, so it can’t be deleted. You can make it inactive instead: it is hidden from lists and new bills, and stays on old ones.`;

/** Each of these, on its own, stops the item from being deleted; the message names it. */
async function expectItemRefused(o: S, it: Row, uses: string) {
  const msg = refused(it.name, uses);
  expect(await usage(o, 'items', it.id)).toEqual({ canDelete: false, message: msg });
  expect((await del(o, 'items', it.id).expect(400)).body.message).toBe(msg);
  expect(await names(o, 'items')).toContain(it.name);
}
async function expectPartyRefused(o: S, p: Row, uses: string) {
  const msg = refused(p.name, uses);
  expect(await usage(o, 'parties', p.id)).toEqual({ canDelete: false, message: msg });
  expect((await del(o, 'parties', p.id).expect(400)).body.message).toBe(msg);
  expect(await names(o, 'parties')).toContain(p.name);
}

describe('delete an item', () => {
  it('never used, with opening stock: its stock is put back, it is hidden everywhere and its name is free again', async () => {
    const o = await owner(app);
    const fan = await item(o, 'Ceiling fan 1200mm', { code: 'CF1200', openingQty: '25', openingRate: '1540' });
    const keep = await item(o, 'LED bulb 9W', { openingQty: '10', openingRate: '60' });
    const godowns = async () => (await http().get('/api/godowns').set(auth(o)).expect(200)).body as { stock: string; value: string }[];
    const before = await godowns();
    expect(await usage(o, 'items', fan.id)).toEqual({ canDelete: true, message: '' });
    expect((await del(o, 'items', fan.id).expect(200)).body).toEqual({ id: fan.id, name: fan.name });
    // the opening stock no longer counts anywhere; the other item is untouched
    expect((await http().get(`/api/items/${fan.id}`).set(auth(o)).expect(200)).body.stock).toBe('0.000');
    expect((await http().get(`/api/items/${keep.id}`).set(auth(o)).expect(200)).body.stock).toBe('10.000');
    expect(JSON.stringify(await godowns())).not.toBe(JSON.stringify(before));
    expect((await godowns())[0]).toMatchObject({ value: '600.00' });
    // gone from the list and from "Show inactive"; name and code can be used again
    expect(await names(o, 'items')).toEqual(['LED bulb 9W']);
    expect(await names(o, 'items', true)).toEqual([]);
    await item(o, 'Ceiling fan 1200mm', { code: 'CF1200' });
    // a deleted item can't be deleted again, edited or made active
    expect((await del(o, 'items', fan.id).expect(400)).body.message).toBe('Already deleted');
    expect((await http().patch(`/api/items/${fan.id}`).set(auth(o)).send({ sale: '1' }).expect(400)).body.message).toBe('Already deleted');
    expect((await http().post(`/api/items/${fan.id}/restore`).set(auth(o)).expect(400)).body.message).toBe('Already deleted');
    // who and when: the audit log keeps what it was
    const a = (await audit(o)).find((e) => e.action === 'delete' && e.entityId === fan.id)!;
    expect(a).toMatchObject({ entity: 'item', before: { name: 'Ceiling fan 1200mm', code: 'CF1200', stock: '25.000' }, after: { deleted: true } });
    expect(a.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.createdAt).toBeTruthy();
  });

  it('a service or an item without stock is deleted the same way', async () => {
    const o = await owner(app);
    const svc = await item(o, 'Fan installation', { kind: 'service' });
    const plain = await item(o, 'MCB 16A');
    await del(o, 'items', svc.id).expect(200);
    await del(o, 'items', plain.id).expect(200);
    expect(await names(o, 'items')).toEqual([]);
  });

  it('is refused when a sale invoice uses it, also a cancelled one', async () => {
    const o = await owner(app);
    const it = await item(o, 'Ceiling fan', { openingQty: '10' });
    const inv = await sale(o, { cashName: 'Walk-in', mode: 'cash', lines: [line(it)] });
    await expectItemRefused(o, it, '1 sale invoice');
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(200);
    await expectItemRefused(o, it, '1 sale invoice');
  });

  it('is refused when a quotation, a delivery challan or a credit note uses it', async () => {
    const o = await owner(app);
    const cust = await party(o, 'Verma Traders');
    const q = await item(o, 'Quoted item');
    await sale(o, { kind: 'quotation', partyId: cust.id, lines: [line(q)] });
    await expectItemRefused(o, q, '1 quotation');
    const c = await item(o, 'Challan item', { openingQty: '5' });
    await http().post('/api/challans').set(auth(o)).send({ partyId: cust.id, date: D, lines: [{ itemId: c.id, qty: '1' }] }).expect(201);
    await expectItemRefused(o, c, '1 delivery challan');
    const r = await item(o, 'Returned item', { openingQty: '5' });
    const inv = await sale(o, { partyId: cust.id, lines: [line(r, '2')] });
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: cust.id, date: D, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: r.id, qty: '1', price: '100', gstRate: '18' }] }).expect(201);
    await expectItemRefused(o, r, '1 sale invoice and 1 credit note');
  });

  it('is refused when a purchase bill, order or debit note uses it', async () => {
    const o = await owner(app);
    const sup = await party(o, 'Kumar Cables', { kind: 'supplier' });
    const b = await item(o, 'Bought item');
    const bill = await buy(o, { partyId: sup.id, lines: [pline(b, '4')] });
    await expectItemRefused(o, b, '1 purchase bill');
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', partyId: sup.id, againstId: bill.id, reason: 'Damaged goods', date: D, dueDate: D, lines: [pline(b, '1')] }).expect(201);
    await expectItemRefused(o, b, '1 purchase bill and 1 debit note');
    const ord = await item(o, 'Ordered item');
    await buy(o, { kind: 'order', partyId: sup.id, lines: [pline(ord)] });
    await expectItemRefused(o, ord, '1 purchase order');
  });

  it('is refused when a stock adjustment or a godown transfer uses it', async () => {
    const o = await owner(app);
    const a = await item(o, 'Adjusted item', { openingQty: '10' });
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: a.id, mode: 'reduce', qty: 2, date: D, reason: 'Count' }).expect(201);
    await expectItemRefused(o, a, '1 stock adjustment');
    const t = await item(o, 'Moved item', { openingQty: '10' });
    const main = ((await http().get('/api/godowns').set(auth(o)).expect(200)).body as { id: string }[])[0]!;
    const back = (await http().post('/api/godowns').set(auth(o)).send({ name: 'Back store' }).expect(201)).body as { id: string };
    await http().post('/api/stock-transfers').set(auth(o)).send({ itemId: t.id, fromGodownId: main.id, toGodownId: back.id, qty: 3, date: D }).expect(201);
    await expectItemRefused(o, t, '1 stock transfer');
  });

  it('lists every kind of use, with counts', async () => {
    const o = await owner(app);
    const it = await item(o, 'Busy item', { openingQty: '50' });
    for (let k = 0; k < 3; k++) await sale(o, { cashName: 'Walk-in', mode: 'cash', lines: [line(it)] });
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: it.id, mode: 'reduce', qty: 1, date: D, reason: 'Count' }).expect(201);
    await sale(o, { kind: 'quotation', partyId: (await party(o, 'Verma Traders')).id, lines: [line(it)] });
    await expectItemRefused(o, it, '3 sale invoices, 1 quotation and 1 stock adjustment');
  });

  it('make inactive / make active: hidden from the list and shown under "Show inactive", with audit entries', async () => {
    const o = await owner(app);
    const it = await item(o, 'Old switch', { openingQty: '2' });
    await sale(o, { cashName: 'Walk-in', mode: 'cash', lines: [line(it)] });
    await http().post(`/api/items/${it.id}/archive`).set(auth(o)).expect(200);
    expect(await names(o, 'items')).toEqual([]);
    expect(await names(o, 'items', true)).toEqual(['Old switch']);
    await http().post(`/api/items/${it.id}/restore`).set(auth(o)).expect(200);
    expect(await names(o, 'items')).toEqual(['Old switch']);
    expect(await names(o, 'items', true)).toEqual([]);
    const a = (await audit(o)).filter((e) => e.entity === 'item' && e.entityId === it.id).map((e) => [e.action, e.after]);
    expect(a.slice(0, 2)).toEqual([['update', { archived: false }], ['cancel', { archived: true }]]);
  });

  it('an edit is in the audit log with what changed', async () => {
    const o = await owner(app);
    const it = await item(o, 'LED bulb 9W');
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ name: 'LED bulb 9 W', sale: '95' }).expect(200);
    const a = (await audit(o)).find((e) => e.action === 'update' && e.entityId === it.id)!;
    expect(a.after?.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'name' }), expect.objectContaining({ field: 'sale' })]));
  });

  it('needs the right to change items; another shop can’t touch it', async () => {
    const o = await owner(app);
    const it = await item(o, 'Spare item');
    const staff = await member(app, o, 'billing_staff');
    await del(staff, 'items', it.id).expect(403);
    const other = await owner(app);
    await del(other, 'items', it.id).expect(404);
    await http().get(`/api/items/${it.id}/usage`).set(auth(other)).expect(404);
    expect(await names(o, 'items')).toEqual(['Spare item']);
  });
});

describe('delete a party', () => {
  it('never used, with an opening balance: the balance stops counting, it is hidden everywhere and the name is free', async () => {
    const o = await owner(app);
    const keep = await party(o, 'Mehta Electricals', { openingBalance: '500', openingDate: D });
    const home = async () => (await http().get(`/api/reports/home?today=${D}`).set(auth(o)).expect(200)).body;
    const parties = async () => (await http().get('/api/reports/parties').set(auth(o)).expect(200)).body;
    const before = { home: await home(), parties: await parties() };
    const p = await party(o, 'Verma Traders', { phone: '9839012345', openingBalance: '1000', openingDate: D });
    expect(p.balance).toBe('1000.00');
    expect(await usage(o, 'parties', p.id)).toEqual({ canDelete: true, message: '' });
    expect((await del(o, 'parties', p.id).expect(200)).body).toEqual({ id: p.id, name: p.name });
    expect(await home()).toEqual(before.home);
    expect(await parties()).toEqual(before.parties);
    expect(await names(o, 'parties')).toEqual([keep.name]);
    expect(await names(o, 'parties', true)).toEqual([]);
    await party(o, 'Verma Traders');
    expect((await del(o, 'parties', p.id).expect(400)).body.message).toBe('Already deleted');
    expect((await http().patch(`/api/parties/${p.id}`).set(auth(o)).send({ name: 'Verma & Sons' }).expect(400)).body.message).toBe('Already deleted');
    expect((await http().post(`/api/parties/${p.id}/restore`).set(auth(o)).expect(400)).body.message).toBe('Already deleted');
    const a = (await audit(o)).find((e) => e.action === 'delete' && e.entityId === p.id)!;
    expect(a).toMatchObject({ entity: 'party', before: { name: 'Verma Traders', phone: '9839012345', openingBalance: '1000.00' }, after: { deleted: true, openingBalance: '0.00' } });
    expect(a.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is refused when a sale invoice, quotation, challan or credit note is in its name', async () => {
    const o = await owner(app);
    const it = await item(o, 'Ceiling fan', { openingQty: '20' });
    const a = await party(o, 'Invoice customer');
    const inv = await sale(o, { partyId: a.id, lines: [line(it)] });
    await expectPartyRefused(o, a, '1 sale invoice');
    // a cancelled invoice still counts
    await http().post(`/api/sales/${inv.id}/cancel`).set(auth(o)).send({ reason: 'x' }).expect(200);
    await expectPartyRefused(o, a, '1 sale invoice');
    const q = await party(o, 'Quote customer');
    await sale(o, { kind: 'quotation', partyId: q.id, lines: [line(it)] });
    await expectPartyRefused(o, q, '1 quotation');
    const c = await party(o, 'Challan customer');
    await http().post('/api/challans').set(auth(o)).send({ partyId: c.id, date: D, lines: [{ itemId: it.id, qty: '1' }] }).expect(201);
    await expectPartyRefused(o, c, '1 delivery challan');
    const r = await party(o, 'Return customer');
    const rinv = await sale(o, { partyId: r.id, lines: [line(it, '2')] });
    await http().post('/api/credit-notes').set(auth(o)).send({ partyId: r.id, date: D, settle: 'adjust', lines: [{ invoiceId: rinv.id, itemId: it.id, qty: '1', price: '100', gstRate: '18' }] }).expect(201);
    await expectPartyRefused(o, r, '1 sale invoice and 1 credit note');
  });

  it('is refused when a purchase bill, order or debit note is in its name', async () => {
    const o = await owner(app);
    const it = await item(o, 'Wire coil');
    const b = await party(o, 'Bill supplier', { kind: 'supplier' });
    const bill = await buy(o, { partyId: b.id, lines: [pline(it, '5')] });
    await expectPartyRefused(o, b, '1 purchase bill');
    await http().post('/api/purchases').set(auth(o)).send({ kind: 'debit_note', partyId: b.id, againstId: bill.id, reason: 'Damaged goods', date: D, dueDate: D, lines: [pline(it, '1')] }).expect(201);
    await expectPartyRefused(o, b, '1 purchase bill and 1 debit note');
    const ord = await party(o, 'Order supplier', { kind: 'supplier' });
    await buy(o, { kind: 'order', partyId: ord.id, lines: [pline(it)] });
    await expectPartyRefused(o, ord, '1 purchase order');
  });

  it('is refused when a payment received or made is in its name', async () => {
    const o = await owner(app);
    const c = await party(o, 'Paying customer', { openingBalance: '800', openingDate: D });
    await http().post('/api/receipts').set(auth(o)).send({ partyId: c.id, date: D, amount: '300', mode: 'Cash', ref: '' }).expect(201);
    await expectPartyRefused(o, c, '1 payment received');
    const s = await party(o, 'Paid supplier', { kind: 'supplier' });
    await http().post('/api/payments-made').set(auth(o)).send({ partyId: s.id, date: D, amount: '400', mode: 'Cash', ref: '' }).expect(201);
    await http().post('/api/payments-made').set(auth(o)).send({ partyId: s.id, date: D, amount: '100', mode: 'Cash', ref: '' }).expect(201);
    await expectPartyRefused(o, s, '2 payments made');
  });

  it('an electrician (Commission) with referred bills is refused; one without is deleted with its electrician account', async () => {
    const o = await owner(app);
    const it = await item(o, 'MCB 16A', { openingQty: '10' });
    const cust = await party(o, 'Mehta Electricals');
    const raju = await party(o, 'Raju Electrician', { group: 'Electricians' });
    const sunil = await party(o, 'Sunil Electrician', { group: 'Electricians' });
    await http().get('/api/commission').set(auth(o)).expect(200);
    const refs = (await http().get('/api/referrers').set(auth(o)).expect(200)).body as { id: string; partyId: string | null }[];
    const rajuRef = refs.find((r) => r.partyId === raju.id)!;
    await sale(o, { partyId: cust.id, referrerId: rajuRef.id, lines: [line(it)] });
    await expectPartyRefused(o, raju, '1 commission record');
    await del(o, 'parties', sunil.id).expect(200);
    expect(((await http().get('/api/referrers').set(auth(o)).expect(200)).body as { partyId: string | null }[]).map((r) => r.partyId)).toEqual([raju.id]);
  });

  it('make inactive / make active: hidden from the list and shown under "Show inactive", with audit entries', async () => {
    const o = await owner(app);
    const it = await item(o, 'Fan', { openingQty: '3' });
    const p = await party(o, 'Old customer');
    await sale(o, { partyId: p.id, lines: [line(it)] });
    await http().post(`/api/parties/${p.id}/archive`).set(auth(o)).expect(200);
    expect(await names(o, 'parties')).toEqual([]);
    expect(await names(o, 'parties', true)).toEqual(['Old customer']);
    await http().post(`/api/parties/${p.id}/restore`).set(auth(o)).expect(200);
    expect(await names(o, 'parties')).toEqual(['Old customer']);
    const a = (await audit(o)).filter((e) => e.entity === 'party' && e.entityId === p.id).map((e) => [e.action, e.after]);
    expect(a.slice(0, 2)).toEqual([['update', { archived: false }], ['cancel', { archived: true }]]);
  });

  it('an edit is in the audit log with the old and new details', async () => {
    const o = await owner(app);
    const p = await party(o, 'Verma Traders', { phone: '9839012345' });
    await http().patch(`/api/parties/${p.id}`).set(auth(o)).send({ phone: '9839099999' }).expect(200);
    const a = (await audit(o)).find((e) => e.action === 'update' && e.entityId === p.id)!;
    expect(a).toMatchObject({ before: { phone: '9839012345' }, after: { phone: '9839099999' } });
  });

  it('needs the right to change parties; another shop can’t touch it', async () => {
    const o = await owner(app);
    const p = await party(o, 'Spare party');
    const staff = await member(app, o, 'billing_staff');
    await del(staff, 'parties', p.id).expect(403);
    const other = await owner(app);
    await del(other, 'parties', p.id).expect(404);
    expect(await names(o, 'parties')).toEqual(['Spare party']);
  });
});

describe('edit a party’s opening balance (Edit party › Credit & balance)', () => {
  it('the balance follows the new opening balance; it can’t go below what was already received against it', async () => {
    const o = await owner(app);
    const p = await party(o, 'Verma Traders', { openingBalance: '1000', openingDate: D });
    const bal = async () => (await http().get(`/api/parties/${p.id}`).set(auth(o)).expect(200)).body.balance;
    const edit = (body: object) => http().patch(`/api/parties/${p.id}`).set(auth(o)).send(body);
    const BLOCKED = '₹400 was already received against the opening balance. The opening balance can’t be less than that. Edit or delete that payment first.';
    await edit({ openingBalance: '1500' }).expect(200);
    expect(await bal()).toBe('1500.00');
    // 400 received against the opening balance: 1100 still to receive
    const pay = (await http().post('/api/receipts').set(auth(o)).send({ partyId: p.id, date: D, amount: '400', mode: 'Cash', ref: '', allocations: [{ to: 'opening', amount: '400' }] }).expect(201)).body as { id: string };
    expect(await bal()).toBe('1100.00');
    // lower, but not below 400: fine
    await edit({ openingBalance: '400' }).expect(200);
    expect(await bal()).toBe('0.00');
    // below 400, cleared, or turned into "to pay": refused, nothing changes
    for (const body of [{ openingBalance: '399.99' }, { openingBalance: null }, { openingType: 'pay' }])
      expect((await edit(body).expect(400)).body).toMatchObject({ message: BLOCKED, field: 'openingBalance' });
    expect(await bal()).toBe('0.00');
    // other details still save when the opening balance isn't touched
    await edit({ phone: '9839012345' }).expect(200);
    // once that payment is deleted, the opening balance can be lowered
    await http().post(`/api/receipts/${pay.id}/delete`).set(auth(o)).send({}).expect(200);
    await edit({ openingBalance: '300' }).expect(200);
    expect(await bal()).toBe('300.00');
    // "to pay" instead of "to receive"
    await edit({ openingType: 'pay' }).expect(200);
    expect(await bal()).toBe('-300.00');
    const a = (await audit(o)).filter((e) => e.action === 'update' && e.entityId === p.id && e.before?.openingBalance !== e.after?.openingBalance);
    expect(a.map((e) => [e.before?.openingBalance, e.after?.openingBalance])).toEqual([['400.00', '300.00'], ['1500.00', '400.00'], ['1000.00', '1500.00']]);
  });

  it('only the part of a payment set against the opening balance counts', async () => {
    const o = await owner(app);
    const p = await party(o, 'Mehta Electricals', { openingBalance: '1000', openingDate: D });
    await http().post('/api/receipts').set(auth(o)).send({ partyId: p.id, date: D, amount: '1250.50', mode: 'Cash', ref: '', allocations: [{ to: 'opening', amount: '1000' }] }).expect(201);
    expect((await http().patch(`/api/parties/${p.id}`).set(auth(o)).send({ openingBalance: '999' }).expect(400)).body.message).toBe('₹1,000 was already received against the opening balance. The opening balance can’t be less than that. Edit or delete that payment first.');
  });
});

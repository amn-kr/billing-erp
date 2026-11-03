/**
 * Settings › Items (owner's request, 3 Nov 2026): labels, date formats and the default unit are the owner's;
 * the page's price lists and code prefix too; a box turned off hides things, and never changes or loses data.
 */
import type { INestApplication } from '@nestjs/common';
import { IMPORT_KEYS, type ImportRow } from '@billing/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
const D = '2026-10-01';
const ALL = ['batch_no', 'exp_date', 'mfg_date', 'mrp', 'pack_loose'];
const features = (o: S, enabled: string[]) => http().put('/api/settings/features').set(auth(o)).send({ enabled }).expect(200);
const options = (s: S, body: unknown) => http().put('/api/settings/item-options').set(auth(s)).send(body as object);
const me = async (s: S) => (await http().get('/api/me').set(auth(s)).expect(200)).body.business as { features: string[]; itemOptions: unknown };
let n = 0;

describe('labels, date formats and the default unit', () => {
  it('a shop starts with nothing changed, and everyone in it reads what the owner saves', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    expect((await me(o)).itemOptions).toEqual({ labels: {} });
    const body = { labels: { batch: 'Lot', exp: 'Best before', mrp: 'Max price', location: 'Shelf' }, expFormat: 'mm/yy', mfgFormat: 'dd/mm/yy', defaultUnit: 'box' };
    const saved = { ...body, defaultUnit: 'BOX' };
    expect((await options(o, body).expect(200)).body).toEqual({ itemOptions: saved });
    expect((await me(staff)).itemOptions).toEqual(saved);
  });

  it.each(['manager', 'billing_staff', 'accountant'])('%s is refused, and nothing changes', async (role) => {
    const o = await owner(app);
    const s = await member(app, o, role);
    expect((await options(s, { labels: { batch: 'Lot' } }).expect(403)).body.message).toBe('Only the shop owner can change item settings.');
    expect((await me(o)).itemOptions).toEqual({ labels: {} });
  });

  it('refuses a unit the shop doesn’t have, an empty label and anything unknown', async () => {
    const o = await owner(app);
    expect((await options(o, { labels: {}, defaultUnit: 'NOPE' }).expect(400)).body.message).toBe('There is no unit NOPE. Add it first.');
    await options(o, { labels: { batch: '  ' } }).expect(400);
    await options(o, { labels: { other: 'x' } }).expect(400);
    await options(o, { labels: {}, expFormat: 'yy' }).expect(400);
    expect((await me(o)).itemOptions).toEqual({ labels: {} });
  });

  it('each change is in the audit log; saving the same adds nothing; another shop isn’t affected', async () => {
    const o = await owner(app);
    const other = await owner(app);
    await options(o, { labels: { batch: 'Lot' } }).expect(200);
    await options(o, { labels: { batch: 'Lot' } }).expect(200);
    const log = ((await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { entity: string; before: unknown; after: unknown }[]).filter((e) => e.entity === 'item_options');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ before: { labels: {} }, after: { labels: { batch: 'Lot' } } });
    expect((await me(other)).itemOptions).toEqual({ labels: {} });
  });

  it('the settings save managers can use can’t change them', async () => {
    const o = await owner(app);
    const m = await member(app, o, 'manager');
    await http().patch('/api/settings').set(auth(m)).send({ itemOptions: { labels: { batch: 'x' } } }).expect((r) => expect(r.status).toBeLessThan(500));
    expect((await me(o)).itemOptions).toEqual({ labels: {} });
  });
});

describe('the rest of the page is the owner’s too', () => {
  it('a manager can’t turn a price list on or off, or change the code prefix; other settings still save', async () => {
    const o = await owner(app);
    const m = await member(app, o, 'manager');
    const lists = (await http().get('/api/price-lists').set(auth(o)).expect(200)).body as { id: string; isDefault: boolean; active: boolean }[];
    const list = lists.find((l) => !l.isDefault)!;
    await http().patch(`/api/price-lists/${list.id}`).set(auth(m)).send({ active: !list.active }).expect(403);
    await http().patch(`/api/price-lists/${list.id}`).set(auth(o)).send({ active: !list.active }).expect(200);
    await http().patch('/api/settings').set(auth(m)).send({ data: { itemPrefix: 'XX' } }).expect(403);
    await http().patch('/api/settings').set(auth(o)).send({ data: { itemPrefix: 'JE' } }).expect(200);
    await http().patch('/api/settings').set(auth(m)).send({ data: { waLink: true } }).expect(200);
    const data = (await http().get('/api/settings').set(auth(o)).expect(200)).body.data as { itemPrefix: string; waLink: boolean };
    expect(data).toMatchObject({ itemPrefix: 'JE', waLink: true });
  });
});

/** Z900 bought first and expiring last; A100 bought second and expiring first. */
async function stocked() {
  const o = await owner(app);
  await features(o, ALL);
  const it = (await http().post('/api/items').set(auth(o)).send({ name: `Tablet ${++n}`, kind: 'goods', unit: 'PCS', gstRate: 0, sale: '20', trackBatch: true }).expect(201)).body as { id: string; name: string };
  const sup = (await http().post('/api/parties').set(auth(o)).send({ name: `Ram ${n}`, kind: 'supplier' }).expect(201)).body as { id: string };
  const cust = (await http().post('/api/parties').set(auth(o)).send({ name: `Raju ${n}` }).expect(201)).body as { id: string };
  const buy = (no: string, expiry: string, mfg = '') => http().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: sup.id, transport: '0', labour: '0', lines: [{ itemId: it.id, name: it.name, qty: '5', rate: '10', discPct: '0', gstRate: '0', batchNo: no, expiry, mfg }] });
  await buy('Z900', '12/40', '01/26').expect(201);
  await new Promise((r) => setTimeout(r, 20));
  await buy('A100', '03/30', '02/26').expect(201);
  const sell = (extra: object = {}) => http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], lines: [{ itemId: it.id, name: it.name, qty: '1', unit: 'PCS', price: '20', discPct: '0', gstRate: '0' }], ...extra });
  const card = async () => (await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as { batches: { rows: { id: string | null; no: string; expiry: string | null; mfg: string | null; qty: string }[] } | null };
  const sold = async (id: string) => ((await http().get(`/api/sales/${id}`).set(auth(o)).expect(200)).body as { lines: { batches: { no: string; expiry: string | null }[] }[] }).lines[0]!.batches;
  return { o, it, sup, cust, buy, sell, card, sold };
}

describe('Exp Date and Mfg Date boxes', () => {
  it('Exp Date on: earliest expiry is sold first. Off: the oldest batch, whatever its name or expiry', async () => {
    const s = await stocked();
    expect((await s.sold((await s.sell().expect(201)).body.id))[0]).toMatchObject({ no: 'A100' });
    await features(s.o, ['batch_no', 'mfg_date', 'mrp', 'pack_loose']);
    expect((await s.sold((await s.sell().expect(201)).body.id))[0]).toMatchObject({ no: 'Z900', expiry: null });
  });

  it('with Exp Date off: an expired batch sells without the question, and the reports are empty', async () => {
    const s = await stocked();
    await s.buy('OLD1', '01/20').expect(201);
    await features(s.o, ['batch_no']);
    const it = (await http().get(`/api/items/${s.it.id}`).set(auth(s.o)).expect(200)).body as { batches: { rows: { id: string; no: string }[] } };
    const old = it.batches.rows.find((r) => r.no === 'OLD1')!;
    const line = { itemId: s.it.id, name: s.it.name, qty: '1', unit: 'PCS', price: '20', discPct: '0', gstRate: '0', batches: [{ batchId: old.id, qty: '1' }] };
    await s.sell({ lines: [line] }).expect(201);
    expect((await http().get(`/api/reports/expiry?today=${D}`).set(auth(s.o)).expect(200)).body.rows).toEqual([]);
    await features(s.o, ['batch_no', 'exp_date']);
    expect((await http().get(`/api/reports/expiry?today=${D}`).set(auth(s.o)).expect(200)).body.rows.map((r: { no: string }) => r.no)).toContain('OLD1');
    expect((await s.sell({ lines: [line] }).expect(409)).body.code).toBe('expired_batch');
  });

  it('turning a date off hides it; turning it back brings it back, also after saving a purchase and an edit meanwhile', async () => {
    const s = await stocked();
    await features(s.o, ['batch_no']);
    let rows = (await s.card()).batches!.rows;
    expect(rows.every((r) => r.expiry === null && r.mfg === null)).toBe(true);
    // what is typed while the box is off is ignored
    await s.buy('Z900', '11/99', '11/99').expect(201);
    const z = rows.find((r) => r.no === 'Z900')!;
    await http().patch(`/api/batches/${z.id}`).set(auth(s.o)).send({ batchNo: 'Z901', mfg: '', expiry: '' }).expect(200);
    await features(s.o, ['batch_no', 'exp_date', 'mfg_date']);
    rows = (await s.card()).batches!.rows;
    expect(rows.find((r) => r.no === 'Z901')).toMatchObject({ expiry: '2040-12-31', mfg: '2026-01-01' });
    expect(rows.find((r) => r.no === 'A100')).toMatchObject({ expiry: '2030-03-31', mfg: '2026-02-01' });
  });

  it('Batch No. off: batches stay, and come back with their stock', async () => {
    const s = await stocked();
    await features(s.o, []);
    expect((await s.card()).batches).toBeNull();
    await features(s.o, ['batch_no', 'exp_date', 'mfg_date']);
    expect((await s.card()).batches!.rows.map((r) => [r.no, Number(r.qty)]).sort()).toEqual([['A100', 5], ['Z900', 5]]);
  });
});

describe('MRP and Pack and loose are separate', () => {
  it('Pack on with MRP off: an item can be set up by the pack, and a rate above MRP isn’t asked', async () => {
    const o = await owner(app);
    await features(o, ['pack_loose']);
    const it = (await http().post('/api/items').set(auth(o)).send({ name: 'Strip', kind: 'goods', unit: 'TAB', packUnit: 'STRIP', packSize: '10', gstRate: 0, sale: '30', mrp: '20' }).expect(201)).body as { id: string; name: string };
    const got = (await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as { packUnit: string };
    expect(got.packUnit).toBe('STRIP');
    const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Raju' }).expect(201)).body as { id: string };
    await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], lines: [{ itemId: it.id, name: it.name, qty: '1', unit: 'STRIP', price: '30', discPct: '0', gstRate: '0' }] }).expect(201);
  });

  it('MRP on with Pack off: a pack set-up is ignored, and a rate above MRP is asked', async () => {
    const o = await owner(app);
    await features(o, ['mrp']);
    const it = (await http().post('/api/items').set(auth(o)).send({ name: 'Plain', kind: 'goods', unit: 'PCS', packUnit: 'BOX', packSize: '10', gstRate: 0, sale: '30', mrp: '20' }).expect(201)).body as { id: string; name: string };
    expect(((await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body as { packUnit: string }).packUnit).toBe('');
    const cust = (await http().post('/api/parties').set(auth(o)).send({ name: 'Raju' }).expect(201)).body as { id: string };
    const r = await http().post('/api/sales').set(auth(o)).send({ kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], lines: [{ itemId: it.id, name: it.name, qty: '1', unit: 'PCS', price: '30', discPct: '0', gstRate: '0' }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('above_mrp');
  });
});

describe('Category, Brand, Series and Location off', () => {
  const full = { name: 'Fan', kind: 'goods', unit: 'PCS', gstRate: 18, category: 'Fans', brand: 'Bajaj', location: 'Rack A1' };

  it('a new shop has them on, and an item saved while they are off keeps what it has', async () => {
    const o = await owner(app);
    expect((await me(o)).features).toEqual([]);
    const it = (await http().post('/api/items').set(auth(o)).send(full).expect(201)).body as { id: string };
    await features(o, ['no_category', 'no_brand', 'no_series', 'no_location']);
    // the form still sends what it loaded, as a hidden box does
    await http().patch(`/api/items/${it.id}`).set(auth(o)).send({ ...full, name: 'Fan 2' }).expect((r) => expect(r.status).toBeLessThan(300));
    await features(o, []);
    expect((await http().get(`/api/items/${it.id}`).set(auth(o)).expect(200)).body).toMatchObject({ name: 'Fan 2', category: 'Fans', brand: 'Bajaj', location: 'Rack A1' });
  });

  it('Excel import: Rack / shelf saved as the location; with Brand off nothing new is made from an old file', async () => {
    const o = await owner(app);
    const row = (line: number, v: Partial<ImportRow>) => ({ line, ...Object.fromEntries(IMPORT_KEYS.map((k) => [k, ''])), ...v });
    await http().post('/api/items/import').set(auth(o)).send({ rows: [row(2, { type: 'Single Range', name: 'Shelf fan', brand: 'Orient', rack: 'Rack B2' })] }).expect((r) => expect(r.status).toBeLessThan(300));
    await features(o, ['no_brand', 'no_series']);
    const c = (await http().get('/api/items/import/context').set(auth(o)).expect(200)).body as { off: string[] };
    expect(c.off).toEqual(['brand', 'series']);
    await http().post('/api/items/import').set(auth(o)).send({ rows: [row(2, { type: 'Single Range', name: 'Wall fan', brand: 'Newbrand' })] }).expect((r) => expect(r.status).toBeLessThan(300));
    await http().post('/api/items/import').set(auth(o)).send({ rows: [row(2, { type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: 'Roma' })] }).expect((r) => expect(r.status).toBeLessThan(500));
    await features(o, []);
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as { name: string; brand: string; location: string }[];
    expect(items.find((i) => i.name === 'Shelf fan')).toMatchObject({ brand: 'Orient', location: 'Rack B2' });
    expect(items.find((i) => i.name === 'Wall fan')).toMatchObject({ brand: '' });
    expect(items.some((i) => i.name.includes('Switch'))).toBe(false);
    expect(((await http().get('/api/brands').set(auth(o)).expect(200)).body as { name: string }[]).map((b) => b.name)).not.toContain('Newbrand');
  });

  it('Excel import: a row without a unit takes the Default unit', async () => {
    const o = await owner(app);
    await options(o, { labels: {}, defaultUnit: 'BOX' }).expect(200);
    const row = { line: 2, ...Object.fromEntries(IMPORT_KEYS.map((k) => [k, ''])), type: 'Single Range', name: 'Boxed' };
    await http().post('/api/items/import').set(auth(o)).send({ rows: [row] }).expect((r) => expect(r.status).toBeLessThan(300));
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as { name: string; unit: string }[];
    expect(items.find((i) => i.name === 'Boxed')!.unit).toBe('BOX');
  });
});

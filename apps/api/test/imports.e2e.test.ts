import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, member, owner, startApp } from './helpers';

const FIX = path.resolve(__dirname, '../../../packages/importer/fixtures');
const backup = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');

let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const asShop = <T>(businessId: string, fn: (tx: PrismaClient) => Promise<T>) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });

beforeAll(async () => {
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

describe('POST /api/imports', () => {
  it('a dry run reports what would come in, and saves nothing', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports?dryRun=true').set(auth(o)).send({ fileName: 'fresh.json', backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, importId: null, counts: { parties: 4, items: 4, partiesWithOpeningBalance: 3 }, warnings: [] });
    expect(await asShop(o.businessId, (tx) => tx.party.count())).toBe(0);
  });

  it('imports a fresh shop’s backup into an empty shop, all in one go', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'fresh.json', backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(res.body.importId).toBeTruthy();
    const got = await asShop(o.businessId, async (tx) => ({
      business: await tx.business.findFirstOrThrow(),
      parties: await tx.party.findMany({ include: { group: true, addresses: true }, orderBy: { name: 'asc' } }),
      items: await tx.item.findMany({ include: { unit: true, category: true, movements: true }, orderBy: { name: 'asc' } }),
      series: await tx.documentSeries.findFirstOrThrow({ where: { docType: 'invoice' } }),
      wholesale: await tx.priceList.findFirstOrThrow({ where: { name: 'Wholesale' }, include: { rules: { include: { partyGroup: true } } } }),
      runs: await tx.importRun.findMany(),
      audit: await tx.auditLog.findMany({ where: { entity: 'import' } }),
      settings: await tx.businessSettings.findFirstOrThrow(),
    }));
    expect(got.business).toMatchObject({ name: 'Gupta Electricals & Hardware', shortName: 'Gupta Electricals', gstin: '09AAGFG2231M1ZQ', city: 'Lucknow', pin: '226001' });
    expect(got.settings.gstEnabled).toBe(true);
    // the old app's Settings switches arrive under the new names; TCS/TDS choices point at the new tax rates
    const sd = got.settings.data as Record<string, unknown>;
    expect(sd).toMatchObject({ reg: 'regular', hsn: true, pos: true, tcs: false, tdsBill: true, payQr: true, waLink: true, acct: false, upiName: 'Gupta Electricals & Hardware', cashOpen: '15000' });
    expect((await http().get('/api/businesses/current').set(auth(o)).expect(200)).body).toMatchObject({ ownerName: 'Ravi Gupta', email: 'ravi@gupta.example.com', invoiceNext: 101 });
    expect(await asShop(o.businessId, (tx) => tx.taxRate.findFirst({ where: { id: sd.tcsRate as string } }))).toMatchObject({ legacyId: 'tcs1' });
    expect(got.series.nextNumber).toBe(101);
    expect(got.parties.map((p) => p.name)).toEqual(['Kanpur Cables Pvt Ltd', 'Mehta Electricals', 'Raju Electrician', 'Walk-in Ramesh']);
    const mehta = got.parties.find((p) => p.name === 'Mehta Electricals')!;
    expect(mehta.kind).toBe('customer');
    expect(mehta.group?.name).toBe('Wholesale customers');
    expect(mehta.openingBalance.toFixed(2)).toBe('25000.00');
    expect(mehta.openingDate?.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(mehta.addresses[0]).toMatchObject({ kind: 'billing', line: '12, Aminabad Market' });
    expect(got.parties.find((p) => p.name === 'Kanpur Cables Pvt Ltd')).toMatchObject({ kind: 'supplier', openingType: 'pay' });
    const wire = got.items.find((i) => i.code === 'CW15')!;
    expect(wire.unit?.code).toBe('COIL');
    expect(wire.category?.name).toBe('Wires & cables');
    expect(wire.salePrice.toFixed(2)).toBe('1890.00');
    expect(wire.movements).toHaveLength(1);
    expect(wire.movements[0]!.qty.toFixed(3)).toBe('25.000');
    expect(wire.movements[0]!.kind).toBe('opening');
    expect(got.items.find((i) => i.name === 'Fan installation')!.kind).toBe('service');
    expect(got.wholesale.rules.map((r) => r.partyGroup.name)).toEqual(['Wholesale customers']);
    expect(got.runs).toHaveLength(1);
    expect(got.runs[0]).toMatchObject({ status: 'done', fileName: 'fresh.json' });
    expect(got.audit).toHaveLength(1);

    // a second import would enter everything twice: refused
    const again = await http().post('/api/imports').set(auth(o)).send({ backup: backup('fresh-shop.backup.json') }).expect(409);
    await http().post('/api/imports?dryRun=true').set(auth(o)).send({ backup: backup('fresh-shop.backup.json') }).expect(409);
    expect(again.body.message).toMatch(/already has parties or items/);
    const list = await http().get('/api/imports').set(auth(o)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('brand / series price rules come along, pointing at the new price lists', async () => {
    const o = await owner(app);
    const bk = JSON.parse(backup('fresh-shop.backup.json'));
    bk.keys['erp-prules'] = JSON.stringify({ 'Havells|*': { sale: { m: 'lp', v: '10', rd: '1' }, 'pl:pl2': { m: 'margin', v: '15', rd: '5' }, 'pl:gone': { m: 'lp', v: '1', rd: '1' }, floor: { on: true, v: 5 } } });
    await http().post('/api/imports').set(auth(o)).send({ backup: JSON.stringify(bk) }).expect(200);
    const got = await asShop(o.businessId, async (tx) => ({ s: await tx.businessSettings.findFirstOrThrow(), wholesale: await tx.priceList.findFirstOrThrow({ where: { name: 'Wholesale' } }) }));
    expect((got.s.data as { priceRules: unknown }).priceRules).toEqual({ 'Havells|*': { sale: { m: 'lp', v: '10', rd: '1' }, [`pl:${got.wholesale.id}`]: { m: 'margin', v: '15', rd: '5' }, floor: { on: true, v: 5 } } });
  });

  it('a shop that kept the sample catalogue gets those items, without stock', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ backup: backup('fresh-kept-items.backup.json') }).expect(200);
    expect(res.body.counts.items).toBeGreaterThan(200);
    expect(await asShop(o.businessId, (tx) => tx.item.count())).toBe(res.body.counts.items);
    expect(await asShop(o.businessId, (tx) => tx.stockMovement.count())).toBe(0);
  });

  it('download backup: the shop’s books as JSON, owner only, no secrets', async () => {
    const o = await owner(app);
    await http().post('/api/imports').set(auth(o)).send({ backup: backup('fresh-shop.backup.json') }).expect(200);
    await http().post('/api/prices/pin').set(auth(o)).send({ pin: '2468' }).expect(204);
    const res = await http().get('/api/backup').set(auth(o)).expect(200);
    expect(res.body).toMatchObject({ app: 'billing-erp-cloud', v: 2, biz: 'Gupta Electricals & Hardware', counts: { parties: 4, items: 4 } });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|pinHash|passwordHash/);
    const acc = await member(app, o, 'accountant');
    await http().get('/api/backup').set(auth(acc)).expect(403);
  });

  it('explains a wrong file in plain words', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ backup: '{"hello":1}' }).expect(422);
    expect(res.body.message).toMatch(/isn’t a backup from the Billing ERP app/);
  });

  it('only the owner can import', async () => {
    const o = await owner(app);
    const mgr = await member(app, o, 'manager');
    await http().post('/api/imports').set(auth(mgr)).send({ backup: backup('fresh-shop.backup.json') }).expect(403);
  });

  it('the imported books stay private to that shop', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await http().post('/api/imports').set(auth(a)).send({ backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(await asShop(b.businessId, (tx) => tx.party.count())).toBe(0);
    expect(await asShop(b.businessId, (tx) => tx.item.count())).toBe(0);
  });
});

describe('importing sales documents', () => {
  it('brings invoices, payments, a return, challans and a quotation, with the same dues and stock the old app showed', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'sales.json', backup: backup('sales-shop.backup.json') }).expect(200);
    expect(res.body.counts).toMatchObject({ invoices: 6, receipts: 1, creditNotes: 1, challans: 2, quotations: 2 });
    const parties = (await http().get('/api/parties').set(auth(o)).expect(200)).body as { name: string; balance: string }[];
    // the prototype's own balanceOf() for the same backup
    expect(Object.fromEntries(parties.map((p) => [p.name, p.balance]))).toEqual({ 'Mehta Electricals': '22174.00', 'Raju Electrician': '2599.00', 'Kanpur Cables Pvt Ltd': '-48000.00', 'Walk-in Ramesh': '0.00' });
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as { name: string; stock: string | null }[];
    expect(Object.fromEntries(items.filter((i) => i.stock !== null).map((i) => [i.name, Number(i.stock)]))).toMatchObject({ 'MCB 32A double pole': -1, 'LED bulb 9W': 179, 'Copper wire 1.5 sq mm (90 m)': 23 });
    const sales = (await http().get('/api/sales').set(auth(o)).expect(200)).body as { number: string; total: string; balance: string; cancelled: boolean }[];
    expect(sales.map((s) => [s.number, s.total, s.balance, s.cancelled])).toEqual([
      ['INV-0106', '570.00', '570.00', false], ['INV-0105', '190.00', '0.00', false], ['INV-0104', '348.00', '0.00', true],
      ['INV-0103', '839.00', '529.00', false], ['INV-0102', '420.00', '0.00', false], ['INV-0101', '4348.00', '2174.00', false],
    ]);
    const rc = (await http().get('/api/receipts').set(auth(o)).expect(200)).body as { number: string; amount: string; unused: string; mode: string }[];
    expect(rc.map((r) => [r.number, r.amount, r.unused, r.mode])).toEqual([
      ['XP-INV-0105', '310.00', '0.00', 'Cash'], ['PI-0625', '5000.00', '0.00', 'Cheque'], ['PI-0624', '190.00', '0.00', 'Cash'], ['PI-0621', '420.00', '0.00', 'Cash'], ['PI-0620', '2000.00', '0.00', 'UPI'],
    ]);
    // numbers carry on after the imported ones
    const next = async (kind: string) => (await http().get(`/api/sales/next-number?kind=${kind}&date=2026-10-01`).set(auth(o)).expect(200)).body.number;
    expect([await next('invoice'), await next('receipt'), await next('credit_note'), await next('challan'), await next('quotation')]).toEqual(['INV-0107', 'PI-0626', 'CN-0002', 'DC-0003', 'Q-0103']);
    // the brand-wise quotation and the Quotation page's grid come across too
    const qs = (await http().get('/api/sales?kind=quotation').set(auth(o)).expect(200)).body as { number: string; qtype: string; items: number; qty: string; brandQuote: { qty: Record<string, number> } | null }[];
    expect(qs.map((q) => [q.number, q.qtype, q.items, q.qty])).toEqual([['Q-0102', 'items', 2, '5.000'], ['Q-0101', 'brand', 11, '132.000']]);
    expect(qs[1]!.brandQuote!.qty).toMatchObject({ r5: 30, p4: 15 });
    const grid = (await http().get('/api/quote-grid').set(auth(o)).expect(200)).body;
    expect([grid.rows.length, grid.ser.length]).toEqual([22, 6]);
    expect((await http().get('/api/settings').set(auth(o)).expect(200)).body.data.quoteGrid.ser[2]).toMatchObject({ b: 'Legrand', r: 'Myrius' }); // stored, not the default
    const dcs = (await http().get('/api/sales?kind=challan').set(auth(o)).expect(200)).body;
    expect(dcs.map((d: { number: string; status: string; invoiceNo: string }) => [d.number, d.status, d.invoiceNo])).toEqual([['DC-0002', 'open', ''], ['DC-0001', 'invoiced', 'INV-0106']]);
  });
});

describe('importing purchases', () => {
  it('brings bills, orders, a debit note and payments made, with what you owe and stock as the old app showed', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'purchases.json', backup: backup('purchase-shop.backup.json') }).expect(200);
    expect(res.body.counts).toMatchObject({ purchaseBills: 2, purchaseOrders: 2, debitNotes: 1, paymentsMade: 2 });
    const parties = (await http().get('/api/parties').set(auth(o)).expect(200)).body as { name: string; balance: string }[];
    // opening 48,000 to pay + bills 27,444 − returned 325 − paid 15,000
    expect(parties.find((p) => p.name === 'Kanpur Cables Pvt Ltd')!.balance).toBe('-60119.00');
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as { name: string; stock: string | null }[];
    expect(Object.fromEntries(items.filter((i) => i.stock !== null).map((i) => [i.name, Number(i.stock)]))).toMatchObject({ 'LED bulb 9W': 324, 'Copper wire 1.5 sq mm (90 m)': 33 });
    const bills = (await http().get('/api/purchases?kind=bill').set(auth(o)).expect(200)).body as { number: string; total: string; balance: string; fromOrder: string }[];
    expect(bills.map((b) => [b.number, b.total, b.balance, b.fromOrder])).toEqual([['PB-0002', '3248.00', '3248.00', 'ORD-0001'], ['PB-0001', '24196.00', '8871.00', '']]);
    const orders = (await http().get('/api/purchases?kind=order').set(auth(o)).expect(200)).body as { number: string; status: string; bill: string }[];
    expect(orders.map((x) => [x.number, x.status, x.bill])).toEqual([['ORD-0002', 'open', ''], ['ORD-0001', 'received', 'PB-0002']]);
    const pays = (await http().get('/api/payments-made').set(auth(o)).expect(200)).body as { number: string; amount: string; mode: string; unused: string }[];
    expect(pays.map((p) => [p.number, p.amount, p.mode, p.unused])).toEqual([['PO-0002', '10000.00', 'Cheque', '0.00'], ['PO-0001', '5000.00', 'Bank transfer', '0.00']]);
    // numbers carry on after the imported ones
    const next = async (kind: string) => (await http().get(`/api/purchases/next-number?kind=${kind}&date=2026-10-01`).set(auth(o)).expect(200)).body.number;
    expect([await next('bill'), await next('order'), await next('debit_note'), await next('payment')]).toEqual(['PB-0003', 'ORD-0003', 'DN-0002', 'PO-0003']);
    expect(res.body.warnings.join(' ')).not.toMatch(/total is/);
  });
});


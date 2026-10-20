import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OLD_APP } from '@billing/shared';
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
    expect(res.body.message).toContain(`isn’t a backup from the ${OLD_APP.name} app`);
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
    // the old app's grid is kept; its ranges show once their brands are on Brands & Series (owner's decision)
    let grid = (await http().get('/api/quote-grid').set(auth(o)).expect(200)).body;
    expect([grid.rows.length, grid.ser.length]).toEqual([22, 0]);
    for (const name of ['Havells', 'Legrand', 'Anchor', 'GM', 'Goldmedal']) await http().post('/api/brands').set(auth(o)).send({ name }).expect(201);
    grid = (await http().get('/api/quote-grid').set(auth(o)).expect(200)).body;
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

describe('banking import', () => {
  it('brings cash and bank accounts and the money moved by hand; balances match the old app', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'bank.json', backup: backup('bank-shop.backup.json') }).expect(200);
    expect(res.body.counts).toMatchObject({ bankAccounts: 2, bankEntries: 5, expenses: 4 });
    const accs = (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { name: string; balance: string; isDefault: boolean; accountNo: string; ifsc: string; branch: string }[];
    // the prototype's own balances for the same backup (expenses and a deposited cheque included): cash 1,080, HDFC 83,696, SBI 65,412
    expect(accs.map((a) => [a.name, a.balance, a.isDefault])).toEqual([['Cash in hand', '1080.00', true], ['HDFC Bank', '83696.00', true], ['State Bank of India', '65412.00', false]]);
    const chq = (await http().get('/api/banking/cheques').set(auth(o)).expect(200)).body as { number: string; status: string; statusDate: string | null }[];
    expect(chq.map((c) => [c.number, c.status, c.statusDate])).toEqual([['PO-0002', 'pending', null], ['PI-0625', 'cleared', '2026-10-01']]);
    const xs = (await http().get('/api/expenses').set(auth(o)).expect(200)).body as { number: string; category: string; total: string; gst: string }[];
    expect(xs.map((x) => [x.number, x.category, x.total, x.gst])).toEqual([
      ['EXP-0005', 'Generator diesel', '1850.00', '0.00'], ['BT-0005', 'Shop expenses', '650.00', '0.00'], ['BT-0003', 'Bank charges', '354.00', '0.00'], ['EXP-0003', 'Repairs', '2950.00', '450.00'], ['EXP-0004', 'Packing material', '2340.00', '0.00'], ['EXP-0002', 'Rent', '25000.00', '0.00'],
    ]);
    expect((await http().get('/api/expenses/next-number').set(auth(o)).expect(200)).body.number).toBe('EXP-0006');
    expect(accs[1]).toMatchObject({ accountNo: '50200012347703', ifsc: 'HDFC0001234', branch: 'Hazratganj, Lucknow' });
    const next = (await http().post('/api/banking/entries').set(auth(o)).send({ date: '2026-10-02', kind: 'in', accountId: (accs as unknown as { id: string }[])[0]!.id, amount: '1', category: 'Other' }).expect(201)).body;
    expect(next.number).toBe('BT-0006');
  });
});

describe('commission import', () => {
  it('referred bills, a return and both kinds of payout: earnings and balances match the old app', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'commission.json', backup: backup('commission-shop.backup.json') }).expect(200);
    expect(res.body.counts).toMatchObject({ commissionPayouts: 2 });
    const C = (await http().get('/api/commission').set(auth(o)).expect(200)).body as { name: string; bills: number; business: string; comm: string; ret: string; earned: string; paid: string; due: string; invoices: { number: string; comm: string; ret: string; f: number; earned: string }[]; payouts: { number: string; mode: string; note: string }[] }[];
    const s = C.find((x) => x.name === 'Sunil Electrician')!;
    // the prototype's cmStats for the same backup
    expect(s).toMatchObject({ bills: 2, business: '3047.00', comm: '202.04', ret: '32.71', earned: '153.96', paid: '150.00', due: '3.96' });
    expect(s.invoices.map((b) => [b.number, b.comm, b.ret, b.earned])).toEqual([['INV-0108', '71.19', '0.00', '23.11'], ['INV-0107', '163.56', '32.71', '130.85']]);
    expect(s.payouts.map((p) => [p.number, p.mode, p.note])).toEqual([['CP-0001', 'Cash', ''], ['CP-0002', 'Adjusted in his account', 'PI-0628 · INV-0109']]);
    const accs = (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { name: string; balance: string }[];
    expect(accs.map((a) => [a.name, a.balance])).toEqual([['Cash in hand', '1280.00'], ['HDFC Bank', '85819.00'], ['State Bank of India', '65412.00']]);
    const sunil = ((await http().get('/api/parties').set(auth(o)).expect(200)).body as { name: string; balance: string }[]).find((p) => p.name === 'Sunil Electrician')!;
    expect(sunil.balance).toBe('900.00');
  });
});

describe('importing: stock value and the automatic purchase price', () => {
  type Row = { name: string; purchase: string; value: string | null; id: string };
  const lotsOf = async (o: { token: string }, id: string) =>
    ((await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as { rateTable: { layers: { rate: string; qty: string }[] } }).rateTable.layers.map((l) => [l.rate, l.qty]);

  it('the old opening rate is the opening lot; the purchase price is the newest bill, else the opening rate, else the old price', async () => {
    const o = await owner(app);
    await http().post('/api/imports').set(auth(o)).send({ fileName: 'fresh.json', backup: backup('fresh-shop.backup.json') }).expect(200);
    const items = (await http().get('/api/items').set(auth(o)).expect(200)).body as Row[];
    const by = (n: string) => items.find((i) => i.name === n)!;
    // old app: purchase 1560, opening 25 at 1540 → the opening rate
    expect([by('Copper wire 1.5 sq mm (90 m)').purchase, by('Copper wire 1.5 sq mm (90 m)').value]).toEqual(['1540.00', '38500.00']);
    expect(await lotsOf(o, by('Copper wire 1.5 sq mm (90 m)').id)).toEqual([['1540.00', '25.000']]);
    expect([by('LED bulb 9W').purchase, by('LED bulb 9W').value]).toEqual(['62.00', '12400.00']);
    // no opening stock and no bill: the old app's price stays
    expect([by('MCB 32A double pole').purchase, by('MCB 32A double pole').value]).toEqual(['310.00', '0.00']);

    const p = await owner(app);
    await http().post('/api/imports').set(auth(p)).send({ fileName: 'purchases.json', backup: backup('purchase-shop.backup.json') }).expect(200);
    const pitems = (await http().get('/api/items').set(auth(p)).expect(200)).body as Row[];
    const wire = pitems.find((i) => i.name === 'Copper wire 1.5 sq mm (90 m)')!;
    // opening 25 at 1540 (1 Apr), bill PB-0001 10 at 1500 (20 Sep), 2 sold: the bill's rate is the newest
    expect(wire.purchase).toBe('1500.00');
    expect(await lotsOf(p, wire.id)).toEqual([['1540.00', '23.000'], ['1500.00', '10.000']]);
    expect(wire.value).toBe('50420.00');
  });
});

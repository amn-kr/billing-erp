import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, owner, startApp } from './helpers';

/** Settings › Transactions: several prefixes per document type, one active; used prefixes are locked. */
let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const D = '2026-10-14';

beforeAll(async () => {
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
interface Px { id: string; prefix: string; active: boolean; used: number; next: string }
interface List { business: string; types: { docType: string; label: string; prefixes: Px[] }[] }
const list = async (o: S): Promise<List> => (await http().get('/api/settings/prefixes').set(auth(o)).expect(200)).body;
const of = (l: List, t: string) => l.types.find((x) => x.docType === t)!.prefixes;
const px = (l: List, t: string, p: string) => of(l, t).find((x) => x.prefix === p)!;
const add = (o: S, body: object) => http().post('/api/settings/prefixes').set(auth(o)).send(body);
const patch = (o: S, id: string, body: object) => http().patch(`/api/settings/prefixes/${id}`).set(auth(o)).send(body);
const del = (o: S, id: string) => http().delete(`/api/settings/prefixes/${id}`).set(auth(o));

async function shop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25' }).expect(201)).body;
  const party = (await http().post('/api/parties').set(auth(o)).send({ name: 'Test Customer', billingName: 'Test Customer Pvt Ltd' }).expect(201)).body;
  const sale = (body: object = {}) => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: party.id, lines: [{ itemId: fan.id, name: fan.name, qty: '1', price: '100', discPct: '0', gstRate: '18' }], ...body });
  return { o, fan, party, sale };
}

describe('prefix list', () => {
  it('a new business has one active default prefix for each of the ten document types', async () => {
    const { o } = await shop();
    const l = await list(o);
    expect(l.business).toBe('Gupta Electricals & Hardware');
    expect(l.types.map((t) => `${t.label}: ${t.prefixes.map((p) => `${p.next}${p.active ? ' active' : ''}`).join()}`)).toEqual([
      'Sale: INV-0001 active', 'Estimate: Q-0101 active', 'Delivery challan: DC-0001 active', 'Credit note: CN-0001 active', 'Payment in: PI-0001 active',
      'Purchase order: ORD-0001 active', 'Purchase bill: PB-0001 active', 'Debit note: DN-0001 active', 'Payment out: PO-0001 active', 'Expense: EXP-0001 active',
    ]);
  });

  it('adds, switches, edits and deletes prefixes, and writes the audit log', async () => {
    const { o, sale } = await shop();
    await sale().expect(201); // INV-0001: INV- is now used
    let l = (await add(o, { docType: 'invoice', prefix: 'JE/INV/' }).expect(201)).body as List;
    expect(px(l, 'invoice', 'JE/INV/')).toMatchObject({ active: true, used: 0, next: 'JE/INV/0001' });
    expect(px(l, 'invoice', 'INV-')).toMatchObject({ active: false, used: 1, next: 'INV-0002' });
    l = (await add(o, { docType: 'invoice', prefix: 'JE/25/', active: false }).expect(201)).body;
    expect(px(l, 'invoice', 'JE/25/').active).toBe(false);
    l = (await patch(o, px(l, 'invoice', 'JE/25/').id, { prefix: 'JE/26/' }).expect(200)).body;
    expect(px(l, 'invoice', 'JE/26/')).toBeTruthy();
    l = (await del(o, px(l, 'invoice', 'JE/26/').id).expect(200)).body;
    expect(of(l, 'invoice').map((p) => p.prefix)).toEqual(['INV-', 'JE/INV/']);
    const audit = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      return tx.auditLog.findMany({ where: { entity: 'document_series' }, orderBy: { createdAt: 'asc' } });
    });
    // one save writes several entries at the same moment, so they are compared without their order
    expect(audit.map((a) => `${a.action} ${(a.after as { change?: string } | null)?.change ?? ''}`.trim()).sort()).toEqual([
      'create', 'create', 'delete', 'update edited', 'update made active', 'update stopped using',
    ]);
  });

  it('a used prefix can’t be edited or deleted; the active one can’t be deleted', async () => {
    const { o, sale } = await shop();
    await sale().expect(201);
    const inv = px(await list(o), 'invoice', 'INV-');
    expect(inv.used).toBe(1);
    expect((await del(o, inv.id).expect(400)).body.message).toBe('INV- is used in 1 document, so it can’t be deleted. You can stop using it by making another prefix active.');
    expect((await patch(o, inv.id, { prefix: 'INV/' }).expect(400)).body.message).toBe('INV- is used in 1 document, so it can’t be changed. Add a new prefix instead.');
    const dc = px(await list(o), 'challan', 'DC-');
    expect((await del(o, dc.id).expect(400)).body.message).toBe('DC- is the active prefix. Make another prefix active before deleting it.');
  });

  it('refuses prefixes that could repeat a number, “None” twice and bad characters', async () => {
    const { o } = await shop();
    expect((await add(o, { docType: 'invoice', prefix: 'INV-1' }).expect(409)).body.message).toBe('INV-1 could make the same numbers as INV-. Choose a different prefix.');
    expect((await add(o, { docType: 'invoice', prefix: 'inv-' }).expect(409)).body.message).toBe('Sale already has the prefix INV-.');
    await add(o, { docType: 'expense', prefix: '', active: true }).expect(201);
    expect(px(await list(o), 'expense', '').next).toBe('0001');
    expect((await add(o, { docType: 'expense', prefix: '' }).expect(409)).body.message).toBe('Expense already has the prefix None.');
    expect((await add(o, { docType: 'invoice', prefix: 'JE INV' }).expect(400)).body.message).toBe('Use letters, digits, / - or _ (up to 10).');
    await add(o, { docType: 'invoice', prefix: 'ABCDEFGHIJK' }).expect(400);
    await add(o, { docType: 'stock_transfer', prefix: 'X-' }).expect(400);
  });
});

describe('numbering with prefixes', () => {
  it('new sales use the active prefix; an old prefix made active again continues from its last number', async () => {
    const { o, sale } = await shop();
    expect((await sale().expect(201)).body.number).toBe('INV-0001');
    const l = (await add(o, { docType: 'invoice', prefix: 'JE/INV/' }).expect(201)).body as List;
    expect((await sale().expect(201)).body.number).toBe('JE/INV/0001');
    expect((await http().get('/api/sales/next-number?kind=invoice').set(auth(o)).expect(200)).body.number).toBe('JE/INV/0002');
    await patch(o, px(l, 'invoice', 'INV-').id, { active: true }).expect(200);
    expect((await sale().expect(201)).body.number).toBe('INV-0002');
    await patch(o, px(l, 'invoice', 'JE/INV/').id, { active: true }).expect(200);
    expect((await sale().expect(201)).body.number).toBe('JE/INV/0002');
  });

  it('a number typed by hand moves its own prefix past it, and is skipped later', async () => {
    const { o, sale } = await shop();
    const l = (await add(o, { docType: 'invoice', prefix: 'JE/' }).expect(201)).body as List;
    await sale({ number: 'INV-0005' }).expect(201); // typed while JE/ is active
    await patch(o, px(l, 'invoice', 'INV-').id, { active: true }).expect(200);
    expect((await sale().expect(201)).body.number).toBe('INV-0006');
    expect((await sale({ number: 'INV-0006' }).expect(400)).body.message).toBe('Invoice number INV-0006 is already used.');
  });

  it('a new prefix with documents already numbered with it starts after the highest one', async () => {
    const { o, sale } = await shop();
    await sale({ number: 'JE/0041' }).expect(201);
    const l = (await add(o, { docType: 'invoice', prefix: 'JE/' }).expect(201)).body as List;
    expect(px(l, 'invoice', 'JE/')).toMatchObject({ used: 1, next: 'JE/0042' });
  });

  it('numbers keep going in the next financial year (no restart in April)', async () => {
    const { o, sale } = await shop();
    expect((await sale({ date: '2027-03-31', dueDate: '2027-03-31' }).expect(201)).body.number).toBe('INV-0001');
    expect((await sale({ date: '2027-04-01', dueDate: '2027-04-01' }).expect(201)).body.number).toBe('INV-0002');
  });
});

describe('billing name of parties', () => {
  it('with the switch on, a new bill keeps its own copy of the party’s billing name', async () => {
    const { o, party, sale } = await shop();
    const before = (await sale().expect(201)).body;
    expect((await http().get(`/api/sales/${before.id}`).set(auth(o)).expect(200)).body.billName).toBe('');
    await http().patch('/api/settings').set(auth(o)).send({ data: { txnBillName: true } }).expect(200);
    const s = (await sale().expect(201)).body;
    expect((await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body.billName).toBe('Test Customer Pvt Ltd');
    await http().patch(`/api/parties/${party.id}`).set(auth(o)).send({ billingName: 'Changed Later Ltd' }).expect(200);
    const v = (await http().get(`/api/sales/${s.id}`).set(auth(o)).expect(200)).body;
    expect(v.billName).toBe('Test Customer Pvt Ltd');
    expect(v.savedAt).toBeTruthy();
    expect((await http().get(`/api/parties/${party.id}`).set(auth(o)).expect(200)).body.billingName).toBe('Changed Later Ltd');
  });
});

describe('two businesses', () => {
  it('changing business A’s prefixes never touches business B', async () => {
    const a = await shop();
    const b = await shop();
    const la = (await add(a.o, { docType: 'invoice', prefix: 'AAA/' }).expect(201)).body as List;
    const lb = await list(b.o);
    expect(of(lb, 'invoice').map((p) => `${p.prefix}${p.active ? ' active' : ''}`)).toEqual(['INV- active']);
    await patch(b.o, px(la, 'invoice', 'INV-').id, { active: true }).expect(404);
    await del(b.o, px(la, 'invoice', 'INV-').id).expect(404);
    expect(px(await list(a.o), 'invoice', 'AAA/').active).toBe(true);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, expectNoPasscode, owner, startApp } from './helpers';

/**
 * Edit for saved sales-side documents (group 1): payments received, credit notes, delivery challans
 * and quotations. An edit undoes the old effects and applies the new ones with the same code as a
 * new document, in one go, under the same number. The strongest check: after an edit every total
 * and report is exactly what it would be had the document been saved that way in the first place.
 * Made-up passcodes only.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const D = '2026-10-04';
const D2 = '2026-10-09';
const PASS = '4826';
const H = 'x-txn-passcode';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
async function shop() {
  const o = await owner(app);
  const fan = (await http().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingRate: '1540' }).expect(201)).body;
  const bulb = (await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', gstRate: 18, openingQty: '200' }).expect(201)).body;
  const verma = (await http().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders', openingBalance: '1000', openingDate: D }).expect(201)).body;
  const singh = (await http().post('/api/parties').set(auth(o)).send({ name: 'Singh Electricals' }).expect(201)).body;
  return { o, fan, bulb, verma, singh };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const line = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
const sale = (o: S, body: object) => http().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, ...body });
const put = (o: S, path: string, body: object, pass?: string) => { const r = http().put(`/api/${path}`).set(auth(o)); return (pass ? r.set(H, pass) : r).send(body); };
const receipt = (partyId: string, amount: string, allocations: { to: string; amount: string }[] = [], more: object = {}) => ({ partyId, date: D, amount, mode: 'Cash', ref: '', allocations, ...more });
const cnBody = (partyId: string | null, lines: object[], more: object = {}) => ({ partyId, date: D, reason: 'Damaged goods', settle: 'adjust', refundMode: 'Cash', lines, ...more });
const cnLine = (invoiceId: string | null, it: { id: string }, qty: string, price = '1890') => ({ invoiceId, itemId: it.id, qty, price, gstRate: '18' });
const dcBody = (partyId: string | null, lines: object[], more: object = {}) => ({ partyId, cashName: '', cashPhone: '', date: D, lines, transport: '', vehicle: '', note: '', ...more });
const balanceOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body.balance;
const partyOf = async (o: S, id: string) => (await http().get(`/api/parties/${id}`).set(auth(o)).expect(200)).body;
const stockOf = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body.stock;
const invBal = async (o: S, id: string) => (await http().get(`/api/sales/${id}`).set(auth(o)).expect(200)).body.balance;
const accounts = async (o: S) => (await http().get('/api/banking/accounts').set(auth(o)).expect(200)).body as { kind: string; name: string; balance: string; openingBalance: string }[];
const cashBal = async (o: S) => (await accounts(o)).filter((a) => a.kind === 'cash').map((a) => a.balance);
const audit = async (o: S) => (await http().get('/api/audit').set(auth(o)).expect(200)).body as { action: string; entity: string; entityId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
const turnOn = (o: S) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);
const same = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'time');

/** Everything a total or report shows for one shop. */
async function figures(s: Shop) {
  const { o } = s;
  const get = async (p: string) => (await http().get(`/api/${p}`).set(auth(o)).expect(200)).body;
  const st = async (id: string) => { const x = await get(`reports/statement/${id}?from=2026-04-01&to=2027-03-31`); return { open: x.open, dr: x.dr, cr: x.cr, close: x.close, overdue: x.overdue }; };
  return same({
    verma: await balanceOf(o, s.verma.id), singh: await balanceOf(o, s.singh.id), fan: await stockOf(o, s.fan.id), bulb: await stockOf(o, s.bulb.id),
    dues: await get(`parties/${s.verma.id}/dues`), duesSingh: await get(`parties/${s.singh.id}/dues`),
    statement: await st(s.verma.id), statementSingh: await st(s.singh.id),
    parties: await get('reports/parties'), activity: await get('reports/party-activity?from=2026-04-01&to=2027-03-31'),
    items: await get(`reports/party-items/${s.verma.id}?from=2026-04-01&to=2027-03-31`),
    home: await get(`reports/home?today=${D2}`), accounts: await get('banking/accounts'),
    invoices: await get('sales?kind=invoice'), creditNotes: await get('credit-notes'),
    receipts: ((await get('receipts')) as Record<string, unknown>[]).map(({ number: _n, ...r }) => r),
  });
}

describe('the “no passcode in the audit log” check', () => {
  it('catches a hash or the passcode in a field, and ignores ids and postal PIN codes that only contain the digits', () => {
    expect(() => expectNoPasscode([{ after: { passcodeHash: '$argon2id$x' } }], PASS)).toThrow();
    expect(() => expectNoPasscode([{ after: { secret: 'x' } }], PASS)).toThrow();
    expect(() => expectNoPasscode([{ after: { pin: PASS } }], PASS)).toThrow();
    expect(() => expectNoPasscode([{ before: { passcode: Number(PASS) } }], PASS)).toThrow();
    expectNoPasscode([{ id: 'c4fda900-9cb2-4826-962a-0d8f2b1c4826', at: '2026-10-18T14:48:26.000Z', after: { pin: '226018', businessId: 'a4826b00-0000-4000-8000-000000004826' } }], PASS);
  });
});

/* ───────── payments received ───────── */

describe('edit a payment received', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; same number; balances follow', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const cash0 = await cashBal(o);
    const pay = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '1000', [{ to: inv.id, amount: '1000' }])).expect(201)).body;
    const body = receipt(verma.id, '1500', [{ to: inv.id, amount: '1500' }]);
    expect((await put(o, `receipts/${pay.id}`, body).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await put(o, `receipts/${pay.id}`, body, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect(await invBal(o, inv.id)).toBe('890.00');
    expect((await put(o, `receipts/${pay.id}`, body, PASS).expect(200)).body).toEqual({ id: pay.id, number: 'PI-0001', amount: '1500.00', partyName: 'Verma Traders' });
    expect(await invBal(o, inv.id)).toBe('390.00');
    expect(await balanceOf(o, verma.id)).toBe('1390.00'); // opening 1000 + 1890 − 1500
    expect(Number((await cashBal(o))[0]) - Number(cash0[0])).toBe(1500);
    expect((await http().get('/api/receipts').set(auth(o)).expect(200)).body.map((r: { number: string }) => r.number)).toEqual(['PI-0001']);
    expect((await http().get(`/api/sales/next-number?kind=receipt&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('PI-0002');
    const a = await audit(o);
    const up = a.find((e) => e.action === 'update' && e.entity === 'payment');
    expect(up).toMatchObject({ entityId: pay.id, before: { amount: '1000', allocations: [{ to: inv.id, amount: '1000.00' }] }, after: { amount: '1500', allocations: [{ to: inv.id, amount: '1500.00' }] } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: pay.id, after: { for: 'edit', document: 'receipt' } });
    expectNoPasscode(a, PASS);
  });

  it('with the passcode off it needs no passcode', async () => {
    const { o, verma } = await shop();
    const pay = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '300')).expect(201)).body;
    await put(o, `receipts/${pay.id}`, receipt(verma.id, '200')).expect(200);
    expect(await balanceOf(o, verma.id)).toBe('800.00');
  });

  it('every total and report is the same as if it had been saved that way (other party, other invoice, opening balance, date, mode)', async () => {
    const build = async (edit: boolean) => {
      const s = await shop();
      const { o, fan, bulb, verma, singh } = s;
      await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201);
      const i1 = (await sale(o, { partyId: singh.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
      const i2 = (await sale(o, { partyId: verma.id, lines: [line(bulb, '10', '95')] }).expect(201)).body;
      const want = receipt(verma.id, '1700', [{ to: 'opening', amount: '1000' }, { to: i2.id, amount: '500' }], { date: D2, mode: 'UPI', ref: 'UTR 8812' });
      if (edit) {
        const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(singh.id, '1890', [{ to: i1.id, amount: '1890' }])).expect(201)).body;
        await put(o, `receipts/${p.id}`, want).expect(200);
      } else await http().post('/api/receipts').set(auth(o)).send(want).expect(201);
      return figures(s);
    };
    const edited = await build(true);
    expect(edited).toBe(await build(false));
    expect(edited).toContain('"verma":"250.00"'); // opening 1000 + 950 − 1700; Singh owes the whole invoice again
    expect(edited).toContain('"singh":"1890.00"');
  });

  it('a cheque still waiting is replaced; a cleared cheque must be undone first', async () => {
    const { o, verma } = await shop();
    const bank = (await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201)).body;
    const chq = async () => ((await http().get('/api/banking/cheques?status=all').set(auth(o)).expect(200)).body as { id: string; ref: string; amount: string; status: string }[]).map((c) => [c.ref, c.amount, c.status]);
    const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '400', [], { mode: 'Cheque', ref: '004512' })).expect(201)).body;
    await put(o, `receipts/${p.id}`, receipt(verma.id, '450', [], { mode: 'Cheque', ref: '004519' })).expect(200);
    expect((await chq()).filter((c) => c[2] === 'pending')).toEqual([['004519', '450.00', 'pending']]);
    const c = ((await http().get('/api/banking/cheques').set(auth(o)).expect(200)).body as { id: string; ref: string }[]).find((x) => x.ref === '004519')!;
    await http().post(`/api/banking/cheques/${c.id}/clear`).set(auth(o)).send({ accountId: bank.id, date: D }).expect(201);
    expect((await put(o, `receipts/${p.id}`, receipt(verma.id, '500', [], { mode: 'Cheque', ref: '004519' })).expect(400)).body.message).toBe('Cheque 004519 on this payment is already cleared. Undo it on the Cheques page first.');
    expect((await http().get(`/api/receipts/${p.id}`).set(auth(o)).expect(200)).body.locked).toBe('Cheque 004519 on this payment is already cleared. Undo it on the Cheques page first.');
    expect(await balanceOf(o, verma.id)).toBe('550.00');
  });

  it('money taken on an invoice is edited on the invoice; a deleted payment can’t be edited', async () => {
    const { o, fan, verma } = await shop();
    await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')], payments: [{ mode: 'Cash', amount: '1890' }] }).expect(201);
    const [pi] = (await http().get('/api/receipts').set(auth(o)).expect(200)).body;
    expect((await put(o, `receipts/${pi.id}`, receipt(verma.id, '10')).expect(400)).body.message).toBe('This payment was taken with INV-0001. Edit the invoice instead.');
    expect((await http().get(`/api/receipts/${pi.id}`).set(auth(o)).expect(200)).body.locked).toBe('This payment was taken with INV-0001. Edit the invoice instead.');
    const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '100')).expect(201)).body;
    await http().post(`/api/receipts/${p.id}/delete`).set(auth(o)).send({}).expect(200);
    expect((await put(o, `receipts/${p.id}`, receipt(verma.id, '10')).expect(400)).body.message).toBe('PI-0002 is deleted. It can’t be changed.');
  });

  it('the edit window sees the dues as if this payment had not settled them', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '2000', [{ to: 'opening', amount: '1000' }, { to: inv.id, amount: '1000' }])).expect(201)).body;
    const dues = async (q: string) => ((await http().get(`/api/parties/${verma.id}/dues${q}`).set(auth(o)).expect(200)).body as { to: string; balance: string }[]).map((d) => [d.to, d.balance]);
    expect(await dues('')).toEqual([[inv.id, '890.00']]);
    expect(await dues(`?payment=${p.id}`)).toEqual([[inv.id, '1890.00'], ['opening', '1000.00']]);
    expect((await http().get(`/api/receipts/${p.id}`).set(auth(o)).expect(200)).body).toMatchObject({ number: 'PI-0001', amount: '2000.00', allocations: [{ to: 'opening', amount: '1000.00' }, { to: inv.id, amount: '1000.00' }], locked: '' });
  });

  it('another shop can’t read or edit it', async () => {
    const { o, verma } = await shop();
    const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '100')).expect(201)).body;
    const other = await owner(app);
    await http().get(`/api/receipts/${p.id}`).set(auth(other)).expect(404);
    const theirs = (await http().post('/api/parties').set(auth(other)).send({ name: 'Their customer' }).expect(201)).body;
    await put(other, `receipts/${p.id}`, receipt(theirs.id, '5')).expect(404);
    expect(await balanceOf(o, verma.id)).toBe('900.00');
  });
});

/* ───────── credit notes ───────── */

describe('edit a credit note', () => {
  it('with the passcode on: none or wrong is refused, the right one saves; stock and balance follow; same number', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '2')])).expect(201)).body;
    expect(await stockOf(o, fan.id)).toBe('24.000');
    expect(await balanceOf(o, verma.id)).toBe('2890.00');
    const body = cnBody(verma.id, [cnLine(inv.id, fan, '1')]);
    await put(o, `credit-notes/${cn.id}`, body).expect(403);
    await put(o, `credit-notes/${cn.id}`, body, '0000').expect(403);
    expect((await put(o, `credit-notes/${cn.id}`, body, PASS).expect(200)).body).toEqual({ id: cn.id, number: 'CN-0001', total: '1890.00', invoices: 1 });
    expect(await stockOf(o, fan.id)).toBe('23.000');
    expect(await balanceOf(o, verma.id)).toBe('4780.00');
    expect(await invBal(o, inv.id)).toBe('3780.00');
    expect((await http().get(`/api/sales/next-number?kind=credit_note&date=${D}`).set(auth(o)).expect(200)).body.number).toBe('CN-0002');
    const a = await audit(o);
    expect(a.find((e) => e.action === 'update' && e.entityId === cn.id)).toMatchObject({ before: { number: 'CN-0001', total: '3780' }, after: { number: 'CN-0001', total: '1890' } });
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: cn.id, after: { for: 'edit', document: 'credit_note' } });
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const { o, fan, verma } = await shop();
    await turnOn(o);
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '2')])).expect(201)).body;
    const body = cnBody(verma.id, [cnLine(inv.id, fan, '1')]);
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await put(o, `credit-notes/${cn.id}`, body, '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await put(o, `credit-notes/${cn.id}`, body, PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect(await stockOf(o, fan.id)).toBe('24.000');
  });

  it('every total and report is the same as if it had been saved that way (adjust → refund, other quantity, date)', async () => {
    const build = async (edit: boolean) => {
      const s = await shop();
      const { o, fan, bulb, verma } = s;
      const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890'), line(bulb, '10', '95')] }).expect(201)).body;
      const want = cnBody(verma.id, [cnLine(inv.id, fan, '1'), cnLine(inv.id, bulb, '4', '95')], { settle: 'refund', refundMode: 'Cash', date: D2, reason: 'Wrong item' });
      if (edit) {
        const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '2')])).expect(201)).body;
        await put(o, `credit-notes/${cn.id}`, want).expect(200);
      } else await http().post('/api/credit-notes').set(auth(o)).send(want).expect(201);
      return figures(s);
    };
    const edited = await build(true);
    expect(edited).toBe(await build(false));
    expect(edited).toContain('"fan":"23.000"');
  });

  it('what can be returned leaves out the credit note being edited; more than sold is refused', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '2')])).expect(201)).body;
    const max = async (q: string) => (await http().get(`/api/sales/${inv.id}/returnable${q}`).set(auth(o)).expect(200)).body[0].max;
    expect(await max('')).toBe('1.000');
    expect(await max(`?except=${cn.id}`)).toBe('3.000');
    expect((await put(o, `credit-notes/${cn.id}`, cnBody(verma.id, [cnLine(inv.id, fan, '4')])).expect(400)).body.message).toBe('Only 3 can be returned on INV-0001');
    await put(o, `credit-notes/${cn.id}`, cnBody(verma.id, [cnLine(inv.id, fan, '3')])).expect(200);
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect((await http().get(`/api/credit-notes/${cn.id}`).set(auth(o)).expect(200)).body).toMatchObject({ number: 'CN-0001', partyId: verma.id, settle: 'adjust', lines: [{ invoiceId: inv.id, itemId: fan.id, qty: '3.000', price: '1890.00' }] });
  });

  it('a cancelled credit note can’t be edited; another shop can’t edit it', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(201)).body;
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '1')])).expect(201)).body;
    const other = await owner(app);
    await http().get(`/api/credit-notes/${cn.id}`).set(auth(other)).expect(404);
    await put(other, `credit-notes/${cn.id}`, cnBody(null, [cnLine(null, fan, '1')], { settle: 'refund' })).expect(404);
    await http().post(`/api/sales/${cn.id}/cancel`).set(auth(o)).send({}).expect(200);
    expect((await put(o, `credit-notes/${cn.id}`, cnBody(verma.id, [cnLine(inv.id, fan, '2')])).expect(400)).body.message).toBe('CN-0001 is cancelled. It can’t be changed.');
    expect(await stockOf(o, fan.id)).toBe('22.000');
  });
});

/* ───────── delivery challans ───────── */

describe('edit a delivery challan', () => {
  it('needs the passcode; party, items, transport change; stock and dues don’t; same number', async () => {
    const { o, fan, bulb, verma, singh } = await shop();
    await turnOn(o);
    const dc = (await http().post('/api/challans').set(auth(o)).send(dcBody(verma.id, [{ itemId: fan.id, qty: '2' }])).expect(201)).body;
    const body = dcBody(singh.id, [{ itemId: bulb.id, qty: '12' }, { itemId: fan.id, qty: '1' }], { date: D2, transport: 'Self', vehicle: 'UP32 AB 1234', note: 'Bill to follow' });
    await put(o, `challans/${dc.id}`, body).expect(403);
    expect((await put(o, `challans/${dc.id}`, body, PASS).expect(200)).body).toEqual({ id: dc.id, number: 'DC-0001', partyName: 'Singh Electricals', items: 2 });
    const [row] = (await http().get('/api/sales?kind=challan').set(auth(o)).expect(200)).body;
    expect(row).toMatchObject({ number: 'DC-0001', date: D2, partyName: 'Singh Electricals', items: 2, qty: '13.000', transport: 'Self', vehicle: 'UP32 AB 1234', note: 'Bill to follow', status: 'open' });
    expect(await stockOf(o, fan.id)).toBe('25.000');
    expect(await balanceOf(o, singh.id)).toBe('0.00');
    expect((await audit(o)).find((e) => e.action === 'update' && e.entityId === dc.id)).toMatchObject({ before: { partyId: verma.id }, after: { partyId: singh.id } });
  });

  it('once turned into an invoice it is edited on the invoice; a cancelled one can’t be edited', async () => {
    const { o, fan, verma } = await shop();
    const dc = (await http().post('/api/challans').set(auth(o)).send(dcBody(verma.id, [{ itemId: fan.id, qty: '2' }])).expect(201)).body;
    await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')], fromChallanId: dc.id }).expect(201);
    expect((await put(o, `challans/${dc.id}`, dcBody(verma.id, [{ itemId: fan.id, qty: '3' }])).expect(400)).body.message).toBe('DC-0001 is already turned into invoice INV-0001. Edit the invoice instead.');
    const dc2 = (await http().post('/api/challans').set(auth(o)).send(dcBody(verma.id, [{ itemId: fan.id, qty: '1' }])).expect(201)).body;
    await http().post(`/api/sales/${dc2.id}/cancel`).set(auth(o)).send({}).expect(200);
    expect((await put(o, `challans/${dc2.id}`, dcBody(verma.id, [{ itemId: fan.id, qty: '3' }])).expect(400)).body.message).toBe('DC-0002 is cancelled. It can’t be changed.');
    await put(await owner(app), `challans/${dc2.id}`, dcBody(null, [], { cashName: 'X' })).expect(404);
  });
});

/* ───────── quotations ───────── */

describe('edit an item-wise quotation', () => {
  it('a quotation already turned into an invoice is edited on the invoice', async () => {
    const { o, fan, verma } = await shop();
    const q = (await sale(o, { kind: 'quotation', partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    // sent without a number, an edit keeps the quotation's own number
    expect((await put(o, `sales/${q.id}`, { kind: 'quotation', date: D, partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(200)).body.number).toBe(q.number);
    await sale(o, { partyId: verma.id, lines: [line(fan, '3', '1890')], fromQuotationIds: [q.id], extra: { quoteRefs: [{ no: q.number, brand: 'Item-wise' }] } }).expect(201);
    expect((await put(o, `sales/${q.id}`, { kind: 'quotation', date: D, partyId: verma.id, lines: [line(fan, '4', '1890')] }).expect(400)).body.message).toBe(`${q.number} is already turned into invoice INV-0001. Edit the invoice instead.`);
  });
});

/* ───────── numbers ───────── */

describe('the number of a saved document never changes', () => {
  it('an edit with a different number is refused (invoice, item-wise and brand-wise quotation); the same number saves', async () => {
    const { o, fan, verma } = await shop();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const body = { date: D, dueDate: D, partyId: verma.id, lines: [line(fan, '2', '1890')] };
    expect((await put(o, `sales/${inv.id}`, { ...body, number: 'INV-9999' }).expect(400)).body).toMatchObject({ message: 'The number of a saved invoice can’t be changed. It stays INV-0001.', field: 'number' });
    expect(await stockOf(o, fan.id)).toBe('24.000');
    expect((await put(o, `sales/${inv.id}`, { ...body, number: 'INV-0001' }).expect(200)).body.number).toBe('INV-0001');
    expect(await stockOf(o, fan.id)).toBe('23.000');
    const q = (await sale(o, { kind: 'quotation', partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    expect((await put(o, `sales/${q.id}`, { kind: 'quotation', date: D, number: 'Q-9999', partyId: verma.id, lines: [line(fan, '3', '1890')] }).expect(400)).body.message).toBe(`The number of a saved quotation can’t be changed. It stays ${q.number}.`);
    const brand = { date: D, cust: 'Verma Traders', disc: 5, sel: ['s1'], qty: { r5: 30 }, items: 1, pcs: 30, low: { name: 'Havells Coral White', total: 5230.5 } };
    const bq = (await http().post('/api/quotations/brand').set(auth(o)).send(brand).expect(201)).body;
    expect((await put(o, `quotations/brand/${bq.id}`, { ...brand, number: 'Q-9998' }).expect(400)).body.message).toBe(`The number of a saved quotation can’t be changed. It stays ${bq.number}.`);
    expect((await put(o, `quotations/brand/${bq.id}`, { ...brand, number: bq.number, disc: 7 }).expect(200)).body.number).toBe(bq.number);
    // nothing was renumbered: the refused numbers are still free and never taken
    expect((await http().get('/api/sales?kind=invoice').set(auth(o)).expect(200)).body.map((x: { number: string }) => x.number)).toEqual(['INV-0001']);
  });
});

/* ───────── opening values ───────── */

describe('opening values are never changed by an edit', () => {
  it('opening stock, opening party balance and opening cash / bank balances stay as they were', async () => {
    const { o, fan, verma } = await shop();
    await http().post('/api/banking/accounts').set(auth(o)).send({ name: 'HDFC Bank', openingBalance: '50000' }).expect(201);
    const opening = async () => {
      const p = await partyOf(o, verma.id);
      const moves = (await http().get(`/api/items/${fan.id}`).set(auth(o)).expect(200)).body;
      return { party: [p.openingBalance, p.openingType, p.openingDate], acc: (await accounts(o)).map((a) => [a.name, a.openingBalance]), stock: JSON.stringify(moves.openingQty ?? null) };
    };
    const at0 = await opening();
    const inv = (await sale(o, { partyId: verma.id, lines: [line(fan, '2', '1890')] }).expect(201)).body;
    // a payment that settled the opening balance, edited; extra fields in the body are ignored
    const p = (await http().post('/api/receipts').set(auth(o)).send(receipt(verma.id, '1000', [{ to: 'opening', amount: '1000' }])).expect(201)).body;
    await put(o, `receipts/${p.id}`, { ...receipt(verma.id, '400', [{ to: 'opening', amount: '400' }], { mode: 'UPI' }), openingBalance: '0', openingQty: '0' }).expect(200);
    const cn = (await http().post('/api/credit-notes').set(auth(o)).send(cnBody(verma.id, [cnLine(inv.id, fan, '1')])).expect(201)).body;
    await put(o, `credit-notes/${cn.id}`, { ...cnBody(verma.id, [cnLine(inv.id, fan, '2')]), openingBalance: '0' }).expect(200);
    expect(await opening()).toEqual(at0);
    // the opening balance is still owed in part: 1000 − 400
    expect(((await http().get(`/api/parties/${verma.id}/dues`).set(auth(o)).expect(200)).body as { to: string; balance: string }[]).find((d) => d.to === 'opening')?.balance).toBe('600.00');
    // there is no edit route for opening entries
    for (const path of ['opening', 'parties/opening', 'items/opening', 'banking/opening']) await http().put(`/api/${path}/${verma.id}`).set(auth(o)).send({ amount: '1' }).expect(404);
    expect(await stockOf(o, fan.id)).toBe('25.000');
  });
});

import { describe, expect, it } from 'vitest';
import { editDiffs, notAnEdit, refsOf, sentences, type Names } from '../src/modules/audit/edit-history';
import { withoutEditedLines } from '../src/modules/items/item-history';

/**
 * The history window's lines, from audit entries shaped exactly as they are stored (Prisma rows
 * through JSON: numbers as text, dates as ISO times). Made-up ids and names.
 */
const FAN = '11111111-1111-4111-8111-111111111111';
const BULB = '22222222-2222-4222-8222-222222222222';
const VERMA = '33333333-3333-4333-8333-333333333333';
const SINGH = '44444444-4444-4444-8444-444444444444';
const CASH = '55555555-5555-4555-8555-555555555555';
const HDFC = '66666666-6666-4666-8666-666666666666';
const MAIN = '77777777-7777-4777-8777-777777777777';
const GONE = '99999999-9999-4999-8999-999999999999';

const names = (): Names => ({
  party: new Map([[VERMA, 'Verma Traders'], [SINGH, 'Singh Electricals']]),
  item: new Map([[FAN, 'Ceiling fan 1200mm'], [BULB, 'LED bulb 9W']]),
  godown: new Map([[MAIN, 'Main godown']]),
  account: new Map([[CASH, 'Cash in hand'], [HDFC, 'HDFC Bank']]),
  referrer: new Map(), sale: new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INV-0003']]), purchase: new Map(),
});
const lines = (entity: string, before: unknown, after: unknown, n = names()) => sentences(editDiffs(entity, before, after)!, n);

const saleLine = (itemId: string, name: string, position: number, qty: string, price: string) => ({ id: `line-${position}`, itemId, name, position, qty, price, discPct: '0', gstRate: '18', amount: '0' });
const invoice = (more: object = {}) => ({
  id: 'doc', kind: 'invoice', number: 'INV-0001', date: '2026-10-04T00:00:00.000Z', dueDate: '2026-10-04T00:00:00.000Z', mode: 'credit', partyId: VERMA,
  cashName: '', cashPhone: '', billName: '', placeOfSupply: '09', pricesInclTax: true, roundOff: true, billDiscPct: null, billDiscAmt: null,
  transport: null, labour: null, bankCharge: null, total: '11340', notes: '', referrerId: null, extra: {}, updatedAt: '2026-10-04T05:00:00.000Z',
  lines: [saleLine(FAN, 'Ceiling fan 1200mm', 0, '6', '1890')], ...more,
});

describe('edits logged with the whole record before and after (sales, purchases, payments)', () => {
  it('a sale: quantity, total and notes; nothing else is listed (ids of lines, update times)', () => {
    const after = invoice({ total: '15120', notes: 'Deliver on Monday', updatedAt: '2026-10-05T05:00:00.000Z', lines: [{ ...saleLine(FAN, 'Ceiling fan 1200mm', 0, '8.000', '1890.00'), id: 'new-line' }] });
    expect(lines('sales_document', invoice(), { ...after, received: '0.00' })).toEqual([
      'Total changed from ₹11,340.00 to ₹15,120.00',
      'Notes was added (value: Deliver on Monday)',
      'Item Ceiling fan 1200mm: quantity changed from 6 to 8',
    ]);
  });

  it('lines added and removed, party changed (shown by name), a date moved; lines stored out of order are paired by item', () => {
    const before = invoice({ lines: [saleLine(BULB, 'LED bulb 9W', 1, '10', '95'), saleLine(FAN, 'Ceiling fan 1200mm', 0, '6', '1890')] });
    const after = invoice({ partyId: SINGH, date: '2026-10-09T00:00:00.000Z', lines: [saleLine(FAN, 'Ceiling fan 1200mm', 0, '6', '1950'), saleLine(GONE, 'Wire roll', 1, '2', '1200')] });
    expect(lines('sales_document', before, after)).toEqual([
      'Date changed from 04/10/2026 to 09/10/2026',
      'Party changed from Verma Traders to Singh Electricals',
      'Item Ceiling fan 1200mm: rate changed from ₹1,890.00 to ₹1,950.00',
      'Item LED bulb 9W was removed (was: quantity 10, rate ₹95.00, GST 18%)',
      'Item Wire roll was added (value: quantity 2, rate ₹1,200.00, GST 18%)',
    ]);
  });

  it('an id that is no longer found shows "(deleted or unknown)"; a yes / no switch reads Yes / No', () => {
    expect(lines('sales_document', invoice({ partyId: GONE, pricesInclTax: true }), invoice({ partyId: VERMA, pricesInclTax: false }))).toEqual([
      'Party changed from (deleted or unknown) to Verma Traders',
      'Prices include GST changed from Yes to No',
    ]);
  });

  it('a purchase bill: supplier bill number and a line rate (purchase lines keep "rate")', () => {
    const bill = (ref: string, rate: string) => ({ kind: 'bill', supplierRef: ref, date: '2026-10-04T00:00:00.000Z', partyId: VERMA, total: '1000', lines: [{ itemId: BULB, name: 'LED bulb 9W', position: 0, qty: '10', rate, discPct: '0', gstRate: '18' }] });
    expect(lines('purchase_document', bill('KC/101', '62'), bill('KC/101A', '64.5'))).toEqual([
      'Supplier bill no. changed from KC/101 to KC/101A',
      'Item LED bulb 9W: rate changed from ₹62.00 to ₹64.50',
    ]);
  });

  it('a payment received: amount and what it settles, by invoice number; the opening balance by name', () => {
    const inv = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const before = { direction: 'in', date: '2026-10-04T00:00:00.000Z', partyId: VERMA, amount: '1000', mode: 'Cash', reference: '', notes: '', allocations: [{ to: inv, amount: '1000.00' }] };
    const after = { ...before, amount: '1500', mode: 'UPI', allocations: [{ to: inv, amount: '1200.00' }, { to: 'opening', amount: '300.00' }] };
    expect(lines('payment', before, after)).toEqual([
      'Amount changed from ₹1,000.00 to ₹1,500.00',
      'Mode changed from Cash to UPI',
      'Amount against INV-0003 changed from ₹1,000.00 to ₹1,200.00',
      'Amount against the opening balance was added (value: ₹300.00)',
    ]);
  });

  it('saved again with nothing changed gives no lines (the window says so)', () => {
    expect(editDiffs('sales_document', invoice(), invoice({ updatedAt: '2026-10-06T00:00:00.000Z' }))).toEqual([]);
  });
});

describe('edits logged with a list of changes (expenses, cash / bank entries, stock adjustments, transfers)', () => {
  it('an expense: account ids become names, lines are compared, money in Indian format', () => {
    const changes = [
      { field: 'date', old: '2026-10-04', new: '2026-10-09' }, { field: 'category', old: 'Repairs', new: 'Electricity' }, { field: 'accountId', old: CASH, new: HDFC },
      { field: 'lines', old: [{ name: 'AC servicing', qty: '1.000', rate: '1200.00', gst: 0, amt: '1200.00' }], new: [{ name: 'AC servicing', qty: '2.000', rate: '1200.00', gst: 0, amt: '2400.00' }] },
      { field: 'total', old: '1200', new: '2400' },
    ];
    const d = editDiffs('expense', { id: 'x' }, { id: 'x', changes })!;
    expect([...refsOf(d).account].sort()).toEqual([CASH, HDFC].sort());
    expect(sentences(d, names())).toEqual([
      'Date changed from 04/10/2026 to 09/10/2026',
      'Category changed from Repairs to Electricity',
      'Paid from changed from Cash in hand to HDFC Bank',
      'Line AC servicing: quantity changed from 1 to 2',
      'Line AC servicing: amount changed from ₹1,200.00 to ₹2,400.00',
      'Total changed from ₹1,200.00 to ₹2,400.00',
    ]);
  });

  it('a bank-to-bank entry calls its first account "From account"; an unknown account id is said so', () => {
    const changes = [{ field: 'kind', old: 'deposit', new: 'transfer' }, { field: 'accountId', old: CASH, new: GONE }, { field: 'amount', old: '5000', new: '7000' }];
    expect(lines('bank_entry', {}, { toAccountId: HDFC, changes })).toEqual([
      'Type changed from Cash deposited in bank to Bank to bank',
      'From account changed from Cash in hand to (deleted or unknown)',
      'Amount changed from ₹5,000.00 to ₹7,000.00',
    ]);
  });

  it('a stock adjustment and a transfer: items and godowns by name, quantities with + / − for an adjustment', () => {
    expect(lines('stock_adjustment', {}, { changes: [{ field: 'itemId', old: FAN, new: BULB }, { field: 'qty', old: '10', new: '-3' }, { field: 'reason', old: 'Count', new: '' }] })).toEqual([
      'Item changed from Ceiling fan 1200mm to LED bulb 9W',
      'Quantity changed from +10 to -3',
      'Reason was removed (was: Count)',
    ]);
    expect(lines('stock_transfer', {}, { changes: [{ field: 'toGodownId', old: MAIN, new: GONE }, { field: 'qty', old: '10', new: '4' }] })).toEqual([
      'To godown changed from Main godown to (deleted or unknown)',
      'Quantity changed from 10 to 4',
    ]);
  });
});

describe('entries without usable values', () => {
  it('no before or no after: null (the window shows "Edited (details were not saved)", never made-up values)', () => {
    expect(editDiffs('sales_document', null, { total: '100' })).toBeNull();
    expect(editDiffs('purchase_document', { total: '100' }, null)).toBeNull();
    expect(editDiffs('something_else', { a: 1 }, { a: 2 })).toBeNull();
  });
  it('a credit note noting the invoice it returns goods from is not an edit of that invoice', () => {
    expect(notAnEdit('sales_document', null, { returned: 'CN-0001' })).toBe(true);
    expect(notAnEdit('sales_document', null, { total: '1' })).toBe(false);
    expect(notAnEdit('sales_document', { a: 1 }, { returned: 'CN-0001' })).toBe(false);
  });
});

describe('item history: the lines an edit replaced are left out', () => {
  const t = (s: string) => new Date(`2026-10-0${s}Z`);
  const mv = (kind: string, qty: number, note: string, at: string, sourceId = 'inv') => ({ kind, qty, note, sourceType: 'sales_document', sourceId, createdAt: t(at) });
  const net = (L: { qty: number }[]) => L.reduce((a, m) => a + m.qty, 0);

  it('a sale edited twice shows only its current line, and what is hidden adds up to nothing', () => {
    const all = [
      { kind: 'opening', qty: 25, note: 'Opening stock', sourceType: null, sourceId: null, createdAt: t('1T09:00:00') },
      mv('sale', -6, 'INV-0001', '4T10:00:00'),
      mv('cancel', 6, 'Edited INV-0001', '4T11:00:00'), mv('sale', -8, 'INV-0001', '4T11:00:00'),
      mv('cancel', 8, 'Edited INV-0001', '5T12:00:00'), mv('sale', -7, 'INV-0001', '5T12:00:00.001'),
    ];
    const shown = withoutEditedLines(all);
    expect(shown.map((m) => [m.kind, m.qty])).toEqual([['opening', 25], ['sale', -7]]);
    expect(net(shown)).toBe(net(all));
  });

  it('a really cancelled document keeps its "cancelled" line; another document is untouched', () => {
    const all = [
      mv('sale', -6, 'INV-0001', '4T10:00:00'), mv('cancel', 6, 'Edited INV-0001', '4T11:00:00'), mv('sale', -8, 'INV-0001', '4T11:00:00'),
      mv('cancel', 8, 'Cancelled INV-0001', '6T09:00:00'),
      mv('sale', -2, 'INV-0002', '4T10:00:00', 'other'), mv('cancel', 2, 'Cancelled INV-0002', '4T12:00:00', 'other'),
    ];
    expect(withoutEditedLines(all).map((m) => [m.note, m.qty])).toEqual([['INV-0001', -8], ['Cancelled INV-0001', 8], ['INV-0002', -2], ['Cancelled INV-0002', 2]]);
  });
});

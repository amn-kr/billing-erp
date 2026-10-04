import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSnapshot, parseBackup } from '../src/extract.ts';
import { planImport } from '../src/plan.ts';
import type { Snapshot } from '../src/snapshot.ts';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, '../fixtures', n), 'utf8');
let browser: Browser;
const snaps: Record<string, Snapshot> = {};
beforeAll(async () => {
  browser = await chromium.launch();
  for (const n of ['fresh-shop', 'fresh-kept-items', 'sample-shop', 'sales-shop', 'purchase-shop']) snaps[n] = await extractSnapshot(parseBackup(fx(`${n}.backup.json`)), { browser });
});
afterAll(async () => { await browser.close(); });

describe('fresh shop', () => {
  it('maps parties, opening balances, items and opening stock with exact money', () => {
    const p = planImport(snaps['fresh-shop']!);
    expect(p.counts).toMatchObject({ parties: 4, customers: 3, suppliers: 1, items: 4, services: 1, partiesWithOpeningBalance: 3, openingStockRows: 2 });
    const mehta = p.parties.find((x) => x.name === 'Mehta Electricals')!;
    expect(mehta).toMatchObject({ kind: 'customer', group: 'Wholesale customers', stateCode: '09', creditDays: 30, creditLimit: null, opening: { amount: '25000.00', type: 'receive', date: '2026-04-01' } });
    expect(mehta.billing).toMatchObject({ line: '12, Aminabad Market' });
    expect(p.parties.find((x) => x.name === 'Kanpur Cables Pvt Ltd')).toMatchObject({ kind: 'supplier', opening: { amount: '48000.00', type: 'pay' } });
    expect(p.parties.find((x) => x.name === 'Walk-in Ramesh')!.opening).toBeNull();
    const wire = p.items.find((x) => x.code === 'CW15')!;
    expect(wire).toMatchObject({ kind: 'goods', unit: 'COIL', gstRate: '18.00', sale: '1890.00', mrp: '2350.00', purchase: '1560.00', minStock: '10.000' });
    expect(wire.opening).toEqual([{ qty: '25.000', rate: '1540.00', date: '2026-04-01' }]);
    expect(p.items.find((x) => x.name === 'Fan installation')).toMatchObject({ kind: 'service', opening: [] });
    expect(p.priceLists.find((x) => x.name === 'Wholesale')).toMatchObject({ rule: 'disc', value: '8.000', roundTo: '1.00', overrides: [] });
    expect(p.commission.find((c) => c.category === 'Fans')).toEqual({ category: 'Fans', kind: 'percent', value: '8.00' });
    expect(p.godowns).toEqual([expect.objectContaining({ name: 'Main shop', isDefault: true, phone: '9415012345' })]);
    expect(p.business).toMatchObject({ name: 'Gupta Electricals & Hardware', invoiceNext: 101 });
    expect(p.warnings).toEqual([]);
  });
});

describe('demo data', () => {
  it('is left out of the sample shop unless asked for, with a note', () => {
    const p = planImport(snaps['sample-shop']!);
    expect(p.counts.items).toBe(0);
    expect(p.warnings[0]).toMatch(/Left out the old app’s demo data/);
    const all = planImport(snaps['sample-shop']!, { includeSample: true });
    expect(all.counts.items).toBe(288);
    expect(all.priceLists.find((x) => x.legacyId === 'pl2')!.overrides).toEqual([{ itemLegacyId: 'i1', price: '1720.00' }]);
  });
  it('a shop that kept the sample catalogue gets it', () => {
    const p = planImport(snaps['fresh-kept-items']!);
    expect(p.counts.items).toBeGreaterThan(200);
    expect(p.items.every((i) => i.opening.length === 0)).toBe(true);
  });
});

describe('messy data from the old app', () => {
  const base = (): Snapshot => JSON.parse(JSON.stringify(snaps['fresh-shop']));
  it('renames duplicate names and re-keys duplicate ids', () => {
    const s = base();
    s.items.push({ ...s.items[0]!, name: s.items[0]!.name.toUpperCase() });
    s.parties.push({ ...s.parties[0]! });
    const p = planImport(s);
    expect(p.items.map((i) => i.name)).toContain(`${s.items[0]!.name.toUpperCase()} (2)`);
    expect(new Set(p.items.map((i) => i.legacyId)).size).toBe(p.items.length);
    expect(new Set(p.parties.map((i) => i.legacyId)).size).toBe(p.parties.length);
    expect(p.warnings.some((w) => /were both called/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /shared the internal id/.test(w))).toBe(true);
  });
  it('drops a repeated item code, flags a bad GSTIN, ignores negative openings', () => {
    const s = base();
    const wire = s.items.find((i) => i.code === 'CW15')!;
    s.items.push({ ...wire, id: 'x1', name: 'Another wire' });
    s.parties[0]!.gstin = '09BAD';
    s.parties[1]!.opening = { amount: -50, date: '2026-04-01', kind: 'receive' };
    const p = planImport(s);
    expect(p.items.find((i) => i.name === 'Another wire')!.code).toBe('');
    expect(p.warnings.some((w) => /Item code “CW15” was used twice/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /GSTIN “09BAD” doesn’t look right/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /negative opening balance/.test(w))).toBe(true);
  });
  it('adds units and categories the items use', () => {
    const s = base();
    s.items[0]!.unit = 'roll';
    s.items[0]!.category = 'Solar';
    const p = planImport(s);
    expect(p.units).toContain('ROLL');
    expect(p.categories).toContain('Solar');
  });
  it('uses decimal maths for money', () => {
    const s = base();
    s.items[0]!.sale = 0.1 + 0.2;
    s.items[0]!.opening = [{ qty: 1.0005, price: 10.005, date: '2026-04-01' }];
    s.items[0]!.service = false;
    const p = planImport(s);
    expect(p.items[0]!.sale).toBe('0.30');
    expect(p.items[0]!.opening[0]).toMatchObject({ qty: '1.001', rate: '10.01' });
  });
});

describe('impossible amounts', () => {
  it('are left out of price history and zeroed on items, with a note', () => {
    const s: Snapshot = JSON.parse(JSON.stringify(snaps['fresh-shop']));
    const it = s.items[0]!;
    it.mrp = 4.7e58;
    s.priceHistory = [
      { d: '2026-10-01T10:00:00Z', id: it.id, f: 'Retail (sale)', old: 10, nv: 4.7e58, how: 'Edited' },
      { d: '2026-10-01T11:00:00Z', id: it.id, f: 'Retail (sale)', old: 10, nv: 12, how: 'Edited' },
    ];
    const p = planImport(s);
    expect(p.items.find((x) => x.legacyId === it.id)!.mrp).toBe('0.00');
    expect(p.priceHistory).toEqual([{ itemLegacyId: it.id, field: 'sale', oldValue: '10.00', newValue: '12.00', how: 'Edited', at: '2026-10-01T11:00:00Z' }]);
    expect(p.warnings.some((w) => /impossible amount/.test(w))).toBe(true);
  });
  it('exact duplicate parties are merged, electricians too', () => {
    const s: Snapshot = JSON.parse(JSON.stringify(snaps['fresh-shop']));
    const raju = s.parties.find((p) => p.name === 'Raju Electrician')!;
    s.parties.push({ ...raju, id: 'dup1', addedOn: '2026-12-01' });
    s.referrers = [
      { id: 'e1', name: 'Raju Electrician', phone: raju.phone, city: 'Lucknow', partyId: 'dup1' },
      { id: 'e2', name: 'Raju Electrician', phone: raju.phone, city: 'Lucknow', partyId: raju.id },
    ];
    const p = planImport(s);
    expect(p.parties.filter((x) => x.name.startsWith('Raju'))).toHaveLength(1);
    expect(p.referrers).toEqual([expect.objectContaining({ name: 'Raju Electrician', partyLegacyId: raju.id })]);
    expect(p.warnings.some((w) => /exact copies/.test(w))).toBe(true);
  });
});

describe('godowns', () => {
  it('the demo godowns of a sample book are left out unless demo data is included', () => {
    const s = snaps['sample-shop']!;
    expect(planImport(s).godowns.map((g) => g.name)).toEqual(['Main shop']);
    expect(planImport(s, { includeSample: true }).godowns.length).toBe(3);
  });
});

describe('sales documents (made through the prototype’s editor and dialogs)', () => {
  it('maps invoices, payments, returns, challans and item-wise quotations, oldest first, with printed totals kept', () => {
    const p = planImport(snaps['sales-shop']!);
    expect(p.counts).toMatchObject({ invoices: 6, receipts: 1, creditNotes: 1, challans: 2, quotations: 2 });
    expect(p.sales.invoices.map((v) => [v.number, v.date, v.totals.total, v.cancelled])).toEqual([
      ['INV-0101', '2026-09-10', '4348.00', false], ['INV-0102', '2026-09-18', '420.00', false], ['INV-0103', '2026-09-28', '839.00', false],
      ['INV-0104', '2026-09-30', '348.00', true], ['INV-0105', '2026-10-01', '190.00', false], ['INV-0106', '2026-10-01', '570.00', false],
    ].map(([n, d, t, c]) => [n, d, t, c]));
    const i3 = p.sales.invoices[2]!;
    expect(i3.totals).toMatchObject({ taxable: '644.39', cgst: '47.12', sgst: '47.12', round: '0.38', billDiscount: '38.88', transport: '100.00' });
    expect(i3.lines[1]).toMatchObject({ qty: '5.000', price: '95.00', discPct: '10.00000000', gstRate: '12.00', amount: '427.50' });
    const walkIn = p.sales.invoices[1]!;
    expect(walkIn).toMatchObject({ mode: 'cash', partyLegacyId: null, cashName: 'Suresh', received: '420.00', receiptNo: 'PI-0621', pays: [{ mode: 'Cash', amount: '420.00', ref: '' }] });
    expect(p.sales.invoices[4]).toMatchObject({ received: '190.00', extraPaid: '310.00', pays: [{ mode: 'Cash', amount: '500.00' }] });
    expect(p.sales.invoices[5]).toMatchObject({ challanNo: 'DC-0001' });
    expect(p.sales.receipts[0]).toMatchObject({ number: 'PI-0625', amount: '5000.00', mode: 'Cheque', ref: '004512', alloc: [{ to: 'opening', amount: '5000.00' }] });
    expect(p.sales.creditNotes[0]).toMatchObject({ number: 'CN-0001', settle: 'adjust', total: '174.00', invoices: [{ no: 'INV-0101', amount: '174.00' }] });
    expect(p.sales.creditNotes[0]!.lines[0]).toMatchObject({ invoiceNo: 'INV-0101', qty: '2.000', price: '87.00', gstRate: '12.00' });
    expect(p.sales.challans.map((d) => [d.number, d.status, d.invoiceNo])).toEqual([['DC-0001', 'invoiced', 'INV-0106'], ['DC-0002', 'open', '']]);
    expect(p.sales.quotations.map((q) => q.number)).toEqual(['Q-0101', 'Q-0102']); // oldest first
    expect(p.sales.quotations[1]).toMatchObject({ number: 'Q-0102', validTill: '2026-10-16', status: 'open', totals: { total: '3283.00' } });
    // the brand-wise quotation comes with its quantities, and the Quotation page grid with it
    const bq = p.sales.quotations.find((q) => q.brand)!;
    expect(bq).toMatchObject({ number: 'Q-0101', lines: [], extra: { type: 'brand', items: 11, pcs: 132, qty: { r5: 30, p4: 15 } } });
    expect([p.sales.quoteGrid!.rows.length, p.sales.quoteGrid!.ser.length]).toEqual([22, 6]);
    expect(p.warnings.join(' ')).not.toMatch(/brand-wise/);
    expect(p.warnings.some((w) => /stock changes/.test(w))).toBe(false);
  });
});

describe('purchases (made through the prototype’s purchase screens)', () => {
  it('maps bills, orders, a debit note and payments made, in the order they happened', () => {
    const p = planImport(snaps['purchase-shop']!);
    expect(p.counts).toMatchObject({ purchaseBills: 2, purchaseOrders: 2, debitNotes: 1, paymentsMade: 2 });
    expect(p.purchases.docs.map((d) => [d.kind, d.number, d.date, d.total, d.status])).toEqual([
      ['bill', 'PB-0001', '2026-09-20', '24196.00', 'open'], ['order', 'ORD-0001', '2026-09-25', '3248.00', 'received'], ['order', 'ORD-0002', '2026-09-29', '7080.00', 'open'],
      ['bill', 'PB-0002', '2026-09-30', '3248.00', 'open'], ['debit_note', 'DN-0001', '2026-10-01', '325.00', 'open'],
    ]);
    expect(p.purchases.docs[0]).toMatchObject({ supplierRef: 'KC/2209', dueDate: '2026-10-20', lines: [{ qty: '10.000', rate: '1500.00', gstRate: '18.00' }, { qty: '100.000', rate: '58.00', gstRate: '12.00' }] });
    expect(p.purchases.docs[3]).toMatchObject({ fromOrderNo: 'ORD-0001' });
    expect(p.purchases.docs[4]).toMatchObject({ againstNo: 'PB-0001', reason: 'Damaged goods' });
    expect(p.purchases.payments).toEqual([
      { number: 'PO-0001', date: '2026-09-20', partyLegacyId: expect.any(String), amount: '5000.00', mode: 'Bank transfer', ref: 'NEFT 4471', alloc: [{ billNo: 'PB-0001', amount: '5000.00' }] },
      { number: 'PO-0002', date: '2026-10-01', partyLegacyId: expect.any(String), amount: '10000.00', mode: 'Cheque', ref: '004890', alloc: [{ billNo: 'PB-0001', amount: '10000.00' }] },
    ]);
  });

  it('the old app’s demo purchase orders stay out unless the demo data is asked for', () => {
    const s = snaps['sample-shop']!;
    const demo = { kind: 'po', no: 'ORD-0105', date: '29/09/2026', party: s.parties.find((x) => x.sample)!.id, status: 'open', lines: [{ id: s.items.find((i) => i.sample)!.id, name: 'x', qty: 1, rate: 10, gst: 18 }] };
    const withDemo = { ...s, documents: { ...s.documents, 'erp-pdocs': [demo] } };
    const p = planImport(withDemo);
    expect(p.purchases.docs).toHaveLength(0);
    expect(p.warnings.some((w) => /demo purchase order/.test(w))).toBe(true);
    expect(planImport(withDemo, { includeSample: true }).purchases.docs).toHaveLength(1);
  });
});

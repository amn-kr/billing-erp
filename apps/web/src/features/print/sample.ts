/**
 * The example bill in Settings › Print & invoice ("Bill without tax" / "GST bill").
 * Every shop sees it, so it must stay obviously fake: no real customer, item, UPI or
 * bill number (sample.test.ts checks). Totals, tax and words are worked out from the
 * items with the shared Decimal helpers. The shop's own details come from its profile.
 */
import { amountInWords, money, round0, round2, sum, toDb } from '@billing/shared';
import type { PDoc, PLine } from './Paper';

/** name, quantity, unit, rate (before tax) */
export const SAMPLE_ITEMS: [string, string, string, string][] = [['Item 1', '2', 'Pcs', '100'], ['Item 2', '5', 'Nos', '40'], ['Item 3', '1', 'Pcs', '250'], ['Item 4', '3', 'Nos', '75']];
export const SAMPLE_GST_RATE = '18';
export const SAMPLE_RECEIVED = '500';

export function sampleDoc(gst: boolean, stateCode = '09'): PDoc {
  const lines: PLine[] = SAMPLE_ITEMS.map(([name, qty, unit, rate], i) => {
    const taxable = round2(money(qty).times(rate));
    const tax = gst ? round2(taxable.times(SAMPLE_GST_RATE).div(100)) : money(0);
    return {
      name, code: `ITEM-00${i + 1}`, hsn: '9999', brand: 'Brand A', series: 'Series 1', cat: 'Category A', grp: 'Group A', qty, unit,
      mrp: toDb(money(rate).times('1.2')), list: toDb(money(rate).times('1.1')), whole: toDb(money(rate).times('0.95')),
      price: toDb(rate), discPct: '0', gst: gst ? SAMPLE_GST_RATE : '0', taxable: toDb(taxable), tax: toDb(tax), amount: toDb(taxable.plus(tax)),
    };
  });
  const taxable = sum(lines.map((l) => l.taxable));
  const tax = sum(lines.map((l) => l.tax));
  const exact = taxable.plus(tax);
  const total = round0(exact);
  const half = round2(tax.div(2));
  const balance = total.minus(SAMPLE_RECEIVED);
  return {
    kind: 'invoice', number: 'SAMPLE-001', date: '2026-04-01', dueDate: null, mode: 'cash', taxMode: gst ? 'gst' : 'none', placeOfSupply: stateCode, cancelled: false,
    party: { name: 'ABC Traders', city: 'Sample address, City', phone: '', gstin: gst ? '00AAAAA0000A0Z0' : '' },
    refs: [['Challan no.', '001']], description: 'Sample description.', notes: '',
    lines, billDiscount: '0.00', taxable: toDb(taxable), cgst: toDb(half), sgst: toDb(tax.minus(half)), igst: '0.00', tcs: '0.00', transport: '0.00', labour: '0.00', bankCharge: '0.00',
    roundAmount: toDb(total.minus(exact)), total: toDb(total), words: amountInWords(total),
    received: toDb(SAMPLE_RECEIVED), payMode: 'UPI', balance: toDb(balance), partyBalance: toDb(balance.plus(1000)), upi: 'example@upi',
  };
}

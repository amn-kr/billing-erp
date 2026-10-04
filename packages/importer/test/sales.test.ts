import { describe, expect, it } from 'vitest';
import { planSales } from '../src/sales.ts';
import { planPayouts } from '../src/commission.ts';

const ctx = (warnings: string[]) => ({
  partyId: (id: string) => (id === 'p1' ? 'p1' : null),
  itemId: (id: string) => (id === 'i1' ? 'i1' : null),
  referrerIds: new Set(['e9']),
  // e1 is a merged copy of e9
  referrerOf: (id: string) => (id === 'e1' || id === 'e9' ? 'e9' : null),
  warnings,
});
const line = { id: 'i1', name: 'Wire', qty: 2, unit: 'Nos', price: 118, disc: 0, gst: 18, tv: 200, tx: 36, amt: 236 };
const inv = (no: string, x: Record<string, unknown>) => ({ no, date: '01/10/2026', party: 'p1', mode: 'credit', tm: 'gst', incl: true, lines: [line], total: 236, received: 0, ...x });

describe('older sales from the owner’s book', () => {
  it('works out commission for lines that kept the base rate but not the amount, as the old app did', () => {
    const p = planSales({ 'erp-invoices': [inv('INV-0001', { ref: 'e9', lines: [{ ...line, bp: 100 }] })] }, ctx([]), '2026-10-01');
    // 2 × (118 − 100) = 36, without 18 % GST = 30.51
    expect(p.invoices[0]!.lines[0]!.commAmount).toBe('30.51');
    const ex = planSales({ 'erp-invoices': [inv('INV-0001', { ref: 'e9', tm: 'none', lines: [{ ...line, bp: 100 }] })] }, ctx([]), '2026-10-01');
    expect(ex.invoices[0]!.lines[0]!.commAmount).toBe('36.00');
    const kept = planSales({ 'erp-invoices': [inv('INV-0001', { ref: 'e9', lines: [{ ...line, bp: 100, cm: 12.5 }] })] }, ctx([]), '2026-10-01');
    expect(kept.invoices[0]!.lines[0]!.commAmount).toBe('12.50');
  });

  it('bills and payouts of a merged electrician follow the one kept', () => {
    const p = planSales({ 'erp-invoices': [inv('INV-0001', { ref: 'e1' }), inv('INV-0002', { ref: 'zz' })] }, ctx([]), '2026-10-01');
    expect(p.invoices.map((v) => [v.number, v.referrerLegacyId])).toEqual([['INV-0002', null], ['INV-0001', 'e9']]);
    const warnings: string[] = [];
    const pay = planPayouts({ 'erp-compay': [{ no: 'CP-0001', date: '01/10/2026', elec: 'e1', amount: 50, mode: 'Cash' }, { no: 'CP-0002', elec: 'zz', amount: 5 }] }, ctx([]).referrerOf, warnings, '2026-10-01');
    expect(pay.map((x) => [x.number, x.referrerLegacyId])).toEqual([['CP-0001', 'e9']]);
    expect(warnings.join(' ')).toMatch(/CP-0002 was left out/);
  });

  it('gives a repeated receipt number a "/2" so both payments are kept', () => {
    const warnings: string[] = [];
    const pay = { received: 236, pays: [{ mode: 'UPI', amt: 236 }] };
    // newest first in the backup
    const p = planSales({ 'erp-invoices': [inv('INV-0002', { ...pay, pi: 'PI-0629' }), inv('INV-0001', { ...pay, pi: 'PI-0629' })] }, ctx(warnings), '2026-10-01');
    expect(p.invoices.map((v) => [v.number, v.receiptNo])).toEqual([['INV-0001', 'PI-0629'], ['INV-0002', 'PI-0629/2']]);
    expect(warnings.join(' ')).toMatch(/INV-0002 and another bill both used receipt number PI-0629/);
  });
});

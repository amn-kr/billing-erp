import { describe, expect, it } from 'vitest';
import { amountInWords } from '@billing/shared';
import { SAMPLE_ITEMS, sampleDoc } from './sample';

/**
 * Every shop sees the example, so every word in it must be one of these obviously fake
 * values (an allow-list: a real customer, item, UPI or bill number can't slip in).
 */
const FAKE = /^(|ABC Traders|Sample address, City|Sample description\.|Item [1-4]|ITEM-00[1-4]|Pcs|Nos|Brand A|Series 1|Category A|Group A|9999|SAMPLE-001|Challan No\.|001|example@upi|UPI|00AAAAA0000A0Z0|invoice|cash|gst|none|2026-04-01|Rupees .* Only|[\d.]+)$/;
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

describe('Settings › Print example bill', () => {
  it('is obviously fake', () => {
    for (const gst of [false, true]) {
      const d = sampleDoc(gst);
      for (const t of strings(d)) expect(t, `"${t}" is not one of the fake example values`).toMatch(FAKE);
      expect(d.party.name).toBe('ABC Traders');
      expect(d.lines.map((l) => l.name)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4']);
      expect(d.upi).toBe('example@upi');
      expect(d.number).toBe('SAMPLE-001');
    }
  });

  it('bill without tax: totals come from the items (2×100 + 5×40 + 1×250 + 3×75)', () => {
    expect(SAMPLE_ITEMS).toHaveLength(4);
    const d = sampleDoc(false);
    expect(d.taxable).toBe('875.00');
    expect(d.cgst).toBe('0.00');
    expect(d.total).toBe('875.00');
    expect(d.roundAmount).toBe('0.00');
    expect(d.balance).toBe('375.00');
    expect(d.words).toBe(amountInWords('875'));
    expect(d.lines.map((l) => l.amount)).toEqual(['200.00', '200.00', '250.00', '225.00']);
  });

  it('GST bill: 18% on 875 = 157.50, split CGST/SGST, rounded to 1,033', () => {
    const d = sampleDoc(true, '27');
    expect(d.taxable).toBe('875.00');
    expect(d.cgst).toBe('78.75');
    expect(d.sgst).toBe('78.75');
    expect(d.roundAmount).toBe('0.50');
    expect(d.total).toBe('1033.00');
    expect(d.words).toBe(amountInWords('1033'));
    expect(d.placeOfSupply).toBe('27');
    expect(d.lines.map((l) => l.tax)).toEqual(['36.00', '36.00', '45.00', '40.50']);
  });
});

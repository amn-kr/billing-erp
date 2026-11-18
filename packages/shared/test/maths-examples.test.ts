import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { amountInWords, purchaseTotals, saleTotals, type DocIn, type TotalsOut } from '../src/invoice';

/**
 * The shared maths examples (step 8.1d): examples/maths.json is what the phone app's Kotlin maths is
 * checked against. This test makes sure the web and server maths still give exactly those answers.
 * After a deliberate change to the maths, make the file again (scripts/maths-examples.mjs).
 */
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/maths.json');
const ex = JSON.parse(fs.readFileSync(FILE, 'utf8')) as {
  bills: { name: string; kind: 'sale' | 'purchase'; bill: DocIn; expect: Record<string, unknown> }[];
  words: { amount: string; expect: string }[];
};

const f = (v: { toFixed(n: number): string }) => v.toFixed(2);
const shown = (t: TotalsOut) => ({
  rows: t.rows.map((r) => ({ taxable: f(r.tv), tax: f(r.tx), amount: f(r.amt) })),
  items: f(t.items), billDiscount: f(t.bdisc), taxable: f(t.taxable), tax: f(t.tax),
  cgst: f(t.cgst), sgst: f(t.sgst), igst: f(t.igst), tcs: f(t.tcs), roundOff: f(t.round), total: f(t.total),
  byRate: Object.fromEntries(Object.entries(t.byRate).map(([k, b]) => [k, { taxable: f(b.tv), tax: f(b.tx) }])),
});

describe('shared maths examples (examples/maths.json)', () => {
  it('has bills of both kinds and amounts in words', () => {
    expect(ex.bills.filter((b) => b.kind === 'sale').length).toBeGreaterThanOrEqual(15);
    expect(ex.bills.filter((b) => b.kind === 'purchase').length).toBeGreaterThanOrEqual(5);
    expect(ex.words.length).toBeGreaterThanOrEqual(10);
  });

  for (const b of ex.bills) {
    it(`${b.kind}: ${b.name}`, () => {
      expect(shown((b.kind === 'sale' ? saleTotals : purchaseTotals)(b.bill))).toEqual(b.expect);
    });
  }

  it('amounts in words', () => {
    for (const w of ex.words) expect(amountInWords(w.amount)).toBe(w.expect);
  });

  it('CGST + SGST + IGST always equals the tax', () => {
    for (const b of ex.bills) {
      const e = b.expect as { tax: string; cgst: string; sgst: string; igst: string };
      expect((Number(e.cgst) * 100 + Number(e.sgst) * 100 + Number(e.igst) * 100).toFixed(0), b.name).toBe((Number(e.tax) * 100).toFixed(0));
    }
  });
});

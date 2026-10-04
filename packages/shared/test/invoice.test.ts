import { describe, expect, it } from 'vitest';
import { amountInWords, purchaseTotals, saleTotals, type DocIn } from '../src/invoice';

/* The prototype's own functions (float), copied, to check we match them. */
const r2 = (n: number) => Math.round(n * 100) / 100;
type PL = { qty: number; price: number; disc: number; gst: number };
type PD = { incl: boolean; inter: boolean; gst: boolean; lines: PL[]; bdiscP?: number; bdisc?: number; tcs?: number; chTr?: number; chLab?: number; chBank?: number; roundOff: boolean };
function protoCalc(SI: PD) {
  const tm = SI.gst ? 'gst' : 'none', inter = SI.inter; let taxable = 0, taxSum = 0;
  const rows = SI.lines.map((l) => { const gross = l.qty * l.price, disc = gross * l.disc / 100, net = gross - disc; const r = tm === 'gst' ? l.gst / 100 : 0; let tx_, tv;
    if (tm !== 'gst') { tv = net; tx_ = 0; } else if (SI.incl) { tv = net / (1 + r); tx_ = net - tv; } else { tv = net; tx_ = net * r; }
    taxable += tv; taxSum += tx_; return { tv: r2(tv), tx: r2(tx_), amt: r2(tv + tx_) }; });
  const items = r2(taxable + taxSum), bd = Math.min(Math.max(SI.bdiscP ? r2(items * SI.bdiscP / 100) : (SI.bdisc || 0), 0), items);
  if (bd > 0 && items > 0) { const f = (items - bd) / items; taxable *= f; taxSum *= f; }
  let total = taxable + taxSum, tcs = 0; if (tm === 'gst' && SI.tcs) { tcs = r2(total * SI.tcs / 100); total += tcs; }
  total += (SI.chTr || 0) + (SI.chLab || 0) + (SI.chBank || 0);
  const exact = r2(total), rounded = SI.roundOff ? Math.round(exact) : exact;
  return { items, bdisc: r2(bd), rows, taxable: r2(taxable), tax: r2(taxSum), igst: inter ? r2(taxSum) : 0, tcs, round: r2(rounded - exact), total: r2(rounded) };
}
function protoPu(d: PD) {
  const tm = d.gst ? 'gst' : 'none'; let taxable = 0, tax = 0;
  const rows = d.lines.map((l) => { const q = l.qty, r = l.price, g = tm === 'gst' ? l.gst : 0, gross = q * r, disc = gross * l.disc / 100, net = gross - disc; let tv, tx;
    if (d.incl && g) { tv = net / (1 + g / 100); tx = net - tv; } else { tv = net; tx = net * g / 100; } taxable += tv; tax += tx; return { tv: r2(tv), tx: r2(tx), amt: r2(tv + tx) }; });
  taxable = r2(taxable); tax = r2(tax); const items = r2(taxable + tax), bd = Math.min(Math.max(d.bdiscP ? r2(items * d.bdiscP / 100) : (d.bdisc || 0), 0), items);
  if (bd > 0 && items > 0) { const f = (items - bd) / items; taxable = r2(taxable * f); tax = r2(tax * f); }
  const raw = taxable + tax + (d.chTr || 0) + (d.chLab || 0), total = d.roundOff === false ? r2(raw) : Math.round(raw);
  return { items, bdisc: r2(bd), rows, taxable, tax, round: r2(total - raw), total };
}

const toIn = (p: PD): DocIn => ({ mode: p.gst ? 'gst' : 'none', incl: p.incl, inter: p.inter, lines: p.lines, bdiscP: p.bdiscP, bdisc: p.bdisc, tcsRate: p.tcs, chTr: p.chTr, chLab: p.chLab, chBank: p.chBank, roundOff: p.roundOff });
// a small seeded generator, so the cases are the same on every run
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
function caseN(): PD {
  const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ qty: pick([1, 2, 3, 5, 10, 12, 25, 0.5, 1.5]), price: Math.round(rnd() * 500000) / 100, disc: pick([0, 0, 0, 2, 5, 7.5, 10]), gst: pick([0, 5, 12, 18, 28]) }));
  const disc = rnd() < 0.3;
  return { incl: rnd() < 0.6, inter: rnd() < 0.3, gst: rnd() < 0.85, lines, ...(disc ? (rnd() < 0.5 ? { bdiscP: pick([2, 5, 10]) } : { bdisc: pick([50, 99.5, 250]) }) : {}), tcs: rnd() < 0.15 ? 1 : undefined, chTr: rnd() < 0.2 ? 150 : 0, chLab: rnd() < 0.1 ? 75.5 : 0, roundOff: rnd() < 0.8 };
}
const n = (m: { toNumber(): number }) => m.toNumber();

describe('saleTotals = prototype calc()', () => {
  it('matches on 2,000 generated invoices (within a paisa where the prototype’s floats round a half the other way)', () => {
    let exact = 0;
    for (let k = 0; k < 2000; k++) {
      const p = caseN();
      const a = protoCalc(p);
      const b = saleTotals(toIn(p));
      for (const [x, y] of [[a.total, n(b.total)], [a.taxable, n(b.taxable)], [a.tax, n(b.tax)], [a.items, n(b.items)], [a.tcs, n(b.tcs)], [a.bdisc, n(b.bdisc)]] as [number, number][]) expect(Math.abs(x - y)).toBeLessThanOrEqual(0.0100001);
      if (a.total === n(b.total) && a.tax === n(b.tax)) exact++;
      // our split always adds up
      expect(b.cgst.plus(b.sgst).plus(b.igst).eq(b.tax)).toBe(true);
    }
    expect(exact).toBeGreaterThan(1960); // nearly all identical to the paisa
  });
  it('a worked example: 3 × 1,890 incl. 18% GST + 2 × 95, 5% bill discount, transport 150, round off', () => {
    const t = saleTotals({ mode: 'gst', incl: true, inter: false, lines: [{ qty: 3, price: 1890, gst: 18 }, { qty: 2, price: 95, gst: 18 }, { qty: 1, price: 0, counted: false }], bdiscP: 5, chTr: 150, roundOff: true });
    expect(t.items.toFixed(2)).toBe('5860.00');
    expect(t.bdisc.toFixed(2)).toBe('293.00');
    expect(t.taxable.toFixed(2)).toBe('4717.80');
    expect(t.tax.toFixed(2)).toBe('849.20');
    expect([t.cgst.toFixed(2), t.sgst.toFixed(2)]).toEqual(['424.60', '424.60']);
    expect(t.total.toFixed(2)).toBe('5717.00');
    expect(t.round.toFixed(2)).toBe('0.00');
    expect(t.count).toBe(2);
    expect(Object.keys(t.byRate)).toEqual(['18']);
  });
  it('other state → IGST; GST off → no tax; composition → no tax', () => {
    expect(saleTotals({ mode: 'gst', incl: false, inter: true, lines: [{ qty: 1, price: 100, gst: 18 }], roundOff: false }).igst.toFixed(2)).toBe('18.00');
    expect(saleTotals({ mode: 'none', incl: false, inter: false, lines: [{ qty: 1, price: 100, gst: 18 }], roundOff: false }).total.toFixed(2)).toBe('100.00');
    expect(saleTotals({ mode: 'bos', incl: true, inter: false, lines: [{ qty: 1, price: 100, gst: 18 }], roundOff: false }).tax.toFixed(2)).toBe('0.00');
  });
  it('a CGST/SGST split that the prototype showed a paisa off', () => {
    const t = saleTotals({ mode: 'gst', incl: false, inter: false, lines: [{ qty: 1, price: 2.5, gst: 10 }], roundOff: false });
    expect(t.tax.toFixed(2)).toBe('0.25');
    expect([t.cgst.toFixed(2), t.sgst.toFixed(2)]).toEqual(['0.13', '0.12']);
  });
  it('a bill discount never goes below zero or above the items total', () => {
    expect(saleTotals({ mode: 'none', incl: false, inter: false, lines: [{ qty: 1, price: 100 }], bdisc: 500, roundOff: false }).total.toFixed(2)).toBe('0.00');
    expect(saleTotals({ mode: 'none', incl: false, inter: false, lines: [{ qty: 1, price: 100 }], bdisc: -5, roundOff: false }).total.toFixed(2)).toBe('100.00');
  });
});

describe('purchaseTotals = prototype puCalc()', () => {
  it('matches on 2,000 generated bills', () => {
    let exact = 0;
    for (let k = 0; k < 2000; k++) {
      const p = { ...caseN(), tcs: undefined, chBank: 0 };
      const a = protoPu(p);
      const b = purchaseTotals(toIn(p));
      for (const [x, y] of [[a.total, n(b.total)], [a.taxable, n(b.taxable)], [a.tax, n(b.tax)], [a.items, n(b.items)]] as [number, number][]) expect(Math.abs(x - y)).toBeLessThanOrEqual(0.0100001);
      if (a.total === n(b.total) && a.tax === n(b.tax)) exact++;
    }
    expect(exact).toBeGreaterThan(1960);
  });
  it('rounds to the rupee unless round-off is turned off', () => {
    const d: DocIn = { mode: 'gst', incl: false, inter: false, lines: [{ qty: 3, price: 33.33, gst: 18 }], roundOff: true };
    expect(purchaseTotals(d).total.toFixed(2)).toBe('118.00');
    expect(purchaseTotals({ ...d, roundOff: false }).total.toFixed(2)).toBe('117.99');
  });
});

describe('amountInWords (prototype words())', () => {
  it('Indian style with lakh and crore', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(amountInWords(5717)).toBe('Rupees Five Thousand Seven Hundred Seventeen Only');
    expect(amountInWords(120000.5)).toBe('Rupees One Lakh Twenty Thousand and Fifty Paise Only');
    expect(amountInWords(25300000)).toBe('Rupees Two Crore Fifty Three Lakh Only');
    expect(amountInWords('11.99')).toBe('Rupees Eleven and Ninety Nine Paise Only');
  });
});

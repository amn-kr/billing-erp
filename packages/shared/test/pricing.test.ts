import { describe, expect, it } from 'vitest';
import { listPrice, roundTo, rulePrice, type PriceRuleSet, type RuleField } from '../src/pricing';

/** The prototype's own functions, copied, to check we match them exactly. */
const rnd = (v: number, r: number) => (r ? Math.round(v / r) * r : Math.round(v * 100) / 100);
const plPrice = (rule: string, val: number, round: number, i: { sale: number; purch: number }) =>
  rule === 'base' ? i.sale : rule === 'disc' ? rnd(i.sale * (1 - val / 100), round) : rnd(i.purch * (1 + val / 100), round);

describe('price lists', () => {
  it('rounds like the prototype', () => {
    expect(roundTo(1738.8, 1).toFixed(2)).toBe('1739.00');
    expect(roundTo(1738.5, 5).toFixed(2)).toBe('1740.00');
    expect(roundTo(1747.4, 10).toFixed(2)).toBe('1750.00');
    expect(roundTo(12.345, 0).toFixed(2)).toBe('12.35');
  });
  it('Wholesale (8% off, round ₹1), Contractor (5% off, round ₹5), Cost plus (12%, round ₹10)', () => {
    const wire = { sale: 1890, purchase: 1560 };
    expect(listPrice('disc', 8, 1, wire).toFixed(2)).toBe('1739.00');
    expect(listPrice('disc', 5, 5, wire).toFixed(2)).toBe('1795.00');
    expect(listPrice('mark', 12, 10, wire).toFixed(2)).toBe('1750.00');
    expect(listPrice('base', 0, 0, wire).toFixed(2)).toBe('1890.00');
    expect(listPrice('disc', 8, 1, wire, 1720).toFixed(2)).toBe('1720.00');
  });
  it('matches the prototype for a spread of prices', () => {
    for (const sale of [9.99, 95, 349.5, 1890, 12345.67])
      for (const purch of [6.2, 62, 310, 1560])
        for (const [rule, val, round] of [['disc', 8, 1], ['disc', 5, 5], ['mark', 12, 10], ['disc', 3, 0], ['mark', 7.5, 0]] as const) {
          const ours = listPrice(rule, val, round, { sale, purchase: purch }).toNumber();
          expect(ours, `${rule} ${val} ${round} ${sale}/${purch}`).toBeCloseTo(plPrice(rule, val, round, { sale, purch }), 2);
        }
  });
});

describe('brand / series rules (prototype prPrice)', () => {
  const R = (f: Partial<RuleField>, extra: Partial<PriceRuleSet> = {}): PriceRuleSet => ({ sale: { m: 'lp', v: '10', rd: '1', ...f }, ...extra }) as PriceRuleSet;
  const P = (i: { lp: number; purch: number }, r: PriceRuleSet) => { const x = rulePrice(i, 'sale', r); return x && { p: x.p.toFixed(2), floor: x.floor, fb: x.fb }; };
  it('List Price − %, rounded up to the step', () => {
    expect(P({ lp: 2162, purch: 1560 }, R({}))).toEqual({ p: '1946.00', floor: false, fb: false }); // 1945.80 → up to 1946
    expect(P({ lp: 2162, purch: 1560 }, R({ rd: '10' }))).toEqual({ p: '1950.00', floor: false, fb: false });
    expect(P({ lp: 2162, purch: 1560 }, R({ rd: '0' }))).toEqual({ p: '1945.80', floor: false, fb: false });
  });
  it('List Price + % and purchase + margin %', () => {
    expect(P({ lp: 100, purch: 60 }, R({ m: 'lpup', v: '5' }))?.p).toBe('105.00');
    expect(P({ lp: 0, purch: 62 }, R({ m: 'margin', v: '25' }))?.p).toBe('78.00'); // 77.50 → up to 78
    expect(P({ lp: 100, purch: 0 }, R({ m: 'margin', v: '25' }))).toBeNull();
  });
  it('minimum margin holds the price at purchase + floor %', () => {
    expect(P({ lp: 100, purch: 95 }, R({ v: '10' }, { floor: { on: true, v: 5 } }))).toEqual({ p: '100.00', floor: true, fb: false }); // 90 < 99.75 → 99.75 → up to 100
    expect(P({ lp: 1600, purch: 1560 }, R({ v: '10', rd: '0' }, { floor: { on: true, v: 5 } }))).toEqual({ p: '1638.00', floor: true, fb: false });
    expect(P({ lp: 100, purch: 95 }, R({ v: '10' }, { floor: { on: false, v: 5 } }))?.floor).toBe(false);
  });
  it('items without List Price: purchase + fallback %, or no price', () => {
    expect(P({ lp: 0, purch: 62 }, R({}, { noLp: { on: true, v: 20 } }))).toEqual({ p: '75.00', floor: false, fb: true }); // 74.40 → 75
    expect(P({ lp: 0, purch: 62 }, R({}, { noLp: { on: false, v: 20 } }))).toBeNull();
    expect(P({ lp: 0, purch: 0 }, R({}, { noLp: { on: true, v: 20 } }))).toBeNull();
  });
  it('“Don’t auto-price” and an empty % give no price', () => {
    expect(P({ lp: 100, purch: 60 }, R({ m: 'none' }))).toBeNull();
    expect(P({ lp: 100, purch: 60 }, R({ v: '' }))).toBeNull();
    expect(rulePrice({ lp: 100, purch: 60 }, 'pl:x', R({}))).toBeNull();
  });
});

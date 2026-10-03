import { describe, expect, it } from 'vitest';
import { listPrice, roundTo } from '../src/pricing';

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

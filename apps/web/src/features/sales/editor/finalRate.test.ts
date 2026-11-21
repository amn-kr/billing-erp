/** Final rate on a sale line (owner, 21 Nov 2026): any rate is allowed, and the sale price stays as the price list has it. */
import { describe, expect, it } from 'vitest';
import { saleSchema } from '@billing/shared';
import { blankLine, calc, finalRate, frSet, newSI, shownDisc, type Ctx, type Line } from './state';

const ctx: Ctx = { mode: 'none' as Ctx['mode'], state: '09', tcsRate: null, defaultList: null, listForGroup: {}, listName: {}, rules: {}, packOn: false };
const line = (price: number): Line => ({ ...blankLine(), name: 'LED bulb 9W', qty: 2, price });

describe('typing the final rate', () => {
  it('below the sale price: the discount is worked out', () => {
    const l = line(100);
    frSet(l, 80);
    expect(l).toMatchObject({ price: 100, disc: 20 });
    expect(finalRate(l)).toBe(80);
    expect(shownDisc(l.disc)).toBe('20');
  });

  it('above the sale price: allowed, the sale price stays, no discount is shown', () => {
    const l = line(100);
    frSet(l, 120);
    expect(l.price).toBe(100);
    expect(finalRate(l)).toBe(120);
    expect(shownDisc(l.disc)).toBe('');
    const si = { ...newSI(ctx, { no: 'INV-1', date: '2026-11-21' }), lines: [l] };
    expect(calc(ctx, si).total).toBe(240);
  });

  it('an odd rate above the sale price comes back exactly', () => {
    const l = line(33);
    frSet(l, 50.75);
    expect(l.price).toBe(33);
    expect(finalRate(l)).toBe(50.75);
  });

  it('0 is allowed (a free item), and a sale price of 0 takes the rate as it is', () => {
    const a = line(100);
    frSet(a, 0);
    expect(finalRate(a)).toBe(0);
    const b = line(0);
    frSet(b, 75);
    expect(b).toMatchObject({ price: 75, disc: 0 });
  });

  it('far above the sale price, the sale price still stays (owner, 21 Nov 2026)', () => {
    // the owner's example: sale price 48; 4800, 4801 and 5000 all keep 48
    for (const v of [4800, 4801, 5000, 99999]) {
      const l = line(48);
      frSet(l, v);
      expect(l.price).toBe(48);
      expect(finalRate(l)).toBe(v);
    }
    const t = line(1);
    frSet(t, 500);
    expect(t.price).toBe(1);
    expect(finalRate(t)).toBe(500);
  });
});

describe('the server accepts a final rate above the sale price', () => {
  const sale = (discPct: string) => saleSchema.safeParse({ date: '2026-11-21', mode: 'cash', cashName: 'Walk-in', lines: [{ name: 'LED bulb 9W', qty: '1', price: '100', discPct, gstRate: '0' }] });
  it('a minus discount of any size is fine; above 100% is not', () => {
    expect(sale('-20').success).toBe(true);
    expect(sale('20').success).toBe(true);
    expect(sale('101').success).toBe(false);
    expect(sale('-9901').success).toBe(true);
    expect(sale('-10316.66666667').success).toBe(true); // 48 sold at 5000
    expect(sale('-1e16').success).toBe(false); // past what the saved column holds
  });
});

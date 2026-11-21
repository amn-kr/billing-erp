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

  it('over 100 × the sale price, the rate becomes the price (the saved discount has a limit)', () => {
    const l = line(1);
    frSet(l, 500);
    expect(l).toMatchObject({ price: 500, disc: 0 });
  });
});

describe('the server accepts a final rate above the sale price', () => {
  const sale = (discPct: string) => saleSchema.safeParse({ date: '2026-11-21', mode: 'cash', cashName: 'Walk-in', lines: [{ name: 'LED bulb 9W', qty: '1', price: '100', discPct, gstRate: '0' }] });
  it('a minus discount is fine; above 100% or past the limit is not', () => {
    expect(sale('-20').success).toBe(true);
    expect(sale('20').success).toBe(true);
    expect(sale('101').success).toBe(false);
    expect(sale('-9901').success).toBe(false);
  });
});

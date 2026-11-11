import { describe, expect, it } from 'vitest';
import { blankLine, finalRate, frSet, type Line } from './state';

// types digits one at a time, as the Final rate box does
const typeIn = (l: Line, s: string) => { for (let k = 1; k <= s.length; k++) frSet(l, Number(s.slice(0, k))); };

describe('Final rate (frSet)', () => {
  it('takes every digit on an item with no price-list rate', () => {
    const l = { ...blankLine(), price: 0 };
    typeIn(l, '500');
    expect(finalRate(l)).toBe(500);
    expect(l).toMatchObject({ price: 500, disc: 0 });
  });
  it('gives a discount below the price-list rate', () => {
    const l = { ...blankLine(), price: 300 };
    typeIn(l, '240');
    expect(finalRate(l)).toBe(240);
    expect(l).toMatchObject({ price: 300, disc: 20 });
  });
  it('raises the sale price above the price-list rate, and goes back when lowered', () => {
    const l = { ...blankLine(), price: 300 };
    typeIn(l, '350');
    expect(l).toMatchObject({ price: 350, disc: 0, lp: 300 });
    frSet(l, 240);
    expect(l).toMatchObject({ price: 300, disc: 20 });
    expect(l.lp).toBeUndefined();
  });
  it('lets a 5 be changed to 6 on an item with no price-list rate', () => {
    const l = { ...blankLine(), price: 0 };
    frSet(l, 5); frSet(l, 6);
    expect(finalRate(l)).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';
import { formatInr0, formatInr2, formatQty, formatRupees, money, round0, round2, sum, toDb } from '../src/money';

describe('money', () => {
  it('adds without float errors', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
    expect(sum([0.1, 0.2]).equals(money('0.3'))).toBe(true);
  });
  it('rounds half up to paise and rupees', () => {
    expect(round2('2.345').toFixed(2)).toBe('2.35');
    expect(round2('2.344').toFixed(2)).toBe('2.34');
    expect(round2('-2.345').toFixed(2)).toBe('-2.35');
    expect(round0('10.5').toFixed(0)).toBe('11');
    expect(round0('10.49').toFixed(0)).toBe('10');
  });
  it('18% GST on 99.99 rounds correctly', () => {
    expect(round2(money('99.99').times('0.18')).toFixed(2)).toBe('18.00');
    expect(round2(money('1234.56').times('0.09')).toFixed(2)).toBe('111.11');
  });
  it('parses user-typed amounts', () => {
    expect(money('₹1,23,456.70').toFixed(2)).toBe('123456.70');
    expect(money('').toFixed(2)).toBe('0.00');
    expect(money(null).toFixed(2)).toBe('0.00');
  });
  it('formats for the database', () => {
    expect(toDb(5)).toBe('5.00');
    expect(toDb('1.005')).toBe('1.01');
  });
  it('formats with Indian digit grouping', () => {
    expect(formatInr0(974000)).toBe('9,74,000');
    expect(formatInr0(123)).toBe('123');
    expect(formatInr0(12345678)).toBe('1,23,45,678');
    expect(formatInr2(3950)).toBe('3,950.00');
    expect(formatInr2(-58203)).toBe('-58,203.00');
    expect(formatRupees(62930)).toBe('₹62,930');
  });
  it('matches toLocaleString en-IN used by the prototype', () => {
    for (const n of [0, 7, 999, 1000, 99999, 100000, 4130171, 987654321]) {
      expect(formatInr0(n)).toBe(Math.round(n).toLocaleString('en-IN'));
    }
  });

  it('formats quantities like the prototype (up to 2 decimals, no trailing zeros)', () => {
    expect(formatQty('7.000')).toBe('7');
    expect(formatQty('1250.500')).toBe('1,250.5');
    expect(formatQty('0.125')).toBe('0.13');
    expect(formatQty('-3')).toBe('-3');
    expect(formatQty('123456.25')).toBe('1,23,456.25');
  });
});

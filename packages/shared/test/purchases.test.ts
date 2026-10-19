import { describe, expect, it } from 'vitest';
import { billTotalTooLow, payPartsUpTo } from '../src/purchases';

describe('money paid with a purchase bill', () => {
  const parts = [{ mode: 'Cash', amount: '600.10' }, { mode: 'UPI', amount: '0.20' }, { mode: 'Cheque', amount: '500' }];
  it('fills the bill in order, in paise, without float errors', () => {
    expect(payPartsUpTo(parts, '1100.30').map((p) => [p.mode, p.amt.toFixed(2)])).toEqual([['Cash', '600.10'], ['UPI', '0.20'], ['Cheque', '500.00']]);
  });
  it('cuts the part that does not fit and drops the rest', () => {
    expect(payPartsUpTo(parts, '600.25').map((p) => [p.mode, p.amt.toFixed(2)])).toEqual([['Cash', '600.10'], ['UPI', '0.15']]);
  });
  it('an edited bill only has room for what is not already settled elsewhere', () => {
    expect(payPartsUpTo(parts, '0')).toEqual([]);
    expect(payPartsUpTo([{ amount: '0' }, { amount: '' }, { amount: '50' }], '20').map((p) => p.amt.toFixed(2))).toEqual(['20.00']);
  });
  it('a bill total below what is already paid is too low; equal is fine', () => {
    expect(billTotalTooLow('999.99', '1000')).toBe(true);
    expect(billTotalTooLow('1000.00', '1000')).toBe(false);
    expect(billTotalTooLow(0.3, '0.1')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { firstError, ownerPlanSchema, ownerSetupSchema, planEndsOn } from '../src';

describe('owner panel: a plan period’s last day (same arithmetic as the design’s addMonths)', () => {
  it('the same day n months later, minus one day', () => {
    expect(planEndsOn('2026-10-01', 1)).toBe('2026-10-31');
    expect(planEndsOn('2026-10-09', 1)).toBe('2026-11-08');
    expect(planEndsOn('2026-10-01', 3)).toBe('2026-12-31');
    expect(planEndsOn('2026-10-01', 12)).toBe('2027-09-30');
    expect(planEndsOn('2026-08-21', 12)).toBe('2027-08-20');
  });
  it('a month without that day rolls over like the design (JavaScript dates)', () => {
    const design = (s: string, n: number) => {
      const [y, m, d] = s.split('-').map(Number);
      const t = new Date(y!, m! - 1, d);
      t.setMonth(t.getMonth() + n);
      t.setDate(t.getDate() - 1);
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    };
    for (const s of ['2026-01-31', '2026-03-31', '2027-01-29', '2028-02-29', '2026-12-31', '2026-05-31'])
      for (const n of [1, 3, 6, 12]) expect(planEndsOn(s, n), `${s} + ${n}`).toBe(design(s, n));
  });
});

describe('owner panel: plan form rules', () => {
  const ok = { months: 1, startsOn: '2026-10-01', paidBy: 'UPI', amount: '1500', reference: 'UPI 4521 8890' };
  const err = (v: object) => {
    const r = ownerPlanSchema.safeParse({ ...ok, ...v });
    return r.success ? '' : firstError(r.error);
  };
  it('accepts a payment; cash needs no reference', () => {
    expect(err({})).toBe('');
    expect(err({ paidBy: 'Cash', reference: '' })).toBe('');
    expect(err({ amount: '1,500.50' })).toBe('');
  });
  it('asks for what is missing in the design’s words', () => {
    expect(err({ reference: '' })).toBe('Enter the UPI reference so you can match this payment later.');
    expect(err({ paidBy: 'Cheque', reference: ' ' })).toBe('Enter the cheque number so you can match this payment later.');
    expect(err({ paidBy: 'Bank transfer', reference: '' })).toBe('Enter the UTR number so you can match this payment later.');
    expect(err({ startsOn: '' })).toBe('Choose a start date.');
    expect(err({ startsOn: '2026-02-30' })).toBe('Choose a start date.');
    expect(err({ amount: '' })).toBe('Enter the amount received.');
    for (const amount of ['0', '-5', 'abc', '10.555']) expect(err({ amount }), amount).toBe('Enter the amount received, like 1500 or 1500.50.');
  });
  it('only the four periods and the four ways to pay', () => {
    expect(ownerPlanSchema.safeParse({ ...ok, months: 2 }).success).toBe(false);
    expect(ownerPlanSchema.safeParse({ ...ok, paidBy: 'Card' }).success).toBe(false);
  });
});

describe('owner panel: setup rules', () => {
  const ok = { code: 'c', name: 'Aman', email: 'owner@example.com', password: 'twelve chars', password2: 'twelve chars' };
  it('12-character password typed twice, not the email', () => {
    expect(ownerSetupSchema.safeParse(ok).success).toBe(true);
    expect(firstError(ownerSetupSchema.safeParse({ ...ok, password: 'eleven char', password2: 'eleven char' }).error!)).toBe('Use at least 12 characters for the password.');
    expect(firstError(ownerSetupSchema.safeParse({ ...ok, password2: 'twelve chars!' }).error!)).toBe('The two passwords don’t match.');
    expect(firstError(ownerSetupSchema.safeParse({ ...ok, email: 'owner12@example.com', password: 'Owner12@example.com', password2: 'Owner12@example.com' }).error!)).toBe('The password can’t be your email.');
  });
});

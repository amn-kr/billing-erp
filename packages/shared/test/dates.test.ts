import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, financialYearOf, formatDmy, formatLongDate, parseIso, todayIst } from '../src/dates';

describe('financial year (April–March)', () => {
  it('April starts a new year', () => {
    expect(financialYearOf('2026-04-01')).toMatchObject({ start: '2026-04-01', end: '2027-03-31', label: '2026-27', short: 'FY 26-27' });
  });
  it('March belongs to the year that started the April before', () => {
    expect(financialYearOf('2027-03-31').label).toBe('2026-27');
    expect(financialYearOf('2026-03-31').label).toBe('2025-26');
  });
  it('mid-year', () => {
    expect(financialYearOf('2026-10-01').label).toBe('2026-27');
    expect(financialYearOf('2027-01-15').start).toBe('2026-04-01');
  });
  it('century edge', () => {
    expect(financialYearOf('2099-12-31').label).toBe('2099-00');
  });
});

describe('India time', () => {
  it('uses Asia/Kolkata, not the server clock', () => {
    // 20:00 UTC on 31 Mar is already 1 Apr 01:30 in India — a new financial year.
    expect(todayIst(new Date('2027-03-31T20:00:00Z'))).toBe('2027-04-01');
    expect(todayIst(new Date('2026-10-01T08:30:00Z'))).toBe('2026-10-01');
  });
});

describe('date helpers', () => {
  it('rejects bad dates', () => {
    expect(() => parseIso('2026-02-30')).toThrow();
    expect(() => parseIso('01/10/2026')).toThrow();
  });
  it('counts and adds days', () => {
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
    expect(addDays('2026-10-01', 14)).toBe('2026-10-15');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
  it('formats like the prototype', () => {
    expect(formatLongDate('2026-10-08')).toBe('8 Oct 2026');
    expect(formatDmy('2026-10-01')).toBe('01/10/2026');
  });
});

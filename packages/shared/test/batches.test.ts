import { describe, expect, it } from 'vitest';
import { batchDateText, batchDay, batchMonth, expiryLabel, expiryState, parseBatchDate, sortBatches } from '../src';

describe('typing a batch date', () => {
  it('MM/YY: an expiry is the month’s last day, a mfg date its first', () => {
    expect(parseBatchDate('03/27', 'expiry')).toBe('2027-03-31');
    expect(parseBatchDate('03/27', 'mfg')).toBe('2027-03-01');
    expect(parseBatchDate('02/28', 'expiry')).toBe('2028-02-29');
    expect(parseBatchDate('02/27', 'expiry')).toBe('2027-02-28');
    expect(parseBatchDate('3/2027', 'expiry')).toBe('2027-03-31');
  });

  it('a full date is taken as it is', () => {
    expect(parseBatchDate('15/03/2027', 'expiry')).toBe('2027-03-15');
    expect(parseBatchDate('15-03-27', 'mfg')).toBe('2027-03-15');
    expect(parseBatchDate('2027-03-15', 'expiry')).toBe('2027-03-15');
  });

  it('blank is no date; anything else is not a date', () => {
    expect(parseBatchDate('', 'expiry')).toBeNull();
    expect(parseBatchDate('  ', 'mfg')).toBeNull();
    expect(parseBatchDate(null, 'mfg')).toBeNull();
    for (const bad of ['13/27', '00/27', '31/02/2027', '2027-13-01', 'soon', '3', '03/2']) expect(parseBatchDate(bad, 'expiry')).toBeUndefined();
  });

  it('shows dates the way they are read, and goes back into the box the same', () => {
    expect(batchMonth('2027-03-31')).toBe('Mar 2027');
    expect(batchMonth(null)).toBe('—');
    expect(batchDay('2027-03-05')).toBe('5 Mar 2027');
    expect(batchDateText('2027-03-31', 'expiry')).toBe('03/27');
    expect(batchDateText('2027-03-01', 'mfg')).toBe('03/27');
    expect(batchDateText('2027-03-15', 'expiry')).toBe('15/03/2027');
    expect(batchDateText(null, 'expiry')).toBe('');
  });
});

describe('expiry', () => {
  const ON = '2026-11-01';
  it('a batch can still be used on its last day; expired is the day after', () => {
    expect(expiryState('2026-11-01', ON)).toBe('soon');
    expect(expiryState('2026-10-31', ON)).toBe('expired');
  });

  it('soon means within 90 days; no date is never soon', () => {
    expect(expiryState('2027-01-30', ON)).toBe('soon');
    expect(expiryState('2027-01-31', ON)).toBe('ok');
    expect(expiryState(null, ON)).toBe('none');
  });

  it('the label beside a batch', () => {
    expect(expiryLabel('2026-10-31', ON)).toBe('Expired');
    expect(expiryLabel('2026-11-02', ON)).toBe('In 1 day');
    expect(expiryLabel('2026-12-01', ON)).toBe('In 30 days');
    expect(expiryLabel('2027-01-15', ON)).toBe('In 2 months');
    expect(expiryLabel('2028-01-01', ON)).toBe('');
    expect(expiryLabel(null, ON)).toBe('');
  });
});

describe('the order batches are shown and used in', () => {
  it('expired, No batch, earliest expiry, then no expiry', () => {
    const row = (id: string | null, no: string, expiry: string | null) => ({ id, no, expiry });
    const out = sortBatches([row('c', 'C', null), row('b', 'B', '2028-02-29'), row(null, 'No batch', null), row('a', 'A', '2027-03-31'), row('x', 'X', '2026-01-31')], '2026-11-01');
    expect(out.map((r) => r.no)).toEqual(['X', 'No batch', 'A', 'B', 'C']);
  });
});

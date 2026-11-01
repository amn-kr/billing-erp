import { describe, expect, it } from 'vitest';
import { allocText, batchDateText, batchDay, batchMonth, batchPrintLine, billAllocs, expiryLabel, expiryState, parseBatchDate, sortBatches } from '../src';

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

describe('which batches a sale uses', () => {
  const ON = '2026-11-01';
  const rows = { i: [
    { id: 'x', no: 'X', expiry: '2026-01-31', qty: '2.000' },
    { id: null, no: 'No batch', expiry: null, qty: '1.000' },
    { id: 'a', no: 'A', expiry: '2027-03-31', qty: '3.000' },
    { id: 'b', no: 'B', expiry: '2027-08-31', qty: '4.000' },
    { id: 'n', no: 'N', expiry: null, qty: '5.000' },
  ] };
  const one = (qty: string | number, hand?: { batchId: string | null; qty: string }[]) => billAllocs([{ itemId: 'i', qty, hand }], rows, ON)[0];

  it('No batch first, then earliest expiry, then no expiry; expired is never picked automatically', () => {
    expect(one('1')).toEqual([{ batchId: null, qty: '1.000' }]);
    expect(one('5')).toEqual([{ batchId: null, qty: '1.000' }, { batchId: 'a', qty: '3.000' }, { batchId: 'b', qty: '1.000' }]);
    expect(one('10')).toEqual([{ batchId: null, qty: '1.000' }, { batchId: 'a', qty: '3.000' }, { batchId: 'b', qty: '4.000' }, { batchId: 'n', qty: '2.000' }]);
  });

  it('more than is in stock goes to No batch, as selling beyond stock always has; expired stays out', () => {
    expect(one('15')).toEqual([{ batchId: null, qty: '3.000' }, { batchId: 'a', qty: '3.000' }, { batchId: 'b', qty: '4.000' }, { batchId: 'n', qty: '5.000' }]);
  });

  it('whether a batch is expired goes by the bill’s date, not today', () => {
    expect(billAllocs([{ itemId: 'i', qty: '1' }], { i: [{ id: 'x', no: 'X', expiry: '2026-01-31', qty: '2.000' }] }, '2026-01-31')[0]).toEqual([{ batchId: 'x', qty: '1.000' }]);
    expect(billAllocs([{ itemId: 'i', qty: '1' }], { i: [{ id: 'x', no: 'X', expiry: '2026-01-31', qty: '2.000' }] }, '2026-02-01')[0]).toEqual([{ batchId: null, qty: '1.000' }]);
  });

  it('a second line of the item takes what the first left', () => {
    const [l1, l2] = billAllocs([{ itemId: 'i', qty: '2' }, { itemId: 'i', qty: '3' }], rows, ON);
    expect(l1).toEqual([{ batchId: null, qty: '1.000' }, { batchId: 'a', qty: '1.000' }]);
    expect(l2).toEqual([{ batchId: 'a', qty: '2.000' }, { batchId: 'b', qty: '1.000' }]);
  });

  it('a hand choice is kept, and reserved before the automatic lines, even when it comes later', () => {
    const [l1, l2] = billAllocs([{ itemId: 'i', qty: '3' }, { itemId: 'i', qty: '3', hand: [{ batchId: 'a', qty: '3.000' }] }], rows, ON);
    expect(l2).toEqual([{ batchId: 'a', qty: '3.000' }]);
    expect(l1).toEqual([{ batchId: null, qty: '1.000' }, { batchId: 'b', qty: '2.000' }]);
  });

  it('a hand choice can be an expired batch', () => {
    expect(one('2', [{ batchId: 'x', qty: '2.000' }])).toEqual([{ batchId: 'x', qty: '2.000' }]);
  });

  it('the quantity going up tops up from the earliest expiry; going down trims from the end of the order', () => {
    expect(one('4', [{ batchId: 'b', qty: '2.000' }])).toEqual([{ batchId: 'b', qty: '2.000' }, { batchId: null, qty: '1.000' }, { batchId: 'a', qty: '1.000' }]);
    expect(one('1', [{ batchId: 'b', qty: '1.000' }, { batchId: 'a', qty: '2.000' }])).toEqual([{ batchId: 'a', qty: '1.000' }]);
  });

  it('items without batch rows get nothing; a quantity of 0 picks nothing; decimals stay exact', () => {
    expect(billAllocs([{ itemId: 'other', qty: '5' }], rows, ON)[0]).toBeNull();
    expect(one(0)).toEqual([]);
    expect(billAllocs([{ itemId: 'i', qty: '0.3' }, { itemId: 'i', qty: '0.3' }], { i: [{ id: 'a', no: 'A', expiry: null, qty: '0.5' }] }, ON)).toEqual([[{ batchId: 'a', qty: '0.300' }], [{ batchId: 'a', qty: '0.200' }, { batchId: null, qty: '0.100' }]]);
  });

  it('the text on the sale line and on the printed invoice', () => {
    expect(allocText([{ batchId: 'a', qty: '3.000' }, { batchId: null, qty: '1.500' }], rows.i)).toBe('A × 3, No batch × 1.5');
    expect(batchPrintLine([{ batchId: null, no: 'No batch', expiry: null, qty: '1.000' }, { batchId: 'a', no: 'A123', expiry: '2040-03-31', qty: '2.000' }])).toBe('Batch A123 × 2 (Exp 03/2040), No batch × 1');
    expect(batchPrintLine([{ batchId: null, no: 'No batch', expiry: null, qty: '1.000' }])).toBe('');
    expect(batchPrintLine([])).toBe('');
  });
});

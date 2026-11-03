import { describe, expect, it } from 'vitest';
import { batchDateShown, batchDateText, batchPrintLine, batchView, billAllocs, itemOptionsSchema, parseBatchDate, readItemOptions, sortBatches } from '../src';

describe('Settings › Items: what is stored', () => {
  it('nothing stored, or something not understood, means nothing changed', () => {
    expect(readItemOptions(null)).toEqual({ labels: {} });
    expect(readItemOptions({})).toEqual({ labels: {} });
    expect(readItemOptions({ labels: { nope: 'x' } })).toEqual({ labels: {} });
    expect(readItemOptions({ labels: {}, expFormat: 'yy/mm' })).toEqual({ labels: {} });
  });

  it('keeps labels, date formats and the default unit', () => {
    const o = { labels: { batch: 'Lot', exp: 'Best before', mfg: 'Made', mrp: 'Max price', location: 'Shelf' }, expFormat: 'mm/yy', mfgFormat: 'dd/mm/yy', defaultUnit: 'BOX' };
    expect(readItemOptions(o)).toEqual(o);
  });

  it('refuses an empty or long label and anything extra; a unit is in capitals', () => {
    expect(itemOptionsSchema.safeParse({ labels: { batch: '  ' } }).success).toBe(false);
    expect(itemOptionsSchema.safeParse({ labels: { batch: 'x'.repeat(21) } }).success).toBe(false);
    expect(itemOptionsSchema.safeParse({ labels: {}, extra: 1 }).success).toBe(false);
    expect(itemOptionsSchema.parse({ labels: {}, defaultUnit: 'box' }).defaultUnit).toBe('BOX');
  });
});

describe('Settings › Items: date formats only change how a date looks', () => {
  it('shows a saved date in each format', () => {
    expect(batchDateShown('2027-03-31')).toBe('Mar 2027');
    expect(batchDateShown('2027-03-31', 'month')).toBe('Mar 2027');
    expect(batchDateShown('2027-03-31', 'mm/yy')).toBe('03/27');
    expect(batchDateShown('2027-03-31', 'dd/mm/yy')).toBe('31/03/27');
    expect(batchDateShown(null, 'mm/yy')).toBe('—');
  });

  it('what a box shows reads back as the same date', () => {
    for (const fmt of ['month', 'mm/yy', 'dd/mm/yy'] as const) {
      for (const [d, kind] of [['2027-03-31', 'expiry'], ['2027-03-15', 'expiry'], ['2026-01-01', 'mfg'], ['2026-01-20', 'mfg']] as const) {
        expect(parseBatchDate(batchDateText(d, kind, fmt), kind)).toBe(d);
      }
    }
  });

  it('a date that isn’t a month’s end keeps its day in mm/yy too', () => {
    expect(batchDateText('2027-03-15', 'expiry', 'mm/yy')).toBe('15/03/2027');
  });

  it('typing keeps working in every format', () => {
    expect(parseBatchDate('03/27', 'expiry')).toBe('2027-03-31');
    expect(parseBatchDate('15/03/27', 'expiry')).toBe('2027-03-15');
  });
});

describe('Settings › Items: how batch screens read', () => {
  it('without changes, each screen keeps its own word', () => {
    const v = batchView(['batch_no', 'exp_date', 'mfg_date'], { labels: {} });
    expect(v.word('batch', 'Batch')).toBe('Batch');
    expect(v.word('batch', 'Batch no.')).toBe('Batch no.');
    expect(v.expText('2027-03-31')).toBe('Mar 2027');
    expect(v.expDay('2027-03-31')).toBe('31 Mar 2027');
    expect(v.hint('expiry')).toBe('MM/YY');
  });

  it('a typed word replaces all of them, and each date has its own format', () => {
    const v = batchView(['batch_no', 'exp_date'], { labels: { batch: 'Lot' }, expFormat: 'mm/yy', mfgFormat: 'dd/mm/yy' });
    expect(v.word('batch', 'Batch')).toBe('Lot');
    expect(v.word('batch', 'Batch no.')).toBe('Lot');
    expect(v.exp).toBe(true);
    expect(v.mfg).toBe(false);
    expect(v.expText('2027-03-31')).toBe('03/27');
    expect(v.mfgText('2026-01-01')).toBe('01/01/26');
    expect(v.hint('mfg')).toBe('DD/MM/YY');
  });
});

describe('the printed batch line', () => {
  const list = [{ batchId: 'a', no: 'A123', expiry: '2040-03-31', qty: '3', mrp: '120' }];
  it('reads as today with nothing changed', () => {
    expect(batchPrintLine(list, true)).toBe('Batch A123 × 3 (Exp 03/2040, MRP 120.00)');
    expect(batchPrintLine(list, true, undefined, batchView([], { labels: {} }))).toBe('Batch A123 × 3 (Exp 03/2040, MRP 120.00)');
  });
  it('takes the owner’s words and date format', () => {
    const v = batchView([], { labels: { batch: 'Lot', exp: 'Best before', mrp: 'Max price' }, expFormat: 'mm/yy' });
    expect(batchPrintLine(list, true, undefined, v)).toBe('Lot A123 × 3 (Best before 03/40, Max price 120.00)');
  });
  it('shows no date when the server sent none (Exp Date off)', () => {
    expect(batchPrintLine([{ ...list[0]!, expiry: null }], false)).toBe('Batch A123 × 3');
  });
});

describe('with Exp Date off the oldest batch is used first', () => {
  const row = (id: string | null, no: string, since: string | null, qty: string) => ({ id, no, expiry: null, qty, since });
  const rows = [row('z', 'A-younger', '2026-05-01T00:00:00Z', '5'), row('y', 'Z-older', '2026-01-01T00:00:00Z', '5'), row(null, 'No batch', null, '1')];
  it('No batch, then by when the batch came in, not by its name', () => {
    expect(sortBatches(rows, '2026-06-01').map((r) => r.no)).toEqual(['No batch', 'Z-older', 'A-younger']);
    expect(billAllocs([{ itemId: 'i', qty: '3' }], { i: rows }, '2026-06-01')[0]).toEqual([{ batchId: null, qty: '1.000' }, { batchId: 'y', qty: '2.000' }]);
  });
  it('with Exp Date on, rows have no `since` and the order is as it always was', () => {
    const on = [{ id: 'c', no: 'C', expiry: null, qty: '1' }, { id: 'b', no: 'B', expiry: '2040-01-31', qty: '1' }, { id: 'a', no: 'A', expiry: null, qty: '1' }];
    expect(sortBatches(on, '2026-06-01').map((r) => r.no)).toEqual(['B', 'A', 'C']);
  });
});

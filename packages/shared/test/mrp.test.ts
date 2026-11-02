import { describe, expect, it } from 'vitest';
import { batchPrintLine, effectiveMrp, isAboveMrp, money, ratePerUnit } from '../src';

describe('a line’s MRP', () => {
  it('the lowest MRP of the batches it uses, else the item’s; no MRP is none', () => {
    expect(effectiveMrp('100', ['120.00', '125.00'])!.toFixed(2)).toBe('120.00');
    // stock without its own MRP counts at the item's
    expect(effectiveMrp('100', [null, '125.00'])!.toFixed(2)).toBe('100.00');
    expect(effectiveMrp('150', [null, '125.00'])!.toFixed(2)).toBe('125.00');
    expect(effectiveMrp('0', [null, '125.00'])!.toFixed(2)).toBe('125.00');
    expect(effectiveMrp('100', [null, undefined])!.toFixed(2)).toBe('100.00');
    expect(effectiveMrp('100')!.toFixed(2)).toBe('100.00');
    expect(effectiveMrp('0', [])).toBeNull();
    expect(effectiveMrp(null, ['0'])).toBeNull();
  });
});

describe('above MRP', () => {
  it('compares what the customer pays per unit, to the paisa', () => {
    expect(ratePerUnit('300', '3').toFixed(2)).toBe('100.00');
    expect(ratePerUnit('100', '3').toFixed(2)).toBe('33.33');
    expect(ratePerUnit('100', '0').toFixed(2)).toBe('0.00');
    expect(isAboveMrp('100', '1', money('100'))).toBe(false);
    expect(isAboveMrp('100.01', '1', money('100'))).toBe(true);
    // 3 for 100 rounds to 33.33: not above an MRP of 33.33
    expect(isAboveMrp('100', '3', money('33.33'))).toBe(false);
    expect(isAboveMrp('106.20', '1', money('100'))).toBe(true);
    expect(isAboveMrp('1000', '1', null)).toBe(false);
  });
});

describe('the printed batch line', () => {
  it('names MRP only when asked', () => {
    const list = [{ batchId: 'a', no: 'A1', expiry: '2040-03-31', qty: '2.000', mrp: '120.00' }, { batchId: 'b', no: 'B2', expiry: null, qty: '1.000', mrp: null }];
    expect(batchPrintLine(list)).toBe('Batch A1 × 2 (Exp 03/2040), B2 × 1');
    expect(batchPrintLine(list, true)).toBe('Batch A1 × 2 (Exp 03/2040, MRP 120.00), B2 × 1');
  });
});

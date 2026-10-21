import { describe, expect, it } from 'vitest';
import { autoPurchasePrice, godownStockValue, stockByPurchaseRate, sumValues, type LedgerMove } from '../src/stock';

const mv = (date: string, kind: string, qty: string, rate: string, sourceId?: string): LedgerMove => ({ date, kind, qty, rate, sourceType: sourceId ? 'doc' : undefined, sourceId });
const value = (moves: LedgerMove[], fb = '0') => stockByPurchaseRate(moves, fb).value;

describe("owner's stock value examples", () => {
  it('example 1: 2000, 8000, 7000, 8250, 4250', () => {
    const steps = [
      mv('2026-10-01', 'opening', '100', '20'),
      mv('2026-10-02', 'purchase', '200', '30', 'b1'),
      mv('2026-10-03', 'sale', '-50', '0', 's1'),
      mv('2026-10-04', 'purchase', '50', '25', 'b2'),
      mv('2026-10-05', 'sale', '-150', '0', 's2'),
    ];
    expect(steps.map((_, i) => value(steps.slice(0, i + 1)))).toEqual(['2000.00', '8000.00', '7000.00', '8250.00', '4250.00']);
    expect(stockByPurchaseRate(steps, '0').totalQty).toBe('150.000');
  });
  it('example 2: a late bill moves the value from 5400 to 6750', () => {
    const before = [mv('2026-10-01', 'opening', '100', '20'), mv('2026-10-05', 'purchase', '200', '30', 'b1'), mv('2026-10-10', 'sale', '-120', '0', 's1')];
    expect(value(before)).toBe('5400.00');
    const after = stockByPurchaseRate([...before, mv('2026-10-02', 'purchase', '50', '25', 'late')], '0');
    expect(after.value).toBe('6750.00');
    expect(after.totalQty).toBe('230.000');
    expect(after.layers.map((l) => [l.rate, l.qty])).toEqual([['20.00', '0.000'], ['25.00', '30.000'], ['30.00', '200.000']]);
  });
});

describe('automatic purchase price', () => {
  it('the newest bill by bill date; on the same date the one entered last; else the opening rate; else null', () => {
    const at = (date: string, kind: string, qty: string, rate: string, src: string | undefined, createdAt: string): LedgerMove => ({ ...mv(date, kind, qty, rate, src), createdAt });
    expect(autoPurchasePrice([])).toBeNull();
    expect(autoPurchasePrice([mv('2026-10-01', 'opening', '5', '0')])).toBeNull();
    expect(autoPurchasePrice([mv('2026-10-01', 'opening', '5', '20')])).toBe('20.00');
    const open = mv('2026-10-01', 'opening', '5', '20');
    expect(autoPurchasePrice([open, mv('2026-10-05', 'purchase', '5', '30', 'b1'), mv('2026-10-02', 'purchase', '5', '25', 'late')])).toBe('30.00');
    expect(autoPurchasePrice([open, at('2026-10-05', 'purchase', '5', '31', 'b2', '2026-10-05T10:00:00Z'), at('2026-10-05', 'purchase', '5', '32', 'b3', '2026-10-05T09:00:00Z')])).toBe('31.00');
    // sales, adjustments and debit notes don't count
    expect(autoPurchasePrice([open, mv('2026-10-06', 'adjustment', '5', '50', 'a1'), mv('2026-10-07', 'purchase_return', '-1', '60', 'd1')])).toBe('20.00');
  });

  it('a cancelled bill leaves no trace and an edited bill counts at its new rate', () => {
    const open = mv('2026-10-01', 'opening', '5', '20');
    const bill = mv('2026-10-02', 'purchase', '5', '30', 'b1');
    const cancel = mv('2026-10-03', 'cancel', '-5', '30', 'b1');
    expect(autoPurchasePrice([open, bill, cancel])).toBe('20.00');
    const reversal = mv('2026-10-02', 'purchase', '-5', '30', 'b1');
    const edited = mv('2026-10-02', 'purchase', '5', '35', 'b1');
    expect(autoPurchasePrice([open, bill, reversal, edited])).toBe('35.00');
  });
});

describe('godown and total values', () => {
  it('a godown is its quantity at the exact average of the lots left; nothing below zero', () => {
    const t = stockByPurchaseRate([mv('2026-10-01', 'opening', '100', '20'), mv('2026-10-02', 'purchase', '200', '30', 'b1')], '0');
    expect([t.value, t.avgRate]).toEqual(['8000.00', '26.67']);
    // the whole stock in one godown shows exactly the item's value (not 300 × 26.67 = 8001)
    expect(godownStockValue('300', t)).toBe('8000.00');
    expect(godownStockValue('100', t)).toBe('2666.67');
    expect(godownStockValue('-4', t)).toBe('0.00');
    expect(godownStockValue('5', stockByPurchaseRate([], '10'))).toBe('0.00');
  });

  it('sums values in Decimal, e.g. 0.10 + 0.20 is exactly 0.30', () => {
    expect(sumValues(['0.10', '0.20'])).toBe('0.30');
    expect(sumValues([])).toBe('0.00');
    expect(sumValues(['4250.00', '6750.00', '0.00'])).toBe('11000.00');
  });

  it('decimal quantities and rates round to paise once, at the end', () => {
    const t = stockByPurchaseRate([mv('2026-10-01', 'opening', '2.5', '33.33'), mv('2026-10-02', 'purchase', '0.333', '10.01', 'b1')], '0');
    // 2.5 × 33.33 = 83.325, 0.333 × 10.01 = 3.33333 → 86.65833 → 86.66
    expect(t.value).toBe('86.66');
  });
});

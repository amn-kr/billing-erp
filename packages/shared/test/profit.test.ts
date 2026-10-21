import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { costOfGoods, costPerLine, hasPurchaseLot, stockByPurchaseRate, type LedgerMove } from '../src/stock';

const mv = (date: string, kind: string, qty: string, rate: string, sourceId?: string, against?: string[]): LedgerMove => ({ date, kind, qty, rate, sourceType: sourceId ? 'doc' : undefined, sourceId, against });
const cost = (moves: LedgerMove[], src: string) => costOfGoods(moves).get(src)?.cost ?? '0.00';
/** the owner's lots: 50 × 20, 200 × 30, 50 × 25 in date order */
const LOTS = [mv('2026-10-01', 'purchase', '50', '20', 'b1'), mv('2026-10-02', 'purchase', '200', '30', 'b2'), mv('2026-10-03', 'purchase', '50', '25', 'b3')];

describe("owner's profit example", () => {
  it('150 pcs at 40: revenue 6,000, cost 50×20 + 100×30 = 4,000, profit 2,000', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1')];
    const c = costOfGoods(moves).get('s1')!;
    expect(c).toEqual({ qty: '150.000', cost: '4000.00', noRateQty: '0.000', shortQty: '0.000' });
    expect(money('6000').minus(c.cost).toFixed(2)).toBe('2000.00');
    // the average cost per unit the bill shows
    expect(money(c.cost).div(c.qty).toDecimalPlaces(2).toFixed(2)).toBe('26.67');
    // the stock value is the same run: 100 × 30 + 50 × 25 left
    expect(stockByPurchaseRate(moves, '0').value).toBe('4250.00');
  });
  it('a second sale goes on from where the first stopped', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1'), mv('2026-10-05', 'sale', '-120', '40', 's2')];
    expect(cost(moves, 's2')).toBe('3500.00'); // 100 × 30 + 20 × 25
  });
});

describe('edit, cancel, return', () => {
  it('an edited sale counts at its new quantity', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1'), mv('2026-10-04', 'cancel', '150', '0', 's1'), mv('2026-10-04', 'sale', '-100', '40', 's1')];
    expect(cost(moves, 's1')).toBe('2500.00'); // 50 × 20 + 50 × 30
  });
  it('a cancelled sale costs nothing and leaves the lots for the next sale', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1'), mv('2026-10-04', 'cancel', '150', '0', 's1'), mv('2026-10-05', 'sale', '-60', '40', 's2')];
    expect(costOfGoods(moves).has('s1')).toBe(false);
    expect(cost(moves, 's2')).toBe('1300.00'); // 50 × 20 + 10 × 30
  });
  it('a sale return gives back the cost of the lots its invoice used (newest first)', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1'), mv('2026-10-06', 'return', '30', '40', 'c1', ['s1'])];
    expect(cost(moves, 'c1')).toBe('900.00'); // 30 × 30
    expect(cost(moves, 's1')).toBe('4000.00'); // the sale itself does not change
    const more = [...moves, mv('2026-10-07', 'return', '110', '40', 'c2', ['s1'])];
    expect(cost(more, 'c2')).toBe('2900.00'); // the other 70 × 30, then 40 × 20
  });
  it('a return beyond what was sold costs nothing back', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-10', '40', 's1'), mv('2026-10-06', 'return', '15', '40', 'c1', ['s1'])];
    expect(costOfGoods(moves).get('c1')).toEqual({ qty: '15.000', cost: '200.00', noRateQty: '5.000', shortQty: '0.000' });
  });
});

describe('late bill', () => {
  it('a backdated bill changes the lot order and so the cost of an older sale (2,600 → 2,500)', () => {
    const before = [mv('2026-10-01', 'opening', '100', '20'), mv('2026-10-05', 'purchase', '200', '30', 'b1'), mv('2026-10-10', 'sale', '-120', '40', 's1')];
    expect(cost(before, 's1')).toBe('2600.00');
    const after = [...before, mv('2026-10-02', 'purchase', '50', '25', 'late')];
    expect(cost(after, 's1')).toBe('2500.00');
  });
});

describe('no purchase entry: cost 0, no fallback', () => {
  it('opening stock without a rate costs 0 for profit, while the stock value still uses the purchase price', () => {
    const moves = [mv('2026-10-01', 'opening', '10', '0'), mv('2026-10-02', 'sale', '-4', '40', 's1')];
    expect(costOfGoods(moves).get('s1')).toEqual({ qty: '4.000', cost: '0.00', noRateQty: '4.000', shortQty: '0.000' });
    expect(stockByPurchaseRate(moves, '50').value).toBe('300.00');
    expect(hasPurchaseLot(moves)).toBe(false);
  });
  it('opening stock with a rate is a lot', () => {
    const moves = [mv('2026-10-01', 'opening', '10', '18'), mv('2026-10-02', 'sale', '-4', '40', 's1')];
    expect(cost(moves, 's1')).toBe('72.00');
    expect(hasPurchaseLot(moves)).toBe(true);
  });
  it('stock with and without a rate at the same layer rate: the part without one still costs 0', () => {
    const moves = [mv('2026-10-01', 'opening', '10', '0'), mv('2026-10-02', 'purchase', '10', '30', 'b1'), mv('2026-10-03', 'sale', '-15', '40', 's1')];
    expect(costOfGoods(moves).get('s1')).toEqual({ qty: '15.000', cost: '150.00', noRateQty: '10.000', shortQty: '0.000' });
    // stock value merged them into one 30.00 column, as before
    expect(stockByPurchaseRate(moves, '30').layers).toEqual([{ rate: '30.00', qty: '5.000', since: '2026-10-01' }]);
  });
  it('an item never bought at all', () => {
    expect(hasPurchaseLot([])).toBe(false);
    expect(costOfGoods([]).size).toBe(0);
  });
});

describe('short stock', () => {
  it('the missing part costs 0 now and the rate of the purchase that fills it later', () => {
    const now = [mv('2026-10-01', 'purchase', '50', '20', 'b1'), mv('2026-10-02', 'sale', '-80', '40', 's1')];
    expect(costOfGoods(now).get('s1')).toEqual({ qty: '80.000', cost: '1000.00', noRateQty: '0.000', shortQty: '30.000' });
    const later = [...now, mv('2026-10-05', 'purchase', '100', '30', 'b2')];
    expect(costOfGoods(later).get('s1')).toEqual({ qty: '80.000', cost: '1900.00', noRateQty: '0.000', shortQty: '0.000' });
    expect(stockByPurchaseRate(later, '0').value).toBe('2100.00'); // 70 × 30 left
  });
});

describe('cost per line', () => {
  it('the same average cost per unit on each line; the last line takes the paise left over', () => {
    const c = { qty: '150.000', cost: '4000.00', noRateQty: '0.000', shortQty: '0.000' };
    expect(costPerLine(c, ['100', '50']).map((l) => l.cost)).toEqual(['2666.67', '1333.33']);
    expect(costPerLine(c, ['150'])).toEqual([{ cost: '4000.00', shortQty: '0.000', noRate: false }]);
  });
  it('what is short goes to the later lines first', () => {
    const c = { qty: '80.000', cost: '1000.00', noRateQty: '0.000', shortQty: '30.000' };
    expect(costPerLine(c, ['60', '20']).map((l) => l.shortQty)).toEqual(['10.000', '20.000']);
  });
  it('nothing known: 0', () => {
    expect(costPerLine(undefined, ['5'])).toEqual([{ cost: '0.00', shortQty: '0.000', noRate: false }]);
  });
});

import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { costOfGoods, costRows, hasPurchaseLot, profitRows, stockByPurchaseRate, type GoodsCost, type LedgerMove } from '../src/stock';

const mv = (date: string, kind: string, qty: string, rate: string, sourceId?: string, against?: string[]): LedgerMove => ({ date, kind, qty, rate, sourceType: sourceId ? 'doc' : undefined, sourceId, against });
const cost = (moves: LedgerMove[], src: string) => costOfGoods(moves).get(src)?.cost ?? '0.00';
/** the owner's lots: 50 × 20, 200 × 30, 50 × 25 in date order */
const LOTS = [mv('2026-10-01', 'purchase', '50', '20', 'b1'), mv('2026-10-02', 'purchase', '200', '30', 'b2'), mv('2026-10-03', 'purchase', '50', '25', 'b3')];

describe("owner's profit example", () => {
  it('150 pcs at 40: revenue 6,000, cost 50×20 + 100×30 = 4,000, profit 2,000', () => {
    const moves = [...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1')];
    const c = costOfGoods(moves).get('s1')!;
    expect(c).toMatchObject({ qty: '150.000', cost: '4000.00', noRateQty: '0.000', shortQty: '0.000' });
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
    expect(costOfGoods(moves).get('c1')).toMatchObject({ qty: '15.000', cost: '200.00', noRateQty: '5.000', shortQty: '0.000' });
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
    expect(costOfGoods(moves).get('s1')).toMatchObject({ qty: '4.000', cost: '0.00', noRateQty: '4.000', shortQty: '0.000' });
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
    expect(costOfGoods(moves).get('s1')).toMatchObject({ qty: '15.000', cost: '150.00', noRateQty: '10.000', shortQty: '0.000' });
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
    expect(costOfGoods(now).get('s1')).toMatchObject({ qty: '80.000', cost: '1000.00', noRateQty: '0.000', shortQty: '30.000' });
    const later = [...now, mv('2026-10-05', 'purchase', '100', '30', 'b2')];
    expect(costOfGoods(later).get('s1')).toMatchObject({ qty: '80.000', cost: '1900.00', noRateQty: '0.000', shortQty: '0.000' });
    expect(stockByPurchaseRate(later, '0').value).toBe('2100.00'); // 70 × 30 left
  });
});

describe('rows per lot (owner, Oct 2026: one row per lot the sale used)', () => {
  const goods = (moves: LedgerMove[], src: string) => costOfGoods(moves).get(src)!;

  it("the owner's BIKE PULSAR example: 150 at 100 from the lots 100 × 35 and 50 × 30", () => {
    const c = goods([mv('2026-10-03', 'purchase', '100', '35', 'b1'), mv('2026-10-05', 'purchase', '200', '30', 'b2'), mv('2026-10-20', 'sale', '-150', '100', 's1')], 's1');
    expect(c.slices).toEqual([{ qty: '100.000', rate: '35.00', kind: 'lot' }, { qty: '50.000', rate: '30.00', kind: 'lot' }]);
    const [line] = costRows(c, ['150']);
    expect(line!.rows).toEqual([{ qty: '100.000', rate: '35.00', cost: '3500.00', kind: 'lot' }, { qty: '50.000', rate: '30.00', cost: '1500.00', kind: 'lot' }]);
    const p = profitRows([{ saleValue: '15000', rows: line!.rows }]);
    expect(p.lines[0]!.map((r) => [r.sale, r.cost, r.profit])).toEqual([['10000.00', '3500.00', '6500.00'], ['5000.00', '1500.00', '3500.00']]);
    expect([p.sale, p.cost, p.profit]).toEqual(['15000.00', '5000.00', '10000.00']);
  });
  it('two lots', () => {
    const c = goods([...LOTS, mv('2026-10-04', 'sale', '-150', '40', 's1')], 's1');
    expect(costRows(c, ['150'])[0]!.rows.map((r) => [r.qty, r.rate, r.cost])).toEqual([['50.000', '20.00', '1000.00'], ['100.000', '30.00', '3000.00']]);
  });
  it('one lot', () => {
    const c = goods([...LOTS, mv('2026-10-04', 'sale', '-30', '40', 's1')], 's1');
    expect(costRows(c, ['30'])).toEqual([{ cost: '600.00', shortQty: '0.000', noRate: false, rows: [{ qty: '30.000', rate: '20.00', cost: '600.00', kind: 'lot' }] }]);
  });
  it('lots at the same rate are one row', () => {
    const c = goods([mv('2026-10-01', 'purchase', '10', '30', 'b1'), mv('2026-10-02', 'purchase', '10', '25', 'b2'), mv('2026-10-03', 'purchase', '10', '30', 'b3'), mv('2026-10-04', 'sale', '-30', '40', 's1')], 's1');
    expect(costRows(c, ['30'])[0]!.rows.map((r) => [r.qty, r.rate])).toEqual([['20.000', '30.00'], ['10.000', '25.00']]);
  });
  it('a discount with an uneven split: the last row takes the remainder', () => {
    // 3 pcs from three lots, sale value 100.00 after a bill discount: 33.33 + 33.33 + 33.34
    const c = goods([mv('2026-10-01', 'purchase', '1', '10', 'b1'), mv('2026-10-02', 'purchase', '1', '11', 'b2'), mv('2026-10-03', 'purchase', '1', '12', 'b3'), mv('2026-10-04', 'sale', '-3', '40', 's1')], 's1');
    const p = profitRows([{ saleValue: '100.00', rows: costRows(c, ['3'])[0]!.rows }]);
    expect(p.lines[0]!.map((r) => [r.sale, r.profit])).toEqual([['33.33', '23.33'], ['33.33', '22.33'], ['33.34', '21.34']]);
    expect([p.sale, p.cost, p.profit]).toEqual(['100.00', '33.00', '67.00']);
  });
  it('short stock: a row of its own at 0, filled later at the purchase rate', () => {
    const now = [mv('2026-10-01', 'purchase', '50', '20', 'b1'), mv('2026-10-02', 'sale', '-80', '40', 's1')];
    expect(costRows(goods(now, 's1'), ['80'])).toEqual([{ cost: '1000.00', shortQty: '30.000', noRate: false, rows: [
      { qty: '50.000', rate: '20.00', cost: '1000.00', kind: 'lot' }, { qty: '30.000', rate: '0.00', cost: '0.00', kind: 'short' }] }]);
    const later = [...now, mv('2026-10-05', 'purchase', '10', '30', 'b2')];
    expect(costRows(goods(later, 's1'), ['80'])[0]!.rows.map((r) => [r.qty, r.rate, r.kind])).toEqual([['50.000', '20.00', 'lot'], ['10.000', '30.00', 'lot'], ['20.000', '0.00', 'short']]);
  });
  it('no purchase entry: a row of its own at 0', () => {
    const c = goods([mv('2026-10-01', 'opening', '10', '0'), mv('2026-10-02', 'purchase', '10', '30', 'b1'), mv('2026-10-03', 'sale', '-15', '40', 's1')], 's1');
    expect(costRows(c, ['15'])).toEqual([{ cost: '150.00', shortQty: '0.000', noRate: true, rows: [
      { qty: '10.000', rate: '0.00', cost: '0.00', kind: 'none' }, { qty: '5.000', rate: '30.00', cost: '150.00', kind: 'lot' }] }]);
  });
  it('two lines of the same item take the lots in line order', () => {
    const c = goods([...LOTS, mv('2026-10-04', 'sale', '-100', '40', 's1'), mv('2026-10-04', 'sale', '-50', '40', 's1')], 's1');
    expect(costRows(c, ['100', '50']).map((l) => [l.cost, l.rows.map((r) => `${Number(r.qty)}@${r.rate}`).join(' ')])).toEqual([['2500.00', '50@20.00 50@30.00'], ['1500.00', '50@30.00']]);
  });
  it('a service (no stock moves): one row at 0', () => {
    expect(costRows(undefined, ['2'])).toEqual([{ cost: '0.00', shortQty: '0.000', noRate: false, rows: [{ qty: '2.000', rate: '0.00', cost: '0.00', kind: 'lot' }] }]);
  });
});

describe('guard: the rows always add up exactly to the bill', () => {
  it('sale value, cost and profit of the rows = the lines = the bill, whatever the split', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let run = 0; run < 300; run++) {
      const moves: LedgerMove[] = [];
      for (let b = 0; b < 1 + rnd(5); b++) moves.push(mv(`2026-10-0${b + 1}`, b === 0 && rnd(2) ? 'opening' : 'purchase', String(1 + rnd(40)) + '.' + rnd(1000), rnd(4) ? `${1 + rnd(90)}.${rnd(100)}` : '0', `b${b}`));
      const qtys = Array.from({ length: 1 + rnd(3) }, () => `${1 + rnd(30)}.${rnd(1000)}`);
      qtys.forEach((q) => moves.push(mv('2026-10-09', 'sale', '-' + q, '50', 's1')));
      const c: GoodsCost = costOfGoods(moves).get('s1')!;
      const lines = costRows(c, qtys);
      expect(lines.reduce((a, l) => a.plus(l.cost), money(0)).toFixed(2)).toBe(c.cost);
      const sales = qtys.map(() => `${rnd(100000)}.${rnd(100)}`);
      const p = profitRows(lines.map((l, k) => ({ saleValue: sales[k]!, rows: l.rows })));
      const rows = p.lines.flat();
      const sum = (k: 'sale' | 'cost' | 'profit') => rows.reduce((a, r) => a.plus(r[k]), money(0)).toFixed(2);
      expect(sum('sale')).toBe(p.sale);
      expect(sum('cost')).toBe(p.cost);
      expect(sum('profit')).toBe(p.profit);
      expect(p.cost).toBe(c.cost);
      expect(p.sale).toBe(sales.reduce((a, v) => a.plus(v), money(0)).toFixed(2));
      p.lines.forEach((l, k) => expect(l.reduce((a, r) => a.plus(r.sale), money(0)).toFixed(2)).toBe(money(sales[k]!).toFixed(2)));
    }
  });
});

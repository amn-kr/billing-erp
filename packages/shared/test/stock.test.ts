import { describe, expect, it } from 'vitest';
import { stockByPurchaseRate, type LedgerMove } from '../src/stock';

let t = 0;
const mv = (date: string, kind: string, qty: string, rate = '0', src?: string, against?: string[]): LedgerMove => ({
  date, kind, qty, rate, createdAt: new Date(Date.UTC(2026, 0, 1) + t++ * 1000).toISOString(), sourceId: src ?? null, sourceType: 'doc', ...(against && { against }),
});
const cols = (moves: LedgerMove[], fb = '0') => stockByPurchaseRate(moves, fb).layers.map((l) => [l.rate, l.qty]);

describe('stock by purchase rate (first in, first out)', () => {
  it('several rates, oldest first, with weighted average and value in Decimal', () => {
    const r = stockByPurchaseRate([
      mv('2026-04-01', 'opening', '21', '60'),
      mv('2026-05-01', 'purchase', '40', '65', 'b1'),
      mv('2026-06-01', 'purchase', '50', '61', 'b2'),
      mv('2026-07-01', 'purchase', '100', '55', 'b3'),
    ], '21');
    expect(r.layers.map((l) => [l.rate, l.qty, l.since])).toEqual([
      ['60.00', '21.000', '2026-04-01'], ['65.00', '40.000', '2026-05-01'], ['61.00', '50.000', '2026-06-01'], ['55.00', '100.000', '2026-07-01'],
    ]);
    expect(r).toMatchObject({ hidden: 0, totalQty: '211.000', value: '12410.00', avgRate: '58.82' });
  });

  it('sales use up the oldest rate first', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '10', '50', 'b1'),
      mv('2026-04-02', 'purchase', '10', '55', 'b2'),
      mv('2026-04-03', 'sale', '-12', '80', 's1'),
    ])).toEqual([['50.00', '0.000'], ['55.00', '8.000']]);
  });

  it('sold-out rates at the start are hidden, except the newest of them', () => {
    const r = stockByPurchaseRate([
      mv('2026-04-01', 'purchase', '5', '40', 'b1'),
      mv('2026-04-02', 'purchase', '5', '45', 'b2'),
      mv('2026-04-03', 'purchase', '5', '50', 'b3'),
      mv('2026-04-04', 'purchase', '5', '52', 'b4'),
      mv('2026-04-05', 'sale', '-17', '80', 's1'),
    ], '0');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['50.00', '0.000'], ['52.00', '3.000']]);
    expect(r.hidden).toBe(2);
    expect(r.totalQty).toBe('3.000');
  });

  it('no sold-out column when the oldest rate still has stock', () => {
    expect(cols([mv('2026-04-01', 'opening', '5', '40'), mv('2026-04-02', 'sale', '-2', '80', 's1')])).toEqual([['40.00', '3.000']]);
  });

  it('a rate at zero in the middle stays visible', () => {
    // 65 is returned to the supplier in full, while 60 and 70 still have stock
    const r = stockByPurchaseRate([
      mv('2026-04-01', 'purchase', '10', '60', 'b1'),
      mv('2026-04-02', 'purchase', '8', '65', 'b2'),
      mv('2026-04-03', 'purchase', '6', '70', 'b3'),
      mv('2026-04-04', 'purchase_return', '-8', '65', 'd1', ['b2']),
    ], '0');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['60.00', '10.000'], ['65.00', '0.000'], ['70.00', '6.000']]);
    expect(r).toMatchObject({ hidden: 0, totalQty: '16.000', avgRate: '63.75' });
  });

  it('no stock at all gives no columns, but remembers the last rate', () => {
    const r = stockByPurchaseRate([mv('2026-04-01', 'purchase', '4', '30', 'b1'), mv('2026-04-02', 'purchase', '4', '35', 'b2'), mv('2026-04-03', 'sale', '-8', '50', 's1')], '0');
    expect(r).toEqual({ layers: [], hidden: 2, totalQty: '0.000', shortQty: '0.000', avgRate: '0.00', value: '0.00', lastRate: '35.00' });
    expect(stockByPurchaseRate([], '10')).toMatchObject({ layers: [], lastRate: null });
  });

  it('selling more than in stock: the next purchase fills the shortfall first', () => {
    const moves = [mv('2026-04-01', 'opening', '5', '40'), mv('2026-04-02', 'sale', '-8', '80', 's1')];
    expect(stockByPurchaseRate(moves, '0')).toMatchObject({ layers: [], shortQty: '3.000', totalQty: '0.000' });
    expect(cols([...moves, mv('2026-04-03', 'purchase', '10', '45', 'b1')])).toEqual([['40.00', '0.000'], ['45.00', '7.000']]);
  });

  it('a cancelled bill and a godown transfer leave no trace', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '10', '50', 'b1'),
      mv('2026-04-02', 'purchase', '10', '99', 'b2'),
      mv('2026-04-03', 'cancel', '-10', '0', 'b2'),
      mv('2026-04-04', 'transfer', '-4', '50', 't1'),
      mv('2026-04-04', 'transfer', '4', '50', 't1'),
    ])).toEqual([['50.00', '10.000']]);
  });

  it('an edited sale counts only for its new quantity', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '10', '50', 'b1'),
      mv('2026-04-02', 'purchase', '10', '55', 'b2'),
      mv('2026-04-03', 'sale', '-15', '80', 's1'),
      mv('2026-04-05', 'cancel', '15', '0', 's1'),
      mv('2026-04-05', 'sale', '-4', '80', 's1'),
    ])).toEqual([['50.00', '6.000'], ['55.00', '10.000']]);
  });

  it('a sale return not linked to an invoice goes back to the rate the latest sale took it from', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '10', '50', 'b1'),
      mv('2026-04-02', 'purchase', '10', '55', 'b2'),
      mv('2026-04-03', 'sale', '-15', '80', 's1'),
      mv('2026-04-04', 'return', '3', '80', 'c1'),
    ])).toEqual([['50.00', '0.000'], ['55.00', '8.000']]);
  });

  it('a rate of 0 uses the item’s purchase price; same rate in a row is one column', () => {
    expect(cols([mv('2026-04-01', 'opening', '5', '0'), mv('2026-04-02', 'purchase', '5', '21', 'b1')], '21')).toEqual([['21.00', '10.000']]);
  });

  it('decimal quantities and rates stay exact', () => {
    const r = stockByPurchaseRate([mv('2026-04-01', 'purchase', '0.1', '0.10', 'b1'), mv('2026-04-02', 'purchase', '0.2', '0.20', 'b2')], '0');
    expect(r).toMatchObject({ totalQty: '0.300', value: '0.05', avgRate: '0.17' });
  });

  /* the owner's cases 6–12 (11 Oct 2026) */
  it('6. opening stock at its price, then a purchase at another rate', () => {
    const r = stockByPurchaseRate([mv('2026-04-01', 'opening', '12', '40'), mv('2026-05-01', 'purchase', '8', '44', 'b1')], '44');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['40.00', '12.000'], ['44.00', '8.000']]);
    expect(r).toMatchObject({ totalQty: '20.000', value: '832.00', avgRate: '41.60' });
  });

  it('7. opening stock with no price counts at the item’s purchase price', () => {
    expect(cols([mv('2026-04-01', 'opening', '10', '0')], '33.50')).toEqual([['33.50', '10.000']]);
  });

  it('8. an adding adjustment at its own price, or at the purchase price without one', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '5', '50', 'b1'),
      mv('2026-04-02', 'adjustment', '3', '47', 'a1'),
      mv('2026-04-03', 'adjustment', '2', '0', 'a2'),
    ], '52')).toEqual([['50.00', '5.000'], ['47.00', '3.000'], ['52.00', '2.000']]);
  });

  it('9. a reducing adjustment takes the oldest rate first, across two rates', () => {
    const r = stockByPurchaseRate([
      mv('2026-04-01', 'purchase', '6', '50', 'b1'),
      mv('2026-04-02', 'purchase', '6', '55', 'b2'),
      mv('2026-04-03', 'purchase', '6', '58', 'b3'),
      mv('2026-04-04', 'adjustment', '-9', '50', 'a1'),
    ], '0');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['50.00', '0.000'], ['55.00', '3.000'], ['58.00', '6.000']]);
    expect(r.totalQty).toBe('9.000');
  });

  it('10. a credit note puts stock back at the rate its own invoice took it from, so a sold-out rate comes back', () => {
    const moves = [
      mv('2026-04-01', 'purchase', '10', '40', 'b1'),
      mv('2026-04-02', 'purchase', '10', '45', 'b2'),
      mv('2026-04-03', 'sale', '-10', '70', 'inv1'), // all of the 40s
      mv('2026-04-04', 'sale', '-4', '70', 'inv2'), // 4 of the 45s
    ];
    // before: 40 is sold out but is the newest sold-out rate, so it stays as a grey column
    expect(stockByPurchaseRate(moves, '0').layers.map((l) => [l.rate, l.qty])).toEqual([['40.00', '0.000'], ['45.00', '6.000']]);
    const r = stockByPurchaseRate([...moves, mv('2026-04-05', 'return', '3', '70', 'cn1', ['inv1'])], '0');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['40.00', '3.000'], ['45.00', '6.000']]);
    expect(r.totalQty).toBe('9.000');
    // more than the invoice took: the rest goes back where the latest sales took it from
    expect(cols([...moves, mv('2026-04-05', 'return', '12', '70', 'cn1', ['inv2'])])).toEqual([['40.00', '8.000'], ['45.00', '10.000']]);
    // more than was ever sold: the rest comes in at the purchase price
    expect(cols([mv('2026-04-01', 'purchase', '2', '40', 'b1'), mv('2026-04-02', 'return', '1', '70', 'cn1')], '42')).toEqual([['40.00', '2.000'], ['42.00', '1.000']]);
  });

  it('11. a debit note linked to a bill comes out of that bill’s rate; one not linked comes out oldest first', () => {
    const moves = [
      mv('2026-04-01', 'purchase', '10', '40', 'b1'),
      mv('2026-04-02', 'purchase', '10', '45', 'b2'),
      mv('2026-04-03', 'purchase', '10', '48', 'b3'),
    ];
    expect(cols([...moves, mv('2026-04-04', 'purchase_return', '-4', '45', 'd1', ['b2'])])).toEqual([['40.00', '10.000'], ['45.00', '6.000'], ['48.00', '10.000']]);
    expect(cols([...moves, mv('2026-04-04', 'purchase_return', '-4', '45', 'd1')])).toEqual([['40.00', '6.000'], ['45.00', '10.000'], ['48.00', '10.000']]);
    // the bill's lot is partly sold already: what is left of it goes first, the rest oldest first
    expect(cols([...moves, mv('2026-04-04', 'sale', '-15', '70', 'inv1'), mv('2026-04-05', 'purchase_return', '-8', '45', 'd1', ['b2'])]))
      .toEqual([['45.00', '0.000'], ['48.00', '7.000']]);
  });

  it('12. a mix in date order: opening, purchases, a sale, a credit note and an adjustment', () => {
    const r = stockByPurchaseRate([
      mv('2026-06-20', 'adjustment', '-2', '0', 'a1'), // listed out of order on purpose
      mv('2026-04-01', 'opening', '10', '30'),
      mv('2026-05-01', 'purchase', '20', '34', 'b1'),
      mv('2026-05-15', 'sale', '-18', '50', 'inv1'), // 10 at 30, 8 at 34
      mv('2026-06-01', 'purchase', '10', '36', 'b2'),
      mv('2026-06-10', 'return', '5', '50', 'cn1', ['inv1']), // back to 34
    ], '36');
    expect(r.layers.map((l) => [l.rate, l.qty])).toEqual([['30.00', '0.000'], ['34.00', '15.000'], ['36.00', '10.000']]);
    expect(r).toMatchObject({ hidden: 0, totalQty: '25.000', value: '870.00', avgRate: '34.80' });
  });

  /* reviewer's edge cases */
  it('an item with no ledger at all, or with only opening stock', () => {
    expect(stockByPurchaseRate([], '10')).toEqual({ layers: [], hidden: 0, totalQty: '0.000', shortQty: '0.000', avgRate: '0.00', value: '0.00', lastRate: null });
    expect(stockByPurchaseRate([mv('2026-04-01', 'opening', '7', '12')], '0')).toMatchObject({ totalQty: '7.000', avgRate: '12.00', value: '84.00', hidden: 0 });
  });

  it('a cancelled adjustment and a cancelled credit note leave no trace', () => {
    expect(cols([
      mv('2026-04-01', 'purchase', '10', '40', 'b1'),
      mv('2026-04-02', 'adjustment', '5', '99', 'a1'),
      mv('2026-04-03', 'cancel', '-5', '99', 'a1'),
      mv('2026-04-04', 'sale', '-3', '70', 'inv1'),
      mv('2026-04-05', 'return', '3', '70', 'cn1', ['inv1']),
      mv('2026-04-06', 'cancel', '-3', '0', 'cn1'),
    ])).toEqual([['40.00', '7.000']]);
  });

  it('very large quantities and rates stay exact', () => {
    const r = stockByPurchaseRate([mv('2026-04-01', 'purchase', '99999999999.999', '999999.99', 'b1'), mv('2026-04-02', 'sale', '-0.001', '1', 'inv1')], '0');
    expect(r).toMatchObject({ totalQty: '99999999999.998', avgRate: '999999.99', value: '99999998999998000.00' });
  });

  it('very many rates: all kept, in order', () => {
    const moves = Array.from({ length: 300 }, (_, i) => mv(`2026-04-${String(1 + (i % 28)).padStart(2, '0')}`, 'purchase', '1', String(50 + (i % 2)), `b${i}`));
    const r = stockByPurchaseRate(moves, '0');
    expect(r.totalQty).toBe('300.000');
    expect(r.layers.reduce((a, l) => a + Number(l.qty), 0)).toBe(300);
  });
});

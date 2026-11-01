import { describe, expect, it } from 'vitest';
import { autoPurchasePrice, costOfGoods, hasPurchaseLot, money, stockByBatch, stockByPurchaseRate, type LedgerMove } from '../src';
import * as frozen from './stock-frozen';

/** A repeatable random stock history: bills, opening, sales, returns, debit notes, adjustments, transfers, cancels and edits. */
function randomLedger(seed: number): LedgerMove[] {
  let s = seed;
  const r = (n: number) => { s = (s * 1664525 + 1013904223) % 4294967296; return Math.floor((s / 4294967296) * n); };
  const moves: LedgerMove[] = [];
  const docs: { id: string; kind: string; qty: string; rate: string; type: string }[] = [];
  const count = 3 + r(40);
  for (let k = 0; k < count; k++) {
    const date = `2026-${String(1 + r(9)).padStart(2, '0')}-${String(1 + r(28)).padStart(2, '0')}`;
    const at = `${date}T10:00:00.${String(k).padStart(6, '0')}Z`;
    const qty = `${1 + r(30)}${r(3) ? '' : '.5'}`;
    const rate = r(5) === 0 ? '0' : String(50 + r(5) * 25);
    const id = `doc${k}`;
    const which = r(9);
    const add = (kind: string, q: string, type: string, rt = rate, doc = id, against?: string[]) => moves.push({ date, createdAt: at, qty: q, rate: rt, kind, sourceType: type, sourceId: doc, against });
    if (which <= 1) { add('purchase', qty, 'purchase_document', rate === '0' ? '60' : rate); docs.push({ id, kind: 'purchase', qty, rate: rate === '0' ? '60' : rate, type: 'purchase_document' }); }
    else if (which === 2) moves.push({ date, createdAt: at, qty, rate, kind: 'opening', sourceType: '', sourceId: null });
    else if (which <= 4) { add('sale', `-${qty}`, 'sales_document', '99'); docs.push({ id, kind: 'sale', qty: `-${qty}`, rate: '99', type: 'sales_document' }); }
    else if (which === 5) { const inv = docs.filter((d) => d.kind === 'sale'); add('return', qty, 'sales_document', '99', id, inv.length ? [inv[r(inv.length)]!.id] : undefined); }
    else if (which === 6) { const bills = docs.filter((d) => d.kind === 'purchase'); add('purchase_return', `-${qty}`, 'purchase_document', '60', id, bills.length ? [bills[r(bills.length)]!.id] : undefined); }
    else if (which === 7) { add('adjustment', r(2) ? qty : `-${qty}`, 'stock_adjustment'); }
    else if (docs.length) {
      // cancel or edit an earlier document
      const d = docs[r(docs.length)]!;
      moves.push({ date, createdAt: at, qty: money(d.qty).neg().toFixed(3), rate: d.rate, kind: 'cancel', sourceType: d.type, sourceId: d.id });
      if (r(2)) moves.push({ date, createdAt: `${at}1`, qty: d.qty, rate: d.rate, kind: d.kind, sourceType: d.type, sourceId: d.id });
    }
  }
  return moves;
}

describe('stock without batches: the same numbers as before batches existed', () => {
  it('600 random histories match the frozen copy exactly', () => {
    let used = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const m = randomLedger(seed);
      used += m.length;
      expect(stockByPurchaseRate(m, '70'), `seed ${seed}`).toEqual(frozen.stockByPurchaseRate(m, '70'));
      expect([...costOfGoods(m)], `seed ${seed}`).toEqual([...frozen.costOfGoods(m)]);
      expect(autoPurchasePrice(m), `seed ${seed}`).toEqual(frozen.autoPurchasePrice(m));
      expect(hasPurchaseLot(m), `seed ${seed}`).toEqual(frozen.hasPurchaseLot(m));
    }
    expect(used).toBeGreaterThan(5000);
  });

  it('an empty batch label is the same as none', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = randomLedger(seed);
      expect(stockByPurchaseRate(m.map((x) => ({ ...x, batchId: null })), '70')).toEqual(frozen.stockByPurchaseRate(m, '70'));
    }
  });

  it('with batches on the moves, the item’s totals still add up', () => {
    for (let seed = 1; seed <= 300; seed++) {
      let s = seed;
      const m = randomLedger(seed).map((x) => {
        s = (s * 31 + 7) % 101;
        return { ...x, batchId: s % 3 === 0 ? null : s % 3 === 1 ? 'A' : 'B' };
      });
      const t = stockByPurchaseRate(m, '70');
      const b = stockByBatch(m, '70');
      const q = b.rows.reduce((a, r) => a.plus(r.qty), money(0));
      const v = b.rows.reduce((a, r) => a.plus(r.value), money(0));
      expect(q.toFixed(3), `seed ${seed}`).toBe(t.totalQty);
      expect(v.toFixed(2), `seed ${seed}`).toBe(t.value);
      expect(b.shortQty, `seed ${seed}`).toBe(t.shortQty);
    }
  });
});

const IN = (batchId: string | null, qty: string, rate: string, date: string, id: string): LedgerMove => ({ date, qty, rate, kind: 'purchase', sourceType: 'purchase_document', sourceId: id, batchId });
const rows = (m: LedgerMove[]) => stockByBatch(m, '0').rows.map((r) => [r.batchId, r.qty, r.value]);

describe('stock by batch', () => {
  const two = [IN('A', '10', '100', '2026-01-01', 'b1'), IN('B', '5', '120', '2026-02-01', 'b2')];

  it('each batch keeps its own quantity and rate', () => {
    expect(rows(two)).toEqual([['A', '10.000', '1000.00'], ['B', '5.000', '600.00']]);
  });

  it('going out of a named batch leaves the older batch alone', () => {
    const sale: LedgerMove = { date: '2026-03-01', qty: '-3', rate: '200', kind: 'sale', sourceType: 'sales_document', sourceId: 's1', batchId: 'B' };
    expect(rows([...two, sale])).toEqual([['A', '10.000', '1000.00'], ['B', '2.000', '240.00']]);
    // and its cost is that batch's rate, not the oldest stock's
    expect(costOfGoods([...two, sale]).get('s1')!.cost).toBe('360.00');
  });

  it('going out with no batch uses stock without a batch first, then the oldest', () => {
    const none = IN(null, '4', '90', '2026-02-15', 'b3');
    const sale: LedgerMove = { date: '2026-03-01', qty: '-6', rate: '200', kind: 'sale', sourceType: 'sales_document', sourceId: 's1' };
    expect(rows([...two, none, sale])).toEqual([['A', '8.000', '800.00'], ['B', '5.000', '600.00']]);
    expect(costOfGoods([...two, none, sale]).get('s1')!.cost).toBe('560.00');
  });

  it('asking for more than a batch holds uses that batch, then the oldest', () => {
    const sale: LedgerMove = { date: '2026-03-01', qty: '-7', rate: '200', kind: 'sale', sourceType: 'sales_document', sourceId: 's1', batchId: 'B' };
    expect(rows([...two, sale])).toEqual([['A', '8.000', '800.00']]);
  });

  it('cancelling a bill takes its batch out; an edit moving to another batch keeps both right', () => {
    const cancel: LedgerMove = { date: '2026-03-01', qty: '-5', rate: '120', kind: 'cancel', sourceType: 'purchase_document', sourceId: 'b2', batchId: 'B' };
    expect(rows([...two, cancel])).toEqual([['A', '10.000', '1000.00']]);
    const moved: LedgerMove = { date: '2026-02-01', createdAt: 'z', qty: '5', rate: '120', kind: 'purchase', sourceType: 'purchase_document', sourceId: 'b2', batchId: 'C' };
    expect(rows([...two, cancel, moved])).toEqual([['A', '10.000', '1000.00'], ['C', '5.000', '600.00']]);
  });

  it('a sale return goes back to the batch named, at the cost that sale used', () => {
    const sale: LedgerMove = { date: '2026-03-01', qty: '-3', rate: '200', kind: 'sale', sourceType: 'sales_document', sourceId: 's1', batchId: 'B' };
    const ret: LedgerMove = { date: '2026-03-02', qty: '2', rate: '200', kind: 'return', sourceType: 'sales_document', sourceId: 'c1', batchId: 'B', against: ['s1'] };
    expect(rows([...two, sale, ret])).toEqual([['A', '10.000', '1000.00'], ['B', '4.000', '480.00']]);
    expect(costOfGoods([...two, sale, ret]).get('c1')!.cost).toBe('240.00');
  });

  it('a debit note against a bill takes out of the batch it names', () => {
    const dn: LedgerMove = { date: '2026-03-01', qty: '-2', rate: '100', kind: 'purchase_return', sourceType: 'purchase_document', sourceId: 'd1', batchId: 'A', against: ['b1'] };
    expect(rows([...two, dn])).toEqual([['A', '8.000', '800.00'], ['B', '5.000', '600.00']]);
  });

  it('rounding: the values always add up to the item’s stock value', () => {
    const m = [IN('A', '0.333', '33.33', '2026-01-01', 'b1'), IN('B', '0.667', '66.67', '2026-01-02', 'b2'), IN(null, '1.111', '11.11', '2026-01-03', 'b3')];
    const v = stockByBatch(m, '0').rows.reduce((a, r) => a.plus(r.value), money(0));
    expect(v.toFixed(2)).toBe(stockByPurchaseRate(m, '0').value);
  });

  it('sold more than was bought: nothing to show, and the short quantity', () => {
    const b = stockByBatch([IN('A', '1', '10', '2026-01-01', 'b1'), { date: '2026-01-02', qty: '-3', rate: '20', kind: 'sale', sourceType: 'sales_document', sourceId: 's1' }], '0');
    expect(b.rows).toEqual([]);
    expect(b.shortQty).toBe('2.000');
  });
});

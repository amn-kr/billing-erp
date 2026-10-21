/**
 * Stock still on hand, split by the purchase rate it was bought at (first in, first out).
 *
 * Owner-approved addition, not in the prototype. The ledger is read oldest first: stock coming in
 * (opening, purchase bill, adding adjustment) starts a rate layer; stock going out (sale, reducing
 * adjustment) is used up from the oldest layer that still has some. All maths is Decimal.
 *
 * - A document whose movements cancel each other out (a cancelled bill, an edited sale, a godown
 *   transfer) counts only for what it nets to, so cancelled documents and transfers leave no trace.
 * - Opening stock or an adding adjustment without a rate counts at the item's purchase price.
 * - A sale return (credit note) puts the quantity back into the layers its invoice took it from
 *   (newest first); a return not linked to an invoice, or more than the invoice took, goes back to
 *   the layers the latest sales took it from; anything beyond that comes in at the purchase price.
 * - A purchase return (debit note) linked to a bill takes stock out of that bill's layer first;
 *   anything else (or one not linked to a bill) is taken oldest first.
 * - Selling more than is in stock leaves a shortfall; the next stock coming in fills it first.
 */
import { money, type Money, type MoneyInput } from './money.js';

export interface LedgerMove {
  /** ISO date */
  date: string;
  /** tie-break for moves on the same date */
  createdAt?: string;
  /** + in, − out */
  qty: MoneyInput;
  rate: MoneyInput;
  /** opening | purchase | sale | adjustment | transfer | return | purchase_return | cancel */
  kind: string;
  sourceType?: string;
  sourceId?: string | null;
  /** credit note: the invoices its lines return against; debit note: the bills */
  against?: string[];
}

export interface RateLayer {
  /** purchase rate, 2 decimals */
  rate: string;
  /** quantity still left at this rate, 3 decimals */
  qty: string;
  /** ISO date this rate was first bought */
  since: string;
}

export interface RateTable {
  /** columns to show, oldest rate first */
  layers: RateLayer[];
  /** older rates already sold out, left out of `layers` */
  hidden: number;
  /** total quantity left (0 when nothing is left or stock is short) */
  totalQty: string;
  /** how much more was sold than was in stock (0 normally) */
  shortQty: string;
  /** weighted average purchase rate of what is left */
  avgRate: string;
  /** what is left × its own purchase rate */
  value: string;
  /** the newest rate ever bought at, for the "no stock" message */
  lastRate: string | null;
}

interface Move { date: string; at: string; qty: Money; rate: Money; kind: string; n: number; src: string; against: string[] }

/** One document's movements, netted when they cancel each other (cancel / edit / transfer). */
function effective(moves: LedgerMove[]): Move[] {
  const out: Move[] = [];
  const groups = new Map<string, Move[]>();
  moves.forEach((m, n) => {
    const v: Move = { date: m.date, at: m.createdAt ?? '', qty: money(m.qty), rate: money(m.rate), kind: m.kind, n, src: m.sourceId ?? '', against: m.against ?? [] };
    if (v.qty.isZero()) return;
    if (!m.sourceId) { out.push(v); return; }
    const k = `${m.sourceType ?? ''}:${m.sourceId}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  });
  for (const g of groups.values()) {
    const mixed = g.some((m) => m.kind === 'cancel') || g.some((m) => m.qty.gt(0)) !== g.every((m) => m.qty.gt(0));
    if (!mixed) { out.push(...g); continue; }
    const net = g.reduce((a, m) => a.plus(m.qty), money(0));
    if (net.isZero()) continue;
    const live = g.filter((m) => m.kind !== 'cancel' && m.qty.isPositive() === net.isPositive());
    const last = [...(live.length ? live : g)].sort(order).at(-1)!;
    out.push({ ...last, qty: net });
  }
  return out.sort(order);
}

const order = (a: Move, b: Move) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at) || a.n - b.n;

/** Part of a rate layer, oldest first: `cost` is its real purchase rate, or 0 when it came in without one. */
interface Part { qty: Money; cost: Money; src: string }
interface Layer { rate: Money; qty: Money; since: string; srcs: Set<string>; parts: Part[] }
/** one piece of what a sale took: from a lot (`cost` its rate), from stock with no rate (0), or still short (0) */
interface Slice { qty: Money; cost: Money; kind: SliceKind }
interface Goods { qty: Money; cost: Money; free: Money; short: Money; slices: Slice[] }

/**
 * The one lot calculation (first in, first out) behind both the stock value and the cost of what
 * was sold. Layers carry the rate the stock value uses (the item's purchase price where the ledger
 * has none); their parts carry the cost a sale takes, which is 0 where there was no purchase rate
 * (owner's rule, Oct 2026: no fallback for profit). Same order, same quantities, so both always agree.
 */
function runLots(moves: LedgerMove[], fallbackRate: MoneyInput) {
  const fb = money(fallbackRate), zero = money(0);
  const layers: Layer[] = [];
  /** what sales took from which layer and at what cost, newest last, so a sale return can put it back */
  const sold: { i: number; qty: Money; src: string; cost: Money }[] = [];
  /** stock that went out beyond what was in, oldest first; the next stock coming in fills it */
  const short: { qty: Money; src: string; sale: boolean }[] = [];
  /** per sale or sale return: its quantity and the cost of the goods it took out or put back */
  const goods = new Map<string, Goods>();
  const g = (src: string) => {
    let x = goods.get(src);
    if (!x) goods.set(src, (x = { qty: zero, cost: zero, free: zero, short: zero, slices: [] }));
    return x;
  };
  const priced = (x: Goods, qty: Money, cost: Money) => {
    x.cost = x.cost.plus(qty.times(cost));
    if (cost.isZero()) x.free = x.free.plus(qty);
  };

  const addLayer = (rate: Money, qty: Money, since: string, src: string, cost: Money) => {
    const top = layers.at(-1);
    if (top && top.rate.eq(rate)) top.qty = top.qty.plus(qty);
    else layers.push({ rate, qty, since, srcs: new Set(), parts: [] });
    const l = layers.at(-1)!;
    if (src) l.srcs.add(src);
    l.parts.push({ qty, cost, src });
  };
  /** takes up to `want` from layer i, oldest part first (only the parts `pick` accepts) */
  const take = (i: number, want: Money, m: Move, pick?: (p: Part) => boolean) => {
    const l = layers[i]!;
    for (const p of l.parts) {
      if (want.lte(0)) break;
      if (pick && !pick(p)) continue;
      const t = want.lt(p.qty) ? want : p.qty;
      if (t.lte(0)) continue;
      p.qty = p.qty.minus(t);
      l.qty = l.qty.minus(t);
      want = want.minus(t);
      if (m.kind === 'sale') {
        sold.push({ i, qty: t, src: m.src, cost: p.cost });
        priced(g(m.src), t, p.cost);
        g(m.src).slices.push({ qty: t, cost: p.cost, kind: p.cost.isZero() ? 'none' : 'lot' });
      }
    }
    l.parts = l.parts.filter((p) => p.qty.gt(0));
    return want;
  };
  /** puts back up to `want` of what sales took (newest first), only those sales `pick` accepts */
  const putBack = (want: Money, pick: (src: string) => boolean, m: Move) => {
    for (let k = sold.length - 1; k >= 0 && want.gt(0); k--) {
      const s = sold[k]!;
      if (!pick(s.src)) continue;
      const t = want.lt(s.qty) ? want : s.qty;
      const l = layers[s.i]!;
      l.qty = l.qty.plus(t);
      l.parts.unshift({ qty: t, cost: s.cost, src: s.src });
      priced(g(m.src), t, s.cost);
      s.qty = s.qty.minus(t);
      if (s.qty.isZero()) sold.splice(k, 1);
      want = want.minus(t);
    }
    return want;
  };

  for (const m of effective(moves)) {
    if (m.kind === 'sale' || m.kind === 'return') g(m.src).qty = g(m.src).qty.plus(m.qty.abs());
    if (m.qty.gt(0)) {
      let q = m.qty;
      // real purchase rate of what comes in (a return's rate is the sale price, not a cost)
      const cost = m.kind !== 'return' && m.rate.gt(0) ? m.rate : zero;
      while (q.gt(0) && short.length) {
        const s = short[0]!;
        const t = q.lt(s.qty) ? q : s.qty;
        if (s.sale) {
          const x = g(s.src);
          x.short = x.short.minus(t);
          priced(x, t, cost);
          // the filled part becomes a slice of its own, just before what is still short
          const k = x.slices.findIndex((sl) => sl.kind === 'short');
          x.slices[k]!.qty = x.slices[k]!.qty.minus(t);
          x.slices.splice(k, x.slices[k]!.qty.isZero() ? 1 : 0, { qty: t, cost, kind: cost.isZero() ? 'none' : 'lot' });
        }
        s.qty = s.qty.minus(t);
        if (s.qty.isZero()) short.shift();
        q = q.minus(t);
      }
      if (m.kind === 'return') {
        if (m.against.length) q = putBack(q, (src) => m.against.includes(src), m);
        q = putBack(q, () => true, m);
        if (q.gt(0)) { addLayer(fb, q, m.date, m.src, zero); priced(g(m.src), q, zero); }
      } else addLayer(m.rate.gt(0) ? m.rate : fb, q, m.date, m.src, cost);
    } else {
      let q = m.qty.neg();
      if (m.kind === 'purchase_return' && m.against.length)
        for (let i = layers.length - 1; i >= 0 && q.gt(0); i--)
          if (m.against.some((b) => layers[i]!.srcs.has(b))) {
            q = take(i, q, m, (p) => m.against.includes(p.src));
            q = take(i, q, m);
          }
      for (let i = 0; i < layers.length && q.gt(0); i++) q = take(i, q, m);
      if (q.gt(0)) {
        short.push({ qty: q, src: m.src, sale: m.kind === 'sale' });
        if (m.kind === 'sale') { const x = g(m.src); x.short = x.short.plus(q); x.slices.push({ qty: q, cost: zero, kind: 'short' }); }
      }
    }
  }
  return { layers, short: short.reduce((a, s) => a.plus(s.qty), zero), goods };
}

/**
 * @param moves the item's stock ledger, all godowns, any order
 * @param fallbackRate the item's purchase price, used where the ledger has no rate
 */
export function stockByPurchaseRate(moves: LedgerMove[], fallbackRate: MoneyInput): RateTable {
  const { layers, short } = runLots(moves, fallbackRate);
  const lastRate = layers.length ? layers.at(-1)!.rate.toFixed(2) : null;
  const first = layers.findIndex((l) => l.qty.gt(0));
  if (first < 0) return { layers: [], hidden: layers.length, totalQty: '0.000', shortQty: short.toDecimalPlaces(3).toFixed(3), avgRate: '0.00', value: '0.00', lastRate };
  // sold-out rates before the first one with stock are hidden, except the newest of them
  const start = Math.max(0, first - 1);
  const shown = layers.slice(start);
  const qty = shown.reduce((a, l) => a.plus(l.qty), money(0));
  const value = shown.reduce((a, l) => a.plus(l.qty.times(l.rate)), money(0));
  return {
    layers: shown.map((l) => ({ rate: l.rate.toFixed(2), qty: l.qty.toDecimalPlaces(3).toFixed(3), since: l.since })),
    hidden: start,
    totalQty: qty.toDecimalPlaces(3).toFixed(3),
    shortQty: '0.000',
    avgRate: value.div(qty).toDecimalPlaces(2).toFixed(2),
    value: value.toDecimalPlaces(2).toFixed(2),
    lastRate,
  };
}

/** The cost of the goods one sale took out, or one sale return (credit note) put back, for one item. */
export interface GoodsCost {
  /** quantity sold or returned, 3 decimals */
  qty: string;
  /** at the purchase rate of the lots it used (oldest first), 2 decimals */
  cost: string;
  /** how much of it came from stock without a purchase entry, so it costs 0 */
  noRateQty: string;
  /** sold beyond the stock and not bought yet: costs 0 until a purchase fills it */
  shortQty: string;
  /** what it used, in the order used (a sale only): neighbouring pieces at the same rate are one */
  slices: CostSlice[];
}

/** lot = from a lot at its purchase rate; none = stock without a purchase entry (0); short = not in stock yet (0) */
export type SliceKind = 'lot' | 'none' | 'short';
export interface CostSlice { qty: string; rate: string; kind: SliceKind }

/**
 * Profit's cost side (owner's rule, Oct 2026): what each sale's goods cost, from the lots it used
 * up oldest first, and what each sale return put back at the cost of the lots its invoice used.
 * The same run as the stock value (runLots), keyed by the document id. No purchase entry = cost 0.
 */
export function costOfGoods(moves: LedgerMove[]): Map<string, GoodsCost> {
  const out = new Map<string, GoodsCost>();
  for (const [src, x] of runLots(moves, 0).goods)
    out.set(src, {
      qty: x.qty.toDecimalPlaces(3).toFixed(3), cost: x.cost.toDecimalPlaces(2).toFixed(2), noRateQty: x.free.toDecimalPlaces(3).toFixed(3), shortQty: x.short.toDecimalPlaces(3).toFixed(3),
      slices: x.slices.reduce<Slice[]>((a, sl) => {
        const top = a.at(-1);
        if (top && top.kind === sl.kind && top.cost.eq(sl.cost)) top.qty = top.qty.plus(sl.qty);
        else a.push({ ...sl });
        return a;
      }, []).map((sl) => ({ qty: sl.qty.toDecimalPlaces(3).toFixed(3), rate: sl.cost.toFixed(2), kind: sl.kind })),
    });
  return out;
}

/** True when the item ever came in with a purchase rate (a bill, opening stock or added stock with a rate). */
export const hasPurchaseLot = (moves: LedgerMove[]): boolean => effective(moves).some((m) => m.qty.gt(0) && m.kind !== 'return' && m.rate.gt(0));

/** One row of a bill's profit & loss: part of a line that used one lot rate (or no rate / short stock). */
export interface CostRow { qty: string; rate: string; cost: string; kind: SliceKind }
export interface LineCost { cost: string; shortQty: string; noRate: boolean; rows: CostRow[] }

/**
 * One document's cost for an item, over its lines of that item (owner, Oct 2026: one row per lot):
 * the lots go to the lines in order, oldest first; within a line, pieces at the same rate are one
 * row. Each row costs qty × rate; the last row takes the paise left over, so the rows always add up
 * exactly to the document's cost. A line that used no stock (a service) gets one row at 0.
 */
export function costRows(c: GoodsCost | undefined, qtys: MoneyInput[]): LineCost[] {
  const zero = money(0);
  const queue = (c?.slices ?? []).map((sl) => ({ qty: money(sl.qty), rate: sl.rate, kind: sl.kind }));
  const lines = qtys.map((v) => {
    let want = money(v).abs();
    const rows: { qty: Money; rate: string; kind: SliceKind }[] = [];
    while (want.gt(0) && queue.length) {
      const sl = queue[0]!;
      const t = want.lt(sl.qty) ? want : sl.qty;
      const same = rows.find((r) => r.kind === sl.kind && r.rate === sl.rate);
      if (same) same.qty = same.qty.plus(t);
      else rows.push({ qty: t, rate: sl.rate, kind: sl.kind });
      sl.qty = sl.qty.minus(t);
      if (sl.qty.isZero()) queue.shift();
      want = want.minus(t);
    }
    if (!rows.length) rows.push({ qty: money(v).abs(), rate: '0.00', kind: 'lot' });
    return rows.map((r) => ({ ...r, cost: r.qty.times(r.rate).toDecimalPlaces(2) }));
  });
  // the last row with a cost takes what rounding left over
  const all = lines.flat();
  const left = money(c?.cost ?? 0).minus(all.reduce((a, r) => a.plus(r.cost), zero));
  const last = [...all].reverse().find((r) => r.kind === 'lot' && !money(r.rate).isZero());
  if (last) last.cost = last.cost.plus(left);
  return lines.map((rows) => ({
    cost: rows.reduce((a, r) => a.plus(r.cost), zero).toFixed(2),
    shortQty: rows.filter((r) => r.kind === 'short').reduce((a, r) => a.plus(r.qty), zero).toDecimalPlaces(3).toFixed(3),
    noRate: rows.some((r) => r.kind === 'none'),
    rows: rows.map((r) => ({ qty: r.qty.toDecimalPlaces(3).toFixed(3), rate: r.rate, cost: r.cost.toFixed(2), kind: r.kind })),
  }));
}

/** A bill line in its profit & loss: its sale value (before GST, after discounts) and its cost rows. */
export interface ProfitLineIn { saleValue: MoneyInput; rows: CostRow[] }
export interface ProfitRow extends CostRow { sale: string; profit: string }

/**
 * The rows of a bill's profit & loss (owner, Oct 2026): each line's sale value shared over its rows
 * by quantity, the last row taking the remainder, so rows add up exactly to the line and the bill.
 */
export function profitRows(lines: ProfitLineIn[]): { lines: ProfitRow[][]; sale: string; cost: string; profit: string } {
  let tS = money(0), tC = money(0);
  const out = lines.map((l) => {
    const total = money(l.saleValue);
    const qty = l.rows.reduce((a, r) => a.plus(r.qty), money(0));
    let left = total;
    return l.rows.map((r, k) => {
      const sale = k === l.rows.length - 1 ? left : qty.isZero() ? money(0) : total.times(r.qty).div(qty).toDecimalPlaces(2);
      left = left.minus(sale);
      tS = tS.plus(sale); tC = tC.plus(r.cost);
      return { ...r, sale: sale.toFixed(2), profit: sale.minus(r.cost).toFixed(2) };
    });
  });
  return { lines: out, sale: tS.toFixed(2), cost: tC.toFixed(2), profit: tS.minus(tC).toFixed(2) };
}

/**
 * The item's purchase price, worked out from its ledger (owner's rule, Oct 2026): the rate of the
 * newest purchase bill by bill date (on the same date, the one entered last); with no purchase, the
 * opening stock's rate; null when neither has a rate. Cancelled bills leave no trace and an edited
 * bill counts at its new rate (the same netting as stockByPurchaseRate).
 */
export function autoPurchasePrice(moves: LedgerMove[]): string | null {
  const eff = effective(moves).filter((m) => m.qty.gt(0) && m.rate.gt(0));
  const last = eff.filter((m) => m.kind === 'purchase').at(-1) ?? eff.filter((m) => m.kind === 'opening').at(-1);
  return last ? last.rate.toFixed(2) : null;
}

/**
 * Stock value of one godown's share of an item: its quantity there (nothing below zero) at the
 * average rate of what is left of the item — the exact average (value ÷ quantity, not the rounded
 * "Avg rate" shown), so one godown holding all the stock shows exactly the item's value. 2 decimals.
 */
export function godownStockValue(qty: MoneyInput, t: Pick<RateTable, 'value' | 'totalQty'>): string {
  const q = money(qty), all = money(t.totalQty);
  if (q.lte(0) || all.lte(0)) return '0.00';
  return q.times(money(t.value)).div(all).toDecimalPlaces(2).toFixed(2);
}

/** Sum of stock values (2 decimals each), e.g. a brand's or a parent item's variants. */
export const sumValues = (values: MoneyInput[]): string => values.reduce<Money>((a, v) => a.plus(money(v)), money(0)).toDecimalPlaces(2).toFixed(2);

/* ───────── editing a saved adjustment or transfer (the editor's "in stock" figures) ───────── */

/**
 * An item's stock in one place while a saved adjustment is edited: what is there now without the
 * adjustment's own quantity (signed: + added, − reduced), when it is for that item.
 */
export function stockBeforeAdjustment(now: MoneyInput, saved: { itemId: string; qty: MoneyInput } | null, itemId: string): Money {
  return saved && saved.itemId === itemId ? money(now).minus(money(saved.qty)) : money(now);
}

/** Stock after adding or reducing a quantity. */
export const stockAfterAdjustment = (base: MoneyInput, mode: 'add' | 'reduce', qty: MoneyInput): Money => (mode === 'add' ? money(base).plus(money(qty)) : money(base).minus(money(qty)));

/**
 * What can be moved out of a godown while a saved transfer is edited: what is there now, plus what
 * that transfer took out of it, less what it brought in (both are given back when it is saved).
 */
export function availableForTransfer(now: MoneyInput, saved: { itemId: string; fromId: string; toId: string; qty: MoneyInput } | null, itemId: string, fromId: string): Money {
  let v = money(now);
  if (saved && saved.itemId === itemId) {
    if (saved.fromId === fromId) v = v.plus(money(saved.qty));
    if (saved.toId === fromId) v = v.minus(money(saved.qty));
  }
  return v;
}

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

/**
 * @param moves the item's stock ledger, all godowns, any order
 * @param fallbackRate the item's purchase price, used where the ledger has no rate
 */
export function stockByPurchaseRate(moves: LedgerMove[], fallbackRate: MoneyInput): RateTable {
  const fb = money(fallbackRate);
  const layers: { rate: Money; qty: Money; since: string; srcs: Set<string> }[] = [];
  /** what sales took from which layer, newest last, so a sale return can put it back */
  const sold: { i: number; qty: Money; src: string }[] = [];
  let short = money(0);

  const addLayer = (rate: Money, qty: Money, since: string, src: string) => {
    const top = layers.at(-1);
    if (top && top.rate.eq(rate)) top.qty = top.qty.plus(qty);
    else layers.push({ rate, qty, since, srcs: new Set() });
    if (src) layers.at(-1)!.srcs.add(src);
  };
  const take = (i: number, want: Money, m: Move) => {
    const l = layers[i]!;
    const t = want.lt(l.qty) ? want : l.qty;
    if (t.lte(0)) return want;
    l.qty = l.qty.minus(t);
    if (m.kind === 'sale') sold.push({ i, qty: t, src: m.src });
    return want.minus(t);
  };
  /** puts back up to `want` of what sales took (newest first), only those sales `pick` accepts */
  const putBack = (want: Money, pick: (src: string) => boolean) => {
    for (let k = sold.length - 1; k >= 0 && want.gt(0); k--) {
      const s = sold[k]!;
      if (!pick(s.src)) continue;
      const t = want.lt(s.qty) ? want : s.qty;
      layers[s.i]!.qty = layers[s.i]!.qty.plus(t);
      s.qty = s.qty.minus(t);
      if (s.qty.isZero()) sold.splice(k, 1);
      want = want.minus(t);
    }
    return want;
  };

  for (const m of effective(moves)) {
    if (m.qty.gt(0)) {
      let q = m.qty;
      const fill = q.lt(short) ? q : short;
      short = short.minus(fill);
      q = q.minus(fill);
      if (m.kind === 'return') {
        if (m.against.length) q = putBack(q, (src) => m.against.includes(src));
        q = putBack(q, () => true);
        if (q.gt(0)) addLayer(fb, q, m.date, m.src);
      } else addLayer(m.rate.gt(0) ? m.rate : fb, q, m.date, m.src);
    } else {
      let q = m.qty.neg();
      if (m.kind === 'purchase_return' && m.against.length)
        for (let i = layers.length - 1; i >= 0 && q.gt(0); i--) if (m.against.some((b) => layers[i]!.srcs.has(b))) q = take(i, q, m);
      for (let i = 0; i < layers.length && q.gt(0); i++) q = take(i, q, m);
      short = short.plus(q);
    }
  }

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

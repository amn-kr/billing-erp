/**
 * Batch and expiry (Features › batch_expiry, owner's request, 1 Nov 2026). A batch is a label on an
 * item's stock: the stock itself stays in the one lot calculation (stock.ts). Stock without a label
 * is "No batch". Dates are ISO; shops mostly type them as printed on the pack, MM/YY.
 */
import { daysBetween } from './dates.js';
import { formatQty, money, type Money, type MoneyInput } from './money.js';

export type BatchDateKind = 'mfg' | 'expiry';
/** expiring within this many days shows as "soon" */
export const EXPIRY_SOON_DAYS = 90;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const year = (t: string) => (t.length === 2 ? 2000 + Number(t) : Number(t));
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m) ? `${y}-${pad(m)}-${pad(d)}` : undefined);

/**
 * What was typed, as an ISO date: 03/27 or 03/2027 (an expiry is the month's last day, a mfg date its
 * first), 15/03/2027, or 2027-03-15. '' stays null (no date); anything else is undefined (not a date).
 */
export function parseBatchDate(text: string | null | undefined, kind: BatchDateKind): string | null | undefined {
  const t = (text ?? '').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(t);
  if (m) return iso(year(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = year(m[2]!), mo = Number(m[1]);
    if (mo < 1 || mo > 12) return undefined;
    return iso(y, mo, kind === 'expiry' ? lastDay(y, mo) : 1);
  }
  return undefined;
}

/** "Mar 2027", or "—" with no date. */
export const batchMonth = (d: string | null | undefined): string => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '—');
/** "31 Mar 2027". */
export const batchDay = (d: string): string => `${Number(d.slice(8, 10))} ${batchMonth(d)}`;
/** A saved date in the box: as MM/YY when typing MM/YY gives the same date back, else in full. */
export function batchDateText(d: string | null | undefined, kind: BatchDateKind): string {
  if (!d) return '';
  const short = `${d.slice(5, 7)}/${d.slice(2, 4)}`;
  return parseBatchDate(short, kind) === d ? short : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';
/** Compared with a day (a bill's date, or today): a batch can still be used on its last day. */
export function expiryState(expiry: string | null | undefined, on: string): ExpiryState {
  if (!expiry) return 'none';
  const left = daysBetween(on, expiry);
  return left < 0 ? 'expired' : left <= EXPIRY_SOON_DAYS ? 'soon' : 'ok';
}
/** The label beside a batch: "Expired", "In 30 days", "In 3 months", or '' when not close. */
export function expiryLabel(expiry: string | null | undefined, on: string): string {
  const st = expiryState(expiry, on);
  if (st === 'expired') return 'Expired';
  if (st !== 'soon') return '';
  const left = daysBetween(on, expiry!);
  return left < 60 ? `In ${left} day${left === 1 ? '' : 's'}` : `In ${Math.floor(left / 30)} months`;
}

/** Item Batch Report's filters: expired, or expiring within so many days (a batch still good today, up to that day). */
export type ExpiryFilter = 'all' | 'expired' | 30 | 60 | 90;
export function matchesExpiry(expiry: string | null | undefined, on: string, f: ExpiryFilter): boolean {
  if (f === 'all') return true;
  if (!expiry) return false;
  const left = daysBetween(on, expiry);
  return f === 'expired' ? left < 0 : left >= 0 && left <= f;
}

/** One row of an item's stock by batch. `id` null is the stock without a batch. */
export interface BatchRow { id: string | null; no: string; mfg: string | null; expiry: string | null; qty: string; rate: string; value: string }

/**
 * The order batches are shown and used in (owner, 1 Nov 2026): expired ones first so they are seen, then
 * No batch (the oldest stock, so it clears first), then earliest expiry, then those with no expiry.
 */
export function sortBatches<T extends { id: string | null; no: string; expiry: string | null }>(rows: readonly T[], on: string): T[] {
  const rank = (r: T) => (r.expiry && expiryState(r.expiry, on) === 'expired' ? 0 : r.id === null ? 1 : r.expiry ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.expiry ?? '').localeCompare(b.expiry ?? '') || a.no.localeCompare(b.no));
}

/* ───────── which batches a sale uses ───────── */

/** Part of a line taken from one batch. batchId null = stock without a batch, or more than is in stock. */
export interface BatchAlloc { batchId: string | null; qty: string }
export type PickRow = Pick<BatchRow, 'id' | 'no' | 'expiry' | 'qty'>;
export interface BillLine { itemId: string; qty: MoneyInput; /** chosen by hand, or saved on the bill */ hand?: readonly BatchAlloc[] | null }

const keyOf = (item: string, batch: string | null) => `${item}|${batch ?? ''}`;
const q3 = (v: Money) => v.toDecimalPlaces(3).toFixed(3);
const merged = (list: { batchId: string | null; qty: Money }[]): BatchAlloc[] => {
  const by = new Map<string | null, Money>();
  for (const a of list) by.set(a.batchId, (by.get(a.batchId) ?? money(0)).plus(a.qty));
  return [...by].filter(([, q]) => q.gt(0)).map(([batchId, q]) => ({ batchId, qty: q3(q) }));
};

/**
 * The batches a bill's lines use (owner, 1 Nov 2026): lines chosen by hand first, then the others in
 * order, each taking what is left. Automatic picking goes in the shown order (sortBatches), never uses
 * an expired batch, and anything beyond the stock goes to No batch, as selling more than is in stock
 * always has. A hand choice that no longer matches its quantity is topped up the same way, or trimmed
 * from the end of the order. `on` is the bill's date. Lines of items not in `rows` get null.
 */
export function billAllocs(lines: readonly BillLine[], rows: Readonly<Record<string, readonly PickRow[] | undefined>>, on: string): (BatchAlloc[] | null)[] {
  const taken = new Map<string, Money>();
  const reserve = (item: string, batch: string | null, q: Money) => taken.set(keyOf(item, batch), (taken.get(keyOf(item, batch)) ?? money(0)).plus(q));
  const auto = (item: string, want: Money): { batchId: string | null; qty: Money }[] => {
    const out: { batchId: string | null; qty: Money }[] = [];
    let left = want;
    for (const r of sortBatches(rows[item] ?? [], on)) {
      if (left.lte(0)) break;
      if (expiryState(r.expiry, on) === 'expired') continue;
      const have = money(r.qty).minus(taken.get(keyOf(item, r.id)) ?? 0);
      if (have.lte(0)) continue;
      const t = have.lt(left) ? have : left;
      out.push({ batchId: r.id, qty: t });
      reserve(item, r.id, t);
      left = left.minus(t);
    }
    if (left.gt(0)) { out.push({ batchId: null, qty: left }); reserve(item, null, left); }
    return out;
  };
  const out: (BatchAlloc[] | null)[] = lines.map(() => null);
  const need = lines.map((l) => (money(l.qty).gt(0) ? money(l.qty) : money(0)));
  // what was chosen by hand is reserved before anything is picked automatically
  const kept = lines.map((l, k) => {
    if (!rows[l.itemId] || !l.hand?.length) return null;
    const order = [...l.hand].sort((a, b) => {
      const list = sortBatches(rows[l.itemId]!, on), at = (id: string | null) => list.findIndex((r) => r.id === id);
      return at(a.batchId) - at(b.batchId);
    });
    let left = need[k]!;
    const keep: { batchId: string | null; qty: Money }[] = [];
    for (const a of order) {
      if (left.lte(0)) break;
      const t = money(a.qty).lt(left) ? money(a.qty) : left;
      keep.push({ batchId: a.batchId, qty: t });
      reserve(l.itemId, a.batchId, t);
      left = left.minus(t);
    }
    return { keep, left };
  });
  lines.forEach((l, k) => {
    if (!rows[l.itemId]) return;
    const h = kept[k];
    out[k] = merged(h ? [...h.keep, ...(h.left.gt(0) ? auto(l.itemId, h.left) : [])] : auto(l.itemId, need[k]!));
  });
  return out;
}

/** "A123 × 3, No batch × 1", for the sale line. */
export function allocText(allocs: readonly BatchAlloc[], rows: readonly Pick<PickRow, 'id' | 'no'>[]): string {
  return allocs.map((a) => `${a.batchId ? rows.find((r) => r.id === a.batchId)?.no ?? '—' : 'No batch'} × ${formatQty(a.qty)}`).join(', ');
}

/** "Batch A123 × 3 (Exp 03/2040), No batch × 1", for the printed invoice; nothing when no batch is named. */
export function batchPrintLine(list: readonly { batchId: string | null; no: string; expiry: string | null; qty: MoneyInput }[]): string {
  const named = list.filter((b) => b.batchId), none = list.filter((b) => !b.batchId);
  if (!named.length) return '';
  const text = (b: (typeof list)[number]) => `${b.no} × ${formatQty(b.qty)}${b.expiry ? ` (Exp ${b.expiry.slice(5, 7)}/${b.expiry.slice(0, 4)})` : ''}`;
  return `Batch ${[...named, ...none].map(text).join(', ')}`;
}

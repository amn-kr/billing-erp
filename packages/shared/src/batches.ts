/**
 * Batch and expiry (Features › batch_expiry, owner's request, 1 Nov 2026). A batch is a label on an
 * item's stock: the stock itself stays in the one lot calculation (stock.ts). Stock without a label
 * is "No batch". Dates are ISO; shops mostly type them as printed on the pack, MM/YY.
 */
import { daysBetween } from './dates.js';

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

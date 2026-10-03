/**
 * Dates. The business runs on Asia/Kolkata time; the financial year runs
 * 1 April to 31 March. Dates are ISO strings (YYYY-MM-DD).
 */
export const BUSINESS_TZ = 'Asia/Kolkata';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in India, whatever the server's own timezone. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseIso(d: string): { y: number; m: number; d: number } {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Not an ISO date: ${d}`);
  const y = +m[1]!, mo = +m[2]!, day = +m[3]!;
  const check = new Date(Date.UTC(y, mo - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) throw new Error(`Not a real date: ${d}`);
  return { y, m: mo, d: day };
}

export interface FinancialYear {
  /** First day, e.g. 2026-04-01 */
  start: string;
  /** Last day, e.g. 2027-03-31 */
  end: string;
  /** e.g. "2026-27" — used in document series */
  label: string;
  /** e.g. "FY 26-27" — as shown in the prototype's period pickers */
  short: string;
  startYear: number;
}

/** The financial year (April–March) that contains the given ISO date. */
export function financialYearOf(date: string): FinancialYear {
  const { y, m } = parseIso(date);
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    start: `${startYear}-04-01`,
    end: `${endYear}-03-31`,
    label: `${startYear}-${String(endYear).slice(2)}`,
    short: `FY ${String(startYear).slice(2)}-${String(endYear).slice(2)}`,
    startYear,
  };
}

/** Whole days from `from` until `to` (both ISO dates); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = parseIso(from), b = parseIso(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-10-08" -> "8 Oct 2026" (en-IN, as the prototype prints dates in sentences). */
export function formatLongDate(date: string): string {
  const { y, m, d } = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-10-01" -> "01/10/2026" (prototype table dates). */
export function formatDmy(date: string): string {
  const { y, m, d } = parseIso(date);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

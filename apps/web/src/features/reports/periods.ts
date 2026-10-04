/** Report periods (prototype DT / PS_PER / psRange), from today in India time. Financial year: April–March. */
import { today } from '../../lib/time';

const iso = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m, d));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

export function dt(t = today()) {
  const [y, mm] = t.split('-').map(Number) as [number, number];
  const m = mm - 1, q = Math.floor(m / 3) * 3, fy = m >= 3 ? y : y - 1;
  return {
    mS: iso(y, m, 1), mE: iso(y, m + 1, 0), lS: iso(y, m - 1, 1), lE: iso(y, m, 0), qS: iso(y, q, 1), qE: iso(y, q + 3, 0),
    fyS: `${fy}-04-01`, fyE: `${fy + 1}-03-31`, fyL: `This year (FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)})`,
    monName: new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }),
  };
}

export type Per = 'month' | 'last' | 'qtr' | 'fy' | 'all' | 'custom';
export function perOpts(): [Per, string, string, string][] {
  const D = dt();
  return [['month', 'This month', D.mS, D.mE], ['last', 'Last month', D.lS, D.lE], ['qtr', 'This quarter', D.qS, D.qE], ['fy', D.fyL, D.fyS, D.fyE], ['all', 'All time', '2000-01-01', '2099-12-31'], ['custom', 'Custom', '', '']];
}

export interface PeriodState { per: Per; from: string; to: string }
/** [from, to] as ISO dates; a custom range left open runs from 2000 to 2099. */
export function range(p: PeriodState): [string, string] {
  if (p.per === 'custom') return [p.from || '2000-01-01', p.to || '2099-12-31'];
  const r = perOpts().find((o) => o[0] === p.per)!;
  return [r[2], r[3]];
}
export const dmyOf = (isoDate: string) => isoDate.split('-').reverse().join('/');
/** "01/04/2026 to 31/03/2027", with "Start" / "Today" for an open range (prototype rpRangeTxt). */
export const rangeTxt = (p: PeriodState) => { const [f, t] = range(p); return `${dmyOf(f).replace('01/01/2000', 'Start')} to ${dmyOf(t).replace('31/12/2099', 'Today')}`; };
/** Choosing "Custom" starts from this financial year to today (prototype RPF). */
export function choosePer(per: Per): PeriodState {
  const D = dt();
  return { per, from: D.fyS, to: today() };
}

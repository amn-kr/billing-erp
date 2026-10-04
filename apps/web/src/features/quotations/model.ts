/**
 * Brand-wise quotation maths (prototype qItem / qRate / qTotals / qComm): each cell's rate is the
 * matching item's price on the chosen rate list, with the electrician's commission loaded when a
 * referral is set. Totals use the shared Decimal helpers.
 */
import { money, qGrp, qSeries, type CommRule, type QuoteGrid, type QuoteRow, type QuoteSeries } from '@billing/shared';
import type { EItem } from '../sales/editor/state';

export interface QDraft {
  /** saved quotation (null = not saved yet) */
  id: string | null; no: string; cust: string; disc: number; pl: string; sel: string[]; qty: Record<string, number>; ref: string;
  status: 'draft' | 'open' | 'converted'; inv: string; brand: string;
}
export interface QList { id: string; name: string; isDefault: boolean }
export interface QCtx { IT: EItem[]; pl: QList; ref: string; rules: Record<string, CommRule> }

const r2 = (n: number) => Math.round(n * 100) / 100;
export const qItem = (c: QCtx, row: QuoteRow, s: QuoteSeries) => c.IT.find((i) => i.grp === qGrp(row) && i.brand === s.b && (i.series || '') === qSeries(s));
/** commission loaded on a rate (prototype cmLoadPrice, rule by item category) */
export function cmLoad(c: QCtx, it: EItem, v: number) {
  if (!c.ref) return v;
  const r = c.rules[it.cat] ?? { t: 'n', v: 0 };
  return r.t === 'p' && r.v > 0 ? r2(v * (1 + r.v / 100)) : r.t === 'f' && r.v > 0 ? r2(v + r.v) : v;
}
export function qRate(c: QCtx, row: QuoteRow, s: QuoteSeries): { v: number | null; it?: EItem; base?: number } {
  const it = qItem(c, row, s);
  if (!it) return { v: null };
  const v = c.pl.isDefault ? it.sale : it.pl[c.pl.id] ?? it.sale;
  if (c.ref) return { v: cmLoad(c, it, v), it, base: v };
  return { v, it };
}
export const qCols = (g: QuoteGrid, d: QDraft) => g.ser.filter((s) => d.sel.includes(s.id));

export interface QTotal { s: QuoteSeries; acc: number; plate: number; sub: number; dis: number; total: number; miss: number }
export function qTotals(c: QCtx, g: QuoteGrid, d: QDraft): QTotal[] {
  return qCols(g, d).map((s) => {
    let acc = money(0), plate = money(0), miss = 0;
    for (const row of g.rows) {
      const q = d.qty[row.id] || 0;
      if (!q) continue;
      const v = qRate(c, row, s).v;
      if (v === null) { miss++; continue; }
      if (row.c === 'plate') plate = plate.plus(money(v).times(q)); else acc = acc.plus(money(v).times(q));
    }
    const sub = acc.plus(plate), dis = sub.times(d.disc || 0).div(100);
    return { s, acc: acc.toNumber(), plate: plate.toNumber(), sub: sub.toNumber(), dis: dis.toNumber(), total: sub.minus(dis).toNumber(), miss };
  });
}
/** commission in a brand's total (prototype qComm) */
export function qComm(c: QCtx, g: QuoteGrid, d: QDraft, s: QuoteSeries) {
  let t = money(0);
  for (const row of g.rows) {
    const q = d.qty[row.id] || 0;
    if (!q) continue;
    const o = qRate(c, row, s);
    if (o.base !== undefined && o.v !== null) t = t.plus(money(o.v - o.base).times(q));
  }
  return r2(t.times(1 - (d.disc || 0) / 100).toNumber());
}
/** brand options best first: all items available, then cheapest (prototype openConvert / iqBrandOpts) */
export const qRanked = (T: QTotal[]) => [...T].sort((a, b) => a.miss - b.miss || a.total - b.total);

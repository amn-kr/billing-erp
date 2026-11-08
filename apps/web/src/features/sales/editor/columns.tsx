/**
 * The columns of the sale and purchase item grids, in order, and their widths.
 *
 * Brand and Series (Settings › Items), HSN (GST on) and the two Tax columns (GST bill)
 * can be switched off. The heading, rapid entry, item and Total rows must all have the
 * same cells, so the Total row is built from this list.
 *
 * When a column is off, its width is shared out over the other columns in proportion
 * to their own widths (owner's choice "A", 7 Nov 2026), so no gap is left and the Item
 * column doesn't take all of it. With every column on, no widths are set here at all:
 * the prototype's CSS (styles/app.css) decides, so the screen looks the same as before.
 */
import { Fragment, type ReactNode } from 'react';

export type ColKey = 'c' | 'it' | 'hic' | 'hib' | 'his' | 'hs' | 'qt' | 'un' | 'pr' | 'dp' | 'da' | 'fr' | 'tp' | 'ta' | 'am' | 'x';

/** The prototype's widths (px) for the columns that have one; Item is the flexible column (its min-width). */
export const BASE: Record<ColKey, number> = { c: 42, it: 200, hic: 96, hib: 96, his: 96, hs: 78, qt: 66, un: 58, pr: 104, dp: 64, da: 86, fr: 98, tp: 80, ta: 90, am: 108, x: 40 };

/** Columns that keep their own size: the row number and the remove button. */
const FIXED: ColKey[] = ['c', 'x'];
/** Item already grows with the screen; it takes part in the sharing but its width isn't set. */
const FLEX: ColKey = 'it';

export interface ColOpts { brand: boolean; series: boolean; hsn: boolean; tax: boolean }

const ALL: ColKey[] = ['c', 'it', 'hic', 'hib', 'his', 'hs', 'qt', 'un', 'pr', 'dp', 'da', 'fr', 'tp', 'ta', 'am', 'x'];

/** The columns that are on, in screen order. */
export function gridCols(o: ColOpts): ColKey[] {
  return ALL.filter((k) => (k === 'hib' ? o.brand : k === 'his' ? o.series : k === 'hs' ? o.hsn : k === 'tp' || k === 'ta' ? o.tax : true));
}

/**
 * Each shown column's width (px) after sharing out the switched-off columns' widths.
 * Item gets no number (it keeps filling what's left); its share goes to it on its own.
 */
export function colWidths(o: ColOpts): { key: ColKey; w?: number }[] {
  const on = gridCols(o);
  const sharing = (ks: ColKey[]) => ks.filter((k) => !FIXED.includes(k));
  const freed = sharing(ALL.filter((k) => !on.includes(k))).reduce((a, k) => a + BASE[k], 0);
  const total = sharing(on).reduce((a, k) => a + BASE[k], 0);
  const f = 1 + freed / total;
  return on.map((key) => (key === FLEX ? { key } : { key, w: FIXED.includes(key) ? BASE[key] : Math.round(BASE[key] * f * 100) / 100 }));
}

/**
 * The table's <colgroup>: one <col> per shown column, with the shared-out widths.
 * With every column on there's nothing to share: no <colgroup> at all, so the CSS alone
 * sizes the table, in Compact and Comfortable alike, exactly as in the prototype.
 */
export function GridColGroup({ o }: { o: ColOpts }) {
  if (gridCols(o).length === ALL.length) return null;
  return <colgroup>{colWidths(o).map((c) => <col key={c.key} data-col={c.key} style={c.w ? { width: c.w } : undefined} />)}</colgroup>;
}

/** The Total row's cells, one per shown column; `cells` fills the ones that show something. */
export function footCells(o: ColOpts, cells: Partial<Record<ColKey, ReactNode>>): ReactNode[] {
  return gridCols(o).map((k) => (cells[k] !== undefined ? <Fragment key={k}>{cells[k]}</Fragment> : <td key={k}></td>));
}

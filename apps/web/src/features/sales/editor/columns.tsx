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
import { Fragment, useLayoutEffect, useState, type ReactNode } from 'react';
import { ui } from '../../../styles/uiSize';

export type ColKey = 'c' | 'it' | 'hic' | 'hib' | 'his' | 'hs' | 'bt' | 'mf' | 'ex' | 'mr' | 'pk' | 'qt' | 'un' | 'pr' | 'dp' | 'da' | 'fr' | 'tp' | 'ta' | 'am' | 'x';

/** The prototype's widths (px) for the columns that have one; Item is the flexible column (its min-width). */
export const BASE: Record<ColKey, number> = { c: 42, it: 200, hic: 96, hib: 96, his: 96, hs: 78, bt: 130, mf: 84, ex: 84, mr: 88, pk: 108, qt: 66, un: 58, pr: 104, dp: 64, da: 86, fr: 98, tp: 80, ta: 90, am: 108, x: 40 };

/** Columns that keep their own size: the row number and the remove button. */
const FIXED: ColKey[] = ['c', 'x'];
/** Item already grows with the screen; it takes part in the sharing but its width isn't set. */
const FLEX: ColKey = 'it';

export interface ColOpts { brand: boolean; series: boolean; hsn: boolean; tax: boolean; /** Settings › Items: own columns, only when switched on */ batch?: boolean; mfg?: boolean; exp?: boolean; mrp?: boolean; pack?: boolean }

/** Batch, Mfg, Expiry, MRP and Pack: not in the prototype, so a shop without them never counts as "a column is off". */
const EXTRA: ColKey[] = ['bt', 'mf', 'ex', 'mr', 'pk'];
const ALL: ColKey[] = ['c', 'it', 'hic', 'hib', 'his', 'hs', 'bt', 'mf', 'ex', 'mr', 'qt', 'un', 'pk', 'pr', 'dp', 'da', 'fr', 'tp', 'ta', 'am', 'x'];

/** The columns that are on, in screen order. */
export function gridCols(o: ColOpts): ColKey[] {
  return ALL.filter((k) => (k === 'hib' ? o.brand : k === 'his' ? o.series : k === 'hs' ? o.hsn : k === 'tp' || k === 'ta' ? o.tax : k === 'bt' ? o.batch : k === 'mf' ? o.mfg : k === 'ex' ? o.exp : k === 'mr' ? o.mrp : k === 'pk' ? o.pack : true));
}

/**
 * Each shown column's width (px) after sharing out the switched-off columns' widths.
 * Item gets no number (it keeps filling what's left); its share goes to it on its own.
 */
export function colWidths(o: ColOpts): { key: ColKey; w?: number }[] {
  const on = gridCols(o);
  const sharing = (ks: ColKey[]) => ks.filter((k) => !FIXED.includes(k));
  const freed = sharing(ALL.filter((k) => !on.includes(k) && !EXTRA.includes(k))).reduce((a, k) => a + BASE[k], 0);
  const total = sharing(on).reduce((a, k) => a + BASE[k], 0);
  const f = 1 + freed / total;
  return on.map((key) => (key === FLEX ? { key } : { key, w: FIXED.includes(key) ? BASE[key] : Math.round(BASE[key] * f * 100) / 100 }));
}

/**
 * The table's <colgroup>: one <col> per shown column, with the shared-out widths.
 * With every column on there's nothing to share: no <colgroup> at all, so the CSS alone
 * sizes the table, in Compact and Comfortable alike, exactly as in the prototype.
 */
export function GridColGroup({ o, fit }: { o: ColOpts; fit?: Fit }) {
  if (fit) return <colgroup>{fit.cols.map((c) => <col key={c.key} data-col={c.key} style={{ width: c.w }} />)}</colgroup>;
  const on = gridCols(o);
  if (ALL.every((k) => EXTRA.includes(k) || on.includes(k))) return null;
  return <colgroup>{colWidths(o).map((c) => <col key={c.key} data-col={c.key} style={c.w ? { width: c.w } : undefined} />)}</colgroup>;
}

/** The narrowest each column may get when the table has to fit (owner, 8 Nov 2026). */
const MIN: Partial<Record<ColKey, number>> = { hic: 56, hib: 50, his: 50, hs: 50, bt: 76, mf: 56, ex: 66, mr: 58, pk: 58, qt: 44, un: 60, pr: 74, dp: 40, da: 54, fr: 66, tp: 58, ta: 56, am: 74 };
const ITEM_FIRST = 150, ITEM_LEAST = 90, ITEM_TIGHT = 190;
export interface Fit { cols: { key: ColKey; w: number }[]; tight: boolean }

/**
 * Owner, 8 Nov 2026: with Batch, Expiry, MRP or Pack on, no column may need a side scroll. When the columns
 * don't fit, Item gives up its width first, then every other column gets narrower together. Null when they
 * fit as they are, or when none of these columns is on: then nothing changes.
 */
export function fitWidths(o: ColOpts, avail: number): Fit | null {
  const on = gridCols(o);
  if (!on.some((k) => EXTRA.includes(k))) return null;
  if (on.reduce((a, k) => a + BASE[k], 0) <= avail) return null;
  const rest = on.filter((k) => k !== FLEX);
  const restSum = rest.reduce((a, k) => a + BASE[k], 0);
  let item = Math.max(ITEM_FIRST, avail - restSum);
  const short = rest.filter((k) => !FIXED.includes(k));
  // Without Mfg this is the sale grid, where Expiry reads "Mar 2040": the year must not be cut. Purchase has a short MM/YY box.
  const least = (k: ColKey) => (k === 'ex' && !on.includes('mf') ? 74 : MIN[k] ?? BASE[k]);
  const room = short.reduce((a, k) => a + BASE[k] - least(k), 0);
  const over = restSum + item - avail;
  const ratio = over > 0 && room > 0 ? Math.min(1, over / room) : 0;
  if (over > room) item = Math.max(ITEM_LEAST, item - (over - room));
  const width = (k: ColKey) => (FIXED.includes(k) ? BASE[k] : BASE[k] - (BASE[k] - least(k)) * ratio);
  return { cols: on.map((key) => ({ key, w: key === FLEX ? item : Math.floor(width(key) * 100) / 100 })), tight: item < ITEM_TIGHT };
}

/** Follows the grid's width on screen and marks the table when it has to fit (styles at the end of app.css). */
export function useGridFit(box: string, o: ColOpts): Fit | null {
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const w = document.querySelector(box);
    if (!w) return;
    const read = () => setAvail(w.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(w);
    return () => ro.disconnect();
  }, [box]);
  const fit = avail ? fitWidths(o, avail) : null;
  const mark = fit ? (fit.tight ? 'tight' : 'on') : '';
  useLayoutEffect(() => {
    const t = document.querySelector<HTMLElement>(`${box} .dgt`);
    if (!t) return;
    if (mark) t.dataset.fit = mark; else delete t.dataset.fit;
  }, [box, mark]);
  return fit;
}

/** A heading for one of the own columns; its width is set here because the prototype's CSS has none for it. */
export function ExtraTh({ k, label }: { k: ColKey; label: string }) {
  return <th rowSpan={2} className={k === 'mr' ? `n ${k}` : k} style={{ width: ui.w(BASE[k]) }}>{label}</th>;
}

/** The Total row's cells, one per shown column; `cells` fills the ones that show something. */
export function footCells(o: ColOpts, cells: Partial<Record<ColKey, ReactNode>>): ReactNode[] {
  return gridCols(o).map((k) => (cells[k] !== undefined ? <Fragment key={k}>{cells[k]}</Fragment> : <td key={k}></td>));
}

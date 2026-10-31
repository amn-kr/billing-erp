/**
 * A spreadsheet-like editable table (Items › Bulk update items), from the same classes and look as
 * the EditGrid (tw, ptt2, egt, egc, egm, edit-grid.css). One cell is the active cell:
 * - Arrow keys move it in all four directions, over the tick box, the item name and the data cells;
 *   Ctrl/Cmd+Up / Down go to the first / last row, Page Up / Down a screen at a time; Tab / Shift+Tab
 *   go right / left. The table scrolls to keep the active cell in view.
 * - Arriving at a text cell selects its whole value, so typing replaces it. Typing starts editing;
 *   F2, Enter or a double-click start editing with the caret at the end. While editing, Left / Right
 *   move the caret, Enter confirms and goes down, Tab confirms and goes right, Esc puts back the value.
 * - A list cell (e.g. Category) opens with Enter, Space or Alt+Down (or a click); Up / Down choose,
 *   Enter confirms, Esc closes; typing a letter jumps to the next choice starting with it.
 * - Space ticks a tick box; Shift+Space ticks the active row from any cell.
 * Rows have one fixed height (a changed cell's "was …" or its problem is a small line inside the
 * cell), so only the rows in view are drawn and thousands of rows stay quick. The active row is
 * always drawn, so the focus is never lost while the table is drawn again.
 * Parties › Import Parties › Bulk entry uses it without the tick boxes and the fixed name column
 * (`selection` and `lead` left out), with a last column of its own (`tail`) and `onPaste` for
 * blocks of cells copied from Excel or Google Sheets.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import css from './edit-grid.css?inline';
import sheetCss from './sheet-grid.css?inline';
import { useStyles } from '../lib/useStyles';
import { useFitToScreen } from './EditGrid';
import { ui } from '../styles/uiSize';

export interface SheetColumn {
  key: string;
  title: string;
  /** a list cell: its choices (value and what is shown) */
  list?: { value: string; label: string }[];
  width?: number;
  /** takes the spare width of the table */
  grow?: boolean;
  placeholder?: string;
  /** shown, not typed in (Bulk active / inactive) */
  readOnly?: boolean;
}

/** a cell's problem (red) or hint (grey, e.g. "was 18%"), shown as one small line inside the cell */
export interface SheetMark { error?: string; hint?: string }
export interface SheetHandle { focusCell: (row: string, col: string) => void }

interface Props<R> {
  id: string;
  columns: SheetColumn[];
  rows: R[];
  rowKey: (r: R) => string;
  rowLabel: (r: R) => ReactNode;
  /** the row's name, for each cell's label */
  rowName: (r: R) => string;
  /** a fixed, read-only first column (the item name); left out: every column can be typed in */
  lead?: { title: string; width: number; cell: (r: R) => string };
  value: (r: R, key: string) => string;
  onChange: (r: R, key: string, value: string) => void;
  mark?: (r: R, key: string) => SheetMark | undefined;
  /** tick boxes in front of the rows; left out: no tick box column */
  selection?: { selected: Set<string>; onToggle: (key: string, on: boolean) => void; onToggleAll: (on: boolean) => void };
  /** a last column that is not a cell (e.g. the row's status and a remove button); not reached by the keys */
  tail?: { title: string; width: number; cell: (r: R) => ReactNode };
  /** text pasted into a cell that holds more than one cell (a tab or a new line): the page fills the cells */
  onPaste?: (row: string, col: string, text: string) => void;
  /** shown after a heading's title, e.g. a filter button; key 'lead' for the item name */
  head?: (key: string) => ReactNode;
  empty?: ReactNode;
  handle?: MutableRefObject<SheetHandle | null>;
}

const SEL = '_sel';
const NAME = '_name';
const BUFFER = 8;
type Cell = { row: string; col: string };
type List = Cell & { hi: number };
const isText = (el: Element | null): el is HTMLInputElement => el instanceof HTMLInputElement && el.type !== 'checkbox';
/** select a text cell's value without the browser scrolling the table to "show" the selection */
const selectAll = (inp: HTMLInputElement) => {
  const tw = inp.closest<HTMLElement>('.tw');
  const top = tw?.scrollTop ?? 0, left = tw?.scrollLeft ?? 0;
  inp.select();
  if (tw && (tw.scrollTop !== top || tw.scrollLeft !== left)) { tw.scrollTop = top; tw.scrollLeft = left; }
};
const printable = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

export function SheetGrid<R>({ id, columns, rows, rowKey, rowLabel, rowName, lead, value, onChange, mark, selection, tail, onPaste, head, empty, handle }: Props<R>) {
  useStyles([css], 'edit-grid');
  // this table's own rules, all under #vBulk (the shared grid look above is not changed)
  useStyles([sheetCss], 'sheet-grid');
  const twRef = useRef<HTMLDivElement>(null);
  useFitToScreen(twRef, true);
  const [active, setActive] = useState<Cell | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [list, setList] = useState<List | null>(null);
  const editing = useRef(false);
  /** what the active cell held when it became active (Esc puts it back) */
  const entered = useRef('');
  /** a click that is focusing a text cell: its mouseup must not undo the "select all" */
  const clickFocus = useRef(false);
  /** go() was asked for this cell (keys, or the page after Update): it takes the focus from anywhere */
  const force = useRef(false);
  /**
   * The scroll position go() asked for. Drawing other rows removes the focused cell for a moment, and
   * the browser may then cut the position to the half-drawn table's height: it is put back once drawn.
   */
  const want = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [rh, setRh] = useState(45);

  const nav = useMemo(() => [...(selection ? [SEL] : []), ...(lead ? [NAME] : []), ...columns.map((c) => c.key)], [columns, selection, lead]);
  const index = useMemo(() => new Map(rows.map((r, i) => [rowKey(r), i])), [rows, rowKey]);
  const colOf = (key: string) => columns.find((c) => c.key === key);
  const rowOf = (key: string) => { const i = index.get(key); return i === undefined ? undefined : rows[i]; };

  const cellEl = (c: Cell) => twRef.current?.querySelector<HTMLTableCellElement>(`tr[data-row="${CSS.escape(c.row)}"] td[data-col="${c.col}"]`) ?? null;
  const focusable = (td: HTMLElement) => td.querySelector<HTMLElement>('input,select') ?? td;

  /** scroll so row i is in view below the heading row */
  const showRow = (i: number) => {
    const tw = twRef.current;
    if (!tw) return;
    const headH = tw.querySelector('thead')?.offsetHeight ?? 0;
    const top = i * rh;
    if (top < tw.scrollTop) tw.scrollTop = top;
    else if (headH + top + rh > tw.scrollTop + tw.clientHeight) tw.scrollTop = headH + top + rh - tw.clientHeight;
    want.current = tw.scrollTop;
    setScrollTop(tw.scrollTop);
  };
  const go = (row: string, col: string) => {
    const i = index.get(row);
    if (i === undefined) return;
    editing.current = false;
    force.current = true;
    setList(null);
    showRow(i);
    setActive({ row, col });
  };
  if (handle) handle.current = { focusCell: go };
  const move = (dr: number, dc: number, edge?: 'first' | 'last') => {
    const a = activeRef.current;
    if (!a || !rows.length) return;
    const ri = index.get(a.row) ?? 0;
    const nr = edge === 'first' ? 0 : edge === 'last' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, ri + dr));
    const nc = Math.max(0, Math.min(nav.length - 1, nav.indexOf(a.col) + dc));
    go(rowKey(rows[nr]!), nav[nc]!);
  };
  /** select a cell's value again once it is drawn: only if it still has the focus (select() would take
   * it back) and editing has not started meanwhile (Esc, then Enter at once) */
  const reselect = (inp: HTMLInputElement) => requestAnimationFrame(() => { if (document.activeElement === inp && !editing.current) selectAll(inp); });
  const toggleRow = (row: string) => selection?.onToggle(row, !selection.selected.has(row));

  // the active cell gets the focus (after moving, and if the focus was lost while drawing again)
  useLayoutEffect(() => {
    if (!active) return;
    const td = cellEl(active);
    if (!td) return;
    if (want.current !== null) {
      if (twRef.current && twRef.current.scrollTop !== want.current) twRef.current.scrollTop = want.current;
      want.current = null;
    }
    const f = focusable(td);
    const ae = document.activeElement;
    if (ae !== f && (force.current || ae === document.body || !ae || twRef.current?.contains(ae))) f.focus({ preventScroll: true });
    force.current = false;
    // sideways: keep it right of the columns that stay in view (tick box, #, item name)
    const tw = twRef.current!;
    const leadTh = tw.querySelector<HTMLElement>('thead th.eglead') ?? tw.querySelector<HTMLElement>('thead th.egn');
    const stick = leadTh ? leadTh.offsetLeft + leadTh.offsetWidth : 0;
    if (active.col !== SEL && active.col !== NAME) {
      if (td.offsetLeft < tw.scrollLeft + stick) tw.scrollLeft = td.offsetLeft - stick;
      // a cell wider than the room left shows from its start
      else if (td.offsetLeft + td.offsetWidth > tw.scrollLeft + tw.clientWidth) tw.scrollLeft = Math.min(td.offsetLeft - stick, td.offsetLeft + td.offsetWidth - tw.clientWidth);
    }
  });

  // rows in view: from the scroll position and the table's height; one row's real height
  useEffect(() => {
    const tw = twRef.current;
    if (!tw) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setScrollTop(tw.scrollTop)); };
    const ro = new ResizeObserver(() => setViewH(tw.clientHeight));
    ro.observe(tw);
    tw.addEventListener('scroll', on, { passive: true });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); tw.removeEventListener('scroll', on); };
  }, []);
  useLayoutEffect(() => {
    const tr = twRef.current?.querySelector<HTMLElement>('tbody tr[data-row]');
    if (tr && tr.offsetHeight && tr.offsetHeight !== rh) setRh(tr.offsetHeight);
  });
  // an open list closes when the table scrolls or something else is clicked
  useEffect(() => {
    if (!list) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(`#${id}-list`)) setList(null); };
    document.addEventListener('mousedown', close, true);
    twRef.current?.addEventListener('scroll', close);
    const tw = twRef.current;
    return () => { document.removeEventListener('mousedown', close, true); tw?.removeEventListener('scroll', close); };
  }, [list, id]);

  /** a cell became active by the mouse, a Tab from outside, or our own focus() */
  const onFocus = (e: FocusEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    const td = t.closest<HTMLElement>('td[data-col]');
    const tr = t.closest<HTMLElement>('tr[data-row]');
    if (!td || !tr) return;
    const c = { row: tr.dataset.row!, col: td.dataset.col! };
    const r = rowOf(c.row);
    const a = activeRef.current;
    if (!a || a.row !== c.row || a.col !== c.col) {
      editing.current = false;
      setList(null);
      setActive(c);
    }
    if (r && colOf(c.col)) entered.current = value(r, c.col);
    if (isText(t) && !editing.current) selectAll(t);
  };

  const listOpen = (c: Cell) => {
    const col = colOf(c.col);
    const r = rowOf(c.row);
    if (!col?.list || !r) return;
    const v = value(r, c.col);
    setList({ ...c, hi: Math.max(0, col.list.findIndex((o) => o.value === v)) });
  };
  const choose = (c: Cell, v: string) => { const r = rowOf(c.row); if (r) onChange(r, c.col, v); setList(null); };
  /** the next choice whose name starts with the letter, after the given one */
  const jump = (opts: { label: string }[], from: number, key: string) => {
    const k = key.toLowerCase();
    for (let n = 1; n <= opts.length; n++) {
      const i = (from + n) % opts.length;
      if (opts[i]!.label.toLowerCase().startsWith(k)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    const td = t.closest<HTMLElement>('td[data-col]');
    const tr = t.closest<HTMLElement>('tr[data-row]');
    if (!td || !tr) return;
    const c = { row: tr.dataset.row!, col: td.dataset.col! };
    const r = rowOf(c.row);
    if (!r) return;
    const mod = e.ctrlKey || e.metaKey;
    const ci = nav.indexOf(c.col);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const arrows = (): boolean => {
      if (e.key === 'ArrowUp') { stop(); move(-1, 0, mod ? 'first' : undefined); return true; }
      if (e.key === 'ArrowDown') { stop(); move(1, 0, mod ? 'last' : undefined); return true; }
      if (e.key === 'ArrowLeft') { stop(); move(0, -1); return true; }
      if (e.key === 'ArrowRight') { stop(); move(0, 1); return true; }
      if (e.key === 'PageDown' || e.key === 'PageUp') { stop(); move((e.key === 'PageDown' ? 1 : -1) * Math.max(1, Math.floor(viewH / rh) - 1), 0); return true; }
      // Tab past the last column (or Shift+Tab before the first) leaves the table as usual
      if (e.key === 'Tab' && (e.shiftKey ? ci > 0 : ci < nav.length - 1)) { stop(); move(0, e.shiftKey ? -1 : 1); return true; }
      return false;
    };

    // tick box: Space (and Shift+Space) tick it as usual
    if (t instanceof HTMLInputElement && t.type === 'checkbox') { arrows(); return; }
    if (c.col === NAME) {
      if (e.key === ' ' && e.shiftKey) { stop(); toggleRow(c.row); return; }
      arrows();
      return;
    }
    const col = colOf(c.col);
    if (!col) return;

    if (col.list) {
      const opts = col.list;
      if (list && list.row === c.row && list.col === c.col) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { stop(); setList({ ...list, hi: Math.max(0, Math.min(opts.length - 1, list.hi + (e.key === 'ArrowDown' ? 1 : -1))) }); }
        else if (e.key === 'Home' || e.key === 'End') { stop(); setList({ ...list, hi: e.key === 'Home' ? 0 : opts.length - 1 }); }
        else if (e.key === 'Enter') { stop(); choose(c, opts[list.hi]!.value); }
        else if (e.key === 'Escape') { stop(); setList(null); }
        else if (e.key === 'Tab') { setList(null); arrows(); }
        else if (printable(e)) { stop(); const i = jump(opts, list.hi, e.key); if (i >= 0) setList({ ...list, hi: i }); }
        else stop();
        return;
      }
      if ((e.key === 'ArrowDown' && e.altKey) || e.key === 'Enter' || e.key === ' ' || e.key === 'F2') {
        if (e.key === ' ' && e.shiftKey) { stop(); toggleRow(c.row); return; }
        stop(); listOpen(c); return;
      }
      if (arrows()) return;
      if (e.key === 'Escape') { stop(); if (value(r, c.col) !== entered.current) onChange(r, c.col, entered.current); return; }
      if (printable(e)) {
        stop();
        const cur = opts.findIndex((o) => o.value === value(r, c.col));
        const i = jump(opts, cur, e.key);
        if (i >= 0) onChange(r, c.col, opts[i]!.value);
      }
      return;
    }

    // a text cell
    const inp = t as HTMLInputElement;
    if (editing.current) {
      if (e.key === 'Enter') { stop(); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { stop(); move(e.key === 'ArrowUp' ? -1 : 1, 0); }
      else if (e.key === 'Tab') { if (!arrows()) editing.current = false; }
      else if (e.key === 'Escape') {
        stop();
        editing.current = false;
        if (inp.value !== entered.current) onChange(r, c.col, entered.current);
        reselect(inp);
      }
      return;
    }
    if (arrows()) return;
    if (e.key === 'Enter' || e.key === 'F2') { stop(); editing.current = true; const n = inp.value.length; inp.setSelectionRange(n, n); return; }
    if (e.key === 'Escape') { stop(); if (inp.value !== entered.current) { onChange(r, c.col, entered.current); reselect(inp); } return; }
    if (e.key === ' ' && e.shiftKey) { stop(); toggleRow(c.row); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { editing.current = true; return; }
    if (printable(e)) {
      // typing replaces the whole value
      if (inp.selectionStart !== 0 || inp.selectionEnd !== inp.value.length) selectAll(inp);
      editing.current = true;
    }
  };

  /** a block of cells pasted into a cell (not while typing a single value into it) */
  const onPasteCells = (e: ClipboardEvent<HTMLTableElement>) => {
    if (!onPaste) return;
    const text = e.clipboardData.getData('text/plain');
    const t = e.target as HTMLElement;
    const td = t.closest<HTMLElement>('td[data-col]');
    const tr = t.closest<HTMLElement>('tr[data-row]');
    if (!td || !tr || !colOf(td.dataset.col!)) return;
    // one value into a text cell is typed in as usual
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, '')) && isText(t)) return;
    e.preventDefault();
    editing.current = false;
    onPaste(tr.dataset.row!, td.dataset.col!, text);
  };

  const onMouseDown = (e: MouseEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement) {
      // our own list instead of the browser's
      e.preventDefault();
      const td = t.closest<HTMLElement>('td[data-col]')!;
      const tr = t.closest<HTMLElement>('tr[data-row]')!;
      const c = { row: tr.dataset.row!, col: td.dataset.col! };
      t.focus();
      if (list && list.row === c.row && list.col === c.col) setList(null);
      else setTimeout(() => listOpen(c), 0);
    } else if (isText(t)) clickFocus.current = document.activeElement !== t;
  };
  const onMouseUp = (e: MouseEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    if (!isText(t)) return;
    if (clickFocus.current) { e.preventDefault(); clickFocus.current = false; }
    // a second click on the active cell edits it where it was clicked
    else editing.current = true;
  };
  const onDoubleClick = (e: MouseEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    if (!isText(t)) return;
    editing.current = true;
    const n = t.value.length;
    t.setSelectionRange(n, n);
  };

  // the rows to draw: those in view (and a few more), plus the active row
  const headH = 41;
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop - headH) / rh) - BUFFER);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / rh) + BUFFER);
  const drawn: number[] = [];
  for (let i = start; i < end; i++) drawn.push(i);
  const ai = active ? index.get(active.row) : undefined;
  if (ai !== undefined && (ai < start || ai >= end)) drawn.push(ai);
  drawn.sort((a, b) => a - b);
  const span = (selection ? 1 : 0) + 1 + (lead ? 1 : 0) + columns.length + (tail ? 1 : 0);
  // left edges of the columns that stay in view
  const numL = selection ? 36 : 0, leadL = numL + 44;
  const gap = (n: number, key: string) => <tr key={key} className="egsp" aria-hidden="true"><td colSpan={span} style={{ height: n * rh }}></td></tr>;
  const first = rows[0] ? rowKey(rows[0]) : '';
  const firstCol = nav[nav.length - columns.length];
  const tab = (row: string, col: string) => (active ? active.row === row && active.col === col : row === first && col === firstCol) ? 0 : -1;
  const leadW = lead && { minWidth: lead.width, maxWidth: lead.width, width: lead.width };
  const title = (key: string, t: ReactNode) => (head ? <span className="thw2">{t}{head(key)}</span> : t);
  const allOn = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(rowKey(r)));
  const tailW = tail && { minWidth: tail.width, width: tail.width };

  const body: ReactNode[] = [];
  let prev = 0;
  for (const i of drawn) {
    if (i > prev) body.push(gap(i - prev, `gap-${prev}`));
    const r = rows[i]!;
    const k = rowKey(r);
    const name = rowName(r);
    const on = (col: string) => (active && active.row === k && active.col === col ? ' egact' : '');
    body.push(
      <tr key={k} data-row={k} aria-rowindex={i + 2}>
        {selection && <td className={`egck${on(SEL)}`} data-col={SEL} style={{ ['--egl' as string]: '0px' }}><input type="checkbox" aria-label={`Select ${name}`} tabIndex={tab(k, SEL)} checked={selection.selected.has(k)} onChange={(e) => selection.onToggle(k, e.target.checked)} /></td>}
        <td className="egn" style={{ ['--egl' as string]: `${numL}px` }}>{rowLabel(r)}</td>
        {lead && <td className={`eglead${on(NAME)}`} data-col={NAME} tabIndex={tab(k, NAME)} title={lead.cell(r)} style={{ ...leadW, ['--egl' as string]: `${leadL}px` }}>{lead.cell(r)}</td>}
        {columns.map((c) => {
          const m = mark?.(r, c.key);
          const v = value(r, c.key);
          const label = `${c.title}, ${name}`;
          return (
            <td key={c.key} className={`egc${m?.error ? ' bad' : ''}${on(c.key)}`} data-col={c.key} title={m?.error && m.hint ? m.hint : undefined}>
              {c.list ? (
                <select aria-label={label} aria-invalid={!!m?.error || undefined} aria-expanded={!!list && list.row === k && list.col === c.key} tabIndex={tab(k, c.key)} value={v} onChange={(e) => onChange(r, c.key, e.target.value)}>
                  {!c.list.some((o) => o.value === v) && <option value={v}>{v || '—'}</option>}
                  {c.list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input aria-label={label} aria-invalid={!!m?.error || undefined} tabIndex={tab(k, c.key)} value={v} readOnly={c.readOnly} placeholder={c.placeholder} autoComplete="off" spellCheck={false} onChange={(e) => onChange(r, c.key, e.target.value)} />
              )}
              {m?.error ? <small className="egm bad">{m.error}</small> : m?.hint ? <small className="egm info">{m.hint}</small> : null}
            </td>
          );
        })}
        {tail && <td className="egtail" style={tailW}>{tail.cell(r)}</td>}
      </tr>,
    );
    prev = i + 1;
  }
  if (rows.length > prev) body.push(gap(rows.length - prev, `gap-${prev}`));

  const lc = list ? colOf(list.col) : undefined;
  const ltd = list ? cellEl(list) : null;
  const lr = ltd?.getBoundingClientRect();

  return (
    <div className="egw egsheet" id={id}>
      {/* no scroll anchoring: drawing other rows must not make the browser move the scroll position */}
      <div className="tw egfit" ref={twRef} style={{ margin: 0, overflowAnchor: 'none' }}>
        <table className="ptt2 egt" role="grid" aria-rowcount={rows.length + 1} onFocus={onFocus} onKeyDown={onKeyDown} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onDoubleClick={onDoubleClick} onPaste={onPaste ? onPasteCells : undefined}>
          <thead>
            <tr aria-rowindex={1}>
              {selection && <th className="egck" style={{ ['--egl' as string]: '0px' }}><input type="checkbox" aria-label="Select all rows" checked={allOn} onChange={(e) => selection.onToggleAll(e.target.checked)} /></th>}
              <th className="egn" style={{ ['--egl' as string]: `${numL}px` }}>#</th>
              {lead && <th className="eglead" style={{ ...leadW, ['--egl' as string]: `${leadL}px` }}>{title('lead', lead.title)}</th>}
              {columns.map((c) => <th key={c.key} style={c.grow ? { width: '100%', minWidth: c.width ?? 200 } : { minWidth: c.width ?? 160, width: c.width ?? 160 }}>{title(c.key, c.title)}</th>)}
              {tail && <th className="egtail" style={tailW}>{tail.title}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length ? body : <tr><td colSpan={span} className="ptempty">{empty ?? 'No rows.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {list && lc?.list && lr && createPortal(
        <div className="pop thfp" id={`${id}-list`} role="listbox" aria-label={lc.title} style={{ position: 'fixed', top: lr.bottom + 2, left: lr.left, minWidth: lr.width, maxHeight: ui.h(280), overflowY: 'auto' }}>
          {lc.list.map((o, i) => (
            <button key={o.value} type="button" role="option" aria-selected={i === list.hi} className={i === list.hi ? 'on' : ''} tabIndex={-1}
              ref={(b) => { if (b && i === list.hi) b.scrollIntoView({ block: 'nearest' }); }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(list, o.value)}>{o.label}</button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

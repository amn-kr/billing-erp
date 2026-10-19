/**
 * An editable grid (Items › Import products; made to be reused by Bulk update items): one row per
 * record, every cell an input, cells marked with an error or a warning and the reason in plain
 * words under the value, optional tick boxes, and pages of 100 rows so thousands of rows stay quick.
 * Built from the app's table classes (tw, ptt2, stt); its own look is in edit-grid.css.
 *
 * The table keeps to the room left on the screen below what is above it (like the prototype's price
 * list table, #vPls .ptxc>.tw): the page itself does not scroll, so the title, buttons, filters and
 * search stay in place; the rows scroll inside the table under its heading row, and the sideways
 * scroll bar is always at the bottom of the screen. With few rows the table is just as tall as they are.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import css from './edit-grid.css?inline';
import { useStyles } from '../lib/useStyles';

export interface GridMark { level: 'error' | 'warning'; message: string }

export interface GridColumn {
  key: string;
  title: string;
  /** shown as "*" after the title */
  required?: boolean;
  /** text (default) or a list: `free` lists also take a name that is not in the list */
  list?: { options: string[]; free?: boolean };
  /** right-aligned (numbers) */
  num?: boolean;
  width?: number;
  placeholder?: string;
}

interface Props<R> {
  id?: string;
  columns: GridColumn[];
  rows: R[];
  rowKey: (r: R) => string | number;
  /** the number shown in the first column, e.g. the file's row number */
  rowLabel: (r: R) => ReactNode;
  value: (r: R, key: string) => string;
  onChange: (r: R, key: string, value: string) => void;
  marks?: (r: R, key: string) => GridMark[] | undefined;
  /** a grey note under a cell's value, e.g. how a typed date was read */
  note?: (r: R, key: string) => string | undefined;
  /** cells before the data columns, e.g. a status */
  lead?: { title: string; cell: (r: R) => ReactNode; width?: number };
  selection?: { selected: Set<string | number>; onToggle: (key: string | number, on: boolean) => void; onToggleAll: (on: boolean) => void };
  empty?: ReactNode;
  pageSize?: number;
  /** keep the table within the screen (default); false lets it grow with its rows */
  fill?: boolean;
}

/** the least height the table keeps on a very short window, as the prototype's price list table */
const MIN_HEIGHT = 260;

/**
 * Sets the table's greatest height to the room between its top and the bottom of the window, less
 * what comes after it on the page (the pager, the card's edge, the page's bottom padding).
 */
export function useFitToScreen(tw: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const el = tw.current;
    const main = el?.closest('main');
    if (!on || !el || !main) return;
    // the screen inside <main> that holds the grid
    let screen: Element = el;
    while (screen.parentElement && screen.parentElement !== main) screen = screen.parentElement;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const after = screen.getBoundingClientRect().bottom - r.bottom + parseFloat(getComputedStyle(main).paddingBottom || '0');
        const h = `${Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - after))}px`;
        if (el.style.maxHeight !== h) el.style.maxHeight = h;
      });
    };
    fit();
    // anything above or below that changes size (a message, the pager, a wider window) moves the table
    const ro = new ResizeObserver(fit);
    ro.observe(screen);
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', fit); el.style.maxHeight = ''; };
  }, [tw, on]);
}

export function EditGrid<R>({ id, columns, rows, rowKey, rowLabel, value, onChange, marks, note, lead, selection, empty, pageSize = 100, fill = true }: Props<R>) {
  useStyles([css], 'edit-grid');
  const twRef = useRef<HTMLDivElement>(null);
  useFitToScreen(twRef, fill);
  const [page, setPage] = useState(0);
  // a new page of rows starts at its first row
  useEffect(() => { twRef.current?.scrollTo({ top: 0 }); }, [page]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  // a filter that leaves fewer pages goes back to the last one
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const shown = rows.slice(page * pageSize, (page + 1) * pageSize);
  const allOn = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(rowKey(r)));

  return (
    <div className="egw" id={id}>
      <div className={`tw${fill ? ' egfit' : ''}`} ref={twRef} style={{ margin: 0 }}>
        <table className="ptt2 egt">
          <thead>
            <tr>
              {selection && <th className="egck" style={{ ['--egl' as string]: '0px' }}><input type="checkbox" aria-label="Select all rows" checked={allOn} onChange={(e) => selection.onToggleAll(e.target.checked)} /></th>}
              <th className="egn" style={{ ['--egl' as string]: selection ? '36px' : '0px' }}>#</th>
              {lead && <th className="eglead" style={{ width: lead.width, ['--egl' as string]: selection ? '80px' : '44px' }}>{lead.title}</th>}
              {columns.map((c) => <th key={c.key} className={c.num ? 'n' : undefined} style={{ minWidth: c.width ?? 140 }}>{c.title}{c.required && <span className="req"> *</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.length ? shown.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} data-row={k}>
                  {selection && <td className="egck" style={{ ['--egl' as string]: '0px' }}><input type="checkbox" aria-label={`Select row ${k}`} checked={selection.selected.has(k)} onChange={(e) => selection.onToggle(k, e.target.checked)} /></td>}
                  <td className="egn" style={{ ['--egl' as string]: selection ? '36px' : '0px' }}>{rowLabel(r)}</td>
                  {lead && <td className="eglead" style={{ ['--egl' as string]: selection ? '80px' : '44px' }}>{lead.cell(r)}</td>}
                  {columns.map((c) => {
                    const m = marks?.(r, c.key) ?? [];
                    const lvl = m.some((x) => x.level === 'error') ? 'bad' : m.length ? 'warn' : '';
                    const v = value(r, c.key);
                    const label = `${c.title}, row ${k}`;
                    const listId = c.list?.free ? `eg-${id ?? 'g'}-${c.key}` : undefined;
                    return (
                      <td key={c.key} className={`egc ${lvl}`} data-col={c.key}>
                        {c.list && !c.list.free ? (
                          <select className={c.num ? 'n' : undefined} aria-label={label} aria-invalid={lvl === 'bad' || undefined} value={v} onChange={(e) => onChange(r, c.key, e.target.value)}>
                            <option value="">{c.placeholder ?? '—'}</option>
                            {v && !c.list.options.includes(v) && <option value={v}>{v}</option>}
                            {c.list.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input className={c.num ? 'n' : undefined} aria-label={label} aria-invalid={lvl === 'bad' || undefined} value={v} placeholder={c.placeholder} list={listId} autoComplete="off" onChange={(e) => onChange(r, c.key, e.target.value)} />
                        )}
                        {(() => { const t = note?.(r, c.key); return t ? <small className="egm info">{t}</small> : null; })()}
                        {m.map((x, i) => <small key={i} className={x.level === 'error' ? 'egm bad' : 'egm warn'}>{x.message}</small>)}
                      </td>
                    );
                  })}
                </tr>
              );
            }) : <tr><td colSpan={columns.length + 1 + (lead ? 1 : 0) + (selection ? 1 : 0)} className="ptempty">{empty ?? 'No rows.'}</td></tr>}
          </tbody>
        </table>
        {columns.filter((c) => c.list?.free).map((c) => <datalist key={c.key} id={`eg-${id ?? 'g'}-${c.key}`}>{c.list!.options.map((o) => <option key={o} value={o} />)}</datalist>)}
      </div>
      {pages > 1 && (
        <div className="egpg">
          <span>Rows {(page * pageSize + 1).toLocaleString('en-IN')}–{Math.min(rows.length, (page + 1) * pageSize).toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')}</span>
          <button className="btn sm" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn sm" type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

/**
 * Searchable drop-down: a text field (the app's .fi) that filters its list as you type ("contains",
 * ignoring capital letters), or opens on click / ↓ to pick from. The list is the prototype's Add item
 * suggestion list (.aisug / .aiso / .aish). ↑ ↓ move, Enter picks, Esc closes only the list, Tab leaves.
 * Optional: a first "none" row (`empty`), an "+ Add …" row at the end (`add` / `onAdd`, given the typed
 * text), rows that can't be picked (`disabled`, with a `note` on the right). Emptying the text and leaving
 * the field clears the choice. Its own few rules are in search-select.css.
 */
import { Fragment, useEffect, useId, useRef, useState, type Ref } from 'react';
import css from './search-select.css?inline';
import { useStyles } from '../lib/useStyles';

export interface SsOption { value: string; label?: string; note?: string; disabled?: boolean }
type Row = { kind: 'empty' } | { kind: 'opt'; o: SsOption } | { kind: 'add' };

const text = (o: SsOption) => o.label ?? o.value;

export function SearchSelect({ id, value, options, onChange, placeholder, empty, add, onAdd, disabled, className = '', inputRef, dataF, label }: {
  id: string; value: string; options: SsOption[]; onChange: (value: string) => void; placeholder?: string;
  /** a first row that clears the choice, e.g. "No category" */
  empty?: string;
  /** the last row, e.g. "+ Add category"; picking it calls onAdd with what was typed */
  add?: string; onAdd?: (typed: string) => void;
  disabled?: boolean; className?: string; inputRef?: Ref<HTMLInputElement>; dataF?: string;
  /** accessible name when the field is not inside a <label> */
  label?: string;
}) {
  useStyles([css], 'search-select');
  const [open, setOpen] = useState(false);
  /** what is typed; null = not typing (the field shows the chosen option) */
  const [q, setQ] = useState<string | null>(null);
  /** highlighted row; 'auto' = the first match (or the "+ Add" row when nothing matches) */
  const [act, setAct] = useState<number | 'auto'>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const lid = `${id}L`, uid = useId();
  const chosen = options.find((o) => o.value === value);
  const shown = q ?? (chosen ? text(chosen) : value);
  const needle = (q ?? '').trim().toLowerCase();
  const hits = needle ? options.filter((o) => text(o).toLowerCase().includes(needle)) : options;
  const rows: Row[] = [...(empty && !needle ? [{ kind: 'empty' } as Row] : []), ...hits.map((o) => ({ kind: 'opt', o }) as Row), ...(add && onAdd ? [{ kind: 'add' } as Row] : [])];
  const can = (r: Row | undefined) => !!r && !(r.kind === 'opt' && r.o.disabled);
  const isOn = (r: Row) => (r.kind === 'empty' ? !value : r.kind === 'opt' && r.o.value === value);
  const first = rows.findIndex((r) => r.kind === 'opt' && !r.o.disabled);
  const cur = act === 'auto' ? (first >= 0 ? first : rows.findIndex((r) => r.kind === 'add')) : act;

  useEffect(() => {
    if (open && cur >= 0) listRef.current?.querySelector(`[data-k="${cur}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, cur]);

  /** First row that can be picked from `from` going `dir` (wrapping), or -1. */
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= rows.length; n++) {
      const k = (((from + dir * n) % rows.length) + rows.length) % rows.length;
      if (can(rows[k])) return k;
    }
    return -1;
  };
  const show = () => {
    const k = rows.findIndex(isOn);
    setOpen(true);
    setAct(k >= 0 && can(rows[k]) ? k : step(-1, 1));
  };
  const close = () => { setOpen(false); setQ(null); setAct(-1); };
  const pick = (r: Row | undefined) => {
    if (!can(r)) return;
    const typed = (q ?? '').trim();
    close();
    if (r!.kind === 'empty') onChange('');
    else if (r!.kind === 'opt') onChange(r!.o.value);
    else onAdd!(typed);
  };
  /** Leaving the field: emptied text clears the choice; anything else typed is dropped. */
  const leave = () => {
    if (q !== null && !q.trim() && value) onChange('');
    close();
  };

  function key(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      setAct(step(cur, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (cur >= 0) pick(rows[cur]);
      else if (q !== null && !q.trim()) leave();
    } else if (e.key === 'Escape') {
      if (!open) return;
      // only the list closes, not the window it is in
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') leave();
  }

  const opt = (k: number) => `${uid}-${k}`;
  return (
    <span className="ssel">
      <input
        className={`fi ${className}`} id={id} ref={inputRef} data-f={dataF} value={shown} placeholder={placeholder} disabled={disabled} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={lid} aria-activedescendant={open && cur >= 0 ? opt(cur) : undefined} aria-label={label}
        onFocus={(e) => e.target.select()}
        onClick={() => (open ? close() : show())}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(e.target.value.trim() ? 'auto' : -1); }}
        onKeyDown={key}
        onBlur={leave}
      />
      <div className="aisug" id={lid} role="listbox" ref={listRef} hidden={!open} aria-label={label}>
        {rows.map((r, k) => {
          const dis = !can(r);
          // mousedown keeps the focus in the field; preventDefault on click stops a surrounding <label> re-opening it
          const on = { onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: (e: React.MouseEvent) => { e.preventDefault(); pick(r); }, onMouseMove: () => !dis && cur !== k && setAct(k) };
          const cls = `aiso${k === cur ? ' on' : ''}`;
          if (r.kind === 'empty') return <div key="_e" id={opt(k)} data-k={k} className={cls} role="option" aria-selected={!value} {...on}><span>{empty}</span></div>;
          if (r.kind === 'add') return <Fragment key="_a">{needle && !hits.length && <div className="aish">No match</div>}<div id={opt(k)} data-k={k} className={cls} role="option" aria-selected={false} {...on}><em>{add}{needle ? ` “${(q ?? '').trim()}”` : ''}</em></div></Fragment>;
          return (
            <div key={r.o.value} id={opt(k)} data-k={k} className={cls} role="option" aria-selected={r.o.value === value} aria-disabled={dis || undefined} {...on}>
              <span>{text(r.o)}</span>{r.o.note && <small>{r.o.note}</small>}
            </div>
          );
        })}
        {needle && !hits.length && !(add && onAdd) && <div className="aish">No match</div>}
      </div>
    </span>
  );
}

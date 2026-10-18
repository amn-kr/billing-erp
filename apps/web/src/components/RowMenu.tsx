/**
 * Row actions menu for document lists — the prototype's #slCtx (slMenu / slMenuClose), shared by
 * every list: right-click a row, the Menu key or Shift+F10 on it, or its ⋮ button (data-slm) opens
 * it. Arrows move, Esc closes and puts the focus back on the row, a click outside closes it (a left
 * click on another row only closes it, as in the prototype). Same markup and classes (.ctxm) as
 * the Sales list always had.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RawIcon } from './Icon';
import { P } from './icon-paths';

/** A menu item: key, words, class ("dz" = red); '-' is a divider. */
export type RowAction = [string, string, string?] | '-';
export interface RowMenuAt<R> { row: R; x: number; y: number; tr: HTMLElement | null }

/** Where the menu opens for a row's ⋮ button (prototype: right edge of the button, just below it). */
export const atButton = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return { x: r.right - 220, y: r.bottom + 4 }; };
/** Where it opens from the keyboard (prototype: inside the row, near its bottom). */
export const atRow = (tr: HTMLElement) => { const r = tr.getBoundingClientRect(); return { x: r.left + 120, y: r.bottom - 4 }; };

/**
 * The handlers a list's <tbody> needs: right-click, Menu key and Shift+F10 on a row open the menu.
 * `rows` matches the row elements (e.g. 'tr[data-dcno]'); `find` gives the row's record.
 */
export function rowMenuHandlers<R>(rows: string, find: (tr: HTMLElement) => R | undefined, open: (m: RowMenuAt<R>) => void) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>(rows);
      if (!tr) return;
      e.preventDefault();
      const r = find(tr);
      if (r) open({ row: r, x: e.clientX, y: e.clientY, tr });
    },
    menuKey: (e: React.KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return false;
      const tr = (e.target as HTMLElement).closest<HTMLElement>(rows);
      const r = tr ? find(tr) : undefined;
      if (!tr || !r) return false;
      e.preventDefault();
      open({ row: r, ...atRow(tr), tr });
      return true;
    },
  };
}

/** The ⋮ button in a row's last cell. Enter / Space open the menu (it is a button). */
export function RowMenuButton({ no, label, onOpen }: { no: string; label: string; onOpen: (b: HTMLElement) => void }) {
  return (
    <button type="button" className="ixs slm" data-slm={no} aria-label={label} title={label} aria-haspopup="menu"
      onClick={(e) => { e.stopPropagation(); onOpen(e.currentTarget); }} onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}><RawIcon d={P.dots} /></button>
  );
}

/**
 * The menu itself. `off` gives a reason for each item that does not apply now (shown disabled,
 * the reason as its tip). `words` can change an item's words for this row.
 */
export function RowMenu<R>({ id, label, rows, menu, head, actions, off, words, onClose: onCloseProp, onPick }: {
  id: string; label: string; rows: string; menu: RowMenuAt<R> | null; head: ReactNode; actions: RowAction[];
  off?: Record<string, string>; words?: Record<string, string>; onClose: () => HTMLElement | null | undefined; onPick: (a: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // the latest close handler, without re-running the effect on every render
  const closeRef = useRef(onCloseProp);
  closeRef.current = onCloseProp;
  useEffect(() => {
    const onClose = () => closeRef.current();
    const m = ref.current;
    if (!menu || !m) return setPos(null);
    const w = m.offsetWidth, h = m.offsetHeight;
    setPos({ left: Math.max(8, Math.min(menu.x, innerWidth - w - 8)), top: Math.max(8, menu.y + h > innerHeight - 8 ? menu.y - h : menu.y) });
    (m.querySelector('button:not([disabled])') as HTMLElement | null)?.focus();
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(`#${id}`) || t.closest('[data-slm]')) return;
      if (e.button === 0 && t.closest(rows)) { const eat = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click', eat, { capture: true, once: true }); }
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      const items = [...m.querySelectorAll('button:not([disabled])')] as HTMLElement[];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose()?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Tab') e.preventDefault();
    };
    const away = (e: Event) => { if (!(e.target as HTMLElement).closest?.(`#${id}`)) onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    addEventListener('scroll', away, true);
    addEventListener('resize', away);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); removeEventListener('scroll', away, true); removeEventListener('resize', away); };
  }, [menu, id, rows]);
  const o = off ?? {};
  return (
    <div className="ctxm" id={id} role="menu" aria-label={label} hidden={!menu} ref={ref} style={pos ? { left: pos.left, top: pos.top } : undefined}>
      {menu ? <><div className="cmh">{head}</div>
        {actions.map((a, k) => (a === '-' ? <hr key={k} /> : <button type="button" role="menuitem" data-sla={a[0]} className={a[2] ?? ''} key={a[0]} disabled={!!o[a[0]]} title={o[a[0]] || undefined} onClick={() => onPick(a[0])}>{words?.[a[0]] ?? a[1]}</button>))}</> : null}
    </div>
  );
}

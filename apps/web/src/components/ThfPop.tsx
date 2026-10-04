/**
 * The prototype's column-header filter pop-up (#thfPop): a menu of choices with a
 * tick, a custom date range, or a text / amount condition. It is placed under the
 * filter button and lives at the end of <body>, as in the prototype.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface ThfAnchor { el: HTMLElement; clamp?: boolean }

export function ThfPop({ anchor, onClose, children, focus = 'button.on,button' }: { anchor: ThfAnchor | null; onClose: (refocus: boolean) => void; children: ReactNode; focus?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const p = ref.current;
    if (!anchor || !p) return setPos(null);
    const r = anchor.el.getBoundingClientRect();
    const left = Math.min(r.left - 8, innerWidth - p.offsetWidth - 12);
    setPos({ top: r.bottom + 6, left: anchor.clamp ? Math.max(8, left) : left });
  }, [anchor, children]);
  useEffect(() => {
    if (!anchor) return;
    anchor.el.setAttribute('aria-expanded', 'true');
    const t = setTimeout(() => (ref.current?.querySelector(focus) as HTMLElement | null)?.focus(), 20);
    const down = (e: MouseEvent) => {
      const t2 = e.target as HTMLElement;
      if (!t2.closest('#thfPop') && !t2.closest('[data-thf],[data-thx]')) onClose(false);
    };
    const key = (e: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll('button') ?? [])] as HTMLElement[];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') { e.stopPropagation(); onClose(true); }
      else if (/^(INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    };
    const scroll = (e: Event) => { if (!(e.target as HTMLElement).closest?.('#thfPop')) onClose(false); };
    document.addEventListener('click', down, true);
    document.addEventListener('keydown', key, true);
    addEventListener('scroll', scroll, true);
    return () => {
      clearTimeout(t);
      anchor.el.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', down, true);
      document.removeEventListener('keydown', key, true);
      removeEventListener('scroll', scroll, true);
    };
  }, [anchor, onClose, focus]);
  return createPortal(
    <div className="pop thfp" id="thfPop" hidden={!anchor} role="menu" style={{ position: 'fixed', ...(pos && { top: pos.top, left: pos.left }) }} ref={ref}>
      {anchor ? children : null}
    </div>,
    document.body,
  );
}

/** The choices of a hidden <select> as menu items with a tick (prototype thf). */
export function ThfChoices({ options, value, onPick }: { options: [value: string, text: string][]; value: string; onPick: (v: string) => void }) {
  return (
    <>
      {options.map(([v, t]) => (
        <button key={v} role="menuitemradio" aria-checked={v === value} data-thv={v} className={v === value ? 'on' : ''} onClick={(e) => { e.stopPropagation(); onPick(v); }}>
          {v === value ? <Icon name="check" /> : <span className="thsp"></span>}{t}
        </button>
      ))}
    </>
  );
}

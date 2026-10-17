/** <aside class="side" id="side"> — same markup as the prototype's sidebar. */
import { useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { P } from '../../components/icon-paths';
import { NAV, type NavEntry, type NavLink } from './nav';
import { readLocal, useShell, write } from './store';
import { APP_LETTER, APP_NAME } from '../../lib/brand';

const MINI_ICON = '<path d="M11 7l-5 5 5 5M6 12h13M20 5v14"/>';

function initialOpen(): string[] {
  let open = ['Sales'];
  try {
    const o = JSON.parse(readLocal('erp-open') ?? 'null');
    if (Array.isArray(o)) open = o;
  } catch {
    /* ignore */
  }
  return open.slice(0, 1);
}

interface Props {
  active: string;
  /** the Reports section on screen */
  rsec?: string;
  lowStock: number;
  /** Settings › General › Modules › Accounting */
  acct?: boolean;
  onView: (view: string, link?: NavLink) => void;
  onSoon: (what: string) => void;
}

interface Fly {
  src: HTMLElement;
  title: string;
  kids: NavLink[];
  pinned: boolean;
}

export function Sidebar({ active, rsec, lowStock, acct, onView, onSoon }: Props) {
  const [open, setOpen] = useState<string[]>(initialOpen);
  const { mini, sideOpen, toggleMini } = useShell();
  const [fly, setFly] = useState<Fly | null>(null);
  const hideT = useRef<number>(0);
  const navRef = useRef<HTMLElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const isMini = () => mini && window.innerWidth > 980;

  const toggleGroup = (label: string) => {
    const next = open.includes(label) ? [] : [label];
    setOpen(next);
    write('erp-open', JSON.stringify(next));
  };

  /* ── mini-mode flyout (prototype FLY) ── */
  const showFly = (src: HTMLElement, e: NavEntry, pinned = false) => {
    window.clearTimeout(hideT.current);
    if (!isMini()) return;
    setFly({ src, title: e.label, kids: e.kids ?? [], pinned });
  };
  const hideFly = (now = false) => {
    window.clearTimeout(hideT.current);
    if (now) setFly(null);
    else hideT.current = window.setTimeout(() => setFly(null), 180);
  };
  useEffect(() => {
    if (!fly || !flyRef.current || !navRef.current) return;
    const el = flyRef.current;
    const r = fly.src.getBoundingClientRect();
    el.style.left = (navRef.current.closest('aside')!.getBoundingClientRect().right + 12) + 'px';
    el.style.top = '0px';
    const top = Math.max(8, Math.min(r.top + r.height / 2 - 22, window.innerHeight - el.offsetHeight - 8));
    el.style.top = top + 'px';
    el.style.setProperty('--ay', (r.top + r.height / 2 - top) + 'px');
    if (fly.pinned) el.querySelector<HTMLButtonElement>('.flyi')?.focus({ preventScroll: true });
  }, [fly]);
  useEffect(() => {
    if (!fly) return;
    const away = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!flyRef.current?.contains(t) && !navRef.current?.contains(t)) hideFly(true);
    };
    const gone = () => hideFly(true);
    document.addEventListener('click', away);
    window.addEventListener('resize', gone);
    window.addEventListener('scroll', gone, true);
    return () => {
      document.removeEventListener('click', away);
      window.removeEventListener('resize', gone);
      window.removeEventListener('scroll', gone, true);
    };
  }, [fly]);

  const link = (l: NavLink) => (ev: RMouseEvent) => {
    ev.preventDefault();
    if (l.view) onView(l.view, l);
    else onSoon(l.soon ?? l.label);
  };

  const addBtn = (title: string) => (
    <span className="add" role="button" tabIndex={-1} data-soon={title} title={title} onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onSoon(title); }}>
      <Icon name="plus" />
    </span>
  );

  const inner = (e: NavEntry) => (
    <>
      {e.kids && <svg className="i car" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: P.cr }} />}
      <Icon name={e.icon} />
      <span className="lb">{e.label}</span>
      {e.count && (
        <span className="ct" title={`${lowStock} items at or below reorder level`} style={lowStock ? undefined : { display: 'none' }}>
          {lowStock || ''}
        </span>
      )}
      {e.badge && <span className="badge">{e.badge}</span>}
      {e.add && addBtn(e.add)}
    </>
  );

  return (
    <aside className={sideOpen ? 'side open' : 'side'} id="side" aria-label="Main menu">
      <div className="sbh"><div className="logo">{APP_LETTER}</div><b>{APP_NAME}</b></div>
      <nav id="nav" ref={navRef} onMouseLeave={() => hideFly()}>
        {NAV.map((row) => {
          if ('heading' in row) return <div className="nl" key={row.heading}>{row.heading}</div>;
          const e = row;
          if (e.kids) {
            const isOpen = open.includes(e.label);
            return (
              <div className={`grp ${isOpen ? 'open' : ''} ${e.cls ?? ''}`} data-g={e.label} hidden={e.label === 'Accounting' ? !acct : e.hidden} key={e.label}>
                <button
                  className="ni"
                  aria-expanded={isOpen}
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement).closest('.add')) return;
                    if (isMini()) {
                      const src = ev.currentTarget;
                      if (fly?.src === src && fly.pinned) hideFly(true);
                      else showFly(src, e, true);
                      return;
                    }
                    toggleGroup(e.label);
                  }}
                  onMouseOver={(ev) => showFly(ev.currentTarget, e)}
                  onFocus={(ev) => showFly(ev.currentTarget, e)}
                >
                  {inner(e)}
                </button>
                <div className="subs">
                  {e.kids.map((k) => (
                    <a href="#" className={k.view && k.view === active && (!k.rsec || k.rsec === rsec) ? 'ni on' : 'ni'} aria-current={k.rsec && k.view === active && k.rsec === rsec ? 'page' : undefined} data-view={k.view} data-rsec={k.rsec} data-soon={k.view ? undefined : k.soon} key={k.label} onClick={link(k)}>
                      {k.bare ? k.label : <span className="lb">{k.label}</span>}
                    </a>
                  ))}
                </div>
              </div>
            );
          }
          const on = !!e.view && e.view === active;
          return (
            <a
              href="#"
              className={`ni ${on ? 'on' : ''} ${e.cls ?? ''}`}
              data-view={e.view}
              data-soon={e.view ? undefined : e.soon}
              aria-current={on ? 'page' : undefined}
              key={e.label}
              onClick={(ev) => { if ((ev.target as HTMLElement).closest('.add')) return; link({ label: e.label, view: e.view, soon: e.soon })(ev); }}
              onMouseOver={(ev) => showFly(ev.currentTarget, e)}
              onFocus={(ev) => showFly(ev.currentTarget, e)}
            >
              {inner(e)}
            </a>
          );
        })}
      </nav>
      <div className="sbf">
        <button
          id="miniBtn"
          aria-label={mini ? 'Expand menu' : 'Collapse menu'}
          title={mini ? 'Expand menu' : 'Collapse menu'}
          onClick={() => { toggleMini(); hideFly(true); }}
          dangerouslySetInnerHTML={{ __html: `<svg class="i" viewBox="0 0 24 24">${MINI_ICON}</svg>` }}
        />
      </div>
      {createPortal(
        <div
          id="fly"
          ref={flyRef}
          className={fly && !fly.kids.length ? 'fly tip' : 'fly'}
          hidden={!fly}
          role="menu"
          onMouseEnter={() => window.clearTimeout(hideT.current)}
          onMouseLeave={() => hideFly()}
          onKeyDown={(ev) => {
            const items = [...(flyRef.current?.querySelectorAll<HTMLButtonElement>('.flyi') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
            else if (ev.key === 'Escape' || ev.key === 'ArrowLeft') { ev.preventDefault(); ev.stopPropagation(); const c = fly?.src; hideFly(true); c?.focus(); }
            else if (ev.key === 'Tab') hideFly(true);
          }}
        >
          {fly && (fly.kids.length ? (
            <>
              <div className="flyh">{fly.title}</div>
              {fly.kids.map((k, i) => (
                <button className={`flyi ${k.view && k.view === active ? 'on' : ''}`} role="menuitem" data-fk={i} key={k.label} onClick={(ev) => { hideFly(true); link(k)(ev); }}>
                  {k.label}
                </button>
              ))}
            </>
          ) : (
            <span>{fly.title}</span>
          ))}
        </div>,
        document.body,
      )}
    </aside>
  );
}

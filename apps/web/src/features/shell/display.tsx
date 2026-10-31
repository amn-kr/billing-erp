/**
 * Density and text size (owner's request, 31 Oct 2026). Each person picks their own; it is kept on their
 * account (PATCH /me/display) and comes back with /me at sign-in. Changed in Settings › General › Display
 * or in Display in the account menu (billing staff can't open Settings). See styles/uiSize.ts for how the
 * sizes change; Comfortable + Normal text is the prototype's look and adds nothing to the page.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Density, MeResponse, TextSize } from '@billing/shared';
import { api } from '../../lib/api';
import { RawIcon } from '../../components/Icon';
import { ME_KEY } from '../../lib/me';
import { useStyles } from '../../lib/useStyles';
import { APP_STYLES } from '../../styles';
import { DENSITIES, TEXT_SIZES, uiSizeSheet } from '../../styles/uiSize';
import toastCss from './toast.css?inline';
import rowMenuCss from './row-menu.css?inline';
import rowHeightCss from './row-height.css?inline';
import entryFrameCss from './entry-frame.css?inline';
import editGridCss from '../../components/edit-grid.css?inline';
import sheetGridCss from '../../components/sheet-grid.css?inline';
import searchSelectCss from '../../components/search-select.css?inline';
import itemFiguresCss from '../items/item-figures.css?inline';
import rateTableCss from '../items/rate-table.css?inline';
import { useShell } from './store';

export interface Display { density: Density; textSize: TextSize }

const ROWS = '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>';
const TEXT = '<path d="M4 7V5h10v2M9 5v14M7 19h4M14 13v-1h6v1M17 12v7M15.5 19h3"/>';
/** the icon tile of a Settings row (as in Settings › General) */
const tile = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });

/** Every screen stylesheet, in the order they reach the page (print.css is paper only, so not here). */
const SHEETS = [...APP_STYLES, toastCss, rowMenuCss, rowHeightCss, entryFrameCss, editGridCss, sheetGridCss, searchSelectCss, itemFiguresCss, rateTableCss];

export const isDefault = (d: Display) => d.density === 'comfortable' && d.textSize === 'normal';
export const displayLabel = (d: Display) => `${DENSITIES.find((x) => x[0] === d.density)![1]} · ${TEXT_SIZES.find((x) => x[0] === d.textSize)![1]} text`;

/** Puts the person's choice on <html> (data-density, data-text, data-ui) and adds the size rules when needed. */
export function useDisplayStyles(d: Display) {
  const on = !isDefault(d);
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.density = d.density;
    html.dataset.text = d.textSize;
    if (on) html.dataset.ui = '';
    else delete html.dataset.ui;
    // screens that measure themselves (sticky headings, grids) measure again
    window.dispatchEvent(new Event('resize'));
    return () => {
      delete html.dataset.density;
      delete html.dataset.text;
      delete html.dataset.ui;
    };
  }, [d.density, d.textSize, on]);
  useStyles(on ? [uiSizeSheet(SHEETS)] : [], on ? 'ui-size' : 'ui-none');
}

/** Saves a choice: shown at once, kept on the account, put back if saving fails. */
export function useSaveDisplay() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  return async (p: Partial<Display>) => {
    const before = qc.getQueriesData<MeResponse>({ queryKey: ME_KEY });
    qc.setQueriesData<MeResponse>({ queryKey: ME_KEY }, (o) => (o ? { ...o, user: { ...o.user, ...p } } : o));
    try {
      const d = await api<Display>('/me/display', { method: 'PATCH', body: p });
      showToast(`Display: ${displayLabel(d)}`, 'ok');
    } catch {
      before.forEach(([k, v]) => qc.setQueryData(k, v));
      showToast('Couldn’t save the display choice. Please try again.', 'error');
    }
  };
}

/** The two choices, as segmented buttons (the prototype's .seg2), in a .tgl row each like the other Display settings. */
export function DisplayChoices({ d, idp }: { d: Display; idp: string }) {
  const save = useSaveDisplay();
  const row = <K extends keyof Display>(key: K, icon: string, title: string, help: string, opts: [Display[K], string][]) => (
    <div className="tgl" style={{ marginTop: 14 }}>
      <div className="ti" style={tile('var(--blue,#2563eb)')}><RawIcon d={icon} /></div>
      <div className="tx"><b>{title}</b><small>{help}</small>
        <div className="seg2" role="radiogroup" aria-label={title} id={`${idp}${key === 'density' ? 'Den' : 'Txt'}`} style={{ marginTop: 10 }}>
          {opts.map(([v, label]) => (
            <button type="button" role="radio" aria-checked={d[key] === v} className={d[key] === v ? 'on' : ''} data-v={v} key={v} onClick={() => d[key] !== v && void save({ [key]: v } as Partial<Display>)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
  return (
    <>
      {row('density', ROWS, 'Density', 'Comfortable is the usual spacing. Compact fits more rows on the screen. Only for you: everyone picks their own.', DENSITIES)}
      {row('textSize', TEXT, 'Text size', 'Size of the writing on every screen. Invoices and print are not affected. Only for you.', TEXT_SIZES)}
    </>
  );
}

/** Display in the account menu: the same two choices in a small window. */
export function DisplayDialog({ open, d, onClose }: { open: boolean; d: Display; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null);
  // the latest onClose, so choosing (which redraws the app) doesn't move the focus back to Done
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    done.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus?.();
    };
  }, [open]);
  return (
    <div className="ov c" id="dsp" hidden={!open} onClick={(e) => { if ((e.target as HTMLElement).id === 'dsp') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="dspT">
        <h3 id="dspT" style={{ margin: '0 0 4px', fontSize: 18 }}>Display</h3>
        <p className="mu" style={{ margin: 0, fontSize: 13 }}>How your screens look. Saved on your account, on every device.</p>
        <DisplayChoices d={d} idp="dsp" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}><button className="btn p" id="dspDone" ref={done} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

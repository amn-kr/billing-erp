/**
 * The editor's layout helpers, as the prototype runs them: the grid fills the
 * window above the footer (dgFit), the headings stay visible (stickH1, qeH,
 * stickPg) and the frozen header heights are kept in CSS variables (--dghH, --sitH).
 */
import { useLayoutEffect, type RefObject } from 'react';

function stickH1(sec: HTMLElement) {
  const t = sec.querySelector<HTMLTableElement>('.dgt');
  if (!t?.tHead?.rows[0]) return;
  const c = [...t.tHead.rows[0].cells].find((x) => (x.rowSpan || 1) === 1);
  if (c) t.style.setProperty('--h1', Math.floor(c.getBoundingClientRect().height - 1) + 'px');
  // rapid entry row sticks under both heading rows
  const R = t.tHead.rows;
  if (R.length > 2) t.style.setProperty('--h12', R[2]!.offsetTop - R[0]!.offsetTop + 'px');
}

function dgFit(sec: HTMLElement) {
  const w = sec.querySelector<HTMLElement>('.dgw');
  const f = sec.querySelector<HTMLElement>('.sift');
  if (!w || !f) return;
  const card = (w.closest('.card') as HTMLElement | null) || w;
  const pad = card.getBoundingClientRect().bottom - w.getBoundingClientRect().bottom;
  const topDoc = w.getBoundingClientRect().top + scrollY;
  const fh = f.getBoundingClientRect().height || 0;
  const mh = Math.max(240, Math.floor(innerHeight - fh - 14 - pad - topDoc)) + 'px';
  if (w.style.maxHeight !== mh) w.style.setProperty('max-height', mh, 'important');
}

function stickPg(sec: HTMLElement) {
  dgFit(sec);
  const t = sec.querySelector<HTMLTableElement>('.dgt');
  if (!t) return;
  const w = (t.closest('.tw,.dgw') as HTMLElement | null) || t.parentElement!;
  let lim = 0;
  [document.querySelector('header.top'), ...sec.querySelectorAll('.sitop,.dgh')].forEach((e) => {
    if (!e) return;
    const el = e as HTMLElement;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    const ps = getComputedStyle(el).position;
    if (ps !== 'sticky' && ps !== 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.top <= lim + 1 && r.height) lim = Math.max(lim, r.bottom);
  });
  const top = w.getBoundingClientRect().top;
  const tb = t.getBoundingClientRect().bottom;
  const hh = t.tHead ? t.tHead.getBoundingClientRect().height : 0;
  let off = Math.max(0, Math.ceil(lim - top));
  if (off && top + off + hh > tb) off = 0;
  const v = off + 'px';
  if (t.style.getPropertyValue('--pgoff') !== v) t.style.setProperty('--pgoff', v);
  const ft = t.tFoot;
  const fh = ft && ft.rows.length ? ft.getBoundingClientRect().height : 0;
  let blim = innerHeight;
  sec.querySelectorAll<HTMLElement>('.sift').forEach((f) => {
    if (f.offsetParent !== null || getComputedStyle(f).position === 'fixed') { const r = f.getBoundingClientRect(); if (r.height && r.top < blim) blim = r.top; }
  });
  const wb = w.getBoundingClientRect().bottom;
  let boff = Math.max(0, Math.ceil(wb - blim));
  if (boff && wb - boff - fh < top + off + hh) boff = 0;
  const bv = boff + 'px';
  if (t.style.getPropertyValue('--pgbot') !== bv) t.style.setProperty('--pgbot', bv);
  const fv = Math.round(boff + fh) + 'px';
  if (w.style.getPropertyValue('--fh') !== fv) w.style.setProperty('--fh', fv);
  const hv = Math.round(off + hh) + 'px';
  if (w.style.getPropertyValue('--hh') !== hv) { w.style.setProperty('--hh', hv); w.classList.add('sbhh'); }
}

/** Runs the layout helpers on every render of the editor and whenever sizes change. */
export function useEditorLayout(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const sec = ref.current;
    if (!sec) return;
    const all = () => { stickH1(sec); stickPg(sec); };
    all();
    let raf = 0;
    const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; all(); }); };
    const ro = new ResizeObserver((es) => {
      for (const e of es) {
        const el = e.target as HTMLElement;
        if (el.classList.contains('dgh')) sec.style.setProperty('--dghH', el.offsetHeight + 'px');
        if (el.classList.contains('sitop')) sec.style.setProperty('--sitH', el.offsetHeight + 'px');
      }
      soon();
    });
    sec.querySelectorAll('.dgh,.sitop,.dgw,#siHead,#siFoot,.sift').forEach((e) => ro.observe(e));
    addEventListener('scroll', soon, { passive: true });
    addEventListener('resize', soon);
    return () => { ro.disconnect(); removeEventListener('scroll', soon); removeEventListener('resize', soon); cancelAnimationFrame(raf); };
  });
}

/**
 * Last prices drop-down while billing (prototype phSale / phDrop): clicking into a row's
 * quantity or price shows the last 5 prices this customer got for the item; a click uses one.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { inr2f } from '../../../lib/format';
import { r2, type SI } from './state';

export interface PH { date: string; number: string; qty: string; price: string; discPct: string }
const qfmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const SEL = '#siRows [data-f="price"], #siRows [data-f="qty"]';
/** whose earlier bills to look at: the party, or a walk-in customer by name (prototype phName) */
export const phName = (s: SI) => (s.party ? s.party.name : s.mode === 'cash' ? s.cashName.trim() : '');

export function usePriceHistory(si: SI | null, onPick: (i: number, h: PH) => void) {
  const qc = useQueryClient();
  const [st, setSt] = useState<{ i: number; H: PH[]; who: string; anchor: HTMLElement } | null>(null);
  const cur = useRef(si);
  cur.current = si;
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const show = async (t: HTMLInputElement) => {
      const s = cur.current, tr = t.closest<HTMLElement>('tr[data-ln]');
      if (!s || !tr || (s.doc === 'quote' && !phName(s))) return setSt(null);
      const i = Number(tr.dataset.ln), l = s.lines[i], who = phName(s);
      if (!l?.item || !who) return setSt(null);
      const q = new URLSearchParams({ item: l.item.id, ...(s.party ? { party: s.party.id } : { name: who }), ...(s.editId ? { exclude: s.editId } : {}) });
      const H = await qc.fetchQuery({ queryKey: ['price-history', q.toString()], queryFn: () => api<PH[]>(`/sales/price-history?${q}`), staleTime: 30_000 });
      if (document.activeElement !== t) return;
      setSt(H.length ? { i, H, who, anchor: tr.querySelector<HTMLElement>('[data-f="price"]')!.closest('td')! } : null);
    };
    const fin = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches?.(SEL)) void show(t as HTMLInputElement);
      else if (!t.closest?.('#phPop')) setSt(null);
    };
    const fout = (e: FocusEvent) => {
      if (!(e.target as HTMLElement).matches?.(SEL)) return;
      setTimeout(() => { if (!(document.activeElement as HTMLElement | null)?.matches?.(SEL)) setSt(null); }, 120);
    };
    document.addEventListener('focusin', fin);
    document.addEventListener('focusout', fout);
    return () => { document.removeEventListener('focusin', fin); document.removeEventListener('focusout', fout); };
  }, [qc]);
  const pop = st ? <PhDrop st={st} onPick={(h) => { const i = st.i; setSt(null); pick.current(i, h); }} /> : null;
  return { pop, hide: () => setSt(null) };
}

function PhDrop({ st, onPick }: { st: { H: PH[]; who: string; anchor: HTMLElement }; onPick: (h: PH) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // under the price cell, or above it when there is no room below (prototype phDrop)
  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop) return;
    const r = st.anchor.getBoundingClientRect();
    pop.style.left = Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12)) + 'px';
    const below = innerHeight - r.bottom - 80;
    pop.style.top = (below < pop.offsetHeight && r.top > pop.offsetHeight + 70 ? r.top - pop.offsetHeight - 2 : r.bottom + 2) + 'px';
  });
  return createPortal(
    <div className="dgpop phpop phdd" id="phPop" role="dialog" aria-label="Previous rates" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      <div className="phh">Sale prices · last {st.H.length}<small>{st.who}</small></div>
      <table className="pht"><thead><tr><th>Date</th><th className="n">Qty</th><th className="n">Price/unit</th><th className="n">Disc</th><th className="n">Final</th></tr></thead>
        <tbody>{st.H.map((h, k) => {
          const price = Number(h.price), disc = Number(h.discPct);
          return (
            <tr data-phuse={k} key={k} title={`Use this price (${h.number})`} onClick={(e) => { e.stopPropagation(); onPick(h); }}>
              <td>{h.date.split('-').reverse().join('-')}</td><td className="n">{qfmt(Number(h.qty))}</td><td className="n">{inr2f(price)}</td><td className="n">{disc ? r2(disc) + '%' : '—'}</td><td className="n"><b>{inr2f(r2(price * (1 - disc / 100)))}</b></td></tr>
          );
        })}</tbody></table>
    </div>,
    document.body,
  );
}

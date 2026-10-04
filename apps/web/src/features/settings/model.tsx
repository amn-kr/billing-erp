/** Settings data in the prototype's terms (its S object), with its defaults. */
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../../lib/api';
import { useSettings, type ShopSettings } from '../../lib/settings';

export type Tax = ShopSettings['taxes'][number] & { used: number };
/** prototype DEF: what a shop starts with */
const DEF = { reg: 'regular', hsn: true, pos: true, rcm: false, cess: false, tcs: false, tds: false, tdsBill: true, tdsExp: true, upi: '', upiName: '', payQr: false, waLink: false, acct: false, showCurrency: false, mrp: false };
export type S = typeof DEF & { tcsRate?: string; tdsRate?: string; cashOpen?: string };

export function useS() {
  const q = useSettings();
  const d = q.data;
  const S = { ...DEF, ...((d?.data ?? {}) as Partial<S>) } as S;
  const taxes = (d?.taxes ?? []) as Tax[];
  return { ready: !!d, gst: !!d?.gstEnabled, S, taxes, ofType: (k: string) => taxes.filter((t) => t.kind === k) };
}

/** Save settings: the screen changes at once, the server confirms. */
export function useSaveS() {
  const qc = useQueryClient();
  return async (p: { gstEnabled?: boolean; data?: Partial<S> }) => {
    qc.setQueriesData<ShopSettings>({ queryKey: ['settings'] }, (o) => (o ? { ...o, ...(p.gstEnabled !== undefined && { gstEnabled: p.gstEnabled }), data: { ...o.data, ...(p.data ?? {}) } } : o));
    try {
      await api('/settings', { method: 'PATCH', body: p });
    } finally {
      await Promise.all([qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
    }
  };
}

/** Which Settings tab is open (kept while moving around the app, like the prototype's SETTAB). */
export const useSetTab = create<{ tab: 'tax' | 'items' | 'gen'; set: (t: 'tax' | 'items' | 'gen') => void }>((set) => ({ tab: 'tax', set: (tab) => set({ tab }) }));

export const pct = (n: number | string) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '%';
/** prototype inr2: ₹ with paise only when there are paise */
export const inr2 = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 });
/** the prototype's switch */
export function Sw({ id, on, label, onChange, disabled }: { id?: string; on: boolean; label: string; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return <label className="tgs"><input type="checkbox" id={id} checked={on} disabled={disabled} aria-label={label} onChange={(e) => onChange?.(e.target.checked)} /><i></i></label>;
}

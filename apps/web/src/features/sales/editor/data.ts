/** Everything the editor reads: items with their list prices, parties with balances, the shop's tax set-up. */
import { useQuery } from '@tanstack/react-query';
import { taxModeOf, type CommRule } from '@billing/shared';
import { api } from '../../../lib/api';
import { useSettings } from '../../../lib/settings';
import type { Item } from '../../items/ItemsPage';
import type { Party } from '../../parties/PartiesPage';
import type { PriceList } from '../../prices/model';
import { useBiz } from '../InvoicePreview';
import type { Ctx, EItem, EParty } from './state';

interface Prices { lists: { id: string; name: string }[]; items: { id: string; lists: Record<string, { price: string; fixed: boolean }> }[] }
export interface Referrer { id: string; name: string; phone: string; city: string; partyId: string | null }
const KIND: Record<string, CommRule['t']> = { none: 'n', percent: 'p', fixed: 'f' };

export function useEditorData() {
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties') });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api<PriceList[]>('/price-lists') });
  const prices = useQuery({ queryKey: ['prices'], queryFn: () => api<Prices>('/prices') });
  const rules = useQuery({ queryKey: ['commission-rules'], queryFn: () => api<{ category: string; kind: string; value: string }[]>('/commission-rules') });
  const refs = useQuery({ queryKey: ['referrers'], queryFn: () => api<Referrer[]>('/referrers') });
  const settings = useSettings();
  const biz = useBiz();
  if (!items.data || !parties.data || !lists.data || !prices.data || !settings.data || !biz.data || !rules.data || !refs.data) return null;
  const data = settings.data.data as { reg?: string; tcs?: boolean; tcsRate?: string };
  const mode = taxModeOf(settings.data.gstEnabled, data.reg);
  const tcs = mode === 'gst' && data.tcs && data.tcsRate ? settings.data.taxes.find((t) => t.id === data.tcsRate) : undefined;
  const active = lists.data.filter((l) => l.active);
  const def = lists.data.find((l) => l.isDefault) ?? null;
  const listForGroup: Record<string, string> = {};
  for (const l of active) if (!l.isDefault) for (const g of l.groups) listForGroup[g] ??= l.id;
  const ctx: Ctx = {
    mode, state: biz.data.stateCode || '09', tcsRate: tcs ? Number(tcs.rate) : null,
    defaultList: def?.id ?? null, listForGroup, listName: Object.fromEntries(lists.data.map((l) => [l.id, l.name])),
    rules: Object.fromEntries(rules.data.map((r) => [r.category, { t: KIND[r.kind] ?? 'n', v: Number(r.value) }])),
  };
  const pm = new Map(prices.data.items.map((p) => [p.id, p.lists]));
  const IT: EItem[] = items.data.map((i) => ({
    id: i.id, name: i.name, code: i.code, hsn: i.hsn, unit: i.unit, cat: i.category, gst: Number(i.gstRate), stock: i.kind === 'service' ? null : Number(i.stock ?? 0),
    svc: i.kind === 'service', brand: i.brand, series: i.series, grp: i.group, purch: Number(i.purchase), sale: Number(i.sale),
    pl: Object.fromEntries(Object.entries(pm.get(i.id) ?? {}).map(([k, v]) => [k, Number(v.price)])),
  }));
  const PT: EParty[] = parties.data.map((p) => ({
    id: p.id, name: p.name, phone: p.phone, gstin: p.gstin, city: p.billing?.city ?? '', state: p.state, group: p.group, days: p.creditDays ?? 0,
    limit: Number(p.creditLimit ?? 0), supplier: p.kind === 'supplier', balance: Number(p.balance),
  }));
  const gstRates = settings.data.taxes.filter((t) => t.kind === 'GST').map((t) => Number(t.rate));
  return { ctx, IT, PT, gstRates, refs: refs.data, gstOn: settings.data.gstEnabled };
}
export type EditorData = NonNullable<ReturnType<typeof useEditorData>>;

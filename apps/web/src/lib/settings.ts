import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ownerKey, useSession } from './session';
import { curFix } from './format';

export interface ShopSettings {
  gstEnabled: boolean;
  data: Record<string, unknown>;
  taxes: { id: string; kind: string; name: string; rate: string; note: string; isOld: boolean; isDefault: boolean }[];
}

export function useSettings() {
  const token = useSession((s) => s.accessToken);
  const owner = useSession((s) => ownerKey(s.accessToken));
  return useQuery({ queryKey: ['settings', owner], queryFn: () => api<ShopSettings>('/settings'), enabled: !!token, staleTime: 60_000 });
}

/** Text helper that drops "₹" when the shop has the currency symbol switched off (the prototype's default). */
export function useCur(): (t: string) => string {
  const s = useSettings().data;
  const on = !!s?.data?.showCurrency;
  return on ? (t) => t : curFix;
}

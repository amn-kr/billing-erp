import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@billing/shared';
import { api, ApiError } from './api';
import { ownerKey, useSession } from './session';

export const ME_KEY = ['me'] as const;

/** Kept under who the token is for (see ownerKey), so a renewed token keeps the data on screen. */
export const meKey = (tok: string | null) => [...ME_KEY, ownerKey(tok)] as const;

export function useMe() {
  const token = useSession((s) => s.accessToken);
  const owner = useSession((s) => ownerKey(s.accessToken));
  return useQuery({
    queryKey: [...ME_KEY, owner],
    queryFn: () => api<MeResponse>('/me'),
    enabled: !!token,
    staleTime: 30_000,
    // a change the shop's owner made elsewhere (Settings › Features) reaches open screens
    refetchInterval: 5 * 60_000,
    // a dropped connection is retried; "please sign in" / "no access" are final
    retry: (count, e) => e instanceof ApiError && e.status === 0 && count < 5,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
  });
}

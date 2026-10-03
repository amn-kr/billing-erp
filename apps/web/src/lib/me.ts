import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@billing/shared';
import { api, ApiError } from './api';
import { useSession } from './session';

export const ME_KEY = ['me'] as const;

export function useMe() {
  const token = useSession((s) => s.accessToken);
  return useQuery({
    queryKey: [...ME_KEY, token],
    queryFn: () => api<MeResponse>('/me'),
    enabled: !!token,
    staleTime: 30_000,
    // a dropped connection is retried; "please sign in" / "no access" are final
    retry: (count, e) => e instanceof ApiError && e.status === 0 && count < 5,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
  });
}

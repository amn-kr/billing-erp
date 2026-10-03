import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@billing/shared';
import { api } from './api';
import { useSession } from './session';

export const ME_KEY = ['me'] as const;

export function useMe() {
  const token = useSession((s) => s.accessToken);
  return useQuery({ queryKey: [...ME_KEY, token], queryFn: () => api<MeResponse>('/me'), enabled: !!token, staleTime: 30_000 });
}

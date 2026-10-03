import type { Permission, RoleKey } from '@billing/shared';

/** Who is making this request, and for which shop. Built by AuthGuard. */
export interface RequestContext {
  userId: string;
  email: string;
  sessionId: string;
  /** null until the person has created or joined a shop */
  businessId: string | null;
  role: RoleKey | null;
  permissions: Permission[];
  ip: string;
}

import type { Permission, RoleKey } from './permissions.js';

export interface MeUser {
  id: string;
  name: string;
  email: string;
}

export interface MeMembership {
  businessId: string;
  businessName: string;
  businessShort: string;
  businessCode: string;
  city: string;
  gstin: string;
  role: RoleKey;
}

export interface MeBusiness {
  id: string;
  code: string;
  name: string;
  short: string;
  city: string;
  gstin: string;
  state: string;
  gstEnabled: boolean;
  plan: 'trial' | 'paid' | 'expired';
  /** ISO date the trial or paid plan ends (inclusive). */
  planEndsOn: string;
}

export interface MeResponse {
  user: MeUser;
  /** null when the person has no shop yet (show "Set up your shop"). */
  business: MeBusiness | null;
  role: RoleKey | null;
  permissions: Permission[];
  memberships: MeMembership[];
  /** Invites waiting for this email (show "Join <shop>"). */
  invites: { id: string; businessName: string; role: RoleKey }[];
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

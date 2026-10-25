import type { Permission, RoleKey } from './permissions.js';

export interface MeUser {
  id: string;
  name: string;
  email: string;
  /** signed in with a temporary password from the shop owner: choose a new one before anything else */
  mustChangePassword: boolean;
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

/** Settings › General › Team: one person in the shop. */
export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: RoleKey;
  status: string;
  lastLoginAt: string | null;
  joinedAt: string;
  /** also active in another shop: the owner can't reset this account's password */
  inOtherShops: boolean;
}

/** Settings › General › Team: what the server says after "Reset password" (shown once, never again). */
export interface TempPassword {
  temporaryPassword: string;
  expiresAt: string;
}

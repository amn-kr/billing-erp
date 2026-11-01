import type { Permission, RoleKey } from './permissions.js';
import type { FeatureKey } from './features.js';

/** How tightly each person's screens are laid out (Settings › General › Display); Comfortable is the prototype's look. */
export const DENSITY_KEYS = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITY_KEYS)[number];
/** Each person's text size; Normal is the prototype's. */
export const TEXT_SIZE_KEYS = ['small', 'normal', 'large'] as const;
export type TextSize = (typeof TEXT_SIZE_KEYS)[number];

export interface MeUser {
  id: string;
  name: string;
  email: string;
  /** signed in with a temporary password from the shop owner: choose a new one before anything else */
  mustChangePassword: boolean;
  /** this person's own display choices (the same in every shop they belong to) */
  density: Density;
  textSize: TextSize;
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
  /** What the shop's owner turned on in Settings › Features. */
  features: FeatureKey[];
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

/** Recovery codes card: how many unused codes are left from the last set (never the codes themselves). */
export interface RecoveryCodesState {
  left: number;
  total: number;
  madeAt: string | null;
}

/** A new set of recovery codes, shown once right after "Make codes". */
export interface RecoveryCodes {
  codes: string[];
  madeAt: string;
}

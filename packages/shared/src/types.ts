import type { Permission, RoleKey } from './permissions.js';

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

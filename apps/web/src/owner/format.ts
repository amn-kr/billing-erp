/** Dates, money and statuses exactly as reference/design/owner-panel.html shows them. */
import type { OwnerCustomer } from '@billing/shared';

const D = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d);
};
/** 26 Sept 2026 */
export const fmt = (s: string) => D(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const daysLeft = (s: string, today: string) => Math.round((D(s).getTime() - D(today).getTime()) / 864e5);
/** +91 98765 43210 */
export const mobileOf = (m: string) => `+91 ${m.slice(0, 5)} ${m.slice(5)}`;

/** The free trial's length, for the trial bar (TRIAL_DAYS on the server). */
export const TRIAL_DAYS = Number(import.meta.env.VITE_TRIAL_DAYS ?? 14);

export type StatusKey = 'trial' | 'active' | 'soon' | 'expired' | 'susp';
export type Group = 'all' | 'trial' | 'active' | 'expired' | 'susp';

/** the design's status(): suspended, paid (active / ends soon / expired), or trial (days left / ended) */
export function status(c: OwnerCustomer, today: string): { k: StatusKey; t: string } {
  if (c.status === 'suspended') return { k: 'susp', t: 'Suspended' };
  if (c.plan === 'paid' && c.paidUntil && daysLeft(c.paidUntil, today) >= 0) {
    const d = daysLeft(c.paidUntil, today);
    return d <= 7 ? { k: 'soon', t: `Ends in ${d} day${d === 1 ? '' : 's'}` } : { k: 'active', t: 'Active' };
  }
  if (c.plan === 'paid') return { k: 'expired', t: 'Plan expired' };
  const d = daysLeft(c.trialEndsOn, today);
  return d >= 0 ? { k: 'trial', t: `Trial · ${d + 1} day${d === 0 ? '' : 's'} left` } : { k: 'expired', t: 'Trial ended' };
}

export const groupOf = (c: OwnerCustomer, today: string): Exclude<Group, 'all'> => {
  const k = status(c, today).k;
  return k === 'soon' ? 'active' : k;
};

/** the design's "Enrolled via" names and icons */
export const VIA: Record<OwnerCustomer['via'], [string, string]> = { email: ['mail', 'Email'], owner: ['hand', 'Added by you'] };
/** the one paid plan's name (no fixed prices; the amount is typed when a payment is added) */
export const PAID_PLAN = 'Paid';

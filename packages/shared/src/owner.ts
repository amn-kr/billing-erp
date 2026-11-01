/**
 * The software owner's panel (/owner): request shapes and replies shared by the API and the web app.
 * Shop users never see any of this. Kept in one file so the panel can move to its own address later.
 */
import { z } from 'zod';
import { parseIso } from './dates.js';
import { MONEY_MAX, money } from './money.js';

/** The owner's password is longer than a shop user's (no 2-step sign-in yet). */
export const OWNER_PASSWORD_MIN = 12;

export const ownerSetupSchema = z
  .object({
    code: z.string().min(1, 'Enter the setup code.').max(200),
    name: z.string().trim().min(1, 'Enter your name.').max(120),
    email: z.string().trim().toLowerCase().email('That email doesn’t look right.'),
    password: z.string().min(OWNER_PASSWORD_MIN, `Use at least ${OWNER_PASSWORD_MIN} characters for the password.`).max(200),
    password2: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.password2) ctx.addIssue({ code: 'custom', path: ['password2'], message: 'The two passwords don’t match.' });
    else if (v.password.trim().toLowerCase() === v.email) ctx.addIssue({ code: 'custom', path: ['password'], message: 'The password can’t be your email.' });
  });
export type OwnerSetupInput = z.infer<typeof ownerSetupSchema>;

/** The sign-in reply when the email belongs to the software owner: the page goes to /owner. */
export interface OwnerSignIn {
  accessToken: string;
  expiresIn: number;
  owner: true;
}

export interface OwnerMe {
  name: string;
  email: string;
}

export type ShopStatus = 'active' | 'suspended';

/**
 * One customer (shop) in the panel: name, contact, type, plan and status only.
 * The panel never gets a shop's invoices, parties, items or other business data.
 */
export interface OwnerCustomer {
  id: string;
  /** BE-1012 */
  code: string;
  name: string;
  ownerName: string;
  /** the shop's phone, else its owner's (digits as typed) */
  mobile: string;
  /** the shop's email, else its owner's sign-in email */
  email: string;
  /** "General" until business modes are added */
  businessType: string;
  /** how they joined: email + password for everyone today */
  via: 'email' | 'owner';
  /** the day the shop was set up (YYYY-MM-DD, India) */
  enrolled: string;
  /** trial | paid */
  plan: 'trial' | 'paid';
  trialEndsOn: string;
  paidUntil: string | null;
  status: ShopStatus;
}

export interface OwnerCustomers {
  /** today in India, for days left (the tests' frozen date under test) */
  today: string;
  customers: OwnerCustomer[];
}

/** Plan periods in the panel (the design's 1 / 3 / 6 / 12 months). */
export const PLAN_MONTHS = [1, 3, 6, 12] as const;
export type PlanMonths = (typeof PLAN_MONTHS)[number];
/** How a payment came in (the design's "Paid by" list). */
export const PAID_BY = ['UPI', 'Bank transfer', 'Cash', 'Cheque'] as const;
export type PaidBy = (typeof PAID_BY)[number];

/**
 * The last day of a plan period: the same day n months later, minus one day (1 Oct + 1 month → 31 Oct).
 * Same arithmetic as the design (a date's month moved on, then one day back), so a month that has no such day
 * rolls over the way the design does (31 Jan + 1 month → 2 Mar).
 */
export function planEndsOn(start: string, months: number): string {
  const { y, m, d } = parseIso(start);
  const t = new Date(Date.UTC(y, m - 1 + months, d - 1));
  return t.toISOString().slice(0, 10);
}

/** what the "Payment reference" box asks for when it's empty (Cash needs none) */
export const referenceMissing = (by: PaidBy): string =>
  `Enter the ${by === 'UPI' ? 'UPI reference' : by === 'Cheque' ? 'cheque number' : 'UTR number'} so you can match this payment later.`;

const isoDate = z.string().refine((v) => {
  try { parseIso(v); return true; } catch { return false; }
}, 'Choose a start date.');

/** Activate or renew a shop's paid plan with a payment received (the drawer's form). */
export const ownerPlanSchema = z
  .object({
    months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    startsOn: isoDate,
    paidBy: z.enum(PAID_BY),
    amount: z.string().trim().min(1, 'Enter the amount received.').max(20),
    reference: z.string().trim().max(120).default(''),
  })
  .superRefine((v, ctx) => {
    let a;
    try { a = money(v.amount); } catch { a = null; }
    if (!a || !a.isFinite() || a.lte(0) || a.gt(MONEY_MAX) || a.decimalPlaces() > 2) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the amount received, like 1500 or 1500.50.' });
    if (v.paidBy !== 'Cash' && !v.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: referenceMissing(v.paidBy) });
  });
export type OwnerPlanInput = z.input<typeof ownerPlanSchema>;

/** One payment in the drawer's Payment history. */
export interface OwnerPayment {
  id: string;
  /** the day it was entered (YYYY-MM-DD, India) */
  paidOn: string;
  months: number;
  /** rupees with paise, e.g. "1500.00" */
  amount: string;
  paidBy: string;
  reference: string;
  startsOn: string;
  endsOn: string;
}

/** The drawer's details: the customer and their payments (newest first). */
export interface OwnerCustomerDetail {
  customer: OwnerCustomer;
  payments: OwnerPayment[];
}

/**
 * The software owner's panel (/owner): request shapes and replies shared by the API and the web app.
 * Shop users never see any of this. Kept in one file so the panel can move to its own address later.
 */
import { z } from 'zod';

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

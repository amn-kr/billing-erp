/** Request shapes shared by the API (validation) and the web app (forms). */
import { z } from 'zod';
import { GSTIN_RE, PIN_RE, STATE_CODES } from './india.js';
import { ROLE_KEYS } from './permissions.js';

const email = z.string().trim().toLowerCase().email('That email doesn’t look right.');
const password = z.string().min(8, 'Use at least 8 characters for the password.').max(200);

export const registerSchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
  email,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.') });
export type LoginInput = z.infer<typeof loginSchema>;

/** Matches the website's "Set up your shop" form and the prototype's bzCheck rules. */
export const createBusinessSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your business name.').max(160),
    owner: z.string().trim().min(1, 'Enter your name.').max(120),
    phone: z.string().trim().max(20).optional().default(''),
    addr: z.string().trim().max(240).optional().default(''),
    city: z.string().trim().max(80).optional().default(''),
    pin: z.string().trim().optional().default('').refine((v) => !v || PIN_RE.test(v), 'PIN code has 6 digits.'),
    state: z.string().refine((v) => STATE_CODES.includes(v), 'Choose a state.'),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .default('')
      .refine((v) => !v || GSTIN_RE.test(v), 'This GSTIN doesn’t look right — 15 characters, like 09ABCDE1234F1Z5.'),
    inv: z.string().trim().optional().default('1').refine((v) => /^\d{1,6}$/.test(v || '1'), 'First invoice number should be a number.'),
  })
  .superRefine((o, ctx) => {
    if (o.gstin && o.gstin.slice(0, 2) !== o.state)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: `GSTIN starts with ${o.gstin.slice(0, 2)} — choose that state.` });
  });
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export const inviteSchema = z.object({
  email,
  role: z.enum(ROLE_KEYS).refine((r) => r !== 'owner', 'A shop has one owner. Choose another role.'),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({ name: z.string().trim().min(1, 'Enter your name.').max(120) });

/** "Choose a new password" after signing in with a temporary one. */
export const changePasswordSchema = z.object({ current: z.string().min(1, 'Enter your current password.').max(200), password });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changeRoleSchema = z.object({ role: z.enum(ROLE_KEYS) });

export const switchBusinessSchema = z.object({ businessId: z.string().uuid() });

/** First message of a zod error, in the plain wording shown under forms. */
export const firstError = (e: z.ZodError): string => e.issues[0]?.message ?? 'Something went wrong.';

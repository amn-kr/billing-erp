/** Banking & cash (prototype ACCTS / BTX): bank accounts, cash in hand, money moved between them. */
import { z } from 'zod';

const trim = z.string().trim();
const opt = (max = 200) => trim.max(max).optional().default('');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
/** a signed amount sent as text or number; blank = 0 */
const signed = z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/[,₹\s]/g, '');
  if (s === '') return '0';
  if (!Number.isFinite(Number(s))) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a number.' }); return z.NEVER; }
  return s;
});

export const BANK_TYPES = ['Current account', 'Savings account', 'Overdraft (OD)', 'Cash credit (CC)'] as const;

/** Add / edit a bank account, or the cash account's opening balance (prototype bamSave). */
export const cashBankAccountSchema = z.object({
  name: opt(80), sub: opt(60), accountNo: opt(18), ifsc: opt(11), branch: opt(120),
  openingBalance: signed, openingDate: isoDate.nullable().optional(),
  /** payments by UPI, card and bank transfer go to this account */
  isDefault: z.boolean().optional().default(false),
});
export type CashBankAccountInput = z.infer<typeof cashBankAccountSchema>;

/** Move money (prototype bmm): bank to bank, deposit / withdraw cash, add / take out money. */
export const BANK_MOVE_KINDS = ['transfer', 'deposit', 'withdraw', 'in', 'out'] as const;
export const BANK_CATEGORIES = {
  in: ['Interest received', 'Capital added by owner', 'Loan received', 'Other income', 'Other'],
  out: ['Bank charges', 'Shop expense', 'Owner drawings', 'Loan repayment', 'Salary', 'Other'],
} as const;
export const bankEntrySchema = z.object({
  kind: z.enum(BANK_MOVE_KINDS),
  date: isoDate,
  amount: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/[,₹\s]/g, '')),
  fromId: z.string().uuid().nullable().optional(),
  toId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  category: opt(60), reference: opt(80), note: opt(200),
  /** sent back unchanged when a saved one is edited: the server refuses a different number */
  number: z.string().trim().max(40).optional(),
});
export type BankEntryInput = z.infer<typeof bankEntrySchema>;

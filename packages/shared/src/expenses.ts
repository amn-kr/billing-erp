/** Expenses (prototype EXPS / ECATS): shop spending paid from cash or a bank, sorted into categories. */
import { z } from 'zod';
import { money, round2, type Money } from './money.js';

const trim = z.string().trim();
const opt = (max = 200) => trim.max(max).optional().default('');
const isoDate = z.string({ required_error: 'Pick the date.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.');
const numText = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined ? '' : String(v).replace(/[,₹\s]/g, '')));

export const XP_MODES = ['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque'] as const;
export const XP_GST = [0, 5, 12, 18, 28] as const;
/** categories the cash and bank book also uses (prototype BT_EXCAT): they keep their names */
export const BOOK_EXPENSE_CATEGORY: Record<string, string> = { 'Shop expense': 'Shop expenses', Salary: 'Salary & wages', 'Bank charges': 'Bank charges' };

export const expenseLineSchema = z.object({ name: opt(200), qty: numText, rate: numText, gst: numText, amt: numText });
export const expenseSchema = z.object({
  categoryId: z.string({ required_error: 'Choose a category.' }).uuid({ message: 'Choose a category.' }),
  date: isoDate,
  payee: opt(120), reference: opt(80), notes: opt(500),
  mode: z.enum(XP_MODES).default('Cash'),
  accountId: z.string().uuid().nullable().optional(),
  lines: z.array(expenseLineSchema).max(100).default([]),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

/** GST inside an amount that includes it (prototype exGst): amt − amt / (1 + rate/100), not rounded. */
export const gstInside = (amt: Money | string | number, rate: number): Money => {
  const a = money(amt);
  return rate ? a.minus(a.div(money(rate).div(100).plus(1))) : money(0);
};
/** An expense's total and GST (prototype exTot / exGst), each rounded once. */
export const expenseTotals = (lines: { amt: Money | string | number; gst: number }[]) => ({
  total: round2(lines.reduce((s, l) => s.plus(money(l.amt)), money(0))),
  gst: round2(lines.reduce((s, l) => s.plus(gstInside(l.amt, l.gst)), money(0))),
});

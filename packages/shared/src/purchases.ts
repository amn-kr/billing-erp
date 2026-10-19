/** Purchases (prototype PDOCS / PPAYS): bills, orders, debit notes and payments made. */
import { z } from 'zod';
import { daysBetween } from './dates.js';
import { money, type Money, type MoneyInput } from './money.js';

const trim = z.string().trim();
const opt = (max = 200) => trim.max(max).optional().default('');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
/** a money / quantity value sent as text or number; blank = 0 */
const num = (msg = 'Enter a number.') =>
  z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
    const s = v === null || v === undefined ? '' : String(v).replace(/[,₹\s]/g, '');
    if (s === '') return '0';
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg }); return z.NEVER; }
    return s;
  });
const optNum = z.union([z.string(), z.number(), z.null()]).optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).replace(/[,₹\s]/g, '')))
  .refine((v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0), 'Enter a number.');

/** how a supplier is paid (prototype PU_MODES) */
export const PU_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque'] as const;
export type PuMode = (typeof PU_MODES)[number];
export const DN_REASONS = ['Damaged goods', 'Wrong item sent', 'Extra quantity', 'Rate difference', 'Other'] as const;
/** numbers: PB-0001 bills, ORD-0001 orders, DN-0001 debit notes, PO-0001 payments made */
export const PURCHASE_KIND = { bill: 'Purchase bill', order: 'Purchase order', debit_note: 'Debit note' } as const;

export const purchaseLineSchema = z.object({
  itemId: z.string().uuid({ message: 'Pick the item from the list.' }),
  name: opt(200), hsn: opt(8), unit: opt(20),
  qty: num('Enter the quantity.'), rate: num('Enter the rate.'), discPct: num('Enter the discount.'), gstRate: num('Choose the GST rate.'),
});
export const puPayPartSchema = z.object({ mode: z.enum(PU_MODES), amount: num('Enter the amount.'), ref: opt(80) });

export const purchaseSchema = z.object({
  kind: z.enum(['bill', 'order', 'debit_note']),
  /** blank = next number in the series */
  number: opt(40),
  /** the supplier's own bill number (bill), quotation ref. (order) */
  supplierRef: opt(60),
  date: isoDate,
  /** bill: due date; order: expected delivery */
  dueDate: isoDate.nullable().optional(),
  partyId: z.string().uuid({ message: 'Choose the supplier.' }),
  pricesInclTax: z.boolean().default(false),
  roundOff: z.boolean().default(true),
  billDiscPct: optNum, billDiscAmt: optNum, transport: num(), labour: num(),
  lines: z.array(purchaseLineSchema).max(500),
  /** bill only: paid with the bill */
  payments: z.array(puPayPartSchema).max(10).optional().default([]),
  /** bill only: set each item's purchase price from this bill */
  updatePrices: z.boolean().optional().default(false),
  /** debit note: the bill it returns against, and why */
  againstId: z.string().uuid().nullable().optional(),
  reason: z.enum(DN_REASONS).optional().default('Damaged goods'),
  /** bill made from an order (the order is marked received) */
  fromOrderId: z.string().uuid().nullable().optional(),
  notes: opt(2000),
  extra: z.object({ ewb: opt(20), transport: opt(120), vehicle: opt(60), deliveryDate: opt(10), description: opt(2000), attachments: z.array(trim.max(200)).max(20).optional().default([]) }).partial().default({}),
});
export type PurchaseInput = z.infer<typeof purchaseSchema>;

export const paymentOutSchema = z.object({
  partyId: z.string().uuid({ message: 'Choose the supplier.' }),
  date: isoDate,
  amount: num('Enter the amount paid.'),
  mode: z.enum(PU_MODES),
  ref: opt(80),
  notes: opt(500),
  /** bills paid: a bill id, or "opening" for the opening balance */
  allocations: z.array(z.object({ to: z.string().min(1), amount: num() })).max(200).optional().default([]),
});
export type PaymentOutInput = z.infer<typeof paymentOutSchema>;

/**
 * Money paid with a bill (prototype savePE): the parts fill the room left on the bill in order;
 * a part that doesn't fit is cut down, the rest is dropped. On a new bill the room is the total;
 * on an edited one it is the total less what payments out and debit notes already settle.
 */
export function payPartsUpTo<T extends { amount: MoneyInput }>(parts: T[], room: MoneyInput): (T & { amt: Money })[] {
  let left = money(room);
  const out: (T & { amt: Money })[] = [];
  for (const p of parts) {
    const want = money(p.amount);
    if (!want.gt(0)) continue;
    const amt = want.lt(left) ? want : left;
    if (!amt.gt(0)) break;
    left = left.minus(amt);
    out.push({ ...p, amt });
  }
  return out;
}

/** What an edited bill's total can't go below: what payments out and debit notes already settle on it. */
export function billTotalTooLow(total: MoneyInput, settledElsewhere: MoneyInput): boolean {
  return money(total).lt(money(settledElsewhere));
}

/** Status chip for a purchase bill (prototype billStatus). */
export function billStatus(b: { total: number; balance: number; due?: string | null; cancelled?: boolean }, today: string): { t: string; c: string } {
  if (b.cancelled) return { t: 'Cancelled', c: 'x' };
  if (b.balance <= 0) return { t: 'Paid', c: 'g' };
  const od = b.due ? daysBetween(b.due, today) : 0;
  if (od > 0) return { t: `Overdue ${od} day${od > 1 ? 's' : ''}`, c: 'r' };
  if (b.balance < b.total) return { t: 'Partly paid', c: 'b' };
  return od === 0 && b.due ? { t: 'Due today', c: 'a' } : { t: b.due ? `Due in ${-od} days` : 'Unpaid', c: 'b' };
}

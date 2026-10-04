/**
 * Sales documents: invoice, item-wise quotation, receipt, credit note, delivery challan.
 * The shapes the web app sends and the API checks. Wording of the business checks
 * (party missing, quantity …) lives in the API so it can name the item; these
 * schemas only make sure the shape is right.
 */
import { z } from 'zod';
import { daysBetween } from './dates.js';
import { money, round2, type Money, type MoneyInput } from './money.js';

const trim = z.string().trim();
const opt = (max = 200) => trim.max(max).optional().default('');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
/** a money / quantity value sent as text or number; blank = 0 */
const num = (msg = 'Enter a number.') =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const s = v === null || v === undefined ? '' : String(v).replace(/[,₹\s]/g, '');
      if (s === '') return '0';
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
        return z.NEVER;
      }
      return s;
    });
const optNum = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).replace(/[,₹\s]/g, '')))
  .refine((v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0), 'Enter a number.');

export const PAY_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'] as const;
export type PayMode = (typeof PAY_MODES)[number];
export const CN_REASONS = ['Damaged goods', 'Wrong item', 'Extra quantity', 'Customer changed mind', 'Rate difference', 'Other'] as const;

/** Commission rule: n = none, p = % of the sale price, f = ₹ per unit. */
export const commRuleSchema = z.object({ t: z.enum(['n', 'p', 'f']), v: z.coerce.number().min(0).max(1_000_000).default(0) });
export type CommRule = z.infer<typeof commRuleSchema>;

export const saleLineSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  name: opt(200),
  hsn: opt(8),
  qty: num('Enter the quantity.'),
  unit: opt(20),
  /** price-list rate (with any referral commission loaded on it) */
  price: num('Enter the rate.'),
  discPct: num('Enter the discount.'),
  gstRate: num('Choose the GST rate.'),
  /** referral: the rate before commission, and a rule set for this line only */
  basePrice: optNum,
  commOverride: commRuleSchema.nullable().optional(),
});
export type SaleLineInput = z.infer<typeof saleLineSchema>;

export const payPartSchema = z.object({ mode: z.enum(PAY_MODES), amount: num('Enter the amount.'), ref: opt(80) });
export type PayPart = z.infer<typeof payPartSchema>;

/** Printed extras kept with the document. */
export const saleExtraSchema = z
  .object({
    challanNo: opt(40), poNo: opt(60), poDate: opt(10), ewb: opt(20), transport: opt(120), vehicle: opt(60), deliveryDate: opt(10),
    description: opt(2000), attachments: z.array(trim.max(200)).max(20).optional().default([]),
    quoteRefs: z.array(z.object({ no: trim.max(40), date: opt(10), cust: opt(160), brand: opt(80) })).max(20).optional().default([]),
    validTill: opt(10),
    /** referral rules changed for this bill only, per item category name */
    commByCategory: z.record(z.string(), commRuleSchema).optional().default({}),
  })
  .partial()
  .default({});

export const saleSchema = z.object({
  kind: z.enum(['invoice', 'quotation']).default('invoice'),
  /** blank = next number in the series */
  number: opt(40),
  date: isoDate,
  dueDate: isoDate.nullable().optional(),
  mode: z.enum(['credit', 'cash']).default('credit'),
  partyId: z.string().uuid().nullable().optional(),
  cashName: opt(160),
  cashPhone: opt(20).transform((v) => v.replace(/\s/g, '')),
  billName: opt(160),
  placeOfSupply: opt(2),
  pricesInclTax: z.boolean().default(true),
  roundOff: z.boolean().default(true),
  billDiscPct: optNum,
  billDiscAmt: optNum,
  transport: num(),
  labour: num(),
  bankCharge: num(),
  lines: z.array(saleLineSchema).max(500),
  payments: z.array(payPartSchema).max(10).optional().default([]),
  notes: opt(2000),
  extra: saleExtraSchema,
  referrerId: z.string().uuid().nullable().optional(),
  /** the quotations and challan this invoice was made from (marked converted / invoiced on save) */
  fromQuotationIds: z.array(z.string().uuid()).max(20).optional().default([]),
  fromChallanId: z.string().uuid().nullable().optional(),
  /** the person pressed Save again after the credit-limit warning */
  confirmOverLimit: z.boolean().optional().default(false),
});
export type SaleInput = z.infer<typeof saleSchema>;

export const receiptSchema = z.object({
  partyId: z.string().uuid({ message: 'Choose the customer.' }),
  date: isoDate,
  amount: num('Enter the amount received.'),
  mode: z.enum(PAY_MODES),
  ref: opt(80),
  notes: opt(500),
  /** dues settled: an invoice id, or "opening" for the opening balance */
  allocations: z.array(z.object({ to: z.string().min(1), amount: num() })).max(200).optional().default([]),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const creditNoteSchema = z.object({
  /** null = counter sales (no account) */
  partyId: z.string().uuid().nullable(),
  date: isoDate,
  reason: z.enum(CN_REASONS).default('Damaged goods'),
  settle: z.enum(['adjust', 'refund']).default('adjust'),
  refundMode: z.enum(['Cash', 'UPI', 'Bank transfer']).default('Cash'),
  lines: z
    .array(z.object({ invoiceId: z.string().uuid().nullable().optional(), itemId: z.string().uuid(), qty: num('Enter the quantity.'), price: num('Enter the rate.'), gstRate: num() }))
    .max(500),
});
export type CreditNoteInput = z.infer<typeof creditNoteSchema>;

export const challanSchema = z.object({
  partyId: z.string().uuid().nullable().optional(),
  cashName: opt(160),
  cashPhone: opt(20).transform((v) => v.replace(/\D/g, '')),
  date: isoDate,
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: num('Enter the quantity.') })).max(500),
  transport: opt(120),
  vehicle: opt(60),
  note: opt(500),
});
export type ChallanInput = z.infer<typeof challanSchema>;

export const cancelSchema = z.object({ reason: opt(500) });

/**
 * Status chip for a sale (prototype txStatus): Paid, Overdue n days, Due today,
 * Partly paid, Due in n days, Unpaid, Cancelled. `c` is the chip colour class.
 */
export function saleStatus(s: { total: number; balance: number; due?: string | null; cancelled?: boolean }, today: string): { t: string; c: string } {
  if (s.cancelled) return { t: 'Cancelled', c: 'x' };
  if (s.balance <= 0) return { t: 'Paid', c: 'g' };
  const od = s.due ? daysBetween(s.due, today) : 0;
  if (s.due && od > 0) return { t: `Overdue ${od} day${od > 1 ? 's' : ''}`, c: od > 14 ? 'r' : 'a' };
  if (s.due && od === 0) return { t: 'Due today', c: 'a' };
  if (s.balance < s.total) return { t: 'Partly paid', c: 'b' };
  return { t: s.due ? `Due in ${-od} days` : 'Unpaid', c: 'b' };
}

/**
 * Referral commission on one line (prototype lineComm): qty × (1 − disc%) × (rate − base),
 * without GST when prices include GST.
 */
export function lineCommission(
  l: { qty: MoneyInput; discPct: MoneyInput; price: MoneyInput; basePrice: MoneyInput | null | undefined; gstRate: MoneyInput },
  inclGst: boolean,
): Money {
  if (l.basePrice === null || l.basePrice === undefined) return money(0);
  const net = money(l.qty).times(money(1).minus(money(l.discPct).div(100))).times(money(l.price).minus(money(l.basePrice)));
  const g = money(l.gstRate);
  return round2(inclGst && !g.isZero() ? net.div(g.div(100).plus(1)) : net);
}

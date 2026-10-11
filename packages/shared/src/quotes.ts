/**
 * Brand-wise quotations (prototype vQuo): rows of item groups against brand ranges. Every rate
 * comes from the item in Price manager whose group, brand and series match the cell.
 */
import { z } from 'zod';

export interface QuoteRow { id: string; n: string; c: 'acc' | 'plate'; grp?: string }
export interface QuoteSeries { id: string; b: string; r: string; f: string }
export interface QuoteGrid { rows: QuoteRow[]; ser: QuoteSeries[] }

/** the item group a row stands for, and the series text of a range (prototype qGrp / qSeries) */
export const qGrp = (r: QuoteRow) => r.grp || r.n;
export const qSeries = (s: QuoteSeries) => (s.f && !/^white$/i.test(s.f) ? `${s.r} ${s.f}` : s.r);
export const qSerName = (s: QuoteSeries) => `${s.b} ${s.r}${s.f ? ' ' + s.f : ''}`;

const id = z.string().trim().min(1).max(40);
export const quoteGridSchema = z.object({
  rows: z.array(z.object({ id, n: z.string().trim().min(1, 'Enter the item name.').max(80), c: z.enum(['acc', 'plate']), grp: z.string().trim().max(80).optional() })).max(200),
  ser: z.array(z.object({ id, b: z.string().trim().min(1, 'Enter the brand name.').max(60), r: z.string().trim().min(1, 'Enter the range name, for example Coral.').max(60), f: z.string().trim().max(40).default('') })).max(60),
});

/** "+ Add item row" on the Quotation page */
export const quoteRowSchema = z.object({ n: z.string().trim().min(1, 'Enter the item name.').max(80), c: z.enum(['acc', 'plate']) });

export const brandQuoteSchema = z.object({
  /** blank = next number in the series */
  number: z.string().trim().max(40).optional().default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  cust: z.string().trim().max(120).optional().default(''),
  priceListId: z.string().uuid().nullable().optional(),
  disc: z.coerce.number().min(0).max(100).default(0),
  sel: z.array(id).max(60),
  qty: z.record(id, z.coerce.number().positive().max(1_000_000)).refine((q) => Object.keys(q).length > 0, 'Enter at least one quantity first'),
  referrerId: z.string().uuid().nullable().optional(),
  /** what the saved list shows (prototype qSnapshot) */
  items: z.coerce.number().int().min(0),
  pcs: z.coerce.number().min(0),
  low: z.object({ name: z.string().max(200), total: z.coerce.number().min(0) }).nullable(),
});
export type BrandQuoteInput = z.input<typeof brandQuoteSchema>;

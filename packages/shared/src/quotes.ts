/**
 * Brand-wise quotations (prototype vQuo): rows of item groups against brand ranges. Every rate
 * comes from the item in Price manager whose group, brand and series match the cell.
 */
import { z } from 'zod';

export interface QuoteRow { id: string; n: string; c: 'acc' | 'plate'; grp?: string }
export interface QuoteSeries { id: string; b: string; r: string; f: string }
export interface QuoteGrid { rows: QuoteRow[]; ser: QuoteSeries[] }

/** The prototype's starting grid (QDEF). */
export const DEFAULT_QUOTE_GRID: QuoteGrid = {
  rows: [
    { id: 'r1', n: 'Bell switch 1M', c: 'acc' }, { id: 'r2', n: '6A switch 1M', c: 'acc', grp: 'Modular switch 6A' }, { id: 'r3', n: '16A switch 1M', c: 'acc' },
    { id: 'r4', n: '6A socket', c: 'acc', grp: 'Modular socket 6A' }, { id: 'r5', n: '10A socket', c: 'acc' }, { id: 'r6', n: '16A socket', c: 'acc' },
    { id: 'r7', n: 'Indicator', c: 'acc' }, { id: 'r8', n: 'Fan regulator 1M', c: 'acc' }, { id: 'r9', n: 'Fan regulator 2M', c: 'acc' },
    { id: 'r10', n: 'Mini MCB 6A–20A', c: 'acc' }, { id: 'r11', n: 'Mini MCB 25A–32A', c: 'acc' }, { id: 'r12', n: 'Blank plate', c: 'acc' }, { id: 'r13', n: 'TV socket', c: 'acc' }, { id: 'r14', n: 'USB charger', c: 'acc' },
    { id: 'p1', n: 'Plate 1/2M', c: 'plate' }, { id: 'p2', n: 'Plate 3M', c: 'plate' }, { id: 'p3', n: 'Plate 4M', c: 'plate' }, { id: 'p4', n: 'Plate 6M', c: 'plate' },
    { id: 'p5', n: 'Plate 8M (H)', c: 'plate' }, { id: 'p6', n: 'Plate 12M', c: 'plate' }, { id: 'p7', n: 'Plate 16M', c: 'plate' }, { id: 'p8', n: 'Plate 18M', c: 'plate' },
  ],
  ser: [
    { id: 's1', b: 'Havells', r: 'Coral', f: 'White' }, { id: 's2', b: 'Havells', r: 'Adiva', f: 'White' }, { id: 's3', b: 'Legrand', r: 'Myrius', f: 'White' },
    { id: 's4', b: 'Anchor', r: 'Roma', f: 'White' }, { id: 's5', b: 'GM', r: 'G-Era', f: 'White' }, { id: 's6', b: 'Goldmedal', r: 'Nixon', f: 'White' },
  ],
};

/** the item group a row stands for, and the series text of a range (prototype qGrp / qSeries) */
export const qGrp = (r: QuoteRow) => r.grp || r.n;
export const qSeries = (s: QuoteSeries) => (s.f && !/^white$/i.test(s.f) ? `${s.r} ${s.f}` : s.r);
export const qSerName = (s: QuoteSeries) => `${s.b} ${s.r}${s.f ? ' ' + s.f : ''}`;

const id = z.string().trim().min(1).max(40);
export const quoteGridSchema = z.object({
  rows: z.array(z.object({ id, n: z.string().trim().min(1, 'Enter the item name.').max(80), c: z.enum(['acc', 'plate']), grp: z.string().trim().max(80).optional() })).max(200),
  ser: z.array(z.object({ id, b: z.string().trim().min(1, 'Enter the brand name.').max(60), r: z.string().trim().min(1, 'Enter the range name, for example Coral.').max(60), f: z.string().trim().max(40).default('') })).max(60),
});

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

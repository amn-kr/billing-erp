/**
 * Form rules for parties, items, godowns, stock and prices — the same checks
 * and wording as the prototype's dialogs (apSave, saveItem, gdForm, adjSave …).
 * Shared by the API (validation) and the web app (forms).
 */
import { z } from 'zod';
import { GSTIN_RE, PIN_RE, STATE_CODES } from './india.js';

const trim = z.string().trim();
const opt = (max = 200) => trim.max(max).optional().default('');
/** "25,000" → "25000"; blank → null; anything else must be a number ≥ 0 */
const amount = (msg = 'Enter a number.') =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === '') return null;
      const n = Number(String(v).replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
        return z.NEVER;
      }
      return String(v).replace(/[,₹\s]/g, '');
    });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const partySchema = z
  .object({
    name: trim.min(1, 'Enter the party name.').max(160),
    kind: z.enum(['customer', 'supplier']).default('customer'),
    group: opt(80),
    phone: opt(20).transform((v) => v.replace(/\s/g, '')).refine((v) => !v || /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number.'),
    email: opt(160).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email address.'),
    gstin: opt(15).transform((v) => v.toUpperCase()).refine((v) => !v || GSTIN_RE.test(v), 'GSTIN has 15 characters, like 09AAJPM7745Q1Z2.'),
    gstType: opt(80),
    state: opt(2).refine((v) => !v || STATE_CODES.includes(v), 'Choose a state.'),
    billing: z.object({ line: opt(240), city: opt(80), pin: opt(6).refine((v) => !v || PIN_RE.test(v), 'PIN code has 6 digits.'), state: opt(2) }).optional(),
    shipping: opt(240),
    creditLimit: amount('Enter the credit limit amount.'),
    creditDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
    openingBalance: amount(),
    openingType: z.enum(['receive', 'pay']).optional(),
    openingDate: isoDate.optional(),
    contacts: z.array(z.object({ label: trim.min(1).max(60), value: trim.max(200) })).max(20).optional().default([]),
  });
export type PartyInput = z.infer<typeof partySchema>;
export const partyUpdateSchema = partySchema.partial();

export const itemSchema = z.object({
  name: trim.min(1, 'Enter the item name.').max(200),
  kind: z.enum(['goods', 'service']).default('goods'),
  code: opt(60),
  hsn: opt(8).refine((v) => !v || /^\d{4,8}$/.test(v), 'HSN/SAC is 4 to 8 digits.'),
  unit: opt(20).transform((v) => v.toUpperCase()),
  category: opt(80),
  brand: opt(80),
  group: opt(160),
  series: opt(80),
  gstRate: z.coerce.number().min(0).max(100).optional().default(0),
  sale: amount(),
  purchase: amount(),
  mrp: amount(),
  listPrice: amount(),
  wholesale: amount(),
  wholesaleMinQty: amount(),
  minStock: amount(),
  location: opt(80),
  /** opening stock (goods only) */
  openingQty: amount(),
  openingRate: amount(),
  openingDate: isoDate.optional(),
});
export type ItemInput = z.infer<typeof itemSchema>;
export const itemUpdateSchema = itemSchema.omit({ openingQty: true, openingRate: true, openingDate: true }).partial();

export const godownSchema = z.object({
  name: trim.min(1, 'Enter the godown name.').max(80),
  address: opt(240),
  manager: opt(120),
  phone: opt(20).transform((v) => v.replace(/\s/g, '')).refine((v) => !v || /^\d{10}$/.test(v), 'Enter a 10-digit mobile number.'),
});
export type GodownInput = z.infer<typeof godownSchema>;

export const stockAdjustmentSchema = z.object({
  itemId: z.string().uuid('Choose an item.'),
  godownId: z.string().uuid().optional(),
  /** add or reduce */
  mode: z.enum(['add', 'reduce']),
  qty: z.coerce.number({ invalid_type_error: 'Enter the quantity.' }).positive('Enter the quantity.'),
  rate: amount(),
  date: isoDate,
  reason: opt(200),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const stockTransferSchema = z
  .object({
    itemId: z.string().uuid('Choose an item.'),
    fromGodownId: z.string().uuid(),
    toGodownId: z.string().uuid(),
    qty: z.coerce.number({ invalid_type_error: 'Enter the quantity.' }).positive('Enter the quantity.'),
    date: isoDate,
    note: opt(200),
  })
  .refine((o) => o.fromGodownId !== o.toGodownId, { message: 'Choose two different godowns.', path: ['toGodownId'] });
export type StockTransferInput = z.infer<typeof stockTransferSchema>;

export const priceListSchema = z.object({
  name: trim.min(1, 'Enter a name for the price list.').max(80),
  rule: z.enum(['disc', 'mark']),
  value: z.coerce.number({ invalid_type_error: 'Enter the percentage.' }).min(0, 'Enter the percentage.').max(1000),
  roundTo: z.coerce.number().min(0).max(1000).optional().default(0),
  groups: z.array(trim.min(1)).max(50).optional().default([]),
});
export type PriceListInput = z.infer<typeof priceListSchema>;

export const PRICE_FIELDS = ['sale', 'purchase', 'mrp', 'listPrice', 'wholesale'] as const;
export const pinSchema = z.string().regex(/^\d{4}$/, 'Enter 4 digits.');

/** A price field of an item, or `pl:<price list id>` for an item's own price in that list. */
export const priceFieldSchema = z.union([z.enum(PRICE_FIELDS), z.string().regex(/^pl:[0-9a-f-]{36}$/i, 'Unknown price.')]);

export const priceChangesSchema = z.object({
  how: opt(200),
  /** the price PIN (Price Setup); checked by the server on every change */
  pin: pinSchema,
  changes: z
    .array(
      z
        .object({
          itemId: z.string().uuid(),
          field: priceFieldSchema,
          /** null only for a price-list field: back to the list's rule */
          value: z.union([z.null(), z.coerce.number().min(0).max(999_999_999_999)]),
        })
        .refine((c) => c.value !== null || c.field.startsWith('pl:'), { message: 'Enter a price.', path: ['value'] }),
    )
    .min(1, 'No prices would change')
    .max(5000),
});
export type PriceChangesInput = z.infer<typeof priceChangesSchema>;

export const referrerSchema = z.object({
  name: trim.min(1, 'Enter the name.').max(120),
  phone: opt(20).transform((v) => v.replace(/\s/g, '')).refine((v) => !v || /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number.'),
  city: opt(80),
  partyId: z.string().uuid().nullable().optional(),
});

export const commissionRuleSchema = z.object({
  category: trim.min(1),
  kind: z.enum(['none', 'percent', 'fixed']),
  value: z.coerce.number().min(0).max(100000).optional().default(0),
});

export const nameSchema = z.object({ name: trim.min(1, 'Enter a name.').max(80) });
export const unitSchema = z.object({ code: trim.min(1, 'Enter a unit.').max(20).transform((v) => v.toUpperCase()) });

/**
 * Settings › Items: the words and date formats a shop's owner chose, and the unit a new item starts with
 * (business_settings.item_options, owner's request, 3 Nov 2026). Only what the owner changed is stored: a word
 * left alone is whatever each screen says today, so a shop that changed nothing looks exactly as before.
 */
import { z } from 'zod';
import { batchDateShown, batchDateText, batchDay, type BatchDateKind } from './batches.js';

export const BATCH_DATE_FORMATS = ['month', 'mm/yy', 'dd/mm/yy'] as const;
export type BatchDateFormat = (typeof BATCH_DATE_FORMATS)[number];
export const BATCH_DATE_FORMAT_NAMES: Record<BatchDateFormat, string> = { month: 'Mar 2027 (as today)', 'mm/yy': 'mm/yy', 'dd/mm/yy': 'dd/mm/yy' };

export const ITEM_LABELS = ['batch', 'exp', 'mfg', 'mrp', 'location'] as const;
export type ItemLabel = (typeof ITEM_LABELS)[number];
/** What each label box shows while the owner hasn't typed a word. */
export const ITEM_LABEL_DEFAULTS: Record<ItemLabel, string> = { batch: 'Batch no.', exp: 'Expiry', mfg: 'Mfg', mrp: 'MRP', location: 'Location' };

const label = z.string().trim().min(1, 'Type a label, or clear the box for the usual word.').max(20, 'Up to 20 characters.');
const format = z.enum(BATCH_DATE_FORMATS);
export const itemOptionsSchema = z.object({
  labels: z.object({ batch: label, exp: label, mfg: label, mrp: label, location: label }).partial().strict().default({}),
  expFormat: format.optional(),
  mfgFormat: format.optional(),
  defaultUnit: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()).optional(),
}).strict();
export type ItemOptions = z.infer<typeof itemOptionsSchema>;

/** What is stored, made safe to read: anything not understood (a backup from another version) counts as not changed. */
export function readItemOptions(stored: unknown): ItemOptions {
  const r = itemOptionsSchema.safeParse(stored ?? {});
  return r.success ? r.data : { labels: {} };
}

/** How a shop's batch screens read: whether its dates show, in which words and format. */
export interface BatchView {
  exp: boolean;
  mfg: boolean;
  expFormat: BatchDateFormat;
  /** what the owner typed in Settings › Items, else the word this screen always used */
  word: (label: ItemLabel, usual: string) => string;
  /** a saved date as text */
  expText: (d: string | null | undefined) => string;
  mfgText: (d: string | null | undefined) => string;
  /** an expiry with its day, for messages */
  expDay: (d: string) => string;
  /** a saved date in its box, and what to type in an empty one */
  boxText: (d: string | null | undefined, kind: BatchDateKind) => string;
  hint: (kind: BatchDateKind) => string;
}
export function batchView(enabled: readonly string[], o: ItemOptions): BatchView {
  const expFormat = o.expFormat ?? 'month', mfgFormat = o.mfgFormat ?? 'month';
  const of = (kind: BatchDateKind) => (kind === 'expiry' ? expFormat : mfgFormat);
  return {
    exp: enabled.includes('exp_date'), mfg: enabled.includes('mfg_date'), expFormat,
    word: (label, usual) => o.labels[label] ?? usual,
    expText: (d) => batchDateShown(d, expFormat), mfgText: (d) => batchDateShown(d, mfgFormat),
    expDay: (d) => (expFormat === 'month' ? batchDay(d) : batchDateShown(d, expFormat)),
    boxText: (d, kind) => batchDateText(d, kind, of(kind)),
    hint: (kind) => (of(kind) === 'dd/mm/yy' ? 'DD/MM/YY' : 'MM/YY'),
  };
}

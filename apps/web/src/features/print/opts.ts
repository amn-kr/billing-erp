/**
 * Settings › Print & invoice: the saved choices (BusinessSettings.data.print) and their
 * defaults. Every printed document reads them through usePrintOpts, so the Settings
 * preview, the preview windows, Print and PDF all follow the same choices.
 */
import { useMemo } from 'react';
import { useSettings } from '../../lib/settings';

export const COLORS: [string, string][] = [['Grey', '#6b7280'], ['Ink', '#151b2e'], ['Blue', '#1d4ed8'], ['Green', '#047857'], ['Maroon', '#9f1239'], ['Purple', '#6d28d9']];
export const NAME_PX = { s: 16, m: 20, l: 24, xl: 28 } as const;
export const TEXT_PX = { s: 11, m: 12, l: 13.5 } as const;
export const MARGIN_PX = { narrow: 18, normal: 30, wide: 48 } as const;
/** paper in CSS px (96 dpi), portrait */
export const PAPER = { A4: [794, 1123], A5: [559, 794] } as const;

export type ColKey = 'sl' | 'name' | 'code' | 'hsn' | 'brand' | 'series' | 'cat' | 'grp' | 'mrp' | 'list' | 'whole' | 'qty' | 'unit' | 'price' | 'discAmt' | 'discPct' | 'txPrice' | 'taxAmt' | 'taxPct' | 'taxable' | 'rate' | 'amount';
/** Item Table Customisation: group, key, default heading, on by default, flags. Only fields our items and bills have. */
export const COLDEF: [1 | 2 | 3, ColKey, string, boolean, { lock?: boolean; n?: boolean; gst?: boolean; disc?: boolean; money?: boolean }?][] = [
  [1, 'sl', '#', true], [1, 'name', 'Item Name', true, { lock: true }], [1, 'code', 'Item Code', false], [1, 'hsn', 'HSN/SAC', false, { gst: true }],
  [2, 'brand', 'Brand', false], [2, 'series', 'Series', false], [2, 'cat', 'Category', false], [2, 'grp', 'Item group', false],
  [2, 'mrp', 'MRP', false, { n: true, money: true }], [2, 'list', 'List price', false, { n: true, money: true }], [2, 'whole', 'Wholesale price', false, { n: true, money: true }],
  [3, 'qty', 'Billed Qty', true, { n: true }], [3, 'unit', 'Unit', true, { n: true }], [3, 'price', 'Price/Unit', false, { n: true, money: true }],
  [3, 'discAmt', 'Discount', false, { n: true, disc: true, money: true }], [3, 'discPct', 'Disc %', false, { n: true, disc: true, money: true }],
  [3, 'txPrice', 'Taxable Price/Unit', false, { n: true, money: true }], [3, 'taxAmt', 'Tax Amount', false, { n: true, gst: true, money: true }], [3, 'taxPct', 'Tax %', false, { n: true, gst: true, money: true }],
  [3, 'taxable', 'Taxable Amount', false, { n: true, money: true }], [3, 'rate', 'Final Rate', true, { n: true, money: true }], [3, 'amount', 'Amount', true, { n: true, lock: true, money: true }],
];
export type ColSet = Record<ColKey, { on: boolean; label: string }>;
export const COLS0 = Object.fromEntries(COLDEF.map(([, k, label, on]) => [k, { on, label }])) as ColSet;

/** Change Transaction Names: only document types this app has. An empty Sale name means "Tax Invoice" on GST bills and "Bill" on others. */
export const NAMES: [key: string, label: string, placeholder: string][] = [
  ['sale', 'Sale', 'Tax Invoice'], ['purchase', 'Purchase', 'Purchase Bill'], ['payIn', 'Payment-In', 'Payment Receipt'], ['payOut', 'Payment-Out', 'Payment Out'],
  ['expense', 'Expense', 'Expense'], ['po', 'Purchase Order', 'Purchase Order'], ['estimate', 'Estimate (our Quotation)', 'Quotation'], ['challan', 'Delivery Challan', 'Delivery Challan'],
  ['credit', 'Credit Note', 'Credit Note'], ['debit', 'Debit Note', 'Debit Note'],
];
export const NAMES0 = Object.fromEntries(NAMES.map(([k]) => [k, ''])) as Record<string, string>;

export const TOP = { title: ['Document name', 'Centred above the box, e.g. TAX INVOICE.'], biz: ['Business & invoice details', 'Your name, address, phone, email, firm name and GSTIN; invoice no., date and challan no.'], bill: ['Bill to', 'Customer name, phone, address and GSTIN.'] } as const;
export const BOT = { bank: ['Bank details & UPI QR', 'Your UPI ID and a QR to pay by UPI.'], terms: ['Terms and conditions', 'The text from Footer.'], sign: ['Signature', '“For <your business>” and the signature text.'] } as const;
export type Top = keyof typeof TOP;
export type Bot = keyof typeof BOT;

export const PRINT_DEF = {
  theme: 'classic' as 'classic' | 'simple', color: '#6b7280',
  showName: true, showAddr: true, showEmail: true, showPhone: true, firm: '',
  paper: 'A4' as keyof typeof PAPER, landscape: false, nameSize: 'm' as keyof typeof NAME_PX, textSize: 'm' as keyof typeof TEXT_PX,
  cols: COLS0, names: NAMES0, bos: false,
  top: ['title', 'biz', 'bill'] as Top[], bot: ['bank', 'terms', 'sign'] as Bot[], hide: [] as string[],
  margin: 'normal' as keyof typeof MARGIN_PX, area: 'fill' as 'auto' | 'fill' | 'min', minRows: '10',
  totalQty: true, received: true, balance: true, partyBal: false, taxTable: true, saved: false, words: true, grouping: true,
  description: true, terms: '', sign: 'Authorized Signatory', payMode: true,
  copies: { orig: true, dup: false, trip: false },
};
export type PrintOpts = typeof PRINT_DEF;

/** saved choices on top of the defaults (anything missing or from an older version falls back) */
export function mergePrint(saved: unknown): PrintOpts {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<PrintOpts>;
  const o = { ...PRINT_DEF, ...s } as PrintOpts;
  o.cols = { ...COLS0 };
  for (const [, k, , , x] of COLDEF) { const c = s.cols?.[k]; if (c) o.cols[k] = { on: x?.lock ? true : !!c.on, label: String(c.label ?? '') }; }
  o.names = { ...NAMES0, ...(s.names ?? {}) };
  o.copies = { ...PRINT_DEF.copies, ...(s.copies ?? {}) };
  const keep = <T extends string>(a: unknown, all: readonly T[]) => { const l = (Array.isArray(a) ? a : []).filter((x): x is T => all.includes(x)); return [...l, ...all.filter((x) => !l.includes(x))]; };
  o.top = keep(s.top, PRINT_DEF.top);
  o.bot = keep(s.bot, PRINT_DEF.bot);
  o.hide = Array.isArray(s.hide) ? s.hide.filter((x) => typeof x === 'string') : [];
  return o;
}

/** The shop's print choices, as every document prints them. */
export function usePrintOpts(): PrintOpts {
  const saved = (useSettings().data?.data as { print?: unknown } | undefined)?.print;
  return useMemo(() => mergePrint(saved), [saved]);
}


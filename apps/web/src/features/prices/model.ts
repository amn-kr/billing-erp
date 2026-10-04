/**
 * Price manager data, in the prototype's terms: fields mrp, lp, purch, sale and
 * `pl:<list id>`; getP / rawOverride / fname as in its code. Money maths uses
 * the shared Decimal helpers.
 */
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { money, roundTo, type Money } from '@billing/shared';
import { api } from '../../lib/api';
import type { Item } from '../items/ItemsPage';

export interface PriceList { id: string; name: string; isDefault: boolean; rule: 'base' | 'disc' | 'mark'; value: string; roundTo: string; active: boolean; groups: string[]; fixedPrices: number }
interface PricesResponse { lists: { id: string; name: string }[]; items: { id: string; lists: Record<string, { price: string; fixed: boolean }> }[] }
interface Catalogue { brands: { name: string }[] }

export interface PItem {
  id: string; name: string; grp: string; code: string; svc: boolean; brand: string; series: string; cat: string; unit: string;
  hsn: string; gst: number; stock: number; legacy: string | null;
  mrp: number; lp: number; purch: number; sale: number;
  /** price-list prices and whether the item has its own price there */
  pl: Record<string, { p: number; own: boolean }>;
}
export type Field = 'mrp' | 'lp' | 'purch' | 'sale' | `pl:${string}`;
export interface Change { i: PItem; f: Field; ov: number; nv: number | null; reset?: boolean }

/** Prototype field → API field */
export const API_FIELD: Record<string, string> = { mrp: 'mrp', lp: 'listPrice', purch: 'purchase', sale: 'sale' };
/** API history field → prototype field */
const HIST_FIELD: Record<string, Field> = { mrp: 'mrp', list: 'lp', purchase: 'purch', sale: 'sale' };

export function usePriceData() {
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api<PriceList[]>('/price-lists') });
  const prices = useQuery({ queryKey: ['prices'], queryFn: () => api<PricesResponse>('/prices') });
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Catalogue>('/catalogue') });
  if (!items.data || !lists.data || !prices.data) return null;
  const pm = new Map(prices.data.items.map((p) => [p.id, p.lists]));
  const IT: PItem[] = items.data.map((i) => ({
    id: i.id, name: i.name, grp: i.group, code: i.code, svc: i.kind === 'service', brand: i.brand, series: i.series, cat: i.category, unit: i.unit,
    hsn: i.hsn, gst: Number(i.gstRate), stock: Number(i.stock ?? 0), legacy: i.legacyId ?? null,
    mrp: Number(i.mrp), lp: Number(i.listPrice), purch: Number(i.purchase), sale: Number(i.sale),
    pl: Object.fromEntries(Object.entries(pm.get(i.id) ?? {}).map(([k, v]) => [k, { p: Number(v.price), own: v.fixed }])),
  }));
  const PLS = lists.data;
  /** active lists other than the default (their own columns) */
  const plCols = PLS.filter((p) => !p.isDefault && p.active);
  const brands = [...new Set([...IT.map((i) => i.brand).filter(Boolean), ...(cat.data?.brands.map((b) => b.name) ?? [])])].sort((a, b) => a.localeCompare(b));
  const FIELDS: [Field, string][] = [['mrp', 'MRP'], ['lp', 'LP (list price)'], ['purch', 'Purchase'], ['sale', 'Retail (sale)'], ...plCols.map((p): [Field, string] => [`pl:${p.id}`, p.name])];
  const fname = (f: string) => FIELDS.find((x) => x[0] === f)?.[1] ?? PLS.find((p) => `pl:${p.id}` === f)?.name ?? f;
  return { IT, PLS, plCols, brands, FIELDS, fname };
}
export type PriceData = NonNullable<ReturnType<typeof usePriceData>>;

export function getP(i: PItem, f: Field): number {
  if (f.startsWith('pl:')) return i.pl[f.slice(3)]?.p ?? 0;
  return i[f as 'mrp' | 'lp' | 'purch' | 'sale'] || 0;
}
/** what Undo puts back: the field's value, or for a list price the own price (null = the list's rule) */
export function rawOverride(i: PItem, f: Field): number | null {
  if (!f.startsWith('pl:')) return getP(i, f);
  const x = i.pl[f.slice(3)];
  return x?.own ? x.p : null;
}
export const histField = (f: string): Field => (f.startsWith('pl:') ? (f as Field) : HIST_FIELD[f] ?? (f as Field));

/** Prototype rnd2(): to the nearest ₹r (0 = paisa), never below 0. */
export const rnd = (v: Money, r: string | number): number => Math.max(0, roundTo(v, r).toNumber());
/** margin % on cost, 2 decimals (prototype mg) */
export const mg = (p: number, c: number) => (c > 0 && p > 0 ? money(p).minus(c).div(c).times(100).toDecimalPlaces(2).toNumber() : null);
/** 2-decimal number (prototype r2) */
export const r2 = (v: Money | number) => money(v).toDecimalPlaces(2).toNumber();

/* Session state that outlives the screen, as the prototype's globals do. */
interface UndoEntry { snap: { id: string; f: Field; old: number | null }[]; how: string; n: number }
interface PmState {
  undo: UndoEntry[];
  /** the PIN while Price Setup is open (memory only; the server checks it on every change) */
  pin: string | null;
  /**
   * The hint beside the filters, as the prototype leaves it: a plain render says "view-only",
   * unlocking says how to edit, locking again says "locked".
   */
  hint: 'view' | 'unlocked' | 'locked';
  psu: { tab: 'rule' | 'item'; q: string; cat: string; brand: string; ser: string };
  /** Brand rules tab: the brand / series picked, brands opened, search */
  pr: { g: string | null; open: string[]; q: string };
  set: (p: Partial<Omit<PmState, 'set'>>) => void;
}
export const usePm = create<PmState>((set) => ({
  undo: [], pin: null, hint: 'view',
  psu: { tab: 'rule', q: '', cat: 'all', brand: 'all', ser: 'all' },
  pr: { g: null, open: [], q: '' },
  set: (p) => set(p),
}));

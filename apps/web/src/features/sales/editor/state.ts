/**
 * The open sale (prototype SI) and the helpers around it: a line for an item
 * (lineFor), the price from the party's price list (unitPrice), the totals
 * (calc, with the shared Decimal maths), commission loading (cmApply) and the
 * final-rate rule (frSet). One sale is open at a time, as in the prototype.
 */
import { createContext, useCallback, useContext } from 'react';
import { create } from 'zustand';
import { useSession } from '../../../lib/session';
import { lineCommission, money, saleTotals, type CommRule, type TaxMode } from '@billing/shared';

export interface EItem {
  id: string; name: string; code: string; hsn: string; unit: string; cat: string; gst: number; stock: number | null; svc: boolean;
  brand: string; series: string; grp: string; purch: number; sale: number;
  /** price on each active price list */
  pl: Record<string, number>;
}
export interface EParty {
  id: string; name: string; phone: string; gstin: string; city: string; state: string; group: string; days: number; limit: number; supplier: boolean; balance: number;
}
export interface Line {
  item: EItem | null; name: string; hsn: string; qty: string | number; unit: string; price: number; disc: number; gst: number;
  /** referral: base rate, rule kind/value, a rule for this line only */
  bp?: number; cmT?: 'p' | 'f'; cmV?: number; cmO?: CommRule;
  /** came from this quotation */
  fromQ?: string;
}
export interface Pay { mode: string; amt: string | number; ref: string }
export interface QRef { no: string; date: string; cust: string; brand: string; id?: string }

export interface SI {
  doc: 'sale' | 'quote';
  /** number shown is the next in the series and follows it until saved (nothing is used up before saving) */
  autoNo: boolean;
  no: string; date: string; due: string; dueTouched: boolean; valid: string;
  mode: 'credit' | 'cash'; party: EParty | null; cashName: string; cashPhone: string; billName: string; pos: string; incl: boolean;
  lines: Line[]; pays: Pay[]; recvTouched: boolean;
  notes: string; roundOff: boolean; warnOk: boolean; err: string; chgOk: boolean;
  challan: string; poNo: string; poDate: string; ewb: string; transport: string; vehicle: string; delivDate: string; desc: string; showDesc: boolean; attach: string[];
  bdisc: string | number; bdiscP: string; chTr: string | number; chLab: string | number; chBank: string | number;
  /** referral */
  ref: string; crOv: Record<string, CommRule> | null;
  qrefs: QRef[]; fromChallanId: string | null; editId: string | null; editOf: string | null; editBal: number; dirty: boolean;
}

export const SI_TT = {
  sale: 'Thank you for your business.\nGoods once sold will not be taken back or exchanged.\nSubject to Lucknow jurisdiction.',
  est: 'This is not a tax invoice.\nThis estimate is valid for 15 days.',
};
export const SI_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'];
export const DG_TERMS: [number, string][] = [[0, 'Due on receipt'], [7, 'Net 7 days'], [15, 'Net 15 days'], [30, 'Net 30 days'], [45, 'Net 45 days'], [60, 'Net 60 days']];

export const r2 = (n: number) => Math.round(n * 100) / 100;
export function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
export const blankLine = (): Line => ({ item: null, name: '', hsn: '', qty: 1, unit: '', price: 0, disc: 0, gst: 18 });

/** Shop context the helpers need. */
export interface Ctx {
  mode: TaxMode; state: string; tcsRate: number | null;
  /** price lists: default id and which party groups use which active list */
  defaultList: string | null; listForGroup: Record<string, string>; listName: Record<string, string>;
  rules: Record<string, CommRule>;
}

export function priceListFor(c: Ctx, p: EParty | null): string | null {
  if (!p) return c.defaultList;
  return c.listForGroup[p.group] ?? c.defaultList;
}
export function unitPrice(c: Ctx, it: EItem, p: EParty | null): number {
  const pl = priceListFor(c, p);
  return pl && it.pl[pl] !== undefined ? it.pl[pl]! : it.sale;
}
export function partyState(c: Ctx, p: EParty | null) {
  if (!p) return c.state;
  if (p.gstin && /^\d{2}/.test(p.gstin)) return p.gstin.slice(0, 2);
  return p.state || c.state;
}

/** Commission rule for a line (prototype siRule). */
export const siRule = (c: Ctx, si: SI, l: Line): CommRule => l.cmO ?? si.crOv?.[l.item!.cat] ?? c.rules[l.item!.cat] ?? { t: 'n', v: 0 };
/** Loads the referral commission on top of the rate, or takes it off (prototype cmApply). */
export function cmApply(c: Ctx, si: SI, l: Line) {
  if (!l.item) return;
  const base = l.bp !== undefined ? l.bp : l.price || 0;
  const r = si.ref ? siRule(c, si, l) : { t: 'n' as const, v: 0 };
  if (si.ref && r.t !== 'n' && r.v > 0) { l.bp = base; l.cmT = r.t; l.cmV = r.v; l.price = r2(r.t === 'p' ? base * (1 + r.v / 100) : base + r.v); }
  else if (l.bp !== undefined) { l.price = base; delete l.bp; delete l.cmT; delete l.cmV; }
}
export const lineComm = (l: Line, incl: boolean) =>
  !l.item || l.bp === undefined ? 0 : lineCommission({ qty: l.qty || 0, discPct: l.disc || 0, price: l.price || 0, basePrice: l.bp, gstRate: l.gst || 0 }, incl).toNumber();

export function lineFor(c: Ctx, si: SI, it: EItem): Line {
  const L: Line = { item: it, name: it.name, hsn: it.hsn || '', qty: 1, unit: it.unit, price: unitPrice(c, it, si.party), disc: 0, gst: c.mode === 'gst' ? it.gst || 0 : 0 };
  if (si.ref) cmApply(c, si, L);
  return L;
}

/** Typed final rate → discount % from the price-list rate (prototype frSet). False when above the list rate. */
export function frSet(l: Line, v: number): boolean {
  const p = l.price || 0;
  if (!(v >= 0)) v = 0;
  if (p <= 0) { l.price = v; l.disc = 0; return true; }
  if (v > p) { l.disc = 0; return false; }
  l.disc = Math.round(((p - v) / p) * 100 * 1e6 * 100) / 100 / 1e6;
  return true;
}
export const finalRate = (l: Line) => r2((l.price || 0) * (1 - (l.disc || 0) / 100));

export interface Calc {
  rows: { gross: number; disc: number; tv: number; tx: number; amt: number }[];
  items: number; bdisc: number; chTr: number; chLab: number; chBank: number; taxable: number; tax: number; cgst: number; sgst: number; igst: number; inter: boolean; tcs: number; round: number; total: number; count: number;
}
/** Totals of the open sale (prototype calc), with the shared exact maths. */
export function calc(c: Ctx, si: SI): Calc {
  const inter = si.pos !== c.state;
  const t = saleTotals({
    mode: c.mode, incl: si.incl, inter,
    lines: si.lines.map((l) => ({ qty: Number(l.qty) || 0, price: l.price || 0, disc: l.disc || 0, gst: c.mode === 'gst' ? l.gst || 0 : 0, counted: !!(l.item || l.name) })),
    bdiscP: si.bdiscP || null, bdisc: si.bdisc ? String(si.bdisc) : null, tcsRate: c.tcsRate, chTr: String(si.chTr || 0), chLab: String(si.chLab || 0), chBank: String(si.chBank || 0), roundOff: si.roundOff,
  });
  const n = (v: { toNumber(): number }) => v.toNumber();
  return {
    rows: t.rows.map((r) => ({ gross: n(r.gross), disc: n(r.disc), tv: n(r.tv), tx: n(r.tx), amt: n(r.amt) })),
    items: n(t.items), bdisc: n(t.bdisc), chTr: n(t.chTr), chLab: n(t.chLab), chBank: n(t.chBank), taxable: n(t.taxable), tax: n(t.tax),
    cgst: n(t.cgst), sgst: n(t.sgst), igst: n(t.igst), inter: t.inter, tcs: n(t.tcs), round: n(t.round), total: n(t.total), count: t.count,
  };
}
export const paySum = (si: SI) => r2(si.pays.reduce((a, p) => a + (Number(p.amt) || 0), 0));
export const hasContent = (si: SI | null) => !!si && (!!si.party || !!si.cashName.trim() || si.lines.some((l) => l.item || l.name.trim()) || !!si.editOf);
export const money2 = (v: number) => money(v).toFixed(2);

export function newSI(c: Ctx, o: { no: string; date: string; doc?: 'sale' | 'quote' }): SI {
  return {
    doc: o.doc ?? 'sale', autoNo: true, no: o.no, date: o.date, due: o.date, dueTouched: false, valid: addDaysIso(o.date, 15),
    mode: 'credit', party: null, cashName: '', cashPhone: '', billName: '', pos: c.state, incl: true,
    lines: [blankLine()], pays: [], recvTouched: o.doc === 'quote', notes: o.doc === 'quote' ? SI_TT.est : SI_TT.sale, roundOff: true, warnOk: false, err: '', chgOk: false,
    challan: '', poNo: '', poDate: '', ewb: '', transport: '', vehicle: '', delivDate: '', desc: '', showDesc: false, attach: [],
    bdisc: 0, bdiscP: '', chTr: 0, chLab: 0, chBank: 0, ref: '', crOv: null, qrefs: [], fromChallanId: null, editId: null, editOf: null, editBal: 0, dirty: false,
  };
}

/**
 * Open bills, one tab each. Every change names the tab it is for, so closing or
 * switching tabs can never write into another bill. Kept in memory only, for the
 * person and shop signed in (cleared on sign-out or a change of shop).
 */
export interface Tab { id: string; si: SI }
interface Store {
  tabs: Tab[]; active: string | null; v: number;
  /** add a bill (at a position, default last) and show it; returns its tab id */
  open: (si: SI, at?: number) => string;
  activate: (id: string) => void;
  /** close a tab; returns the tab shown next, or null when none is left */
  close: (id: string) => string | null;
  /** change one bill */
  upTab: (id: string, fn: (si: SI) => void) => void;
  clear: () => void;
}
let tabN = 0;
export const useSI = create<Store>((set, get) => ({
  tabs: [], active: null, v: 0,
  open: (si, at) => {
    const id = `t${++tabN}`;
    const tabs = [...get().tabs];
    tabs.splice(at ?? tabs.length, 0, { id, si });
    set({ tabs, active: id, v: get().v + 1 });
    return id;
  },
  activate: (id) => { if (get().tabs.some((t) => t.id === id)) set({ active: id, v: get().v + 1 }); },
  close: (id) => {
    const { tabs, active } = get();
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return active;
    const rest = tabs.filter((t) => t.id !== id);
    const next = active === id ? rest[Math.min(i, rest.length - 1)]?.id ?? null : active;
    set({ tabs: rest, active: next, v: get().v + 1 });
    return next;
  },
  upTab: (id, fn) => {
    const t = get().tabs.find((x) => x.id === id);
    if (!t) return;
    fn(t.si);
    const si = { ...t.si };
    set({ tabs: get().tabs.map((x) => (x.id === id ? { id, si } : x)), v: get().v + 1 });
  },
  clear: () => set({ tabs: [], active: null, v: get().v + 1 }),
}));
const who = (tok: string | null) => {
  if (!tok) return '';
  try { const c = JSON.parse(atob(tok.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; bid?: string | null }; return `${c.sub}|${c.bid}`; } catch { return ''; }
};
let owner = who(useSession.getState().accessToken);
useSession.subscribe((st) => { const w = who(st.accessToken); if (w !== owner) { owner = w; useSI.getState().clear(); } });

/** The tab an editor is drawing. */
export const TabCtx = createContext('');
/** The bill of the tab being drawn, and a change function bound to that tab. */
export function useTab() {
  const id = useContext(TabCtx);
  const si = useSI((st) => st.tabs.find((t) => t.id === id)?.si ?? null);
  const upTab = useSI((st) => st.upTab);
  const up = useCallback((fn: (si: SI) => void) => upTab(id, fn), [id, upTab]);
  return { id, si, up };
}
/** Something was entered that would be lost (prototype siDirty). */
export const isDirty = (si: SI) => hasContent(si) && (!si.editOf || si.dirty);

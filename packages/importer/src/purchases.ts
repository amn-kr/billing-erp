/**
 * Purchases from the old app's backup (erp-pdocs, erp-ppays): bills, orders, debit notes and
 * payments made. The demo orders a non-fresh shop starts with (ORD-0103 … ORD-0105, for the demo
 * suppliers) are left out unless the demo data is asked for; the demo bills the old app shows
 * from its code (PU_SEED_BILLS) are never in a backup.
 */
import { money, toDb } from '@billing/shared';
import { isoOfDmy, type SalesContext } from './sales.ts';

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const amt = (v: unknown) => toDb(money(Number(v) || 0).toDecimalPlaces(2).toString());

export interface PlanPurchaseLine { itemLegacyId: string; name: string; hsn: string; qty: string; unit: string; rate: string; discPct: string; gstRate: string }
export interface PlanPurchaseDoc {
  kind: 'bill' | 'order' | 'debit_note'; number: string; supplierRef: string; date: string; dueDate: string | null; partyLegacyId: string;
  pricesInclTax: boolean; roundOff: boolean; billDiscAmt: string | null; transport: string; labour: string; lines: PlanPurchaseLine[];
  notes: string; status: 'open' | 'received' | 'cancelled'; againstNo: string; reason: string; fromOrderNo: string;
  /** the total the old app showed (checked against the recomputed one) */
  total: string;
}
export interface PlanPaymentOut { number: string; date: string; partyLegacyId: string; amount: string; mode: string; ref: string; alloc: { billNo: string; amount: string }[] }
export interface PlanPurchases { docs: PlanPurchaseDoc[]; payments: PlanPaymentOut[] }

const DEMO_ORDERS = new Set(['ORD-0103', 'ORD-0104', 'ORD-0105']);
const KIND: Record<string, PlanPurchaseDoc['kind']> = { bill: 'bill', po: 'order', dn: 'debit_note' };
const MODES = new Set(['Cash', 'UPI', 'Bank transfer', 'Cheque']);
const REASONS = new Set(['Damaged goods', 'Wrong item sent', 'Extra quantity', 'Rate difference', 'Other']);

/** Purchase documents that are the old app's demo orders (not real), given which parties are demo ones. */
export const isDemoPurchase = (d: Record<string, unknown>, demoParty: (id: string) => boolean) => d.kind === 'po' && DEMO_ORDERS.has(str(d.no)) && demoParty(str(d.party));

export function planPurchases(docs: Record<string, unknown>, ctx: SalesContext & { demoParty: (id: string) => boolean; keepDemo: boolean }, fallbackDate: string): PlanPurchases {
  const W = ctx.warnings;
  const date = (s: unknown) => isoOfDmy(s) || fallbackDate;
  const out: PlanPurchaseDoc[] = [];
  let demo = 0;
  for (const d of arr(docs['erp-pdocs'])) {
    const no = str(d.no), kind = KIND[str(d.kind)];
    if (!kind || !no) continue;
    if (!ctx.keepDemo && isDemoPurchase(d, ctx.demoParty)) { demo++; continue; }
    const pid = ctx.partyId(str(d.party));
    if (!pid) { W.push(`${no} was left out: its supplier isn’t in the backup.`); continue; }
    const lines: PlanPurchaseLine[] = [];
    let skip = false;
    for (const l of arr(d.lines)) {
      const iid = ctx.itemId(str(l.id));
      if (!iid) { W.push(`${no} was left out: “${str(l.name)}” isn’t in your items.`); skip = true; break; }
      lines.push({ itemLegacyId: iid, name: str(l.name), hsn: str(l.hsn), qty: money(Number(l.qty) || 0).toFixed(3), unit: str(l.unit), rate: amt(l.rate), discPct: money(Number(l.disc) || 0).toString(), gstRate: money(Number(l.gst) || 0).toFixed(2) });
    }
    if (skip || !lines.length) continue;
    out.push({
      kind, number: no, supplierRef: str(d.ref), date: date(d.date), dueDate: kind === 'bill' ? isoOfDmy(d.due) || date(d.date) : kind === 'order' ? isoOfDmy(d.exp) || null : null, partyLegacyId: pid,
      pricesInclTax: !!d.incl, roundOff: d.roundOff !== false, billDiscAmt: Number(d.bdisc) > 0 ? amt(d.bdisc) : null, transport: amt(d.chTr), labour: amt(d.chLab), lines,
      notes: str(d.notes), status: kind === 'order' ? (d.status === 'received' ? 'received' : d.status === 'cancelled' ? 'cancelled' : 'open') : 'open',
      againstNo: kind === 'debit_note' ? str(d.against) : '', reason: kind === 'debit_note' ? (REASONS.has(str(d.reason)) ? str(d.reason) : 'Other') : '', fromOrderNo: kind === 'bill' ? str(d.fromPo) : '',
      total: amt(d.total),
    });
  }
  if (demo) W.push(`Left out the old app’s ${demo} demo purchase order${demo > 1 ? 's' : ''} (${[...DEMO_ORDERS].join(', ')}). Ask if your shop used them for real.`);
  const billNos = new Set(out.filter((x) => x.kind === 'bill').map((x) => x.number));
  const payments: PlanPaymentOut[] = [];
  for (const p of arr(docs['erp-ppays'])) {
    const no = str(p.no), pid = ctx.partyId(str(p.party));
    if (!no || !pid || !(Number(p.amount) > 0)) { if (no) W.push(`Payment ${no} was left out: its supplier or amount is missing.`); continue; }
    payments.push({
      number: no, date: date(p.date), partyLegacyId: pid, amount: amt(p.amount), mode: MODES.has(str(p.mode)) ? str(p.mode) : 'Cash', ref: str(p.ref),
      alloc: arr(p.alloc).filter((a) => billNos.has(str(a.no)) && Number(a.amt) > 0).map((a) => ({ billNo: str(a.no), amount: amt(a.amt) })),
    });
  }
  // the order things happened: by date, documents before payments on the same day, then by number
  const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  const ord = { order: 0, bill: 1, debit_note: 2 };
  out.sort((a, b) => a.date.localeCompare(b.date) || ord[a.kind] - ord[b.kind] || num(a.number) - num(b.number));
  payments.sort((a, b) => a.date.localeCompare(b.date) || num(a.number) - num(b.number));
  return { docs: out, payments };
}

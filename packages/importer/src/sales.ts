/**
 * Sales documents from the old app's backup (Phase 3): invoices, payments
 * received, credit notes, delivery challans and item-wise quotations.
 *
 * Totals stay exactly as the old app saved and printed them; the API posts
 * them to the books with the same rules as a new sale. Pure — unit-tested.
 */
import { lineCommission, money, quoteGridSchema, toDb, type QuoteGrid } from '@billing/shared';

const qty = (v: unknown) => money(num(v)).toDecimalPlaces(3).toFixed(3);
const amt = (v: unknown) => toDb(num(v));
function num(v: unknown): number {
  const x = +String(v ?? '').replace(/,/g, '');
  return Number.isFinite(x) ? x : 0;
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** "dd/mm/yyyy" → "yyyy-mm-dd"; anything else → '' */
export const isoOfDmy = (s: unknown) => (/^\d{2}\/\d{2}\/\d{4}$/.test(str(s)) ? str(s).split('/').reverse().join('-') : /^\d{4}-\d{2}-\d{2}$/.test(str(s)) ? str(s) : '');
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export interface PlanSaleLine {
  itemLegacyId: string; name: string; hsn: string; qty: string; unit: string; price: string; discPct: string; gstRate: string;
  taxable: string; tax: string; amount: string;
  /** referral: rate before commission, rule and amount */
  basePrice: string | null; commType: 'none' | 'p' | 'f'; commValue: string; commAmount: string; commOverride: { t: string; v: number } | null;
}
export interface PlanSaleTotals { taxable: string; cgst: string; sgst: string; igst: string; tcs: string; round: string; total: string; billDiscount: string; transport: string; labour: string; bankCharge: string }
export interface PlanInvoice {
  number: string; date: string; dueDate: string; mode: 'credit' | 'cash'; partyLegacyId: string | null; cashName: string; cashPhone: string; billName: string;
  placeOfSupply: string; taxMode: 'gst' | 'bos' | 'none'; pricesInclTax: boolean; lines: PlanSaleLine[]; totals: PlanSaleTotals;
  /** money taken on the invoice screen: kept on the bill, and any extra (settles older dues, rest advance) */
  received: string; extraPaid: string; pays: { mode: string; amount: string; ref: string }[]; receiptNo: string;
  notes: string; extra: Record<string, unknown>; referrerLegacyId: string | null;
  cancelled: boolean; quoteNos: string[]; challanNo: string;
}
export interface PlanReceipt { number: string; date: string; partyLegacyId: string; amount: string; mode: string; ref: string; alloc: { to: string; amount: string }[] }
export interface PlanCreditNote {
  number: string; date: string; partyLegacyId: string | null; cashName: string; reason: string; settle: 'adjust' | 'refund'; refundMode: string;
  lines: { invoiceNo: string; itemLegacyId: string; name: string; qty: string; unit: string; price: string; gstRate: string; amount: string }[];
  invoices: { no: string; amount: string }[]; total: string;
}
export interface PlanChallan {
  number: string; date: string; partyLegacyId: string | null; cashName: string; cashPhone: string;
  lines: { itemLegacyId: string; name: string; qty: string; unit: string }[]; transport: string; vehicle: string; note: string; status: 'open' | 'invoiced' | 'cancelled'; invoiceNo: string;
}
export interface PlanQuotation {
  number: string; date: string; validTill: string; mode: 'credit' | 'cash'; partyLegacyId: string | null; cashName: string; cashPhone: string;
  placeOfSupply: string; taxMode: 'gst' | 'bos' | 'none'; pricesInclTax: boolean; lines: PlanSaleLine[]; totals: PlanSaleTotals;
  notes: string; extra: Record<string, unknown>; status: 'open' | 'converted'; invoiceNo: string; referrerLegacyId: string | null;
  /** brand-wise (Quotation page grid): no lines; quantities per grid row, ranges, discount and rate list in `extra` */
  brand?: { priceListLegacyId: string; invoiceBrand: string };
}
export interface PlanSales {
  invoices: PlanInvoice[]; receipts: PlanReceipt[]; creditNotes: PlanCreditNote[]; challans: PlanChallan[]; quotations: PlanQuotation[];
  /** the Quotation page's rows and brand ranges (erp-quo) */
  quoteGrid: QuoteGrid | null;
}

export interface SalesContext {
  /** party / item legacy ids that exist in the plan (after merging copies) */
  partyId: (legacy: string) => string | null;
  itemId: (legacy: string) => string | null;
  referrerIds: Set<string>;
  /** the electrician kept for an id (merged copies point at the one kept) */
  referrerOf?: (id: string) => string | null;
  warnings: string[];
}

/** Party and item ids that the old app's documents use (so demo entries a shop really used are kept). */
export function usedByDocuments(docs: Record<string, unknown>, demoPurchase: (d: Record<string, unknown>) => boolean = () => false): { parties: Set<string>; items: Set<string> } {
  const parties = new Set<string>();
  const items = new Set<string>();
  const lines = (d: Record<string, unknown>) => arr(d.lines).forEach((l) => l.id && items.add(str(l.id)));
  for (const v of arr(docs['erp-invoices'])) { if (v.party) parties.add(str(v.party)); lines(v); }
  for (const r of arr(docs['erp-precv'])) if (r.party) parties.add(str(r.party));
  for (const c of arr(docs['erp-cnotes'])) { if (c.party) parties.add(str(c.party)); lines(c); }
  for (const d of arr(docs['erp-dchal'])) { if (d.party) parties.add(str(d.party)); lines(d); }
  for (const q of arr(docs['erp-quotes'])) if (q.type === 'items') { if (q.party) parties.add(str(q.party)); lines(q); }
  for (const d of arr(docs['erp-pdocs'])) if (!demoPurchase(d)) { if (d.party) parties.add(str(d.party)); lines(d); }
  for (const p of arr(docs['erp-ppays'])) if (p.party) parties.add(str(p.party));
  return { parties, items };
}

const MODES = new Set(['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card']);
const tm = (v: unknown): 'gst' | 'bos' | 'none' => (v === 'bos' ? 'bos' : v === 'none' ? 'none' : 'gst');
const commKind = (t: unknown): 'none' | 'p' | 'f' => (t === 'p' ? 'p' : t === 'f' ? 'f' : 'none');

function saleLines(raw: Record<string, unknown>[], ctx: SalesContext, where: string, inclGst = false): PlanSaleLine[] | null {
  const out: PlanSaleLine[] = [];
  for (const l of raw) {
    const id = ctx.itemId(str(l.id));
    if (!id) {
      ctx.warnings.push(`${where}: the item “${str(l.name)}” is not in the imported items, so ${where} was left out.`);
      return null;
    }
    out.push({
      itemLegacyId: id, name: str(l.name), hsn: str(l.hsn), qty: qty(l.qty), unit: str(l.unit), price: amt(l.price),
      discPct: money(num(l.disc)).toDecimalPlaces(8).toFixed(8), gstRate: money(num(l.gst)).toFixed(2),
      taxable: amt(l.tv), tax: amt(l.tx), amount: amt(l.amt),
      basePrice: l.bp !== undefined ? amt(l.bp) : null, commType: l.bp !== undefined ? commKind(l.cmT) : 'none', commValue: amt(l.cmV),
      /* older bills kept the base rate but not the amount: work it out as the old app did when saving */
      commAmount: l.bp !== undefined && l.cm === undefined
        ? toDb(lineCommission({ qty: num(l.qty), discPct: num(l.disc), price: num(l.price), basePrice: num(l.bp), gstRate: num(l.gst) }, inclGst))
        : amt(l.cm),
      commOverride: l.cmO && typeof l.cmO === 'object' ? { t: str((l.cmO as Record<string, unknown>).t), v: num((l.cmO as Record<string, unknown>).v) } : null,
    });
  }
  return out;
}

const totals = (v: Record<string, unknown>): PlanSaleTotals => ({
  taxable: amt(v.taxable), cgst: amt(v.cgst), sgst: amt(v.sgst), igst: amt(v.igst), tcs: amt(v.tcs), round: amt(v.round), total: amt(v.total),
  billDiscount: amt(v.bdisc), transport: amt(v.chTr), labour: amt(v.chLab), bankCharge: amt(v.chBank),
});
const printed = (v: Record<string, unknown>) => ({
  challanNo: str(v.challan), poNo: str(v.poNo), poDate: isoOfDmy(v.poDate), ewb: str(v.ewb), transport: str(v.transport), vehicle: str(v.vehicle),
  deliveryDate: isoOfDmy(v.delivDate), description: str(v.desc), attachments: arr(v.attach).map(str),
  quoteRefs: arr(v.quotes).map((q) => ({ no: str(q.no), date: isoOfDmy(q.date), cust: str(q.cust), brand: str(q.brand) })),
  ...(v.crOv && typeof v.crOv === 'object' ? { commByCategory: v.crOv } : {}),
});

export function planSales(docs: Record<string, unknown>, ctx: SalesContext, fallbackDate: string): PlanSales {
  const W = ctx.warnings;
  const partyOf = (legacy: unknown, where: string): string | null | undefined => {
    if (!legacy) return null;
    const id = ctx.partyId(str(legacy));
    if (!id) { W.push(`${where}: its party is not in the imported parties, so it was left out.`); return undefined; }
    return id;
  };
  const date = (s: unknown) => isoOfDmy(s) || fallbackDate;

  /* invoices, oldest first (the old app replays them in that order) */
  const invoices: PlanInvoice[] = [];
  const seenNo = new Set<string>();
  for (const v of arr(docs['erp-invoices']).slice().reverse()) {
    const no = str(v.no);
    if (!no || seenNo.has(no)) { W.push(`An invoice ${no ? 'numbered ' + no + ' appeared twice' : 'without a number'}; the extra copy was left out.`); continue; }
    const pid = partyOf(v.party, `Invoice ${no}`);
    if (pid === undefined) continue;
    const lines = saleLines(arr(v.lines), ctx, `Invoice ${no}`, v.incl !== false && tm(v.tm) === 'gst');
    if (!lines) continue;
    seenNo.add(no);
    const pays = arr(v.pays).filter((p) => num(p.amt) > 0).map((p) => ({ mode: MODES.has(str(p.mode)) ? str(p.mode) : 'Cash', amount: amt(p.amt), ref: str(p.ref) }));
    const received = num(v.received) - num(v.prior);
    if (!pays.length && received > 0) pays.push({ mode: MODES.has(str(v.payMode)) ? str(v.payMode) : 'Cash', amount: amt(received), ref: str(v.payRef) });
    if (num(v.prior) > 0) W.push(`Invoice ${no}: ₹${amt(v.prior)} received before it was edited is counted as received on the invoice.`);
    invoices.push({
      number: no, date: date(v.date), dueDate: isoOfDmy(v.due) || date(v.date), mode: v.mode === 'cash' || !pid ? 'cash' : 'credit',
      partyLegacyId: pid, cashName: pid ? '' : str(v.partyName) || 'Walk-in customer', cashPhone: pid ? '' : str(v.phone), billName: str(v.billName),
      placeOfSupply: str(v.pos), taxMode: tm(v.tm), pricesInclTax: v.incl !== false, lines, totals: totals(v),
      received: amt(num(v.received)), extraPaid: pid ? amt(v.extra) : '0.00', pays, receiptNo: str(v.pi),
      notes: str(v.notes), extra: printed(v), referrerLegacyId: v.ref ? (ctx.referrerOf ? ctx.referrerOf(str(v.ref)) : ctx.referrerIds.has(str(v.ref)) ? str(v.ref) : null) : null,
      cancelled: !!v.cancelled, quoteNos: arr(v.quotes).map((q) => str(q.no)), challanNo: str(v.challan),
    });
  }
  const invNos = new Set(invoices.map((i) => i.number));

  /* payments received */
  const receipts: PlanReceipt[] = [];
  for (const r of arr(docs['erp-precv']).slice().reverse()) {
    const no = str(r.no);
    const pid = partyOf(r.party, `Payment ${no}`);
    if (!pid) { if (pid === null) W.push(`Payment ${no} had no party and was left out.`); continue; }
    const alloc = arr(r.alloc).flatMap((a) => {
      const k = str(a.no);
      if (k.startsWith('OB:')) return [{ to: 'opening', amount: amt(a.amt) }];
      if (invNos.has(k)) return [{ to: k, amount: amt(a.amt) }];
      W.push(`Payment ${no}: the part settled against ${k} (₹${amt(a.amt)}) is kept as advance, because ${k} was not imported.`);
      return [];
    });
    receipts.push({ number: no, date: date(r.date), partyLegacyId: pid, amount: amt(r.amount), mode: MODES.has(str(r.mode)) ? str(r.mode) : str(r.mode) || 'Cash', ref: str(r.ref), alloc });
  }

  /* credit notes */
  const creditNotes: PlanCreditNote[] = [];
  for (const c of arr(docs['erp-cnotes']).slice().reverse()) {
    const no = str(c.no);
    const pid = partyOf(c.party, `Credit note ${no}`);
    if (pid === undefined) continue;
    const lines: PlanCreditNote['lines'] = [];
    let ok = true;
    for (const l of arr(c.lines)) {
      const id = ctx.itemId(str(l.id));
      if (!id) { W.push(`Credit note ${no}: the item “${str(l.name)}” is not in the imported items, so the credit note was left out.`); ok = false; break; }
      const inv = str(l.inv) || (!c.invs && invNos.has(str(c.against)) ? str(c.against) : '');
      lines.push({ invoiceNo: invNos.has(inv) ? inv : '', itemLegacyId: id, name: str(l.name), qty: qty(l.qty), unit: str(l.unit), price: amt(l.price), gstRate: money(num(l.gst)).toFixed(2), amount: amt(l.amt) });
    }
    if (!ok) continue;
    const invs = (Array.isArray(c.invs) ? arr(c.invs).map((x) => ({ no: str(x.no), amount: amt(x.amt) })) : c.against ? [{ no: str(c.against), amount: amt(c.total) }] : []).filter((x) => invNos.has(x.no));
    creditNotes.push({
      number: no, date: date(c.date), partyLegacyId: pid, cashName: pid ? '' : str(c.partyName) || 'Counter sale', reason: str(c.reason) || 'Other',
      settle: c.mode === 'refund' || !pid ? 'refund' : 'adjust', refundMode: str(c.refMode) || 'Cash', lines, invoices: invs, total: amt(c.total),
    });
  }

  /* delivery challans */
  const challans: PlanChallan[] = [];
  for (const d of arr(docs['erp-dchal']).slice().reverse()) {
    const no = str(d.no);
    const pid = partyOf(d.party, `Challan ${no}`);
    if (pid === undefined) continue;
    const lines = arr(d.lines).map((l) => ({ itemLegacyId: ctx.itemId(str(l.id)) ?? '', name: str(l.name), qty: qty(l.qty), unit: str(l.unit) }));
    if (lines.some((l) => !l.itemLegacyId)) { W.push(`Challan ${no}: one of its items is not in the imported items, so it was left out.`); continue; }
    const st = d.status === 'invoiced' ? 'invoiced' : d.status === 'cancelled' ? 'cancelled' : 'open';
    challans.push({
      number: no, date: date(d.date), partyLegacyId: pid, cashName: pid ? '' : str(d.partyName), cashPhone: pid ? '' : str(d.phone),
      lines, transport: str(d.transport), vehicle: str(d.vehicle), note: str(d.note), status: st, invoiceNo: invNos.has(str(d.inv)) ? str(d.inv) : '',
    });
  }

  /* quotations: item-wise like invoices, brand-wise as quantities against the Quotation page grid */
  const quotations: PlanQuotation[] = [];
  const zero: PlanSaleTotals = { taxable: '0.00', cgst: '0.00', sgst: '0.00', igst: '0.00', tcs: '0.00', round: '0.00', total: '0.00', billDiscount: '0.00', transport: '0.00', labour: '0.00', bankCharge: '0.00' };
  for (const q of arr(docs['erp-quotes']).slice().reverse()) {
    const no = str(q.no);
    if (q.type !== 'items') {
      const qty = Object.fromEntries(Object.entries((q.qty ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)]).filter(([, v]) => (v as number) > 0));
      if (!no || !Object.keys(qty).length) { W.push(`Quotation ${no || '(no number)'} has no quantities, so it was left out.`); continue; }
      const low = q.low && typeof q.low === 'object' ? { name: str((q.low as Record<string, unknown>).name), total: Number((q.low as Record<string, unknown>).total) || 0 } : null;
      const cust = str(q.cust);
      quotations.push({
        number: no, date: date(q.date), validTill: '', mode: 'cash', partyLegacyId: null, cashName: cust, cashPhone: '', placeOfSupply: '', taxMode: 'none', pricesInclTax: true, lines: [],
        totals: { ...zero, total: (low?.total ?? 0).toFixed(2) }, notes: '',
        extra: { type: 'brand', cust, disc: Number(q.disc) || 0, sel: (Array.isArray(q.sel) ? (q.sel as unknown[]) : []).map(str), qty, items: Number(q.items) || Object.keys(qty).length, pcs: Number(q.pcs) || Object.values(qty).reduce<number>((a, b) => a + (b as number), 0), low },
        status: q.status === 'converted' ? 'converted' : 'open', invoiceNo: invNos.has(str(q.inv)) ? str(q.inv) : '',
        referrerLegacyId: q.ref ? (ctx.referrerOf ? ctx.referrerOf(str(q.ref)) : ctx.referrerIds.has(str(q.ref)) ? str(q.ref) : null) : null,
        brand: { priceListLegacyId: str(q.pl), invoiceBrand: str(q.brand) },
      });
      continue;
    }
    const pid = partyOf(q.party, `Quotation ${no}`);
    if (pid === undefined) continue;
    const lines = saleLines(arr(q.lines), ctx, `Quotation ${no}`);
    if (!lines) continue;
    quotations.push({
      number: no, date: date(q.date), validTill: isoOfDmy(q.valid), mode: pid ? 'credit' : 'cash', partyLegacyId: pid, cashName: pid ? '' : str(q.cust) || 'Walk-in customer',
      cashPhone: pid ? '' : str(q.phone), placeOfSupply: str(q.pos), taxMode: tm(q.tm), pricesInclTax: q.incl !== false, lines, totals: totals(q),
      notes: str(q.notes), extra: { ...printed(q), validTill: isoOfDmy(q.valid) }, status: q.status === 'converted' ? 'converted' : 'open', invoiceNo: invNos.has(str(q.inv)) ? str(q.inv) : '',
      referrerLegacyId: q.ref ? (ctx.referrerOf ? ctx.referrerOf(str(q.ref)) : ctx.referrerIds.has(str(q.ref)) ? str(q.ref) : null) : null,
    });
  }
  // brand-wise ones were kept in the old app in save order, item-wise ones newest first: oldest first here
  quotations.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'en', { numeric: true }));
  /* the Quotation page grid; the prototype's starting grid when the backup has none */
  const qg = quoteGridSchema.safeParse(docs['erp-quo'] ? { rows: (docs['erp-quo'] as Record<string, unknown>).rows, ser: (docs['erp-quo'] as Record<string, unknown>).ser } : null);
  if (docs['erp-quo'] && !qg.success) W.push('The Quotation page’s rows and brand ranges could not be read; the standard ones are used.');
  // the old app could give two invoices the same receipt number (PI-…); numbers are unique here, so a repeat gets "/2", "/3"
  const usedNo = new Set(receipts.map((r) => r.number));
  for (const v of invoices) {
    if (!v.receiptNo) continue;
    if (!usedNo.has(v.receiptNo)) { usedNo.add(v.receiptNo); continue; }
    let k = 2;
    while (usedNo.has(`${v.receiptNo}/${k}`)) k++;
    const nn = `${v.receiptNo}/${k}`;
    ctx.warnings.push(`${v.number} and another bill both used receipt number ${v.receiptNo} in the old app. The one on ${v.number} is ${nn} here.`);
    usedNo.add(nn);
    v.receiptNo = nn;
  }
  return { invoices, receipts, creditNotes, challans, quotations, quoteGrid: qg.success ? qg.data : null };
}

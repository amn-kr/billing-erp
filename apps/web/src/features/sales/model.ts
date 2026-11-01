/** Sales: what the API sends, and the prototype's list rules (status chip, periods). */
import { useQuery } from '@tanstack/react-query';
import { addDays, parseIso, saleStatus } from '@billing/shared';
import { api } from '../../lib/api';
import { today } from '../../lib/time';

export interface SaleRow {
  id: string; number: string; date: string; dueDate: string | null; mode: 'credit' | 'cash';
  party: { id: string; name: string; city: string; gstin: string } | null; partyName: string; phone: string;
  total: string; received: string; balance: string; cancelled: boolean; status: string; items: number; qty: string;
  lineNames: string[]; transport: string; vehicle: string; note: string; invoiceNo: string; legacy: boolean; referrerId: string | null;
  /** quotations only */
  qtype?: 'items' | 'brand'; invoiceBrand?: string;
  brandQuote?: { cust: string; priceListId: string | null; disc: number; sel: string[]; qty: Record<string, number>; low: { name: string; total: number } | null } | null;
}

export interface SaleLine {
  id: string; itemId: string | null; name: string; hsn: string; qty: string; unit: string; price: string; discPct: string; gstRate: string;
  taxable: string; tax: string; amount: string; basePrice: string | null; commOverride: { t: string; v: number } | null; commType: string; commValue: string; commAmount: string;
  batches?: { batchId: string | null; no: string; expiry: string | null; qty: string }[];
  againstId: string | null; code: string; brand: string; series: string; group: string; category: string; categoryId: string | null;
}

export interface SaleDoc {
  id: string; kind: 'invoice' | 'quotation' | 'challan' | 'credit_note'; number: string; date: string; dueDate: string | null; mode: 'credit' | 'cash'; status: string;
  party: { id: string; name: string; phone: string; gstin: string; city: string; state: string } | null;
  partyName: string; cashName: string; cashPhone: string; billName: string; taxMode: 'gst' | 'bos' | 'none'; pricesInclTax: boolean; placeOfSupply: string; roundOff: boolean;
  billDiscPct: string | null; billDiscAmt: string | null; transport: string; labour: string; bankCharge: string; tcsRate: string | null;
  itemsTotal: string; billDiscount: string; taxable: string; tax: string; cgst: string; sgst: string; igst: string; tcs: string; roundAmount: string; total: string; words: string;
  received: string; balance: string; notes: string; reason: string; extra: Record<string, unknown>; referrerId: string | null; cancelled: boolean; legacy: boolean;
  /** when the document was saved (shown with Settings › Transactions › Add time) */
  savedAt?: string;
  lines: SaleLine[];
  payment: { id: string; number: string; amount: string; mode: string; reference: string; splits: { mode: string; amount: string; ref: string; accountId?: string | null }[] } | null;
  settlements: { amount: string; kind: 'payment' | 'credit_note'; number: string; date: string | null; mode: string; atSale: boolean; cancelled: boolean }[];
  history: { action: string; at: string }[];
}

export const useSales = (kind: 'invoice' | 'quotation' | 'challan' = 'invoice') =>
  useQuery({ queryKey: ['sales', kind], queryFn: () => api<SaleRow[]>(`/sales?kind=${kind}`) });

export const useSale = (id: string | null) => useQuery({ queryKey: ['sale', id], queryFn: () => api<SaleDoc>(`/sales/${id}`), enabled: !!id });

/** Status chip (prototype txStatus) for a sales list row, with today's date. */
export const statusOf = (s: { total: string; balance: string; dueDate: string | null; cancelled: boolean }) =>
  saleStatus({ total: Number(s.total), balance: Number(s.balance), due: s.dueDate, cancelled: s.cancelled }, today());

/** Prototype perOk: all / this month ("oct") / last month ("sep") / custom range. */
export type Period = 'all' | 'oct' | 'sep' | 'custom';
export function inPeriod(iso: string, per: Period, range?: { from?: string; to?: string }) {
  if (per === 'all') return true;
  if (per === 'custom') return (!range?.from || iso >= range.from) && (!range?.to || iso <= range.to);
  const t = parseIso(today());
  const d = parseIso(iso);
  if (per === 'oct') return d.y === t.y && d.m === t.m;
  const last = parseIso(addDays(`${t.y}-${String(t.m).padStart(2, '0')}-01`, -1));
  return d.y === last.y && d.m === last.m;
}

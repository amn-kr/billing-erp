/** Purchases: what the API sends for bills, orders, debit notes and payments made. */
import { useQuery } from '@tanstack/react-query';
import { billStatus } from '@billing/shared';
import { api } from '../../lib/api';
import { today } from '../../lib/time';

export type PKind = 'bill' | 'order' | 'debit_note';
export interface PurchaseRow {
  id: string; kind: PKind; number: string; supplierRef: string; date: string; dueDate: string | null;
  party: { id: string; name: string; gstin: string }; partyName: string; total: string; paid: string; balance: string;
  items: number; qty: string; status: 'open' | 'received' | 'cancelled'; cancelled: boolean; reason: string; against: string; fromOrder: string; bill: string; legacy: boolean;
}
export interface PurchaseLine { id: string; itemId: string; name: string; hsn: string; qty: string; unit: string; rate: string; discPct: string; gstRate: string; taxable: string; tax: string; amount: string }
export interface PurchaseDoc {
  id: string; kind: PKind; number: string; supplierRef: string; date: string; dueDate: string | null;
  party: { id: string; name: string; gstin: string; phone: string }; taxMode: string; pricesInclTax: boolean; interState: boolean; roundOff: boolean;
  billDiscPct: string | null; billDiscAmt: string | null; transport: string; labour: string;
  itemsTotal: string; billDiscount: string; taxable: string; tax: string; cgst: string; sgst: string; igst: string; roundAmount: string; total: string;
  balance: string; status: string; notes: string; reason: string; cancelled: boolean; source: string; sourceId: string | null;
  /** why it can't be edited ('' when it can); what payments made and debit notes already settle on a bill */
  locked: string; settledElsewhere: string;
  lines: PurchaseLine[];
  /** `atBill`: paid with the bill itself (edited with the bill) */
  settlements: { kind: 'payment' | 'debit_note'; number: string; date: string; mode: string; amount: string; ref: string; accountId: string | null; atBill: boolean }[];
}
export interface PaymentMade {
  id: string; number: string; date: string; party: { id: string; name: string } | null; partyName: string; mode: string; ref: string; amount: string; cancelled: boolean;
  bills: { number: string; amount: string }[]; unused: string; legacy: boolean; atBill: boolean;
}
/** A payment made for its edit window. */
export interface PaymentMadeDoc { id: string; number: string; date: string; partyId: string | null; amount: string; mode: string; accountId: string | null; ref: string; notes: string; cancelled: boolean; allocations: { to: string; amount: string }[]; locked: string }
export interface UnpaidBill { id: string; number: string; date: string; dueDate: string | null; total: string; balance: string }

export const PE_T: Record<PKind, string> = { bill: 'Purchase bill', order: 'Purchase order', debit_note: 'Debit note' };
export const usePurchases = (kind: PKind) => useQuery({ queryKey: ['purchases', kind], queryFn: () => api<PurchaseRow[]>(`/purchases?kind=${kind}`) });
export const usePaymentsMade = () => useQuery({ queryKey: ['payments-made'], queryFn: () => api<PaymentMade[]>('/payments-made') });
export const statusOfBill = (b: { total: string; balance: string; dueDate: string | null; cancelled?: boolean }) => billStatus({ total: Number(b.total), balance: Number(b.balance), due: b.dueDate, cancelled: b.cancelled }, today());
/** what the lists refresh after a purchase is saved, paid, edited or cancelled */
export const PU_KEYS = ['purchases', 'purchase', 'payments-made', 'payment-made', 'parties', 'items', 'unpaid-bills', 'next-number', 'party', 'cheques', 'banking'];

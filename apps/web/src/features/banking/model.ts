/** Banking & cash: what the API sends, and the prototype's ledger rules (periods, colours, masks). */
import { useQuery } from '@tanstack/react-query';
import { addDays, parseIso } from '@billing/shared';
import { api } from '../../lib/api';
import { today } from '../../lib/time';
import { inPeriod } from '../sales/model';

export interface Account {
  id: string; kind: 'cash' | 'bank'; name: string; sub: string; accountNo: string; ifsc: string; branch: string;
  openingBalance: string; openingDate: string | null; isDefault: boolean; balance: string; used: boolean;
}
export interface BookEntry { key: string; date: string; amt: string; kind: string; party: string; doc: string; mode: string; ref: string; note: string; src: string; sourceId: string; run: string }
export interface Book { id: string; openingBalance: string; openingDate: string | null; balance: string; entries: BookEntry[] }
export type BkPer = 'all' | 'oct' | 'sep';

export const useAccounts = () => useQuery({ queryKey: ['bank-accounts'], queryFn: () => api<Account[]>('/banking/accounts') });
export const useBook = (id: string | null | undefined) => useQuery({ queryKey: ['bank-book', id], queryFn: () => api<Book>(`/banking/accounts/${id}/book`), enabled: !!id });
/** what changes when money moves */
export const BK_KEYS = ['bank-accounts', 'bank-book', 'parties', 'receipts', 'payments-made'];

/** prototype bkMask: "••• 7703" */
export const bkMask = (n: string) => (n ? '••• ' + n.slice(-4) : '');
const BK_COL = ['--blue', '--violet', '--green', '--amber', '--pink'];
/** prototype bkCol: cash green, banks blue, violet, then amber, pink… */
export function bkCol(a: Account, banks: Account[]) {
  if (a.kind === 'cash') return '--green';
  const i = banks.findIndex((b) => b.id === a.id);
  return BK_COL[(i + (i > 1 ? 1 : 0)) % BK_COL.length]!;
}
/** prototype T(): a soft tint of a colour */
export const tint = (c: string) => ({ background: `color-mix(in srgb,var(${c}) 14%,transparent)`, color: `var(${c})` });

/** First day of the period (prototype BK_START): this month or last month. */
export function perStart(per: BkPer): string | null {
  if (per === 'all') return null;
  const t = parseIso(today());
  const first = `${t.y}-${String(t.m).padStart(2, '0')}-01`;
  if (per === 'oct') return first;
  const last = parseIso(addDays(first, -1));
  return `${last.y}-${String(last.m).padStart(2, '0')}-01`;
}

/** The prototype's ledRender sums for one account and period. */
export function ledger(b: Book, per: BkPer) {
  const P = b.entries.filter((e) => inPeriod(e.date, per));
  const start = perStart(per);
  const before = start ? b.entries.filter((e) => e.date < start) : [];
  const openB = start && before.length ? Number(before[before.length - 1]!.run) : Number(b.openingBalance);
  const tin = P.filter((e) => Number(e.amt) > 0).reduce((s, e) => s + Number(e.amt), 0);
  const tout = P.filter((e) => Number(e.amt) < 0).reduce((s, e) => s - Number(e.amt), 0);
  const close = P.length ? Number(P[P.length - 1]!.run) : openB;
  return { P, start, openB, tin, tout, close };
}

/**
 * Cash and bank accounts and the money moved between them by hand, from the old app's
 * backup (erp-accts, erp-btx). A shop that did not start fresh carries the old app's demo
 * accounts (HDFC Bank, State Bank of India, with demo balances) and four demo entries; those
 * are left out unless the demo data is asked for. A demo account that a real entry uses is
 * kept with a zero opening balance, and the person importing is told to check it. So is the
 * demo default bank when the shop's own documents took or paid money other than in cash: the old
 * app put that money there, and without it the money would land in cash.
 */
import { money, toDb } from '@billing/shared';
import { isoOfDmy } from './sales.ts';

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const amt = (v: unknown) => toDb(money(Number(v) || 0).toDecimalPlaces(2).toString());

export interface PlanAccount { legacyId: string; kind: 'cash' | 'bank'; name: string; sub: string; accountNo: string; ifsc: string; branch: string; openingBalance: string; openingDate: string | null; isDefault: boolean }
export interface PlanBankEntry { number: string; date: string; kind: 'transfer' | 'deposit' | 'withdraw' | 'in' | 'out'; amount: string; fromLegacyId: string; toLegacyId: string; accountLegacyId: string; category: string; reference: string; note: string }
/** A cheque the old app marked deposited / cleared or bounced (erp-chq), found again by its payment or expense number. */
export interface PlanChequeState { dir: 'in' | 'out' | 'expense'; number: string; status: 'cleared' | 'bounced'; date: string; accountLegacyId: string; charges: string; note: string }
export interface PlanBanking { accounts: PlanAccount[]; entries: PlanBankEntry[]; cheques: PlanChequeState[] }

const DEMO_ACCOUNTS: Record<string, number> = { cash: 45000, hdfc: 325000, sbi: 118000 };
const DEMO_ENTRIES: Record<string, number> = { 'BT-0001': 25000, 'BT-0002': 354, 'BT-0003': 6500, 'BT-0004': 40000 };
const KINDS = new Set(['transfer', 'deposit', 'withdraw', 'in', 'out']);

/** Did the shop's own (planned) sales, receipts, payments or expenses move money other than in cash? */
export function movedNonCash(modes: string[]): boolean {
  return modes.some((m) => !!m && m !== 'Cash');
}

export function planBanking(docs: Record<string, unknown>, o: { fresh: boolean; keepDemo: boolean; warnings: string[]; nonCash?: boolean }, fallbackDate: string): PlanBanking {
  const W = o.warnings;
  const raw = arr(docs['erp-accts']);
  const demoMode = !o.fresh && !o.keepDemo;
  const isDemoAcct = (a: Record<string, unknown>) => demoMode && DEMO_ACCOUNTS[str(a.id)] === Number(a.open);
  const entries: PlanBankEntry[] = [];
  let demoEntries = 0;
  for (const t of arr(docs['erp-btx'])) {
    const no = str(t.no), kind = str(t.kind);
    if (!no || !KINDS.has(kind) || !(Number(t.amount) > 0)) continue;
    if (demoMode && DEMO_ENTRIES[no] === Number(t.amount)) { demoEntries++; continue; }
    entries.push({
      number: no, date: isoOfDmy(t.date) || fallbackDate, kind: kind as PlanBankEntry['kind'], amount: amt(t.amount), fromLegacyId: str(t.from), toLegacyId: str(t.to), accountLegacyId: str(t.acct),
      category: str(t.cat), reference: str(t.ref), note: str(t.note),
    });
  }
  const used = new Set(entries.flatMap((e) => [e.fromLegacyId, e.toLegacyId, e.accountLegacyId]).filter(Boolean));
  const accounts: PlanAccount[] = [];
  let demoAccts = 0;
  for (const a of raw) {
    const id = str(a.id), kind = str(a.kind) === 'cash' ? 'cash' : 'bank';
    const demo = isDemoAcct(a);
    const tookMoney = !!o.nonCash && !!a.def;
    if (demo && kind === 'bank' && !used.has(id) && !tookMoney) { demoAccts++; continue; }
    if (demo && kind === 'bank' && !used.has(id)) W.push(`${str(a.name)} is one of the old app’s demo accounts, but it was your default bank, so your UPI, card and bank payments went there. It was kept with a zero opening balance — check its name and balance in Banking › Bank accounts.`);
    else if (demo && kind === 'bank') W.push(`${str(a.name)} is one of the old app’s demo accounts, but an entry of yours uses it. It was kept with a zero opening balance — check it in Banking › Bank accounts.`);
    accounts.push({
      legacyId: id, kind, name: kind === 'cash' ? 'Cash in hand' : str(a.name).slice(0, 80) || 'Bank account', sub: str(a.sub).slice(0, 60), accountNo: str(a.acno).replace(/\D/g, '').slice(0, 18),
      ifsc: str(a.ifsc).toUpperCase().slice(0, 11), branch: str(a.branch).slice(0, 120),
      // the demo cash balance is not the shop's; the cash in hand from Start fresh is kept in settings
      openingBalance: demo ? '0.00' : amt(a.open), openingDate: isoOfDmy(a.od) || null, isDefault: kind === 'bank' && !!a.def,
    });
  }
  if (demoAccts || demoEntries) W.push(`Left out the old app’s demo banking data (${[demoAccts ? `${demoAccts} bank account${demoAccts > 1 ? 's' : ''}` : '', demoEntries ? `${demoEntries} entr${demoEntries > 1 ? 'ies' : 'y'}` : ''].filter(Boolean).join(' and ')}). Ask if your shop used them for real.`);
  const have = new Set(accounts.map((a) => a.legacyId));
  const kept = entries.filter((e) => {
    const ok = [e.fromLegacyId, e.toLegacyId, e.accountLegacyId].filter(Boolean).every((x) => have.has(x));
    if (!ok) W.push(`${e.number} was left out: its account isn’t in the backup.`);
    return ok;
  });
  const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  kept.sort((a, b) => a.date.localeCompare(b.date) || num(a.number) - num(b.number));
  // cheque states: keys like "R:PI-0625", "P:PO-0002", "X:EXP-0004" (split receipts add "#1")
  const raw2 = docs['erp-chq'];
  const cheques: PlanChequeState[] = [];
  if (raw2 && typeof raw2 === 'object' && !Array.isArray(raw2)) {
    for (const [k, v] of Object.entries(raw2 as Record<string, Record<string, unknown>>)) {
      const m = /^([RPX]):(.+?)(#\d+)?$/.exec(k);
      const st = str(v?.st);
      if (!m || (st !== 'cleared' && st !== 'bounced')) continue;
      cheques.push({ dir: m[1] === 'R' ? 'in' : m[1] === 'P' ? 'out' : 'expense', number: m[2]!, status: st, date: isoOfDmy(v.date) || fallbackDate, accountLegacyId: str(v.acct), charges: amt(v.chg), note: str(v.note).slice(0, 200) });
    }
  }
  return { accounts, entries: kept, cheques };
}

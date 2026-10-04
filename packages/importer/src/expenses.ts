/**
 * Expenses and expense categories from the old app's backup (erp-exps, erp-ecats). A shop that
 * did not start fresh starts with 14 demo expenses (EXP-0001 … EXP-0014); when they are in the
 * backup they are left out unless the demo data is asked for.
 */
import { money, toDb } from '@billing/shared';
import { isoOfDmy } from './sales.ts';

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const amt = (v: unknown) => toDb(money(Number(v) || 0).toDecimalPlaces(2).toString());

export interface PlanExpense {
  number: string; date: string; category: string; payee: string; mode: string; accountLegacyId: string; reference: string; notes: string;
  lines: { name: string; qty: string; rate: string; gst: string; amt: string }[];
}
export interface PlanExpenses { categories: string[]; expenses: PlanExpense[] }

const DEMO: Record<string, number> = {
  'EXP-0001': 25000, 'EXP-0002': 7840, 'EXP-0003': 1180, 'EXP-0004': 2360, 'EXP-0005': 1350, 'EXP-0006': 5000, 'EXP-0007': 3700,
  'EXP-0008': 2340, 'EXP-0009': 2000, 'EXP-0010': 2950, 'EXP-0011': 3600, 'EXP-0012': 41000, 'EXP-0013': 640, 'EXP-0014': 25000,
};
const MODES = new Set(['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque']);

export function planExpenses(docs: Record<string, unknown>, o: { fresh: boolean; keepDemo: boolean; warnings: string[] }, fallbackDate: string): PlanExpenses {
  const cats = Array.isArray(docs['erp-ecats']) ? (docs['erp-ecats'] as unknown[]).map(str).filter(Boolean) : [];
  const out: PlanExpense[] = [];
  let demo = 0;
  for (const x of arr(docs['erp-exps'])) {
    const no = str(x.no);
    const lines = arr(x.lines).map((l) => ({ name: str(l.name).slice(0, 200), qty: String(Number(l.qty) || 1), rate: amt(l.rate), gst: String(Number(l.gst) || 0), amt: amt(l.amt) })).filter((l) => Number(l.amt) > 0);
    const total = lines.reduce((s, l) => s + Number(l.amt), 0);
    if (!no || !lines.length) continue;
    if (!o.fresh && !o.keepDemo && Math.abs((DEMO[no] ?? -1) - total) < 0.005) { demo++; continue; }
    const cat = str(x.cat) || 'Other';
    if (!cats.some((c) => c.toLowerCase() === cat.toLowerCase())) cats.push(cat);
    out.push({
      number: no, date: isoOfDmy(x.date) || fallbackDate, category: cat, payee: str(x.payee).slice(0, 120), mode: MODES.has(str(x.mode)) ? str(x.mode) : 'Cash',
      accountLegacyId: str(x.acct), reference: str(x.ref).slice(0, 80), notes: str(x.note).slice(0, 500), lines,
    });
  }
  if (demo) o.warnings.push(`Left out the old app’s ${demo} demo expense${demo > 1 ? 's' : ''}. Ask if your shop used them for real.`);
  const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  out.sort((a, b) => a.date.localeCompare(b.date) || num(a.number) - num(b.number));
  return { categories: cats, expenses: out };
}

/** Commission paid to electricians from the old app's backup (erp-compay). */
import { money, toDb } from '@billing/shared';
import { isoOfDmy } from './sales.ts';

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export interface PlanPayout { number: string; date: string; referrerLegacyId: string; amount: string; mode: string; note: string }

export function planPayouts(docs: Record<string, unknown>, referrerOf: (id: string) => string | null, warnings: string[], fallbackDate: string): PlanPayout[] {
  const out: PlanPayout[] = [];
  for (const x of arr(docs['erp-compay'])) {
    const no = str(x.no), amt = Number(x.amount) || 0;
    if (!no || !(amt > 0)) continue;
    const ref = referrerOf(str(x.elec));
    if (!ref) { warnings.push(`Commission payment ${no} was left out: its electrician isn’t in the backup.`); continue; }
    out.push({ number: no, date: isoOfDmy(x.date) || fallbackDate, referrerLegacyId: ref, amount: toDb(money(amt).toDecimalPlaces(2).toString()), mode: str(x.mode) || 'Cash', note: str(x.note).slice(0, 200) });
  }
  return out;
}

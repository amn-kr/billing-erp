import { money } from '@billing/shared';
import type { PlanBanking } from '@billing/importer';
import type { Tx } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import { day } from '../../common/lookups';
import type { BankingService } from '../banking/banking.service';

/**
 * Cash and bank accounts and the money moved between them by hand, from the old app. The shop's
 * own "Cash in hand" takes the old cash account's details; bank accounts are added; entries are
 * written through the same rules as new ones (the books, numbers), oldest first.
 */
/** The accounts first, so money in sales and purchases lands in the right bank (prototype modeAcct). */
export async function writeAccounts(tx: Tx, ctx: RequestContext, p: PlanBanking): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const cash = await tx.cashBankAccount.findFirst({ where: { kind: 'cash', archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  const t0 = Date.now();
  let k = 0;
  for (const a of p.accounts) {
    if (a.kind === 'cash' && cash) {
      // a demo cash balance comes as 0: keep what Start fresh / settings already put there
      await tx.cashBankAccount.update({ where: { id: cash.id }, data: { legacyId: a.legacyId, ...(money(a.openingBalance).isZero() ? {} : { openingBalance: a.openingBalance }), ...(a.openingDate && { openingDate: day(a.openingDate) }) } });
      ids.set(a.legacyId, cash.id);
      continue;
    }
    if (a.isDefault) await tx.cashBankAccount.updateMany({ where: { kind: 'bank' }, data: { isDefault: false } });
    const r = await tx.cashBankAccount.create({
      data: {
        businessId: ctx.businessId!, createdBy: ctx.userId, createdAt: new Date(t0 + ++k), kind: a.kind, name: a.name, sub: a.sub, accountNo: a.accountNo, ifsc: a.ifsc, branch: a.branch,
        openingBalance: a.openingBalance, openingDate: a.openingDate ? day(a.openingDate) : null, isDefault: a.isDefault, legacyId: a.legacyId,
      },
    });
    ids.set(a.legacyId, r.id);
  }
  // the first bank takes UPI and bank transfers when none was marked
  const banks = await tx.cashBankAccount.findMany({ where: { kind: 'bank', archivedAt: null }, orderBy: { createdAt: 'asc' } });
  if (banks.length && !banks.some((b) => b.isDefault)) await tx.cashBankAccount.update({ where: { id: banks[0]!.id }, data: { isDefault: true } });
  return ids;
}

/** Then the entries typed by hand, after the documents. */
export async function writeEntries(tx: Tx, ctx: RequestContext, svc: BankingService, p: PlanBanking, ids: Map<string, string>) {
  for (const e of p.entries) {
    const two = e.kind === 'transfer' || e.kind === 'deposit' || e.kind === 'withdraw';
    await svc.moveIn(tx, ctx, {
      kind: e.kind, date: e.date, amount: money(e.amount), from: two ? ids.get(e.fromLegacyId)! : '', to: two ? ids.get(e.toLegacyId)! : '', account: two ? '' : ids.get(e.accountLegacyId)!,
      category: e.category, reference: e.reference, note: e.note, legacyNo: e.number,
    });
  }
}

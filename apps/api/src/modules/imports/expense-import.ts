import type { PlanExpenses } from '@billing/importer';
import type { ExpenseInput } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import type { ExpensesService } from '../expenses/expenses.service';

/**
 * Expense categories as the old app had them (added in its order; a starting category the shop
 * had removed is removed here too), then expenses through the same rules as new ones.
 */
export async function writeExpenses(tx: Tx, ctx: RequestContext, svc: ExpensesService, p: PlanExpenses, accountIds: Map<string, string>) {
  if (!p.categories.length && !p.expenses.length) return;
  const have = await tx.expenseCategory.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
  const byName = new Map(have.map((c) => [c.name.toLowerCase(), c.id]));
  const t0 = Date.now();
  let k = 0;
  for (const name of p.categories) {
    if (byName.has(name.toLowerCase())) continue;
    const c = await tx.expenseCategory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, createdAt: new Date(t0 + ++k), name } });
    byName.set(name.toLowerCase(), c.id);
  }
  if (p.categories.length) {
    const keep = new Set(p.categories.map((c) => c.toLowerCase()));
    const gone = have.filter((c) => !keep.has(c.name.toLowerCase())).map((c) => c.id);
    if (gone.length) await tx.expenseCategory.updateMany({ where: { id: { in: gone } }, data: { archivedAt: new Date() } });
  }
  for (const x of p.expenses) {
    const input: ExpenseInput = {
      categoryId: byName.get(x.category.toLowerCase())!, date: x.date, payee: x.payee, reference: x.reference, notes: x.notes,
      mode: x.mode as ExpenseInput['mode'], accountId: accountIds.get(x.accountLegacyId) ?? null, lines: x.lines,
    };
    await svc.saveIn(tx, ctx, input, undefined, x.number);
  }
}

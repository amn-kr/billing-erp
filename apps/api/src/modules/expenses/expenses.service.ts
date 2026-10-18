import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BOOK_EXPENSE_CATEGORY, expenseTotals, gstInside, money, round2, todayIst, type ExpenseInput, type Money } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService, type PostLine } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { keepNumber, reconciledMap, reconciledMessage } from '../../common/editing';

const FIXED = new Set(Object.values(BOOK_EXPENSE_CATEGORY));
const num = (v: string, d = 0) => (v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export interface ExpenseLineOut { name: string; qty: string; rate: string; gst: number; amt: string }

/**
 * Expenses (prototype EXPS / xpSave): money spent running the shop, sorted into categories and
 * paid from cash, a bank, or by cheque. Each one comes out of its cash or bank book; GST inside
 * the amounts is kept as input credit. Expenses are cancelled, never deleted.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  nextNumber(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => ({ number: await this.numbers.peek(tx, ctx.businessId!, ctx.userId, 'expense', todayIst()) }));
  }

  /* ───────── categories ───────── */

  categories(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) =>
      (await tx.expenseCategory.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } })).map((c) => ({ id: c.id, name: c.name, fixed: FIXED.has(c.name) })));
  }

  private async unique(tx: Tx, name: string, except?: string) {
    const all = await tx.expenseCategory.findMany({ where: { archivedAt: null } });
    if (all.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase())) throw new BadRequestException({ message: `${name} already exists` });
  }

  addCategory(ctx: RequestContext, name: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      if (!name) throw new BadRequestException({ message: 'Enter the category name.' });
      await this.unique(tx, name);
      const c = await tx.expenseCategory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'expense_category', entityId: c.id, after: c, ip: ctx.ip });
      return { id: c.id, name: c.name };
    });
  }

  /** Renaming fixes the name on every entry (they point at the category). */
  renameCategory(ctx: RequestContext, id: string, name: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const c = await tx.expenseCategory.findFirst({ where: { id, archivedAt: null } });
      if (!c) throw new NotFoundException({ message: 'That category was not found.' });
      if (FIXED.has(c.name)) throw new BadRequestException({ message: 'Also used by the cash and bank book, so it keeps this name' });
      if (!name) throw new BadRequestException({ message: 'Enter the category name.' });
      await this.unique(tx, name, id);
      const u = await tx.expenseCategory.update({ where: { id }, data: { name } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'expense_category', entityId: id, before: c, after: u, ip: ctx.ip });
      return { id, name };
    });
  }

  /** An unused category can be removed (kept, hidden). */
  removeCategory(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const c = await tx.expenseCategory.findFirst({ where: { id, archivedAt: null } });
      if (!c) throw new NotFoundException({ message: 'That category was not found.' });
      const used = await tx.expenseLine.count({ where: { categoryId: id, expense: { cancelledAt: null } } });
      if (used || FIXED.has(c.name)) throw new BadRequestException({ message: `${c.name} is in use and can’t be removed.` });
      await tx.expenseCategory.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'expense_category', entityId: id, before: c, after: { removed: true }, ip: ctx.ip });
      return { id, name: c.name };
    });
  }

  /* ───────── expenses ───────── */

  /** Lines with an amount or a name; checked the way the prototype's xpSave checks them. */
  private lines(input: ExpenseInput, gstOn: boolean) {
    const L = input.lines
      .filter((l) => num(l.amt) > 0 || l.name)
      .map((l) => ({ name: l.name, qty: money(num(l.qty, 1) || 1), rate: round2(num(l.rate)), gst: gstOn ? num(l.gst) : 0, amt: round2(num(l.amt)) }));
    if (!L.length || !L.some((l) => l.amt.gt(0))) throw new BadRequestException({ message: 'Enter the amount spent.' });
    if (L.some((l) => !l.amt.gt(0))) throw new BadRequestException({ message: 'Each line needs an amount. Remove empty lines.' });
    return L;
  }

  /** Where the money came from: the account chosen, or by mode; cheques wait in "cheques issued". */
  private async source(tx: Tx, mode: string, accountId: string | null | undefined): Promise<{ account: string; accountId: string | null }> {
    if (mode === 'Cheque') {
      const id = accountId && (await tx.cashBankAccount.findFirst({ where: { id: accountId, archivedAt: null } })) ? accountId : null;
      return { account: 'cheques_issued', accountId: id };
    }
    const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
    const a = accs.find((x) => x.id === accountId);
    if (a) return { account: 'cb:' + a.id, accountId: a.id };
    const cash = accs.find((x) => x.kind === 'cash' && x.isDefault) ?? accs.find((x) => x.kind === 'cash')!;
    const banks = accs.filter((x) => x.kind === 'bank');
    const pick = mode === 'Cash' ? cash : banks.find((b) => b.isDefault) ?? banks[0] ?? cash;
    return { account: 'cb:' + pick.id, accountId: pick.id };
  }

  save(ctx: RequestContext, input: ExpenseInput, id?: string) {
    return this.db.scoped(this.scope(ctx), (tx) => this.saveIn(tx, ctx, input, id));
  }

  async saveIn(tx: Tx, ctx: RequestContext, input: ExpenseInput, id?: string, legacyNo?: string) {
    const businessId = ctx.businessId!;
    const cat = await tx.expenseCategory.findFirst({ where: { id: input.categoryId, archivedAt: null } });
    if (!cat) throw new BadRequestException({ message: 'Choose a category.', field: 'categoryId' });
    const settings = await tx.businessSettings.findFirst();
    const gstOn = !!settings?.gstEnabled;
    const L = this.lines(input, gstOn);
    const t = expenseTotals(L.map((l) => ({ amt: l.amt, gst: l.gst })));
    const src = await this.source(tx, input.mode, input.accountId);
    const old = id ? await tx.expense.findFirst({ where: { id }, include: { lines: true } }) : null;
    if (id && !old) throw new NotFoundException({ message: 'That expense was not found.' });
    if (old?.cancelledAt) throw new BadRequestException({ message: 'This expense is cancelled.' });
    if (old) await this.editable(tx, old, input);
    const number = old?.number ?? legacyNo ?? (await this.numbers.next(tx, businessId, ctx.userId, 'expense', input.date));
    if (legacyNo) await this.numbers.claim(tx, businessId, ctx.userId, 'expense', input.date, legacyNo);
    const data = {
      date: day(input.date), payee: input.payee, mode: input.mode, accountId: src.accountId, reference: input.reference, notes: input.notes,
      taxable: t.total.minus(t.gst).toFixed(2), tax: t.gst.toFixed(2), total: t.total.toFixed(2),
    };
    const x = old
      ? await tx.expense.update({ where: { id: old.id }, data })
      : await tx.expense.create({ data: { ...data, businessId, createdBy: ctx.userId, number, ...(legacyNo && { legacyId: legacyNo }) } });
    if (old) await tx.expenseLine.deleteMany({ where: { expenseId: old.id } }); // lines of a live record, replaced as a whole
    await tx.expenseLine.createMany({
      data: L.map((l, i) => ({ businessId, expenseId: x.id, position: i, categoryId: cat.id, description: l.name, qty: l.qty.toFixed(3), rate: l.rate.toFixed(2), amount: l.amt.toFixed(2), gstRate: String(l.gst), tax: round2(gstInside(l.amt, l.gst)).toFixed(2) })),
    });
    // the cheque register: a cheque expense waits there until the bank pays it
    await tx.cheque.updateMany({ where: { expenseId: x.id, status: 'pending' }, data: { status: 'cancelled' } });
    if (input.mode === 'Cheque') await tx.cheque.create({ data: { businessId, createdBy: ctx.userId, direction: 'issued', chequeNo: input.reference, chequeDate: day(input.date), amount: t.total.toFixed(2), expenseId: x.id, note: number } });
    const cgst = round2(t.gst.div(2));
    const lines: PostLine[] = [
      { account: 'expenses', debit: t.total.minus(t.gst), memo: cat.name },
      { account: 'input_cgst', debit: cgst }, { account: 'input_sgst', debit: t.gst.minus(cgst) },
      { account: src.account, credit: t.total, memo: `${input.mode}${input.reference ? ' · ' + input.reference : ''}` },
    ];
    await this.ledger.repost(tx, { businessId, userId: ctx.userId }, { date: input.date, sourceType: 'expense', sourceId: x.id, number, narration: `Expense · ${cat.name}`, lines });
    await this.audit.log(tx, { businessId, userId: ctx.userId, action: old ? 'update' : 'create', entity: 'expense', entityId: x.id, before: old ?? undefined, after: { ...x, category: cat.name, lines: L.map((l) => ({ ...l, qty: l.qty.toString(), rate: l.rate.toFixed(2), amt: l.amt.toFixed(2) })) }, ip: ctx.ip });
    return { id: x.id, number, total: t.total.toFixed(2), account: src.accountId };
  }

  /**
   * What stops a saved expense from being changed: another number, a cheque the bank already
   * cleared or bounced (it has its own entry), or an entry ticked in Reconciliation.
   */
  private async editable(tx: Tx, old: { id: string; number: string }, input: ExpenseInput) {
    keepNumber(input.number, old.number, 'expense');
    const why = (await this.lockedReasons(tx, [old.id])).get(old.id);
    if (why) throw new BadRequestException({ message: why });
  }

  /** Expense id → why it can't be changed now (the list shows it on a greyed-out Edit). */
  private async lockedReasons(tx: Tx, ids: string[]) {
    const out = new Map<string, string>();
    const chqs = await tx.cheque.findMany({ where: { expenseId: { in: ids }, status: { in: ['cleared', 'bounced'] } }, orderBy: { createdAt: 'asc' } });
    for (const c of chqs) out.set(c.expenseId!, `Cheque ${c.chequeNo} on this expense is already ${c.status}. Undo it on the Cheques page first.`);
    for (const [id, bank] of await reconciledMap(tx, 'expense', ids)) if (!out.has(id)) out.set(id, reconciledMessage(bank));
    return out;
  }

  cancel(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const x = await tx.expense.findFirst({ where: { id } });
      if (!x) throw new NotFoundException({ message: 'That expense was not found.' });
      if (x.cancelledAt) throw new BadRequestException({ message: 'Already cancelled' });
      await this.ledger.cancel(tx, 'expense', id);
      await tx.cheque.updateMany({ where: { expenseId: id, status: 'pending' }, data: { status: 'cancelled' } });
      await tx.expense.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'expense', entityId: id, before: x, ip: ctx.ip });
      return { id, number: x.number };
    });
  }

  /**
   * Every expense, newest first, plus money taken out in the cash / bank book for shop
   * expenses, salary or bank charges (prototype allExpenses).
   */
  list(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const cats = new Map((await tx.expenseCategory.findMany()).map((c) => [c.id, c.name]));
      const xs = await tx.expense.findMany({ where: { cancelledAt: null }, include: { lines: { orderBy: { position: 'asc' } } } });
      const locked = await this.lockedReasons(tx, xs.map((x) => x.id));
      const rows = xs.map((x) => ({
        key: 'EX:' + x.number, id: x.id, src: 'ex' as const, number: x.number, date: isoOf(x.date)!, category: cats.get(x.lines[0]?.categoryId ?? '') ?? '', categoryId: x.lines[0]?.categoryId ?? null,
        payee: x.payee, mode: x.mode, accountId: x.accountId, reference: x.reference, notes: x.notes, total: money(x.total.toString()).toFixed(2), gst: money(x.tax.toString()).toFixed(2),
        lines: x.lines.map((l): ExpenseLineOut => ({ name: l.description, qty: money(l.qty.toString()).toString(), rate: money(l.rate.toString()).toFixed(2), gst: Number(l.gstRate), amt: money(l.amount.toString()).toFixed(2) })),
        locked: locked.get(x.id) ?? '',
      }));
      const bes = await tx.bankEntry.findMany({ where: { cancelledAt: null, kind: 'out', category: { in: Object.keys(BOOK_EXPENSE_CATEGORY) } } });
      const cash = new Set((await tx.cashBankAccount.findMany({ where: { kind: 'cash' }, select: { id: true } })).map((a) => a.id));
      const ticked = await reconciledMap(tx, 'bank_entry', bes.map((b) => b.id));
      const book = bes.map((b) => {
        const amt: Money = money(b.amount.toString());
        return {
          key: 'BT:' + b.number, id: b.id, src: 'bt' as const, number: b.number, date: isoOf(b.date)!, category: BOOK_EXPENSE_CATEGORY[b.category]!, categoryId: null,
          payee: b.note, mode: cash.has(b.accountId) ? 'Cash' : 'Bank', accountId: b.accountId, reference: b.reference, notes: '', total: amt.toFixed(2), gst: '0.00',
          lines: [{ name: b.note || b.category, qty: '1', rate: amt.toFixed(2), gst: 0, amt: amt.toFixed(2) }],
          locked: ticked.has(b.id) ? reconciledMessage(ticked.get(b.id)!) : '',
        };
      });
      // newest first, then by number (prototype sorts by date, then "no" descending)
      return [...rows, ...book].sort((a, b) => b.date.localeCompare(a.date) || (b.number < a.number ? -1 : b.number > a.number ? 1 : 0));
    });
  }
}

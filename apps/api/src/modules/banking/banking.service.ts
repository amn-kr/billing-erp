import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, formatInr2, money, todayIst, type BankEntryInput, type CashBankAccountInput, type Money } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { fieldChanges, keepNumber, reconciledIn, reconciledMessage } from '../../common/editing';

/** The other side of money added or taken out by hand (prototype BM_CAT). */
const CATEGORY_ACCOUNT: Record<string, string> = {
  'Interest received': 'other_income', 'Capital added by owner': 'capital', 'Loan received': 'loans', 'Other income': 'other_income',
  'Bank charges': 'bank_charges', 'Shop expense': 'expenses', 'Owner drawings': 'drawings', 'Loan repayment': 'loans', Salary: 'expenses',
  'Cash excess on count': 'cash_difference', 'Cash short on count': 'cash_difference', 'Commission paid': 'commission',
};
const MOVE_LABEL: Record<string, string> = { deposit: 'Cash deposited', withdraw: 'Cash withdrawn', transfer: 'Transfer' };

type BankEntryRow = NonNullable<Awaited<ReturnType<Tx['bankEntry']['findFirst']>>>;

export interface BookEntry {
  key: string; date: string; amt: string; kind: string; party: string; doc: string; mode: string; ref: string; note: string;
  src: string; sourceId: string; run: string;
}

/**
 * Banking & cash (prototype ACCTS / BTX / bkEntries): the shop's cash and bank accounts, a book
 * for each built from every document that moved money through it, and entries typed by hand
 * (transfers, deposits, withdrawals, money added or taken out). Entries are cancelled, never deleted.
 */
@Injectable()
export class BankingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /* ───────── accounts ───────── */

  accounts(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: [{ createdAt: 'asc' }] });
      const bal = await this.ledger.cashBankBalances(tx);
      const used = await this.usedAccounts(tx);
      // cash first, then banks in the order they were added (prototype ACCTS)
      return [...accs.filter((a) => a.kind === 'cash'), ...accs.filter((a) => a.kind === 'bank')].map((a) => ({
        id: a.id, kind: a.kind, name: a.name, sub: a.sub, accountNo: a.accountNo, ifsc: a.ifsc, branch: a.branch,
        openingBalance: money(a.openingBalance.toString()).toFixed(2), openingDate: isoOf(a.openingDate), isDefault: a.isDefault,
        balance: (bal.get(a.id) ?? money(0)).toFixed(2), used: used.has(a.id),
      }));
    });
  }

  /** Accounts that have entries (they cannot be removed). */
  private async usedAccounts(tx: Tx) {
    const rows = await tx.$queryRaw<{ key: string }[]>`
      SELECT DISTINCT a.key FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
      WHERE e.cancelled_at IS NULL AND a.key LIKE 'cb:%'`;
    return new Set(rows.map((r) => r.key.slice(3)));
  }

  private check(input: CashBankAccountInput, cash: boolean) {
    if (cash) return;
    if (!input.name) throw new BadRequestException({ message: 'Enter the bank name.', field: 'name' });
    const no = input.accountNo.replace(/\s/g, '');
    if (no && !/^\d{6,18}$/.test(no)) throw new BadRequestException({ message: 'Account number should be 6 to 18 digits.', field: 'accountNo' });
    if (input.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc.toUpperCase())) throw new BadRequestException({ message: 'IFSC looks wrong — it is 11 characters like HDFC0001234.', field: 'ifsc' });
  }

  addAccount(ctx: RequestContext, input: CashBankAccountInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      this.check(input, false);
      const banks = await tx.cashBankAccount.findMany({ where: { kind: 'bank', archivedAt: null } });
      // the first bank account takes UPI, card and bank transfers
      const def = input.isDefault || !banks.some((b) => b.isDefault);
      if (def) await tx.cashBankAccount.updateMany({ where: { kind: 'bank' }, data: { isDefault: false } });
      const a = await tx.cashBankAccount.create({
        data: {
          businessId: ctx.businessId!, createdBy: ctx.userId, kind: 'bank', name: input.name, sub: input.sub || 'Current account', accountNo: input.accountNo.replace(/\s/g, ''),
          ifsc: input.ifsc.toUpperCase(), branch: input.branch, openingBalance: money(input.openingBalance).toFixed(2), openingDate: day(input.openingDate ?? todayIst()), isDefault: def,
        },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'cash_bank_account', entityId: a.id, after: a, ip: ctx.ip });
      return { id: a.id, name: a.name };
    });
  }

  updateAccount(ctx: RequestContext, id: string, input: CashBankAccountInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.cashBankAccount.findFirst({ where: { id, archivedAt: null } });
      if (!a) throw new NotFoundException({ message: 'That account was not found.' });
      const cash = a.kind === 'cash';
      this.check(input, cash);
      let def = a.isDefault;
      if (!cash) {
        const others = await tx.cashBankAccount.findMany({ where: { kind: 'bank', archivedAt: null, id: { not: id } } });
        def = input.isDefault || !others.some((b) => b.isDefault);
        if (def) await tx.cashBankAccount.updateMany({ where: { kind: 'bank', id: { not: id } }, data: { isDefault: false } });
      }
      const u = await tx.cashBankAccount.update({
        where: { id },
        data: {
          openingBalance: money(input.openingBalance).toFixed(2), openingDate: day(input.openingDate ?? todayIst()),
          ...(!cash && { name: input.name, sub: input.sub || a.sub, accountNo: input.accountNo.replace(/\s/g, ''), ifsc: input.ifsc.toUpperCase(), branch: input.branch, isDefault: def }),
        },
      });
      if (!cash && u.name !== a.name) await tx.ledgerAccount.updateMany({ where: { key: 'cb:' + id }, data: { name: u.name } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'cash_bank_account', entityId: id, before: a, after: u, ip: ctx.ip });
      return { id, name: u.name };
    });
  }

  /** A bank account with no entries can be removed (kept, hidden). */
  removeAccount(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.cashBankAccount.findFirst({ where: { id, archivedAt: null } });
      if (!a) throw new NotFoundException({ message: 'That account was not found.' });
      if (a.kind === 'cash') throw new BadRequestException({ message: 'Cash in hand cannot be removed.' });
      if ((await this.usedAccounts(tx)).has(id)) throw new BadRequestException({ message: 'This account has entries. Move them first.' });
      await tx.cashBankAccount.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });
      if (a.isDefault) {
        const next = await tx.cashBankAccount.findFirst({ where: { kind: 'bank', archivedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.cashBankAccount.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'cash_bank_account', entityId: id, before: a, after: { removed: true }, ip: ctx.ip });
      return { id, name: a.name };
    });
  }

  /* ───────── the book of one account ───────── */

  book(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.cashBankAccount.findFirst({ where: { id } });
      if (!a) throw new NotFoundException({ message: 'That account was not found.' });
      const entries = await this.entries(tx, id);
      let run = money(a.openingBalance.toString());
      const rows: BookEntry[] = entries.map((e) => { run = run.plus(e.amt); return { ...e, amt: e.amt.toFixed(2), run: run.toFixed(2) }; });
      return { id: a.id, openingBalance: money(a.openingBalance.toString()).toFixed(2), openingDate: isoOf(a.openingDate), balance: run.toFixed(2), entries: rows };
    });
  }

  /** Every live journal line on the account, described like the prototype's money book (oldest first). */
  private async entries(tx: Tx, accountId: string) {
    const lines = await tx.journalLine.findMany({
      where: { account: { key: 'cb:' + accountId }, entry: { cancelledAt: null } },
      include: { entry: true },
    });
    const ids = (t: string) => [...new Set(lines.filter((l) => l.entry.sourceType === t).map((l) => l.entry.sourceId))];
    const pays = new Map((await tx.payment.findMany({ where: { id: { in: ids('payment') } }, include: { party: { select: { name: true } } } })).map((p) => [p.id, p]));
    // a walk-in sale's money carries the name typed on the bill
    const walkIn = new Map((await tx.salesDocument.findMany({ where: { id: { in: [...pays.values()].flatMap((p) => (!p.partyId && p.sourceId ? [p.sourceId] : [])) } }, select: { id: true, cashName: true } })).map((d) => [d.id, d.cashName]));
    const sdocs = new Map((await tx.salesDocument.findMany({ where: { id: { in: ids('sales_document') } }, include: { party: { select: { name: true } } } })).map((d) => [d.id, d]));
    const exps = new Map((await tx.expense.findMany({ where: { id: { in: ids('expense') } }, include: { lines: { take: 1, orderBy: { position: 'asc' } } } })).map((x) => [x.id, x]));
    const catName = new Map((await tx.expenseCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const chqs = new Map((await tx.cheque.findMany({ where: { id: { in: ids('cheque') } } })).map((c) => [c.id, c]));
    const chqPay = new Map((await tx.payment.findMany({ where: { id: { in: [...chqs.values()].flatMap((c) => (c.paymentId ? [c.paymentId] : [])) } }, include: { party: { select: { name: true } } } })).map((p) => [p.id, p]));
    const chqExp = new Map((await tx.expense.findMany({ where: { id: { in: [...chqs.values()].flatMap((c) => (c.expenseId ? [c.expenseId] : [])) } }, include: { lines: { take: 1, orderBy: { position: 'asc' } } } })).map((x) => [x.id, x]));
    const cps = new Map((await tx.commissionPayout.findMany({ where: { id: { in: ids('commission_payout') } }, include: { referrer: { select: { name: true } } } })).map((x) => [x.id, x]));
    const bes = await tx.bankEntry.findMany({ where: { id: { in: ids('bank_entry') } } });
    const be = new Map(bes.map((b) => [b.id, b]));
    const accIds = [...new Set(bes.flatMap((b) => [b.accountId, b.toAccountId ?? '']).filter(Boolean))];
    const accName = new Map((await tx.cashBankAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const used = new Map<string, number>();
    const out = lines.map((l) => {
      const e = l.entry;
      const amt: Money = money(l.debit.toString()).minus(l.credit.toString());
      const base = { key: l.id, sk: e.number, date: isoOf(e.date)!, amt, doc: e.number, note: '', src: e.sourceType, sourceId: e.sourceId, mode: '', ref: '', party: '', kind: e.narration };
      if (e.sourceType === 'payment') {
        const p = pays.get(e.sourceId);
        if (p) {
          // a payment split across modes: one line per mode, matched in order
          const splits = (Array.isArray(p.splits) ? p.splits : []) as { mode: string; amount: string; ref: string }[];
          const k = used.get(p.id) ?? 0;
          const s = splits.length > 1 ? splits.filter((x) => x.mode !== 'Cheque')[k] : null;
          used.set(p.id, k + 1);
          return { ...base, sk: (p.direction === 'in' ? 'R:' : 'P:') + p.number, kind: p.direction === 'in' ? 'Payment received' : 'Payment made', party: p.party?.name ?? (p.sourceId ? walkIn.get(p.sourceId) ?? '' : ''), mode: s?.mode ?? p.mode, ref: s ? s.ref : p.reference };
        }
      }
      if (e.sourceType === 'sales_document') {
        const d = sdocs.get(e.sourceId);
        return { ...base, sk: 'CN:' + e.number, kind: amt.isNegative() ? 'Refund on return' : 'Payment received', party: d?.party?.name ?? d?.cashName ?? '' };
      }
      if (e.sourceType === 'cheque') {
        const c = chqs.get(e.sourceId);
        if (c) {
          const p = c.paymentId ? chqPay.get(c.paymentId) : undefined;
          const x = c.expenseId ? chqExp.get(c.expenseId) : undefined;
          const doc = p?.number ?? x?.number ?? c.note;
          const party = p?.party?.name ?? (x ? x.payee || catName.get(x.lines[0]?.categoryId ?? '') || '' : '');
          const key = (c.direction === 'received' ? 'R:' : x ? 'X:' : 'P:') + doc;
          if (l.memo === 'bounce charges') return { ...base, sk: key + ':chg', kind: 'Cheque bounce charges', party, doc, mode: '', ref: c.chequeNo };
          return { ...base, sk: key, kind: c.direction === 'received' ? 'Cheque deposited' : 'Cheque cleared', party, doc, mode: 'Cheque', ref: c.chequeNo };
        }
      }
      if (e.sourceType === 'commission_payout') {
        const x = cps.get(e.sourceId);
        if (x) return { ...base, sk: 'CP:' + x.number, kind: 'Commission paid', party: x.referrer.name, mode: x.mode, note: x.note };
      }
      if (e.sourceType === 'expense') {
        const x = exps.get(e.sourceId);
        if (x) {
          const cat = catName.get(x.lines[0]?.categoryId ?? '') ?? '';
          return { ...base, sk: 'EX:' + x.number, kind: 'Expense · ' + cat, party: x.payee || cat, mode: x.mode, ref: x.reference, note: x.notes };
        }
      }
      if (e.sourceType === 'bank_entry') {
        const b = be.get(e.sourceId);
        if (b) {
          base.sk = 'BT:' + b.number;
          const note = b.note, ref = b.reference;
          if (b.kind === 'in' || b.kind === 'out') return { ...base, kind: b.category || (b.kind === 'out' ? 'Money taken out' : 'Money added'), party: note, ref, note: '' };
          const into = amt.gt(0);
          return { ...base, kind: MOVE_LABEL[b.kind]!, party: into ? 'From ' + (accName.get(b.accountId) ?? '') : 'To ' + (accName.get(b.toAccountId ?? '') ?? ''), ref, note };
        }
      }
      return base;
    });
    // date, then money in before money out, then the document (prototype acctLedger sorts by "R:PI-…", "P:PO-…", "BT:BT-…")
    out.sort((x, y) => x.date.localeCompare(y.date) || Number(y.amt.gt(0)) - Number(x.amt.gt(0)) || (x.sk < y.sk ? -1 : x.sk > y.sk ? 1 : 0) || x.key.localeCompare(y.key));
    return out.map(({ sk: _sk, ...r }) => r);
  }

  /* ───────── reconciliation (prototype RECON: statement date, balance, ticked entries) ───────── */

  /** The last statement worked on for this account; a new one starts on the last day of last month, nothing ticked. */
  reconciliation(ctx: RequestContext, accountId: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const r = await tx.reconciliation.findFirst({ where: { accountId }, orderBy: { updatedAt: 'desc' } });
      if (r) return { asOf: isoOf(r.statementDate)!, statement: r.statementBalance === null ? null : money(r.statementBalance.toString()).toFixed(2), ticked: (r.cleared as string[]) ?? [] };
      const t = todayIst();
      return { asOf: addDays(t.slice(0, 8) + '01', -1), statement: null, ticked: [] as string[] };
    });
  }

  saveReconciliation(ctx: RequestContext, accountId: string, o: { asOf: string; statement: string | null; ticked: string[] }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.cashBankAccount.findFirst({ where: { id: accountId, kind: 'bank' } });
      if (!a) throw new NotFoundException({ message: 'That account was not found.' });
      const r = await tx.reconciliation.findFirst({ where: { accountId }, orderBy: { updatedAt: 'desc' } });
      const data = { statementDate: day(o.asOf), statementBalance: o.statement === null ? null : money(o.statement).toFixed(2), cleared: o.ticked };
      if (r) await tx.reconciliation.update({ where: { id: r.id }, data });
      else await tx.reconciliation.create({ data: { ...data, businessId: ctx.businessId!, createdBy: ctx.userId, accountId } });
      return { ok: true };
    });
  }

  /* ───────── entries typed by hand ───────── */

  move(ctx: RequestContext, input: BankEntryInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => this.moveIn(tx, ctx, await this.checked(tx, input)));
  }

  /** A typed entry checked the way a new one is (for an edit: with the old entry already undone). */
  private async checked(tx: Tx, input: BankEntryInput) {
    const amt = money(Number(input.amount) > 0 ? input.amount : 0);
    if (!amt.gt(0)) throw new BadRequestException({ message: 'Enter the amount.', field: 'amount' });
    const accs = new Map((await tx.cashBankAccount.findMany({ where: { archivedAt: null } })).map((a) => [a.id, a]));
    const k = input.kind;
    const two = k === 'transfer' || k === 'deposit' || k === 'withdraw';
    let from = '', to = '', acc = '';
    if (two) {
      from = input.fromId ?? ''; to = input.toId ?? '';
      const f = accs.get(from), t = accs.get(to);
      if (!f || !t || from === to) throw new BadRequestException({ message: 'Choose two different accounts.' });
      if ((k === 'deposit' && (f.kind !== 'cash' || t.kind !== 'bank')) || (k === 'withdraw' && (f.kind !== 'bank' || t.kind !== 'cash')) || (k === 'transfer' && (f.kind !== 'bank' || t.kind !== 'bank')))
        throw new BadRequestException({ message: 'Choose two different accounts.' });
      if (f.kind === 'cash') {
        const bal = (await this.ledger.cashBankBalances(tx)).get(from) ?? money(0);
        if (amt.gt(bal.plus(0.001))) throw new BadRequestException({ message: `Only ${formatInr2(bal.toFixed(2))} cash in hand.`, field: 'amount' });
      }
    } else {
      acc = input.accountId ?? '';
      if (!accs.get(acc)) throw new BadRequestException({ message: 'Choose the account.' });
    }
    return { kind: k, date: input.date, amount: amt, from, to, account: acc, category: input.category, reference: input.reference, note: input.note };
  }

  /** Writes a typed entry and its book lines; `old` (an edit) keeps its number, its old lines already undone. */
  async moveIn(tx: Tx, ctx: RequestContext, o: { kind: string; date: string; amount: Money; from: string; to: string; account: string; category: string; reference: string; note: string; legacyNo?: string }, old?: BankEntryRow) {
    const businessId = ctx.businessId!;
    const number = old?.number ?? o.legacyNo ?? (await this.numbers.next(tx, businessId, ctx.userId, 'bank_entry', o.date));
    if (o.legacyNo) await this.numbers.claim(tx, businessId, ctx.userId, 'bank_entry', o.date, o.legacyNo);
    const two = !!o.from;
    const data = {
      date: day(o.date), kind: o.kind, accountId: two ? o.from : o.account, toAccountId: two ? o.to : null,
      amount: o.amount.toFixed(2), category: two ? '' : o.category, note: o.note, reference: o.reference,
    };
    const b = old
      ? await tx.bankEntry.update({ where: { id: old.id }, data })
      : await tx.bankEntry.create({ data: { ...data, businessId, createdBy: ctx.userId, number, ...(o.legacyNo && { legacyId: o.legacyNo }) } });
    const other = CATEGORY_ACCOUNT[o.category] ?? (o.kind === 'in' ? 'other_income' : 'expenses');
    const lines = two
      ? [{ account: 'cb:' + o.to, debit: o.amount }, { account: 'cb:' + o.from, credit: o.amount }]
      : o.kind === 'in' ? [{ account: 'cb:' + o.account, debit: o.amount }, { account: other, credit: o.amount }] : [{ account: other, debit: o.amount }, { account: 'cb:' + o.account, credit: o.amount }];
    await this.ledger.post(tx, { businessId, userId: ctx.userId }, { date: o.date, sourceType: 'bank_entry', sourceId: b.id, number, narration: two ? MOVE_LABEL[o.kind]! : o.category || o.kind, lines });
    await this.audit.log(tx, { businessId, userId: ctx.userId, action: old ? 'update' : 'create', entity: 'bank_entry', entityId: b.id, before: old, ip: ctx.ip,
      after: old ? { ...b, changes: fieldChanges(old, b, ['date', 'kind', 'accountId', 'toAccountId', 'amount', 'category', 'reference', 'note']) } : b });
    return { id: b.id, number, amount: o.amount.toFixed(2) };
  }

  /** "Count cash": the difference from the books is saved as cash excess or short. */
  countCash(ctx: RequestContext, counted: string, date: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const cash = await tx.cashBankAccount.findFirst({ where: { kind: 'cash', archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      if (!cash) throw new BadRequestException({ message: 'There is no cash account.' });
      const book = (await this.ledger.cashBankBalances(tx)).get(cash.id) ?? money(0);
      const diff = money(counted).minus(book);
      if (diff.abs().lt(0.01)) return { match: true, diff: '0.00', number: null };
      const r = await this.moveIn(tx, ctx, { kind: diff.gt(0) ? 'in' : 'out', date, amount: diff.abs(), from: '', to: '', account: cash.id, category: diff.gt(0) ? 'Cash excess on count' : 'Cash short on count', reference: '', note: 'Cash count' });
      return { match: false, diff: diff.toFixed(2), number: r.number };
    });
  }

  entry(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const b = await tx.bankEntry.findFirst({ where: { id } });
      if (!b) throw new NotFoundException({ message: 'That entry was not found.' });
      return { id: b.id, number: b.number, date: isoOf(b.date), kind: b.kind, accountId: b.accountId, toAccountId: b.toAccountId, amount: money(b.amount.toString()).toFixed(2), category: b.category, note: b.note, reference: b.reference, cancelled: !!b.cancelledAt, locked: await this.lockedReason(tx, b) };
    });
  }

  /**
   * Edit an entry typed by hand: its old lines stop counting (as when it is cancelled) and the new
   * ones are written under the same number, in one go. Entries made by something else, cancelled
   * ones and ones ticked in Reconciliation are refused with what to do instead.
   */
  editEntry(ctx: RequestContext, id: string, input: BankEntryInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const b = await tx.bankEntry.findFirst({ where: { id } });
      if (!b) throw new NotFoundException({ message: 'That entry was not found.' });
      const why = await this.lockedReason(tx, b);
      if (why) throw new BadRequestException({ message: why });
      keepNumber(input.number, b.number, 'entry');
      await this.ledger.cancel(tx, 'bank_entry', id);
      return this.moveIn(tx, ctx, await this.checked(tx, input), b);
    });
  }

  /** Why a typed entry can't be changed, or '' (also shown greyed out in the book's row menu). */
  private async lockedReason(tx: Tx, b: BankEntryRow) {
    if (b.cancelledAt) return 'This entry is cancelled, so it can’t be changed.';
    if (b.category === 'Commission paid') return `This entry was made by commission payment ${b.reference ? b.reference + ' ' : ''}on the Commission page, so it can’t be changed here.`;
    if (b.category === 'Cash excess on count' || b.category === 'Cash short on count') return 'This is a cash count difference. Count the cash again to correct it.';
    const bank = await reconciledIn(tx, 'bank_entry', b.id);
    return bank ? reconciledMessage(bank) : '';
  }

  cancelEntry(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const b = await tx.bankEntry.findFirst({ where: { id } });
      if (!b) throw new NotFoundException({ message: 'That entry was not found.' });
      if (b.cancelledAt) throw new BadRequestException({ message: 'Already cancelled' });
      await this.ledger.cancel(tx, 'bank_entry', id);
      await tx.bankEntry.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'bank_entry', entityId: id, before: b, ip: ctx.ip });
      return { id, number: b.number };
    });
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatInr2, money } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { LedgerService, type PostLine } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';

/**
 * Cheques (prototype allCheques / bcm): received from customers, issued to suppliers or for
 * expenses. A cheque waits until it is deposited / cleared (the money then moves into or out
 * of the bank) or bounces (the amount goes back on the party's account, with any bank charges).
 * Undo puts it back to pending; nothing is deleted.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  list(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const cs = await tx.cheque.findMany({ where: { status: { not: 'cancelled' } } });
      const pays = new Map((await tx.payment.findMany({ where: { id: { in: cs.flatMap((c) => (c.paymentId ? [c.paymentId] : [])) } }, include: { party: { select: { name: true } }, allocations: true } })).map((p) => [p.id, p]));
      const exps = new Map((await tx.expense.findMany({ where: { id: { in: cs.flatMap((c) => (c.expenseId ? [c.expenseId] : [])) } }, include: { lines: { take: 1, orderBy: { position: 'asc' } } } })).map((x) => [x.id, x]));
      const catName = new Map((await tx.expenseCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const docIds = [...pays.values()].flatMap((p) => p.allocations.flatMap((a) => [a.salesDocumentId, a.purchaseDocumentId].filter((x): x is string => !!x)));
      const docNo = new Map([
        ...(await tx.salesDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, number: true, cashName: true } })).map((d) => [d.id, d.number] as const),
        ...(await tx.purchaseDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, number: true } })).map((d) => [d.id, d.number] as const),
      ]);
      const walkIn = new Map((await tx.salesDocument.findMany({ where: { id: { in: [...pays.values()].flatMap((p) => (!p.partyId && p.sourceId ? [p.sourceId] : [])) } }, select: { id: true, cashName: true } })).map((d) => [d.id, d.cashName]));
      const rows = cs.flatMap((c) => {
        const p = c.paymentId ? pays.get(c.paymentId) : undefined;
        const x = c.expenseId ? exps.get(c.expenseId) : undefined;
        if (p?.cancelledAt || x?.cancelledAt) return [];
        const cat = x ? catName.get(x.lines[0]?.categoryId ?? '') ?? '' : '';
        const against = p ? [...new Set(p.allocations.map((a) => (a.kind === 'opening' ? 'Opening balance' : docNo.get(a.salesDocumentId ?? a.purchaseDocumentId ?? '') ?? '')).filter(Boolean))].join(', ') : cat;
        return [{
          id: c.id, dir: c.direction === 'received' ? 'in' : 'out', number: p?.number ?? x?.number ?? c.note, date: isoOf(c.chequeDate)!, ref: c.chequeNo,
          party: p ? p.party?.name ?? (p.sourceId ? walkIn.get(p.sourceId) ?? '' : '') : x ? x.payee || cat : '', partyId: p?.partyId ?? null,
          amount: money(c.amount.toString()).toFixed(2), against, status: c.status, statusDate: isoOf(c.statusDate), accountId: c.accountId,
          charges: money(c.charges.toString()).toFixed(2), note: c.status === 'bounced' ? c.note : '',
        }];
      });
      // newest first, then by number (prototype allCheques)
      return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.number < a.number ? -1 : b.number > a.number ? 1 : 0));
    });
  }

  /** Deposited (received) or cleared (issued): the money moves into or out of the bank. */
  clear(ctx: RequestContext, id: string, o: { accountId: string; date: string }) {
    return this.db.scoped(this.scope(ctx), (tx) => this.clearIn(tx, ctx, id, o));
  }

  async clearIn(tx: Tx, ctx: RequestContext, id: string, o: { accountId: string; date: string }) {
    const c = await tx.cheque.findFirst({ where: { id } });
    if (!c || c.status === 'cancelled') throw new NotFoundException({ message: 'That cheque was not found.' });
    if (c.status !== 'pending') throw new BadRequestException({ message: 'This cheque is not pending.' });
    const acc = await tx.cashBankAccount.findFirst({ where: { id: o.accountId, kind: 'bank', archivedAt: null } });
    if (!acc) throw new BadRequestException({ message: 'Add a bank account first — Banking › Bank accounts' });
    const amt = money(c.amount.toString());
    const lines: PostLine[] = c.direction === 'received'
      ? [{ account: 'cb:' + acc.id, debit: amt, memo: 'cheque' }, { account: 'cheques_in_hand', credit: amt }]
      : [{ account: 'cheques_issued', debit: amt }, { account: 'cb:' + acc.id, credit: amt, memo: 'cheque' }];
    await this.ledger.post(tx, { businessId: ctx.businessId!, userId: ctx.userId }, { date: o.date, sourceType: 'cheque', sourceId: c.id, number: c.chequeNo, narration: c.direction === 'received' ? 'Cheque deposited' : 'Cheque cleared', lines });
    const u = await tx.cheque.update({ where: { id }, data: { status: 'cleared', statusDate: day(o.date), accountId: acc.id } });
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'cheque', entityId: id, before: c, after: u, ip: ctx.ip });
    return { id, ref: c.chequeNo, amount: amt.toFixed(2), account: acc.name, dir: c.direction === 'received' ? 'in' : 'out' };
  }

  /** Bounced: the amount goes back on the party's account; the bank's charges come out of the bank. */
  bounce(ctx: RequestContext, id: string, o: { accountId: string; date: string; charges: string; note: string }) {
    return this.db.scoped(this.scope(ctx), (tx) => this.bounceIn(tx, ctx, id, o));
  }

  async bounceIn(tx: Tx, ctx: RequestContext, id: string, o: { accountId: string; date: string; charges: string; note: string }) {
    const c = await tx.cheque.findFirst({ where: { id } });
    if (!c || c.status === 'cancelled') throw new NotFoundException({ message: 'That cheque was not found.' });
    if (c.status !== 'pending') throw new BadRequestException({ message: 'This cheque is not pending.' });
    const acc = await tx.cashBankAccount.findFirst({ where: { id: o.accountId, kind: 'bank', archivedAt: null } });
    if (!acc) throw new BadRequestException({ message: 'Add a bank account first — Banking › Bank accounts' });
    const amt = money(c.amount.toString());
    const chg = money(Number(o.charges) > 0 ? o.charges : 0);
    const pay = c.paymentId ? await tx.payment.findFirst({ where: { id: c.paymentId }, select: { partyId: true } }) : null;
    const partyId = pay?.partyId ?? c.partyId;
    // received: the customer owes it again; issued: the shop owes the supplier again; an expense cheque just goes back
    const lines: PostLine[] = c.direction === 'received'
      ? [partyId ? { account: 'receivable', partyId, debit: amt } : { account: 'sales', debit: amt }, { account: 'cheques_in_hand', credit: amt }]
      : [{ account: 'cheques_issued', debit: amt }, partyId ? { account: 'payable', partyId, credit: amt } : { account: 'expenses', credit: amt }];
    if (chg.gt(0)) lines.push({ account: 'bank_charges', debit: chg }, { account: 'cb:' + acc.id, credit: chg, memo: 'bounce charges' });
    await this.ledger.post(tx, { businessId: ctx.businessId!, userId: ctx.userId }, { date: o.date, sourceType: 'cheque', sourceId: c.id, number: c.chequeNo, narration: 'Cheque bounced', lines });
    const u = await tx.cheque.update({ where: { id }, data: { status: 'bounced', statusDate: day(o.date), accountId: acc.id, charges: chg.toFixed(2), note: o.note } });
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'cheque', entityId: id, before: c, after: u, ip: ctx.ip });
    return { id, ref: c.chequeNo, amount: amt.toFixed(2), charges: formatInr2(chg.toFixed(2)) };
  }

  /** Back to pending: the entry it made no longer counts. */
  undo(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const c = await tx.cheque.findFirst({ where: { id } });
      if (!c || c.status === 'cancelled') throw new NotFoundException({ message: 'That cheque was not found.' });
      if (c.status === 'pending') throw new BadRequestException({ message: 'This cheque is already pending.' });
      await this.ledger.cancel(tx, 'cheque', id);
      const u = await tx.cheque.update({ where: { id }, data: { status: 'pending', statusDate: null, accountId: null, charges: '0', note: '' } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'cheque', entityId: id, before: c, after: u, ip: ctx.ip });
      return { id, ref: c.chequeNo };
    });
  }
}

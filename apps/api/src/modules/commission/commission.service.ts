import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatInr2, money, round2, todayIst, type Money } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { autoAllocate, invoiceBalances, openDues } from '../sales/dues';
import { BankingService } from '../banking/banking.service';

const r2m = (v: Money) => round2(v);

/**
 * Electrician commission (prototype cmBills / cmStats / cmPay): commission on referred bills,
 * less commission on goods returned, is earned as the customer pays; what was earned and not
 * yet paid is payable. Paying takes money from cash or the bank, or is adjusted against the
 * electrician's own unpaid bills.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** Every electrician with their referred bills, returns, earnings and payments. */
  summary(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      await this.syncElectricians(tx, ctx);
      return this.summaryIn(tx);
    });
  }

  /** Any party put in the "Electricians" group shows up as an electrician (prototype elecSync). */
  private async syncElectricians(tx: Tx, ctx: RequestContext) {
    const group = await tx.partyGroup.findFirst({ where: { name: 'Electricians' } });
    if (!group) return;
    const linked = new Set((await tx.referrer.findMany({ where: { partyId: { not: null } }, select: { partyId: true } })).map((r) => r.partyId!));
    const add = await tx.party.findMany({ where: { groupId: group.id, archivedAt: null, id: { notIn: [...linked] } }, include: { addresses: { where: { kind: 'billing' }, take: 1 } }, orderBy: { createdAt: 'asc' } });
    for (const p of add) await tx.referrer.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name: p.name, phone: p.phone, city: p.addresses[0]?.city ?? '', partyId: p.id } });
  }

  private async summaryIn(tx: Tx, only?: string) {
    const refs = await tx.referrer.findMany({ where: { archivedAt: null, ...(only && { id: only }) }, orderBy: { createdAt: 'asc' } });
    const invs = await tx.salesDocument.findMany({
      where: { kind: 'invoice', cancelledAt: null, referrerId: { in: refs.map((r) => r.id) } },
      include: { lines: true, party: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    const bal = await invoiceBalances(tx, invs.map((v) => v.id));
    // credit notes against those invoices: their lines (commission given back) and what they took off each invoice
    const cnLines = await tx.salesDocumentLine.findMany({ where: { againstId: { in: invs.map((v) => v.id) }, document: { kind: 'credit_note', cancelledAt: null } }, include: { document: { select: { id: true, number: true, date: true, reason: true } } } });
    const cnAlloc = await tx.paymentAllocation.findMany({ where: { salesDocumentId: { in: invs.map((v) => v.id) }, noteId: { not: null } } });
    const liveNotes = new Set((await tx.salesDocument.findMany({ where: { id: { in: cnAlloc.map((a) => a.noteId!) }, cancelledAt: null }, select: { id: true } })).map((n) => n.id));
    const payouts = await tx.commissionPayout.findMany({ where: { cancelledAt: null, referrerId: { in: refs.map((r) => r.id) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    const pBal = new Map((await this.ledger.partyBalances(tx, refs.flatMap((r) => (r.partyId ? [r.partyId] : [])))).entries());
    return refs.map((e) => {
      const B = invs.filter((v) => v.referrerId === e.id).flatMap((v) => {
        const comm = v.lines.reduce((a, l) => a.plus(l.commAmount.toString()), money(0));
        if (!comm.gt(0)) return [];
        const R = cnLines.filter((l) => l.againstId === v.id).flatMap((l) => {
          const line = v.lines.find((x) => x.itemId === l.itemId && Number(x.commAmount) > 0);
          if (!line || !Number(line.qty)) return [];
          const amt = r2m(money(line.commAmount.toString()).div(line.qty.toString()).times(l.qty.toString()));
          return amt.gt(0) ? [{ cn: l.document.number, date: isoOf(l.document.date)!, inv: v.number, item: l.name, qty: Number(l.qty), amt: amt.toFixed(2), reason: l.document.reason || 'Goods returned' }] : [];
        });
        const ret = R.reduce((a, x) => a.plus(x.amt), money(0));
        const cnSum = cnAlloc.filter((a) => a.salesDocumentId === v.id && liveNotes.has(a.noteId!)).reduce((a, x) => a.plus(x.amount.toString()), money(0));
        const total = money(v.total.toString());
        const invPaid = total.minus(bal.get(v.id) ?? money(0));
        const net = money(Math.max(0, Number(total.minus(cnSum))));
        const paid = money(Math.max(0, Number(invPaid.minus(cnSum))));
        const f = net.gt(0) ? Math.min(1, Number(paid.div(net))) : cnSum.gt(0) ? 1 : 0;
        const c2 = money(Math.max(0, Number(r2m(comm.minus(ret)))));
        return [{ id: v.id, number: v.number, date: isoOf(v.date)!, partyName: v.party?.name ?? v.cashName, total: total.toFixed(2), comm: r2m(comm).toFixed(2), ret: r2m(ret).toFixed(2), f, earned: r2m(c2.times(f)).toFixed(2), returns: R, net: c2 }];
      });
      const P = payouts.filter((x) => x.referrerId === e.id);
      const sum = (k: 'comm' | 'ret' | 'earned' | 'total') => r2m(B.reduce((a, b) => a.plus(b[k]), money(0)));
      const paid = r2m(P.reduce((a, x) => a.plus(x.amount.toString()), money(0)));
      const earned = sum('earned');
      return {
        id: e.id, name: e.name, phone: e.phone, city: e.city, partyId: e.partyId, partyBalance: e.partyId ? (pBal.get(e.partyId) ?? money(0)).toFixed(2) : null,
        bills: B.length, business: sum('total').toFixed(2), comm: r2m(B.reduce((a, b) => a.plus(b.net), money(0))).toFixed(2), ret: sum('ret').toFixed(2), earned: earned.toFixed(2), paid: paid.toFixed(2), due: earned.minus(paid).toFixed(2),
        invoices: B.map(({ net: _n, ...b }) => b),
        payouts: P.map((x) => ({ number: x.number, date: isoOf(x.date)!, mode: x.mode, note: x.note, amount: money(x.amount.toString()).toFixed(2) })),
      };
    });
  }

  /** Pay commission (prototype cmPay): cash / UPI / bank transfer, or "Adjust" against his own unpaid bills. */
  pay(ctx: RequestContext, o: { referrerId: string; amount: string; mode: string; note: string; date?: string }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const [e] = await this.summaryIn(tx, o.referrerId);
      if (!e) throw new NotFoundException({ message: 'That electrician was not found.' });
      const amt = money(Number(o.amount) > 0 ? o.amount : 0);
      if (!amt.gt(0)) throw new BadRequestException({ message: 'Enter the amount.' });
      const due = money(e.due);
      const adjust = o.mode === 'Adjust';
      if (amt.gt(due.plus(0.01))) throw new BadRequestException({ message: adjust ? `Only ${formatInr2(e.due)} is payable now.` : `Only ${formatInr2(e.due)} is payable now — the rest is earned as the customer pays.` });
      const date = o.date ?? todayIst();
      const businessId = ctx.businessId!;
      const number = await this.numbers.next(tx, businessId, ctx.userId, 'commission_payout', date);
      if (adjust) {
        if (!e.partyId) throw new BadRequestException({ message: 'This electrician has no account to adjust against.' });
        const party = e.partyId;
        // a receipt that pays his oldest dues with the commission (prototype "Commission adjust")
        const D = await openDues(tx, party);
        const { alloc } = autoAllocate(D, amt);
        const pino = await this.numbers.next(tx, businessId, ctx.userId, 'receipt', date);
        const p = await tx.payment.create({ data: { businessId, createdBy: ctx.userId, direction: 'in', number: pino, date: day(date), partyId: party, amount: amt.toFixed(2), mode: 'Commission adjust', reference: 'Commission', splits: [{ mode: 'Commission adjust', amount: amt.toFixed(2), ref: 'Commission' }] as Prisma.InputJsonValue } });
        if (alloc.length) await tx.paymentAllocation.createMany({ data: alloc.map((a) => ({ businessId, paymentId: p.id, partyId: party, amount: a.amount.toFixed(2), ...(a.to === 'opening' ? { kind: 'opening' } : { salesDocumentId: a.to }) })) });
        await this.ledger.post(tx, { businessId, userId: ctx.userId }, { date, sourceType: 'payment', sourceId: p.id, number: pino, narration: `Commission adjusted · ${e.name}`, lines: [{ account: 'commission', debit: amt, memo: `Commission adjust · ${number}` }, { account: 'receivable', partyId: party, credit: amt }] });
        const docs = alloc.map((a) => (a.to === 'opening' ? 'Opening balance' : D.find((d) => d.to === a.to)?.number ?? ''));
        const x = await tx.commissionPayout.create({ data: { businessId, createdBy: ctx.userId, number, date: day(date), referrerId: e.id, amount: amt.toFixed(2), mode: 'Adjusted in his account', note: pino + (docs.length ? ' · ' + docs.join(', ') : ' · kept as advance') } });
        await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'commission_payout', entityId: x.id, after: x, ip: ctx.ip });
        return { number, amount: amt.toFixed(2), name: e.name, adjusted: true };
      }
      if (!['Cash', 'UPI', 'Bank transfer'].includes(o.mode)) throw new BadRequestException({ message: 'Choose how it was paid.' });
      const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
      const cash = accs.find((a) => a.kind === 'cash' && a.isDefault) ?? accs.find((a) => a.kind === 'cash')!;
      const banks = accs.filter((a) => a.kind === 'bank');
      const acc = o.mode === 'Cash' ? cash : banks.find((b) => b.isDefault) ?? banks[0] ?? cash;
      const x = await tx.commissionPayout.create({ data: { businessId, createdBy: ctx.userId, number, date: day(date), referrerId: e.id, amount: amt.toFixed(2), mode: o.mode, accountId: acc.id, note: o.note } });
      // the money goes out through the cash / bank book, as the old app did ("Commission paid", ref CP-…)
      await new BankingService(this.db, this.audit, this.numbers, this.ledger).moveIn(tx, ctx, { kind: 'out', date, amount: amt, from: '', to: '', account: acc.id, category: 'Commission paid', reference: number, note: e.name });
      await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'commission_payout', entityId: x.id, after: x, ip: ctx.ip });
      return { number, amount: amt.toFixed(2), name: e.name, adjusted: false };
    });
  }

  /** A payout from the old app, kept as it was (an "adjusted" one is already in the books through its receipt). */
  async importPayout(tx: Tx, ctx: RequestContext, o: { number: string; date: string; referrerId: string; amount: Money; mode: string; note: string }) {
    const businessId = ctx.businessId!;
    await this.numbers.claim(tx, businessId, ctx.userId, 'commission_payout', o.date, o.number);
    const adjusted = /adjust/i.test(o.mode);
    let accountId: string | null = null;
    // the old app also wrote the cash payment in its cash / bank book ("Commission paid", ref CP-…); when that
    // entry came across, it already moved the money
    const bookEntry = adjusted ? null : await tx.bankEntry.findFirst({ where: { reference: o.number, category: 'Commission paid', cancelledAt: null } });
    if (bookEntry) accountId = bookEntry.accountId;
    else if (!adjusted) {
      const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
      const cash = accs.find((a) => a.kind === 'cash' && a.isDefault) ?? accs.find((a) => a.kind === 'cash')!;
      const banks = accs.filter((a) => a.kind === 'bank');
      accountId = (o.mode === 'Cash' ? cash : banks.find((b) => b.isDefault) ?? banks[0] ?? cash).id;
    }
    const x = await tx.commissionPayout.create({ data: { businessId, createdBy: ctx.userId, number: o.number, date: day(o.date), referrerId: o.referrerId, amount: o.amount.toFixed(2), mode: o.mode, accountId, note: o.note, legacyId: o.number } });
    if (accountId && !bookEntry) await this.ledger.post(tx, { businessId, userId: ctx.userId }, { date: o.date, sourceType: 'commission_payout', sourceId: x.id, number: o.number, narration: 'Commission paid (imported)', lines: [{ account: 'commission', debit: o.amount }, { account: 'cb:' + accountId, credit: o.amount, memo: o.mode }] });
  }
}

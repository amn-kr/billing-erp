import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  amountInWords, lineCommission, money, saleTotals, taxModeOf, toDb, todayIst, type CommRule, type Money, type SaleInput, type TaxMode,
} from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService, type PostLine } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { autoAllocate, invoiceBalances, openDues, unusedAmounts } from './dues';
import { capSplits, moneyInLines } from './money-in';

const q3 = (v: { toString(): string }) => money(v.toString()).toDecimalPlaces(3).toFixed(3);
const d2 = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : toDb(v.toString()));
const KIND_WORD = { invoice: 'Invoice', quotation: 'Quotation' } as const;
const RULE_KIND: Record<string, CommRule['t']> = { none: 'n', percent: 'p', fixed: 'f' };

/** The shop's tax set-up when a document is saved. */
export async function booksOf(tx: Tx, businessId: string): Promise<{ mode: TaxMode; state: string; tcsRate: Money | null }> {
  const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, include: { settings: true } });
  const data = (b.settings?.data ?? {}) as Record<string, unknown>;
  const mode = taxModeOf(!!b.settings?.gstEnabled, data.reg as string | undefined);
  let tcsRate: Money | null = null;
  if (mode === 'gst' && data.tcs && typeof data.tcsRate === 'string') {
    const t = await tx.taxRate.findFirst({ where: { id: data.tcsRate, active: true } });
    if (t) tcsRate = money(t.rate.toString());
  }
  return { mode, state: b.stateCode || '09', tcsRate };
}

/** Party balance (positive = to receive) from the books, leaving out one document's own entry. */
async function balanceWithout(tx: Tx, ledger: LedgerService, partyId: string, docId?: string) {
  const all = (await ledger.partyBalances(tx, [partyId])).get(partyId) ?? money(0);
  if (!docId) return all;
  const [r] = await tx.$queryRaw<{ s: string | null }[]>`
    SELECT sum(l.debit - l.credit)::text AS s FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE e.cancelled_at IS NULL AND e.source_id = ${docId}::uuid AND l.party_id = ${partyId}::uuid`;
  return all.minus(money(r?.s ?? 0));
}

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** The number the editor shows for a new document. */
  nextNumber(ctx: RequestContext, kind: string, date?: string) {
    const docType = { invoice: 'invoice', quotation: 'quotation', challan: 'challan', credit_note: 'credit_note', receipt: 'receipt' }[kind];
    if (!docType) throw new BadRequestException({ message: 'Unknown document type.' });
    return this.db.scoped(this.scope(ctx), async (tx) => ({ number: await this.numbers.peek(tx, ctx.businessId!, ctx.userId, docType, date ?? todayIst()) }));
  }

  /* ───────── invoice / item-wise quotation ───────── */

  save(ctx: RequestContext, input: SaleInput, id?: string) {
    return this.db.scoped(this.scope(ctx), (tx) => this.saveIn(tx, ctx, input, id), { timeout: 30_000 });
  }

  private async saveIn(tx: Tx, ctx: RequestContext, input: SaleInput, id?: string) {
    const businessId = ctx.businessId!;
    const kind = input.kind;
    const isInv = kind === 'invoice';
    const before = id ? await tx.salesDocument.findFirst({ where: { id, kind }, include: { lines: true } }) : null;
    if (id && !before) throw new NotFoundException({ message: `That ${KIND_WORD[kind].toLowerCase()} was not found.` });
    if (before?.cancelledAt) throw new BadRequestException({ message: `${before.number} is cancelled. It can’t be changed.` });

    /* checks, in the prototype's order and words */
    const cash = input.mode === 'cash';
    if (!cash && !input.partyId)
      throw new BadRequestException({ message: isInv ? 'Choose who this bill is for. For a counter sale, switch to Cash.' : 'Choose the party, or switch to Walk-in and type a name.', field: 'partyId' });
    const party = !cash && input.partyId ? await tx.party.findFirst({ where: { id: input.partyId } }) : null;
    if (!cash && !party) throw new BadRequestException({ message: 'That party was not found.', field: 'partyId' });
    const rows = input.lines.filter((l) => l.itemId || l.name.trim());
    if (!rows.length) throw new BadRequestException({ message: 'Add at least one item.', field: 'lines' });
    const items = new Map((await tx.item.findMany({ where: { id: { in: rows.flatMap((l) => (l.itemId ? [l.itemId] : [])) } }, include: { unit: true } })).map((i) => [i.id, i]));
    const qtyBad = rows.find((l) => !money(l.qty).gt(0));
    const unknown = rows.find((l) => !l.itemId || !items.has(l.itemId));
    const qtyMsg = (l: (typeof rows)[number]) => `Enter a quantity for “${l.name || items.get(l.itemId!)?.name || ''}”.`;
    const unknownMsg = (l: (typeof rows)[number]) => `“${l.name}” isn’t in your items. Pick it from the list or add it as a new item.`;
    if (isInv) {
      if (qtyBad) throw new BadRequestException({ message: qtyMsg(qtyBad), field: 'lines' });
      if (unknown) throw new BadRequestException({ message: unknownMsg(unknown), field: 'lines' });
    } else {
      if (unknown) throw new BadRequestException({ message: unknownMsg(unknown), field: 'lines' });
      if (qtyBad) throw new BadRequestException({ message: qtyMsg(qtyBad), field: 'lines' });
    }
    const docType = kind;
    let number = input.number.trim();
    if (number && number !== before?.number) {
      const used = await tx.salesDocument.findFirst({ where: { kind, number, ...(id && { id: { not: id } }) } });
      if (used) throw new BadRequestException({ message: `${KIND_WORD[kind]} number ${number} is already used.`, field: 'number' });
    }

    /* totals, worked out here (never trusted from the browser) */
    const books = await booksOf(tx, businessId);
    const pos = books.mode === 'gst' ? input.placeOfSupply || (party ? partyState(party, books.state) : books.state) : books.state;
    const lines = rows.map((l) => {
      const it = items.get(l.itemId!)!;
      return { l, it, gst: books.mode === 'gst' ? l.gstRate : '0' };
    });
    const t = saleTotals({
      mode: books.mode, incl: input.pricesInclTax, inter: pos !== books.state,
      lines: lines.map(({ l, gst }) => ({ qty: l.qty, price: l.price, disc: l.discPct, gst })),
      bdiscP: input.billDiscPct, bdisc: input.billDiscAmt, tcsRate: books.tcsRate, chTr: input.transport, chLab: input.labour, chBank: input.bankCharge, roundOff: input.roundOff,
    });
    const paid = isInv ? input.payments.reduce((a, p) => a.plus(money(p.amount)), money(0)) : money(0);
    const received = paid.lt(t.total) ? paid : t.total;

    /* credit limit: asked once, saved on the second press */
    if (isInv && !cash && party!.creditLimit && money(party!.creditLimit.toString()).gt(0) && !input.confirmOverLimit) {
      const newBal = (await balanceWithout(tx, this.ledger, party!.id, id)).plus(t.total.minus(received));
      if (newBal.gt(money(party!.creditLimit.toString())))
        throw new ConflictException({ code: 'over_credit_limit', message: 'This sale goes over the credit limit. Press Save again to save anyway.' });
    }

    /* referral commission per line */
    const rules = input.referrerId ? await this.commissionRules(tx) : new Map<string, CommRule>();
    const byCat = input.extra.commByCategory ?? {};
    const inclGst = input.pricesInclTax && books.mode === 'gst';

    if (!number) number = await this.numbers.next(tx, businessId, ctx.userId, docType, input.date);
    else if (number !== before?.number) await this.numbers.claim(tx, businessId, ctx.userId, docType, input.date, number);

    const head = {
      number, date: day(input.date), dueDate: isInv ? day(cash ? input.date : (input.dueDate ?? input.date)) : input.extra.validTill ? day(input.extra.validTill) : null,
      mode: input.mode, partyId: party?.id ?? null, cashName: cash ? input.cashName.trim() || 'Walk-in customer' : '', cashPhone: cash ? input.cashPhone : '', billName: input.billName,
      taxMode: books.mode, pricesInclTax: input.pricesInclTax, placeOfSupply: pos, roundOff: input.roundOff,
      billDiscPct: input.billDiscPct, billDiscAmt: input.billDiscPct ? null : input.billDiscAmt,
      transport: toDb(input.transport), labour: toDb(input.labour), bankCharge: toDb(input.bankCharge), tcsRate: books.tcsRate ? books.tcsRate.toFixed(2) : null,
      itemsTotal: t.items.toFixed(2), billDiscount: t.bdisc.toFixed(2), taxable: t.taxable.toFixed(2), tax: t.tax.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), igst: t.igst.toFixed(2),
      tcs: t.tcs.toFixed(2), roundAmount: t.round.toFixed(2), total: t.total.toFixed(2), notes: input.notes, referrerId: input.referrerId ?? null,
      extra: input.extra as Prisma.InputJsonValue,
    };
    const doc = before
      ? await tx.salesDocument.update({ where: { id: before.id }, data: head })
      : await tx.salesDocument.create({ data: { ...head, businessId, kind, createdBy: ctx.userId, status: 'open', sourceId: input.fromChallanId ?? input.fromQuotationIds[0] ?? null } });
    if (before) await tx.salesDocumentLine.deleteMany({ where: { documentId: doc.id } });
    await tx.salesDocumentLine.createMany({
      data: lines.map(({ l, it, gst }, k) => {
        const r = t.rows[k]!;
        const rule: CommRule | null = !input.referrerId || l.basePrice === null ? null : (l.commOverride ?? byCat[it.categoryId ?? ''] ?? rules.get(it.categoryId ?? '') ?? { t: 'n', v: 0 });
        const comm = input.referrerId ? lineCommission({ qty: l.qty, discPct: l.discPct, price: l.price, basePrice: l.basePrice, gstRate: gst }, inclGst) : money(0);
        return {
          businessId, documentId: doc.id, position: k, itemId: it.id, name: l.name || it.name, hsn: l.hsn || it.hsn, qty: money(l.qty).toFixed(3), unit: it.unit?.code ?? l.unit,
          price: toDb(l.price), discPct: money(l.discPct).toDecimalPlaces(8).toFixed(8), gstRate: money(gst).toFixed(2), taxable: r.tv.toFixed(2), tax: r.tx.toFixed(2), amount: r.amt.toFixed(2),
          basePrice: input.referrerId && l.basePrice !== null ? toDb(l.basePrice) : null, commOverride: l.commOverride ? (l.commOverride as Prisma.InputJsonValue) : Prisma.DbNull,
          commType: rule ? { n: 'none', p: 'p', f: 'f' }[rule.t] : 'none', commValue: rule ? money(rule.v).toFixed(2) : '0', commAmount: comm.toFixed(2),
        };
      }),
    });

    let settledOld = money(0);
    let advance = money(0);
    if (isInv) {
      await this.moveStock(tx, ctx, doc.id, number, input.date, lines.map(({ l, it }, k) => ({ it, qty: money(l.qty), rate: t.rows[k]!.amt.div(money(l.qty)) })), !!before);
      await this.ledger.repost(tx, { businessId, userId: ctx.userId }, {
        date: input.date, sourceType: 'sales_document', sourceId: doc.id, number, narration: `Sale ${number} · ${party?.name ?? head.cashName}`,
        lines: invoiceLines(t, party?.id ?? null),
      });
      const r = await this.atSaleReceipt(tx, ctx, { doc, party, input, total: t.total, paid });
      settledOld = r.settledOld;
      advance = r.advance;
      /* the quotations and challan it came from */
      if (input.fromQuotationIds.length)
        for (const qid of input.fromQuotationIds) {
          const q = await tx.salesDocument.findFirst({ where: { id: qid, kind: 'quotation' } });
          if (q) await tx.salesDocument.update({ where: { id: q.id }, data: { status: 'converted', extra: { ...(q.extra as object), invoiceNo: number, invoiceId: doc.id } } });
        }
      if (input.fromChallanId) {
        const c = await tx.salesDocument.findFirst({ where: { id: input.fromChallanId, kind: 'challan' } });
        if (c && c.status === 'open') await tx.salesDocument.update({ where: { id: c.id }, data: { status: 'invoiced', extra: { ...(c.extra as object), invoiceNo: number, invoiceId: doc.id } } });
      }
    }

    const after = await tx.salesDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: { orderBy: { position: 'asc' } } } });
    await this.audit.log(tx, { businessId, userId: ctx.userId, action: before ? 'update' : 'create', entity: 'sales_document', entityId: doc.id, before: before ?? undefined, after: { ...after, received: received.toFixed(2) }, ip: ctx.ip });
    const balance = isInv ? ((await invoiceBalances(tx, [doc.id])).get(doc.id) ?? money(0)) : t.total;
    return {
      id: doc.id, number, total: t.total.toFixed(2), received: received.toFixed(2), balance: balance.toFixed(2),
      settledOld: settledOld.toFixed(2), advance: advance.toFixed(2), change: !party && paid.gt(t.total) ? paid.minus(t.total).toFixed(2) : '0.00',
    };
  }

  private async commissionRules(tx: Tx) {
    const rows = await tx.commissionRule.findMany();
    return new Map(rows.map((r) => [r.categoryId, { t: RULE_KIND[r.kind] ?? 'n', v: Number(r.value) } as CommRule]));
  }

  /** Items leave the default godown; an edit first puts the old quantities back. */
  private async moveStock(tx: Tx, ctx: RequestContext, docId: string, number: string, date: string, lines: { it: { id: string; kind: string }; qty: Money; rate: Money }[], edited: boolean) {
    const base = { businessId: ctx.businessId!, createdBy: ctx.userId, sourceType: 'sales_document', sourceId: docId };
    if (edited) await this.reverseStock(tx, ctx, docId, date, `Edited ${number}`);
    const godown = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
    const goods = lines.filter((l) => l.it.kind !== 'service');
    if (goods.length)
      await tx.stockMovement.createMany({
        data: goods.map((l) => ({ ...base, itemId: l.it.id, godownId: godown.id, date: day(date), qty: l.qty.neg().toFixed(3), rate: l.rate.toDecimalPlaces(2).toFixed(2), kind: 'sale', note: number })),
      });
  }

  /** Puts back whatever a document's movements still take out, item by item and godown by godown. */
  private async reverseStock(tx: Tx, ctx: RequestContext, docId: string, date: string, note: string) {
    const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId'], where: { sourceType: 'sales_document', sourceId: docId }, _sum: { qty: true } });
    const back = net.filter((n) => n._sum.qty && !n._sum.qty.isZero());
    if (back.length)
      await tx.stockMovement.createMany({
        data: back.map((n) => ({
          businessId: ctx.businessId!, createdBy: ctx.userId, sourceType: 'sales_document', sourceId: docId, itemId: n.itemId, godownId: n.godownId,
          date: day(date), qty: n._sum.qty!.neg().toFixed(3), kind: 'cancel', note,
        })),
      });
  }

  /**
   * Money taken on the invoice screen: one receipt, settled against this invoice first,
   * any extra against the party's older dues (oldest first), the rest kept as advance.
   * A walk-in sale records only the bill amount (the rest is change).
   */
  private async atSaleReceipt(
    tx: Tx, ctx: RequestContext,
    o: { doc: { id: string; number: string; date: Date }; party: { id: string; name: string } | null; input: SaleInput; total: Money; paid: Money },
  ) {
    const businessId = ctx.businessId!;
    const date = isoOf(o.doc.date)!;
    const old = await tx.payment.findFirst({ where: { sourceId: o.doc.id, atSale: true, cancelledAt: null } });
    const amount = o.party ? o.paid : o.paid.lt(o.total) ? o.paid : o.total;
    const zero = { settledOld: money(0), advance: money(0) };
    if (old) {
      await tx.cheque.updateMany({ where: { paymentId: old.id, status: 'pending' }, data: { status: 'cancelled', statusDate: day(date), note: `Replaced when ${o.doc.number} was edited` } });
      await tx.paymentAllocation.deleteMany({ where: { paymentId: old.id } });
    }
    if (!amount.gt(0)) {
      if (old) {
        await tx.payment.update({ where: { id: old.id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
        await this.ledger.cancel(tx, 'payment', old.id);
      }
      return zero;
    }
    const splits = o.party ? o.input.payments.map((p) => ({ mode: p.mode as string, amount: money(p.amount), ref: p.ref })).filter((p) => p.amount.gt(0)) : capSplits(o.input.payments, amount);
    const modes = [...new Set(splits.map((s) => s.mode))];
    const data = {
      date: day(date), partyId: o.party?.id ?? null, amount: amount.toFixed(2), mode: modes.join(' + '), reference: splits.map((s) => s.ref).filter(Boolean).join(', '),
      splits: splits.map((s) => ({ mode: s.mode, amount: s.amount.toFixed(2), ref: s.ref })) as Prisma.InputJsonValue, notes: `Received with ${o.doc.number}`,
    };
    const pay = old
      ? await tx.payment.update({ where: { id: old.id }, data })
      : await tx.payment.create({ data: { ...data, businessId, createdBy: ctx.userId, direction: 'in', atSale: true, sourceId: o.doc.id, number: await this.numbers.next(tx, businessId, ctx.userId, 'receipt', date) } });
    const onBill = amount.lt(o.total) ? amount : o.total;
    const alloc = [{ to: o.doc.id, amount: onBill }];
    let left = amount.minus(onBill);
    let settledOld = money(0);
    if (o.party && left.gt(0)) {
      const r = autoAllocate(await openDues(tx, o.party.id, { upTo: date, except: o.doc.id }), left);
      alloc.push(...r.alloc);
      settledOld = left.minus(r.left);
      left = r.left;
    }
    await tx.paymentAllocation.createMany({
      data: alloc.map((a) => ({
        businessId, paymentId: pay.id, amount: a.amount.toFixed(2),
        ...(a.to === 'opening' ? { kind: 'opening', partyId: o.party!.id } : { salesDocumentId: a.to, partyId: o.party?.id ?? null }),
      })),
    });
    const debit = await moneyInLines(tx, { businessId, userId: ctx.userId }, { splits, paymentId: pay.id, partyId: o.party?.id ?? null, date, memo: pay.number });
    await this.ledger.repost(tx, { businessId, userId: ctx.userId }, {
      date, sourceType: 'payment', sourceId: pay.id, number: pay.number, narration: `Received with ${o.doc.number}`,
      lines: [...debit, { account: 'receivable', partyId: o.party?.id ?? null, credit: amount }],
    });
    return { settledOld, advance: left };
  }

  /* ───────── cancel ───────── */

  cancel(ctx: RequestContext, id: string, reason: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const d = await tx.salesDocument.findFirst({ where: { id } });
      if (!d) throw new NotFoundException({ message: 'That document was not found.' });
      if (d.cancelledAt) throw new BadRequestException({ message: 'Already cancelled' });
      const today = todayIst();
      let movedToAdvance = money(0);
      if (d.kind === 'invoice') {
        const bal = (await invoiceBalances(tx, [d.id])).get(d.id) ?? money(0);
        movedToAdvance = money(d.total.toString()).minus(bal);
        await this.ledger.cancel(tx, 'sales_document', d.id);
        await this.reverseStock(tx, ctx, d.id, today, `Cancelled ${d.number}`);
        if (!d.partyId) {
          // a walk-in has no account to keep an advance in: the money taken with it is refunded
          const pays = await tx.payment.findMany({ where: { sourceId: d.id, atSale: true, cancelledAt: null } });
          for (const p of pays) {
            await tx.payment.update({ where: { id: p.id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
            await this.ledger.cancel(tx, 'payment', p.id);
            await tx.cheque.updateMany({ where: { paymentId: p.id, status: 'pending' }, data: { status: 'cancelled', statusDate: day(today) } });
          }
          movedToAdvance = money(0);
        }
      }
      await tx.salesDocument.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: reason, ...(d.kind === 'challan' && { status: 'cancelled' }) } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'sales_document', entityId: id, before: d, after: { reason, movedToAdvance: movedToAdvance.toFixed(2) }, ip: ctx.ip });
      return { id, number: d.number, movedToAdvance: movedToAdvance.toFixed(2) };
    });
  }

  /* ───────── reading ───────── */

  list(ctx: RequestContext, kind: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const docs = await tx.salesDocument.findMany({
        where: { kind }, include: { party: { select: { id: true, name: true, gstin: true, addresses: { where: { kind: 'billing' }, select: { city: true } } } }, lines: { select: { qty: true, name: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
      });
      const bal = kind === 'invoice' ? await invoiceBalances(tx, docs.map((d) => d.id)) : new Map<string, Money>();
      return docs.map((d) => {
        const total = money(d.total.toString());
        const b = bal.get(d.id) ?? (kind === 'invoice' ? money(0) : total);
        const x = d.extra as Record<string, unknown>;
        return {
          id: d.id, number: d.number, date: isoOf(d.date), dueDate: isoOf(d.dueDate), mode: d.mode,
          party: d.party ? { id: d.party.id, name: d.party.name, city: d.party.addresses[0]?.city ?? '', gstin: d.party.gstin } : null,
          partyName: d.party?.name ?? d.cashName, phone: d.cashPhone,
          total: total.toFixed(2), received: d.cancelledAt ? '0.00' : total.minus(b).toFixed(2), balance: d.cancelledAt ? '0.00' : b.toFixed(2),
          cancelled: !!d.cancelledAt, status: d.status, items: d.lines.length, qty: q3(d.lines.reduce((a, l) => a.plus(money(l.qty.toString())), money(0))),
          lineNames: d.lines.slice(0, 3).map((l) => l.name), transport: (x.transport as string) ?? '', vehicle: (x.vehicle as string) ?? '', note: d.notes,
          invoiceNo: (x.invoiceNo as string) ?? '', legacy: !!d.legacyId, referrerId: d.referrerId,
        };
      });
    });
  }

  get(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const d = await tx.salesDocument.findFirst({
        where: { id },
        include: { party: { include: { addresses: { where: { kind: 'billing' } } } }, lines: { orderBy: { position: 'asc' } } },
      });
      if (!d) throw new NotFoundException({ message: 'That document was not found.' });
      const items = new Map((await tx.item.findMany({ where: { id: { in: d.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])) } }, include: { brand: true, category: true, itemGroup: true } })).map((i) => [i.id, i]));
      const bal = d.kind === 'invoice' ? ((await invoiceBalances(tx, [d.id])).get(d.id) ?? money(0)) : money(d.total.toString());
      const allocs = await tx.paymentAllocation.findMany({ where: { OR: [{ salesDocumentId: d.id }, { noteId: d.id }] }, include: { payment: true }, orderBy: { createdAt: 'asc' } });
      const notes = await tx.salesDocument.findMany({ where: { id: { in: allocs.flatMap((a) => (a.noteId && a.noteId !== d.id ? [a.noteId] : [])) } }, select: { id: true, number: true, date: true, cancelledAt: true } });
      const atSale = await tx.payment.findFirst({ where: { sourceId: d.id, atSale: true, cancelledAt: null } });
      const history = await tx.auditLog.findMany({ where: { entityId: d.id }, orderBy: { createdAt: 'asc' }, select: { action: true, createdAt: true, after: true } });
      const total = money(d.total.toString());
      return {
        id: d.id, kind: d.kind, number: d.number, date: isoOf(d.date), dueDate: isoOf(d.dueDate), mode: d.mode, status: d.status,
        party: d.party ? { id: d.party.id, name: d.party.name, phone: d.party.phone, gstin: d.party.gstin, city: d.party.addresses[0]?.city ?? '', state: d.party.stateCode } : null,
        partyName: d.party?.name ?? d.cashName, cashName: d.cashName, cashPhone: d.cashPhone, billName: d.billName,
        taxMode: d.taxMode, pricesInclTax: d.pricesInclTax, placeOfSupply: d.placeOfSupply, roundOff: d.roundOff,
        billDiscPct: d2(d.billDiscPct), billDiscAmt: d2(d.billDiscAmt), transport: d2(d.transport), labour: d2(d.labour), bankCharge: d2(d.bankCharge), tcsRate: d2(d.tcsRate),
        itemsTotal: d2(d.itemsTotal), billDiscount: d2(d.billDiscount), taxable: d2(d.taxable), tax: d2(d.tax), cgst: d2(d.cgst), sgst: d2(d.sgst), igst: d2(d.igst), tcs: d2(d.tcs),
        roundAmount: d2(d.roundAmount), total: total.toFixed(2), words: amountInWords(total),
        received: d.cancelledAt ? (atSale ? toDb(atSale.amount.toString()) : '0.00') : total.minus(bal).toFixed(2), balance: d.cancelledAt ? '0.00' : bal.toFixed(2),
        notes: d.notes, reason: d.reason, extra: d.extra, referrerId: d.referrerId, cancelled: !!d.cancelledAt, cancelledAt: d.cancelledAt, legacy: !!d.legacyId,
        lines: d.lines.map((l) => {
          const it = l.itemId ? items.get(l.itemId) : undefined;
          return {
            id: l.id, itemId: l.itemId, name: l.name, hsn: l.hsn, qty: q3(l.qty), unit: l.unit, price: d2(l.price), discPct: l.discPct.toString(), gstRate: l.gstRate.toString(),
            taxable: d2(l.taxable), tax: d2(l.tax), amount: d2(l.amount), basePrice: d2(l.basePrice), commOverride: l.commOverride, commType: l.commType, commValue: d2(l.commValue), commAmount: d2(l.commAmount),
            againstId: l.againstId, code: it?.code ?? '', brand: it?.brand?.name ?? '', series: it?.series ?? '', group: it?.itemGroup?.name ?? '', category: it?.category?.name ?? '', categoryId: it?.categoryId ?? null,
          };
        }),
        payment: atSale ? { id: atSale.id, number: atSale.number, amount: d2(atSale.amount), mode: atSale.mode, reference: atSale.reference, splits: atSale.splits } : null,
        settlements: allocs.map((a) => {
          const n = a.noteId ? notes.find((x) => x.id === a.noteId) : null;
          return {
            amount: d2(a.amount), kind: a.paymentId ? 'payment' : 'credit_note', number: a.payment?.number ?? n?.number ?? '', date: isoOf(a.payment?.date ?? n?.date ?? null),
            mode: a.payment?.mode ?? '', atSale: !!a.payment?.atSale, cancelled: !!(a.payment?.cancelledAt ?? n?.cancelledAt),
          };
        }),
        history: history.map((h) => ({ action: h.action, at: h.createdAt })),
      };
    });
  }

  /** A customer's unpaid dues (Receive payment, footer "Pre. Dues"). */
  dues(ctx: RequestContext, partyId: string, except?: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await openDues(tx, partyId, { except });
      return L.map((d) => ({ ...d, total: d.total.toFixed(2), balance: d.balance.toFixed(2) }));
    });
  }

  /** Advance (unused money) per receipt. */
  unused(tx: Tx, ids: string[]) {
    return unusedAmounts(tx, 'payment', ids);
  }
}

/** A party's state for place of supply: from the GSTIN, else the party's state. */
export function partyState(p: { gstin: string; stateCode: string }, fallback: string) {
  if (p.gstin && /^\d{2}/.test(p.gstin)) return p.gstin.slice(0, 2);
  return p.stateCode || fallback;
}

/** The invoice's journal lines; round off takes up any paisa so the entry always balances. */
export function invoiceLines(t: ReturnType<typeof saleTotals>, partyId: string | null): PostLine[] {
  const charges = t.chTr.plus(t.chLab).plus(t.chBank);
  const round = t.total.minus(t.taxable).minus(t.tax).minus(t.tcs).minus(charges);
  return [
    { account: 'receivable', partyId, debit: t.total },
    { account: 'sales', credit: t.taxable },
    { account: 'output_cgst', credit: t.cgst },
    { account: 'output_sgst', credit: t.sgst },
    { account: 'output_igst', credit: t.igst },
    { account: 'tcs_payable', credit: t.tcs },
    { account: 'charges_income', credit: charges },
    { account: 'round_off', credit: round },
  ];
}

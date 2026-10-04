import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { money, purchaseTotals, toDb, todayIst, type Money, type PaymentOutInput, type PurchaseInput } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService, type PostLine } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { booksOf } from '../sales/sales.service';
import { billBalances, usedOut } from './dues';

const DOC_TYPE = { bill: 'bill', order: 'purchase_order', debit_note: 'debit_note' } as const;
const d2 = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : toDb(v.toString()));
const q3 = (v: { toString(): string }) => money(v.toString()).toDecimalPlaces(3).toFixed(3);
const fmt = (v: Money) => v.toDecimalPlaces(3).toNumber().toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Where money paid out comes from: cash from the cash account, cheques wait in "cheques issued" until cleared, the rest from the bank. */
async function accountOut(tx: Tx, mode: string): Promise<string> {
  if (mode === 'Cheque') return 'cheques_issued';
  const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
  const cash = accs.find((a) => a.kind === 'cash' && a.isDefault) ?? accs.find((a) => a.kind === 'cash');
  if (/cash/i.test(mode)) return 'cb:' + cash!.id;
  const banks = accs.filter((a) => a.kind === 'bank');
  return 'cb:' + (banks.find((a) => a.isDefault) ?? banks[0] ?? cash!).id;
}

/**
 * Purchases (prototype savePE / puApply / pySave): bills bring stock in and add to what you owe
 * the supplier; orders change nothing until converted; debit notes send stock back and reduce a
 * bill; payments made settle bills (the rest is an advance). Nothing is deleted, only cancelled.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  nextNumber(ctx: RequestContext, kind: string, date?: string) {
    const docType = kind === 'payment' ? 'payment' : DOC_TYPE[kind as keyof typeof DOC_TYPE];
    if (!docType) throw new BadRequestException({ message: 'Unknown document type.' });
    return this.db.scoped(this.scope(ctx), async (tx) => ({ number: await this.numbers.peek(tx, ctx.businessId!, ctx.userId, docType, date ?? todayIst()) }));
  }

  /* ───────── bills, orders, debit notes ───────── */

  save(ctx: RequestContext, input: PurchaseInput) {
    return this.db.scoped(this.scope(ctx), (tx) => this.saveIn(tx, ctx, input));
  }

  /**
   * Save inside a transaction. `legacy` is for documents brought from the old app's backup: the
   * number is kept as its old id, an order keeps its status, and a return is not refused for stock
   * (the old app already allowed it).
   */
  async saveIn(tx: Tx, ctx: RequestContext, input: PurchaseInput, legacy?: { status?: 'open' | 'received' | 'cancelled' }) {
    {
      const businessId = ctx.businessId!;
      const k = input.kind;
      const party = await tx.party.findFirst({ where: { id: input.partyId, archivedAt: null }, include: { addresses: { where: { kind: 'billing' } } } });
      if (!party) throw new BadRequestException({ message: 'Choose the supplier.', field: 'partyId' });
      if (!input.lines.length) throw new BadRequestException({ message: 'Add at least one item.' });
      const items = new Map((await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } }, include: { unit: { select: { code: true } } } })).map((i) => [i.id, { ...i, unitCode: i.unit?.code ?? '' }]));
      const unknown = input.lines.find((l) => !items.has(l.itemId));
      if (unknown) throw new BadRequestException({ message: `“${unknown.name}” isn’t in your items. Pick it from the list or add it as a new item.` });
      const bad = input.lines.find((l) => !money(l.qty).gt(0));
      if (bad) throw new BadRequestException({ message: `Enter a quantity for “${bad.name || items.get(bad.itemId)!.name}”.` });
      if (k !== 'order' && input.lines.some((l) => !money(l.rate).gt(0))) throw new BadRequestException({ message: 'Enter a rate for every item.' });
      const docType = DOC_TYPE[k];
      let number = input.number.trim();
      if (number && (await tx.purchaseDocument.findFirst({ where: { kind: k, number } }))) throw new BadRequestException({ message: `Number ${number} is already used.`, field: 'number' });
      // returning goods: no more than is in stock (prototype)
      if (k === 'debit_note' && !legacy) {
        const st = new Map((await tx.stockMovement.groupBy({ by: ['itemId'], where: { itemId: { in: input.lines.map((l) => l.itemId) } }, _sum: { qty: true } })).map((r) => [r.itemId, money(r._sum.qty?.toString() ?? 0)]));
        for (const l of input.lines) {
          const it = items.get(l.itemId)!;
          if (it.kind === 'service') continue;
          const s = st.get(it.id) ?? money(0);
          if (s.lt(money(l.qty))) throw new BadRequestException({ message: `Only ${fmt(s)} ${it.unitCode} of “${it.name}” in stock to return.` });
        }
      }
      const books = await booksOf(tx, businessId);
      const supState = party.gstin && /^\d{2}/.test(party.gstin) ? party.gstin.slice(0, 2) : party.stateCode || books.state;
      const inter = books.mode === 'gst' && supState !== books.state;
      const t = purchaseTotals({
        mode: books.mode, incl: input.pricesInclTax, inter,
        lines: input.lines.map((l) => ({ qty: l.qty, price: l.rate, disc: l.discPct, gst: books.mode === 'gst' ? l.gstRate : 0 })),
        bdiscP: input.billDiscPct, bdisc: input.billDiscPct ? null : input.billDiscAmt, chTr: input.transport, chLab: input.labour, roundOff: input.roundOff,
      });
      if (!number) number = await this.numbers.next(tx, businessId, ctx.userId, docType, input.date);
      else await this.numbers.claim(tx, businessId, ctx.userId, docType, input.date, number);
      const against = k === 'debit_note' && input.againstId ? await tx.purchaseDocument.findFirst({ where: { id: input.againstId, kind: 'bill', partyId: party.id, cancelledAt: null } }) : null;
      const doc = await tx.purchaseDocument.create({
        data: {
          businessId, createdBy: ctx.userId, kind: k, number, supplierRef: input.supplierRef, date: day(input.date),
          dueDate: k === 'debit_note' ? null : day(input.dueDate ?? input.date), partyId: party.id, taxMode: books.mode, pricesInclTax: input.pricesInclTax, interState: inter, roundOff: input.roundOff,
          billDiscPct: d2(input.billDiscPct), billDiscAmt: input.billDiscPct ? null : d2(input.billDiscAmt), transport: toDb(input.transport), labour: toDb(input.labour),
          itemsTotal: t.items.toFixed(2), billDiscount: t.bdisc.toFixed(2), taxable: t.taxable.toFixed(2), tax: t.tax.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), igst: t.igst.toFixed(2),
          roundAmount: t.round.toFixed(2), total: t.total.toFixed(2), status: 'open', notes: input.notes,
          reason: k === 'debit_note' ? input.reason : '', ...(legacy && { legacyId: number, ...(k === 'order' && legacy.status && { status: legacy.status, ...(legacy.status === 'cancelled' && { cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: 'Cancelled in the old app' }) }) }), sourceId: k === 'bill' ? input.fromOrderId ?? null : k === 'debit_note' ? against?.id ?? null : null,
        },
      });
      await tx.purchaseDocumentLine.createMany({
        data: input.lines.map((l, i) => ({
          businessId, documentId: doc.id, position: i, itemId: l.itemId, name: l.name || items.get(l.itemId)!.name, hsn: l.hsn, qty: l.qty, unit: l.unit || items.get(l.itemId)!.unitCode,
          rate: toDb(l.rate), discPct: l.discPct, gstRate: books.mode === 'gst' ? l.gstRate : '0', taxable: t.rows[i]!.tv.toFixed(2), tax: t.rows[i]!.tx.toFixed(2), amount: t.rows[i]!.amt.toFixed(2),
          againstId: against?.id ?? null,
        })),
      });

      let priceChanges = 0;
      if (k !== 'order') {
        /* stock: in on a bill (at the taxable value per unit), out on a debit note */
        const godown = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
        const goods = input.lines.map((l, i) => ({ l, i, it: items.get(l.itemId)! })).filter((x) => x.it.kind !== 'service');
        if (goods.length)
          await tx.stockMovement.createMany({
            data: goods.map(({ l, i, it }) => ({
              businessId, createdBy: ctx.userId, sourceType: 'purchase_document', sourceId: doc.id, itemId: it.id, godownId: godown.id, date: day(input.date),
              qty: (k === 'bill' ? money(l.qty) : money(l.qty).neg()).toFixed(3), rate: t.rows[i]!.tv.div(money(l.qty)).toDecimalPlaces(2).toFixed(2), kind: k === 'bill' ? 'purchase' : 'purchase_return', note: number,
            })),
          });
        /* the books */
        const charges = money(input.transport).plus(money(input.labour));
        const sign = k === 'bill' ? 1 : -1;
        const lines: PostLine[] = [
          { account: 'payable', partyId: party.id, credit: k === 'bill' ? t.total : undefined, debit: k === 'bill' ? undefined : t.total },
          { account: k === 'bill' ? 'purchases' : 'purchase_returns', ...(sign > 0 ? { debit: t.taxable } : { credit: t.taxable }) },
          { account: 'input_cgst', ...(sign > 0 ? { debit: t.cgst } : { credit: t.cgst }) },
          { account: 'input_sgst', ...(sign > 0 ? { debit: t.sgst } : { credit: t.sgst }) },
          { account: 'input_igst', ...(sign > 0 ? { debit: t.igst } : { credit: t.igst }) },
          { account: 'charges_expense', ...(sign > 0 ? { debit: charges } : { credit: charges }) },
          { account: 'round_off', ...(sign > 0 ? { debit: t.round } : { credit: t.round }) },
        ];
        await this.ledger.post(tx, { businessId, userId: ctx.userId }, { date: input.date, sourceType: 'purchase_document', sourceId: doc.id, number, narration: `${k === 'bill' ? 'Purchase' : 'Debit note'} ${number} · ${party.name}`, lines });

        if (k === 'bill') {
          /* paid with the bill: one payment made per part (prototype savePE) */
          let left = t.total;
          for (const p of input.payments.filter((x) => money(x.amount).gt(0))) {
            const amt = money(p.amount).lt(left) ? money(p.amount) : left;
            if (!amt.gt(0)) break;
            left = left.minus(amt);
            await this.payOutIn(tx, ctx, { partyId: party.id, partyName: party.name, date: input.date, amount: amt, mode: p.mode, ref: p.ref, notes: '', alloc: [{ billId: doc.id, amount: amt }], atBill: doc.id });
          }
          /* purchase prices in Items, with history */
          if (input.updatePrices)
            for (const [i, l] of input.lines.entries()) {
              const it = items.get(l.itemId)!;
              const nv = t.rows[i]!.tv.div(money(l.qty)).toDecimalPlaces(2);
              const ov = money(it.purchasePrice.toString());
              if (nv.minus(ov).abs().gt(0.009)) {
                await tx.item.update({ where: { id: it.id }, data: { purchasePrice: nv.toFixed(2) } });
                await tx.priceHistory.create({ data: { businessId, itemId: it.id, field: 'purchase', oldValue: ov.toFixed(2), newValue: nv.toFixed(2), how: `From purchase bill ${number}`, createdBy: ctx.userId } });
                priceChanges++;
              }
            }
          if (input.fromOrderId) await tx.purchaseDocument.updateMany({ where: { id: input.fromOrderId, kind: 'order', status: 'open' }, data: { status: 'received' } });
        }
        /* a debit note against a bill reduces what is owed on it; the rest is credit with the supplier */
        if (k === 'debit_note' && against) {
          const bal = (await billBalances(tx, [against.id])).get(against.id) ?? money(0);
          const use = bal.lt(t.total) ? bal : t.total;
          if (use.gt(0)) await tx.paymentAllocation.create({ data: { businessId, kind: 'document', partyId: party.id, noteId: doc.id, purchaseDocumentId: against.id, amount: use.toFixed(2) } });
        }
      }
      await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'purchase_document', entityId: doc.id, after: { ...doc, lines: input.lines }, ip: ctx.ip });
      return { id: doc.id, number, kind: k, total: t.total.toFixed(2), priceChanges };
    }
  }

  /** Cancel a bill, order or debit note: the record stays; stock and the books are put back. */
  cancel(ctx: RequestContext, id: string, reason: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const d = await tx.purchaseDocument.findFirst({ where: { id } });
      if (!d) throw new NotFoundException({ message: 'That document was not found.' });
      if (d.cancelledAt) throw new BadRequestException({ message: 'Already cancelled' });
      const today = todayIst();
      if (d.kind !== 'order') {
        await this.ledger.cancel(tx, 'purchase_document', d.id);
        const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId'], where: { sourceType: 'purchase_document', sourceId: d.id }, _sum: { qty: true } });
        const back = net.filter((n) => n._sum.qty && !n._sum.qty.isZero());
        if (back.length)
          await tx.stockMovement.createMany({
            data: back.map((n) => ({ businessId: ctx.businessId!, createdBy: ctx.userId, sourceType: 'purchase_document', sourceId: d.id, itemId: n.itemId, godownId: n.godownId, date: day(today), qty: n._sum.qty!.neg().toFixed(3), kind: 'cancel', note: `Cancelled ${d.number}` })),
          });
      }
      // money paid against a cancelled bill stays with the supplier as an advance (its allocations no longer count)
      await tx.purchaseDocument.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: reason, ...(d.kind === 'order' && { status: 'cancelled' }) } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'purchase_document', entityId: id, before: d, after: { reason }, ip: ctx.ip });
      return { id, number: d.number };
    });
  }

  /* ───────── payments made ───────── */

  payOut(ctx: RequestContext, input: PaymentOutInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const party = await tx.party.findFirst({ where: { id: input.partyId, archivedAt: null } });
      if (!party) throw new BadRequestException({ message: 'Choose the supplier.', field: 'partyId' });
      const amt = money(input.amount);
      if (!amt.gt(0)) throw new BadRequestException({ message: 'Enter the amount paid.', field: 'amount' });
      if (input.mode === 'Cheque' && !input.ref.trim()) throw new BadRequestException({ message: 'Enter the cheque number.', field: 'ref' });
      const ids = input.allocations.filter((a) => money(a.amount).gt(0)).map((a) => a.to);
      const bal = await billBalances(tx, ids);
      const bills = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: ids }, kind: 'bill', partyId: party.id, cancelledAt: null } })).map((b) => [b.id, b]));
      const alloc = input.allocations
        .filter((a) => money(a.amount).gt(0) && bills.has(a.to))
        .map((a) => { const b = bal.get(a.to) ?? money(0); const v = money(a.amount); return { billId: a.to, amount: v.lt(b) ? v : b }; })
        .filter((a) => a.amount.gt(0));
      if (alloc.reduce((s, a) => s.plus(a.amount), money(0)).gt(amt.plus(0.009))) throw new BadRequestException({ message: 'The bill amounts add up to more than the payment.' });
      return this.payOutIn(tx, ctx, { partyId: party.id, partyName: party.name, date: input.date, amount: amt, mode: input.mode, ref: input.ref.trim(), notes: input.notes, alloc, atBill: null });
    });
  }

  /** Record a payment made inside a transaction; `legacyNo` keeps the old app's number (import). */
  async payOutIn(tx: Tx, ctx: RequestContext, o: { partyId: string; partyName: string; date: string; amount: Money; mode: string; ref: string; notes: string; alloc: { billId: string; amount: Money }[]; atBill: string | null; legacyNo?: string }) {
    const businessId = ctx.businessId!;
    const number = o.legacyNo ?? (await this.numbers.next(tx, businessId, ctx.userId, 'payment', o.date));
    if (o.legacyNo) await this.numbers.claim(tx, businessId, ctx.userId, 'payment', o.date, o.legacyNo);
    const p = await tx.payment.create({
      data: {
        businessId, createdBy: ctx.userId, direction: 'out', number, date: day(o.date), partyId: o.partyId, amount: o.amount.toFixed(2), mode: o.mode, reference: o.ref, notes: o.notes,
        atSale: !!o.atBill, sourceId: o.atBill, ...(o.legacyNo && { legacyId: o.legacyNo }), splits: [{ mode: o.mode, amount: o.amount.toFixed(2), ref: o.ref }] as Prisma.InputJsonValue,
      },
    });
    if (o.alloc.length) await tx.paymentAllocation.createMany({ data: o.alloc.map((a) => ({ businessId, kind: 'document', partyId: o.partyId, paymentId: p.id, purchaseDocumentId: a.billId, amount: a.amount.toFixed(2) })) });
    if (o.mode === 'Cheque') await tx.cheque.create({ data: { businessId, createdBy: ctx.userId, direction: 'issued', chequeNo: o.ref, chequeDate: day(o.date), amount: o.amount.toFixed(2), partyId: o.partyId, paymentId: p.id } });
    await this.ledger.post(tx, { businessId, userId: ctx.userId }, {
      date: o.date, sourceType: 'payment', sourceId: p.id, number, narration: `Paid ${o.partyName}`,
      lines: [{ account: 'payable', partyId: o.partyId, debit: o.amount }, { account: await accountOut(tx, o.mode), credit: o.amount, memo: `${o.mode}${o.ref ? ' · ' + o.ref : ''}` }],
    });
    await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'payment', entityId: p.id, after: { ...p, alloc: o.alloc.map((a) => ({ billId: a.billId, amount: a.amount.toFixed(2) })) }, ip: ctx.ip });
    return { id: p.id, number, amount: o.amount.toFixed(2) };
  }

  /* ───────── reading ───────── */

  list(ctx: RequestContext, kind: 'bill' | 'order' | 'debit_note') {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const docs = await tx.purchaseDocument.findMany({
        where: { kind }, include: { party: { select: { id: true, name: true, gstin: true } }, lines: { select: { qty: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
      });
      const bal = kind === 'bill' ? await billBalances(tx, docs.map((d) => d.id)) : new Map<string, Money>();
      // a debit note's credit not set against a bill (prototype: the note's own balance)
      const noteUsed = kind === 'debit_note' ? await usedOut(tx, 'note', docs.map((d) => d.id)) : new Map<string, Money>();
      const refs = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: docs.flatMap((d) => (d.sourceId ? [d.sourceId] : [])) } }, select: { id: true, number: true } })).map((x) => [x.id, x.number]));
      const billsFromOrders = kind === 'order' ? new Map((await tx.purchaseDocument.findMany({ where: { kind: 'bill', sourceId: { in: docs.map((d) => d.id) }, cancelledAt: null }, select: { sourceId: true, number: true } })).map((b) => [b.sourceId!, b.number])) : new Map<string, string>();
      return docs.map((d) => {
        const total = money(d.total.toString());
        const b = kind === 'bill' ? (bal.get(d.id) ?? money(0)) : kind === 'debit_note' && !d.cancelledAt ? total.minus(noteUsed.get(d.id) ?? 0) : money(0);
        return {
          id: d.id, kind: d.kind, number: d.number, supplierRef: d.supplierRef, date: isoOf(d.date), dueDate: isoOf(d.dueDate), party: d.party, partyName: d.party.name,
          total: total.toFixed(2), paid: kind === 'bill' && !d.cancelledAt ? total.minus(b).toFixed(2) : '0.00', balance: b.toFixed(2),
          items: d.lines.length, qty: q3(d.lines.reduce((a, l) => a.plus(money(l.qty.toString())), money(0))),
          status: d.status, cancelled: !!d.cancelledAt, reason: d.reason, against: d.sourceId && kind === 'debit_note' ? refs.get(d.sourceId) ?? '' : '',
          fromOrder: d.sourceId && kind === 'bill' ? refs.get(d.sourceId) ?? '' : '', bill: billsFromOrders.get(d.id) ?? '', legacy: !!d.legacyId,
        };
      });
    });
  }

  get(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const d = await tx.purchaseDocument.findFirst({ where: { id }, include: { party: true, lines: { orderBy: { position: 'asc' } } } });
      if (!d) throw new NotFoundException({ message: 'That document was not found.' });
      const bal = d.kind === 'bill' ? (await billBalances(tx, [d.id])).get(d.id) ?? money(0) : money(0);
      const allocs = await tx.paymentAllocation.findMany({ where: { purchaseDocumentId: d.id }, include: { payment: true } });
      const notes = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: allocs.flatMap((a) => (a.noteId ? [a.noteId] : [])) } } })).map((n) => [n.id, n]));
      const src = d.sourceId ? await tx.purchaseDocument.findFirst({ where: { id: d.sourceId }, select: { number: true } }) : null;
      return {
        id: d.id, kind: d.kind, number: d.number, supplierRef: d.supplierRef, date: isoOf(d.date), dueDate: isoOf(d.dueDate),
        party: { id: d.party.id, name: d.party.name, gstin: d.party.gstin, phone: d.party.phone }, taxMode: d.taxMode, pricesInclTax: d.pricesInclTax, interState: d.interState, roundOff: d.roundOff,
        billDiscPct: d2(d.billDiscPct), billDiscAmt: d2(d.billDiscAmt), transport: d2(d.transport), labour: d2(d.labour),
        itemsTotal: d2(d.itemsTotal), billDiscount: d2(d.billDiscount), taxable: d2(d.taxable), tax: d2(d.tax), cgst: d2(d.cgst), sgst: d2(d.sgst), igst: d2(d.igst), roundAmount: d2(d.roundAmount), total: d2(d.total),
        balance: bal.toFixed(2), status: d.status, notes: d.notes, reason: d.reason, cancelled: !!d.cancelledAt, source: src?.number ?? '',
        lines: d.lines.map((l) => ({ id: l.id, itemId: l.itemId, name: l.name, hsn: l.hsn, qty: q3(l.qty), unit: l.unit, rate: d2(l.rate), discPct: l.discPct.toString(), gstRate: l.gstRate.toString(), taxable: d2(l.taxable), tax: d2(l.tax), amount: d2(l.amount) })),
        settlements: allocs
          .filter((a) => (a.payment ? !a.payment.cancelledAt : !notes.get(a.noteId!)?.cancelledAt))
          .map((a) => ({ kind: a.payment ? 'payment' : 'debit_note', number: a.payment?.number ?? notes.get(a.noteId!)?.number ?? '', date: isoOf(a.payment?.date ?? notes.get(a.noteId!)?.date ?? null), mode: a.payment?.mode ?? '', amount: d2(a.amount) })),
      };
    });
  }

  payments(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const pays = await tx.payment.findMany({ where: { direction: 'out' }, include: { party: { select: { id: true, name: true } }, allocations: true }, orderBy: [{ date: 'desc' }, { number: 'desc' }] });
      const used = await usedOut(tx, 'payment', pays.map((p) => p.id));
      const bills = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: pays.flatMap((p) => p.allocations.flatMap((a) => (a.purchaseDocumentId ? [a.purchaseDocumentId] : []))) } }, select: { id: true, number: true, cancelledAt: true } })).map((b) => [b.id, b]));
      return pays.map((p) => {
        const amt = money(p.amount.toString());
        return {
          id: p.id, number: p.number, date: isoOf(p.date), party: p.party, partyName: p.party?.name ?? '', mode: p.mode, ref: p.reference, amount: amt.toFixed(2), cancelled: !!p.cancelledAt,
          bills: p.allocations.flatMap((a) => { const b = a.purchaseDocumentId ? bills.get(a.purchaseDocumentId) : null; return b && !b.cancelledAt ? [{ number: b.number, amount: d2(a.amount) }] : []; }),
          unused: p.cancelledAt ? '0.00' : amt.minus(used.get(p.id) ?? 0).toFixed(2), legacy: !!p.legacyId,
        };
      });
    });
  }

  /** A supplier's unpaid bills, oldest first (prototype payBills). */
  unpaid(ctx: RequestContext, partyId: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const docs = await tx.purchaseDocument.findMany({ where: { kind: 'bill', partyId, cancelledAt: null }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
      const bal = await billBalances(tx, docs.map((d) => d.id));
      return docs.flatMap((d) => { const b = bal.get(d.id) ?? money(0); return b.gt(0) ? [{ id: d.id, number: d.number, date: isoOf(d.date), dueDate: isoOf(d.dueDate), total: d2(d.total), balance: b.toFixed(2) }] : []; });
    });
  }
}

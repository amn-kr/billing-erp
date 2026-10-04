import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { money, toDb, type CreditNoteInput, type ChallanInput, type Money, type ReceiptInput } from '@billing/shared';
import { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { LedgerService } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf } from '../../common/lookups';
import { invoiceBalances, openDues, unusedAmounts } from './dues';
import { accountFor, moneyInLines } from './money-in';
import { booksOf } from './sales.service';

const q3 = (v: { toString(): string }) => money(v.toString()).toDecimalPlaces(3).toFixed(3);

/** Payments received, credit notes (sale returns) and delivery challans. */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /* ───────── payments received ───────── */

  receive(ctx: RequestContext, input: ReceiptInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const businessId = ctx.businessId!;
      const party = await tx.party.findFirst({ where: { id: input.partyId } });
      if (!party) throw new BadRequestException({ message: 'Choose the customer.', field: 'partyId' });
      const amount = money(input.amount);
      if (!amount.gt(0)) throw new BadRequestException({ message: 'Enter the amount received.', field: 'amount' });
      if (input.mode === 'Cheque' && !input.ref.trim()) throw new BadRequestException({ message: 'Enter the cheque number.', field: 'ref' });
      const dues = await openDues(tx, party.id);
      const alloc = input.allocations
        .map((a) => {
          const d = dues.find((x) => x.to === a.to);
          const want = money(a.amount);
          return { to: a.to, amount: d ? (want.lt(d.balance) ? want : d.balance) : money(0) };
        })
        .filter((a) => a.amount.gt(0));
      if (alloc.reduce((s, a) => s.plus(a.amount), money(0)).gt(amount))
        throw new BadRequestException({ message: 'The invoice amounts add up to more than the payment.' });
      const number = await this.numbers.next(tx, businessId, ctx.userId, 'receipt', input.date);
      const pay = await tx.payment.create({
        data: {
          businessId, createdBy: ctx.userId, direction: 'in', number, date: day(input.date), partyId: party.id, amount: amount.toFixed(2), mode: input.mode,
          reference: input.ref, notes: input.notes, splits: [{ mode: input.mode, amount: amount.toFixed(2), ref: input.ref }] as Prisma.InputJsonValue,
        },
      });
      if (alloc.length)
        await tx.paymentAllocation.createMany({
          data: alloc.map((a) => ({ businessId, paymentId: pay.id, amount: a.amount.toFixed(2), partyId: party.id, ...(a.to === 'opening' ? { kind: 'opening' } : { salesDocumentId: a.to }) })),
        });
      const debit = await moneyInLines(tx, { businessId, userId: ctx.userId }, { splits: [{ mode: input.mode, amount, ref: input.ref }], paymentId: pay.id, partyId: party.id, date: input.date, memo: number });
      await this.ledger.post(tx, { businessId, userId: ctx.userId }, {
        date: input.date, sourceType: 'payment', sourceId: pay.id, number, narration: `Payment from ${party.name}`,
        lines: [...debit, { account: 'receivable', partyId: party.id, credit: amount }],
      });
      await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'payment', entityId: pay.id, after: { ...pay, allocations: alloc.map((a) => ({ to: a.to, amount: a.amount.toFixed(2) })) }, ip: ctx.ip });
      return { id: pay.id, number, amount: amount.toFixed(2), partyName: party.name };
    });
  }

  /** Payments received list (prototype allReceipts). */
  receipts(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const pays = await tx.payment.findMany({ where: { direction: 'in', cancelledAt: null }, include: { party: { select: { id: true, name: true, phone: true } }, allocations: true }, orderBy: [{ date: 'desc' }, { number: 'desc' }] });
      const used = await unusedAmounts(tx, 'payment', pays.map((p) => p.id));
      const docIds = [...new Set(pays.flatMap((p) => p.allocations.flatMap((a) => (a.salesDocumentId ? [a.salesDocumentId] : []))))];
      const src = await tx.salesDocument.findMany({ where: { id: { in: [...docIds, ...pays.flatMap((p) => (p.sourceId ? [p.sourceId] : []))] } }, select: { id: true, number: true, cashName: true, cancelledAt: true } });
      const no = new Map(src.map((d) => [d.id, d]));
      return pays.map((p) => {
        const sale = p.sourceId ? no.get(p.sourceId) : undefined;
        const against = p.allocations.map((a) => (a.kind === 'opening' ? 'Opening balance' : (no.get(a.salesDocumentId ?? '')?.number ?? '')));
        const amount = money(p.amount.toString());
        const unused = p.partyId ? amount.minus(used.get(p.id) ?? money(0)) : money(0);
        return {
          id: p.id, number: p.number, date: isoOf(p.date), party: p.party ? { id: p.party.id, name: p.party.name, phone: p.party.phone } : null,
          partyName: p.party?.name ?? sale?.cashName ?? 'Walk-in customer', counter: !p.partyId, mode: p.mode, reference: p.reference,
          against: [...new Set(against.filter(Boolean))].join(', '), cancelledInvoice: sale?.cancelledAt ? sale.number : null,
          amount: amount.toFixed(2), unused: unused.toFixed(2), atSale: p.atSale, legacy: !!p.legacyId,
        };
      });
    });
  }

  /* ───────── credit notes ───────── */

  /** How much of each invoice line can still be returned (sold − already returned). */
  returnable(ctx: RequestContext, invoiceId: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const inv = await tx.salesDocument.findFirst({ where: { id: invoiceId, kind: 'invoice' }, include: { lines: { orderBy: { position: 'asc' } } } });
      if (!inv) throw new NotFoundException({ message: 'That invoice was not found.' });
      const back = await this.returned(tx, invoiceId);
      return inv.lines.map((l) => {
        const sold = money(l.qty.toString());
        const left = sold.minus(back.get(l.itemId ?? '') ?? 0);
        const price = money(l.price.toString()).times(money(1).minus(money(l.discPct.toString()).div(100)));
        return { itemId: l.itemId, name: l.name, unit: l.unit, sold: q3(sold), max: q3(left.isNegative() ? 0 : left), price: price.toDecimalPlaces(2).toFixed(2), gstRate: l.gstRate.toString() };
      });
    });
  }

  private async returned(tx: Tx, invoiceId: string) {
    const rows = await tx.salesDocumentLine.findMany({ where: { againstId: invoiceId, document: { kind: 'credit_note', cancelledAt: null } }, select: { itemId: true, qty: true } });
    const m = new Map<string, Money>();
    for (const r of rows) m.set(r.itemId ?? '', (m.get(r.itemId ?? '') ?? money(0)).plus(r.qty.toString()));
    return m;
  }

  creditNote(ctx: RequestContext, input: CreditNoteInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const businessId = ctx.businessId!;
      const party = input.partyId ? await tx.party.findFirst({ where: { id: input.partyId } }) : null;
      if (input.partyId && !party) throw new BadRequestException({ message: 'Choose the customer.', field: 'partyId' });
      const L = input.lines.filter((l) => money(l.qty).gt(0));
      if (!L.length) throw new BadRequestException({ message: 'Enter the quantity returned for at least one item.' });
      if (!party && input.settle !== 'refund') throw new BadRequestException({ message: 'Counter sales have no customer account. Choose “Refund now”.' });
      const invIds = [...new Set(L.flatMap((l) => (l.invoiceId ? [l.invoiceId] : [])))];
      const invs = await tx.salesDocument.findMany({ where: { id: { in: invIds }, kind: 'invoice', cancelledAt: null } });
      if (invs.length !== invIds.length) throw new BadRequestException({ message: 'One of those invoices was not found or is cancelled.' });
      for (const inv of invs) if ((inv.partyId ?? null) !== (party?.id ?? null)) throw new BadRequestException({ message: `${inv.number} belongs to another customer.` });
      for (const inv of invs) {
        const sold = await tx.salesDocumentLine.findMany({ where: { documentId: inv.id } });
        const back = await this.returned(tx, inv.id);
        for (const l of L.filter((x) => x.invoiceId === inv.id)) {
          const s = sold.filter((x) => x.itemId === l.itemId).reduce((a, x) => a.plus(x.qty.toString()), money(0));
          const max = s.minus(back.get(l.itemId) ?? 0);
          if (money(l.qty).gt(max)) throw new BadRequestException({ message: `Only ${q3(max.isNegative() ? 0 : max).replace(/\.?0+$/, '')} can be returned on ${inv.number}` });
        }
      }
      const items = new Map((await tx.item.findMany({ where: { id: { in: L.map((l) => l.itemId) } }, include: { unit: true } })).map((i) => [i.id, i]));
      if (items.size !== new Set(L.map((l) => l.itemId)).size) throw new BadRequestException({ message: 'One of those items was not found.' });
      const books = await booksOf(tx, businessId);

      /* amounts: qty × final rate, GST included (prototype cnCalc) */
      const rows = L.map((l) => {
        const amt = money(l.qty).times(money(l.price)).toDecimalPlaces(2);
        const g = books.mode === 'gst' ? money(l.gstRate) : money(0);
        const tv = amt.div(g.div(100).plus(1)).toDecimalPlaces(2);
        return { l, amt, g, tv, tx: amt.minus(tv) };
      });
      const total = rows.reduce((a, r) => a.plus(r.amt), money(0));
      const taxable = rows.reduce((a, r) => a.plus(r.tv), money(0));
      const tax = total.minus(taxable);
      const pos = invs[0]?.placeOfSupply || books.state;
      const inter = books.mode === 'gst' && pos !== books.state;
      const cgst = inter ? money(0) : tax.div(2).toDecimalPlaces(2);
      const sgst = inter ? money(0) : tax.minus(cgst);
      const number = await this.numbers.next(tx, businessId, ctx.userId, 'credit_note', input.date);
      const cn = await tx.salesDocument.create({
        data: {
          businessId, createdBy: ctx.userId, kind: 'credit_note', number, date: day(input.date), mode: party ? 'credit' : 'cash', partyId: party?.id ?? null,
          cashName: party ? '' : (invs[0]?.cashName || 'Counter sale'), taxMode: books.mode, placeOfSupply: pos, roundOff: false,
          itemsTotal: total.toFixed(2), taxable: taxable.toFixed(2), tax: tax.toFixed(2), cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), igst: (inter ? tax : money(0)).toFixed(2), total: total.toFixed(2),
          status: input.settle, reason: input.reason, extra: { refundMode: input.settle === 'refund' ? input.refundMode : '', invoices: invs.map((i) => i.number) },
          sourceId: invs[0]?.id ?? null,
        },
      });
      await tx.salesDocumentLine.createMany({
        data: rows.map((r, k) => {
          const it = items.get(r.l.itemId)!;
          return {
            businessId, documentId: cn.id, position: k, itemId: it.id, name: it.name, hsn: it.hsn, qty: money(r.l.qty).toFixed(3), unit: it.unit?.code ?? '',
            price: toDb(r.l.price), gstRate: r.g.toFixed(2), taxable: r.tv.toFixed(2), tax: r.tx.toFixed(2), amount: r.amt.toFixed(2), againstId: r.l.invoiceId ?? null,
          };
        }),
      });

      /* stock comes back */
      const godown = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
      const goods = rows.filter((r) => items.get(r.l.itemId)!.kind !== 'service');
      if (goods.length)
        await tx.stockMovement.createMany({
          data: goods.map((r) => ({
            businessId, createdBy: ctx.userId, itemId: r.l.itemId, godownId: godown.id, date: day(input.date), qty: money(r.l.qty).toFixed(3), rate: toDb(r.l.price),
            kind: 'return', sourceType: 'sales_document', sourceId: cn.id, note: number,
          })),
        });

      /* settle: adjust against the invoices it returns, or refund now */
      const tl = [
        { account: 'sales_returns', debit: taxable },
        { account: 'output_cgst', debit: cgst },
        { account: 'output_sgst', debit: sgst },
        { account: 'output_igst', debit: inter ? tax : money(0) },
      ];
      if (input.settle === 'adjust') {
        let left = total;
        const bal = await invoiceBalances(tx, invIds);
        const alloc: { id: string; amount: Money }[] = [];
        for (const inv of invs) {
          const part = rows.filter((r) => r.l.invoiceId === inv.id).reduce((a, r) => a.plus(r.amt), money(0));
          const b = bal.get(inv.id) ?? money(0);
          const u = [part, b, left].reduce((m, v) => (v.lt(m) ? v : m));
          if (u.gt(0)) { alloc.push({ id: inv.id, amount: u }); left = left.minus(u); }
        }
        if (alloc.length) await tx.paymentAllocation.createMany({ data: alloc.map((a) => ({ businessId, noteId: cn.id, salesDocumentId: a.id, partyId: party!.id, amount: a.amount.toFixed(2) })) });
        await this.ledger.post(tx, { businessId, userId: ctx.userId }, { date: input.date, sourceType: 'sales_document', sourceId: cn.id, number, narration: `Credit note ${number}`, lines: [...tl, { account: 'receivable', partyId: party!.id, credit: total }] });
      } else {
        await this.ledger.post(tx, { businessId, userId: ctx.userId }, {
          date: input.date, sourceType: 'sales_document', sourceId: cn.id, number, narration: `Credit note ${number} · refunded by ${input.refundMode}`,
          lines: [...tl, { account: await accountFor(tx, input.refundMode), credit: total, memo: `Refund · ${input.refundMode}` }],
        });
      }
      await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'sales_document', entityId: cn.id, after: cn, ip: ctx.ip });
      for (const inv of invs) await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'update', entity: 'sales_document', entityId: inv.id, after: { returned: number }, ip: ctx.ip });
      return { id: cn.id, number, total: total.toFixed(2), invoices: invs.length };
    });
  }

  creditNotes(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const cns = await tx.salesDocument.findMany({ where: { kind: 'credit_note' }, include: { party: { select: { id: true, name: true } }, lines: { orderBy: { position: 'asc' } } }, orderBy: [{ date: 'desc' }, { number: 'desc' }] });
      const used = await unusedAmounts(tx, 'note', cns.map((c) => c.id));
      const invs = await tx.salesDocument.findMany({ where: { id: { in: cns.flatMap((c) => c.lines.flatMap((l) => (l.againstId ? [l.againstId] : []))) } }, select: { id: true, number: true } });
      const no = new Map(invs.map((i) => [i.id, i.number]));
      return cns.map((c) => {
        const total = money(c.total.toString());
        return {
          id: c.id, number: c.number, date: isoOf(c.date), party: c.party, partyName: c.party?.name ?? c.cashName, reason: c.reason, settle: c.status,
          refundMode: (c.extra as Record<string, string>).refundMode ?? '', against: [...new Set(c.lines.flatMap((l) => (l.againstId ? [no.get(l.againstId) ?? ''] : [])))],
          qty: q3(c.lines.reduce((a, l) => a.plus(l.qty.toString()), money(0))), total: total.toFixed(2),
          unused: c.status === 'refund' || c.cancelledAt ? '0.00' : total.minus(used.get(c.id) ?? 0).toFixed(2), cancelled: !!c.cancelledAt,
          lines: c.lines.map((l) => ({ name: l.name, qty: q3(l.qty), unit: l.unit, price: toDb(l.price.toString()), amount: toDb(l.amount.toString()), invoice: l.againstId ? (no.get(l.againstId) ?? '') : '' })),
        };
      });
    });
  }

  /* ───────── delivery challans ───────── */

  challan(ctx: RequestContext, input: ChallanInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const businessId = ctx.businessId!;
      if (!input.partyId && !input.cashName.trim()) throw new BadRequestException({ message: 'Enter the name.', field: 'cashName' });
      const party = input.partyId ? await tx.party.findFirst({ where: { id: input.partyId } }) : null;
      if (input.partyId && !party) throw new BadRequestException({ message: 'Choose who the goods are going to.', field: 'partyId' });
      const L = input.lines.filter((l) => money(l.qty).gt(0));
      if (!L.length) throw new BadRequestException({ message: 'Add at least one item with a quantity.' });
      const items = new Map((await tx.item.findMany({ where: { id: { in: L.map((l) => l.itemId) } }, include: { unit: true } })).map((i) => [i.id, i]));
      if (items.size !== new Set(L.map((l) => l.itemId)).size) throw new BadRequestException({ message: 'One of those items was not found.' });
      const books = await booksOf(tx, businessId);
      const number = await this.numbers.next(tx, businessId, ctx.userId, 'challan', input.date);
      const dc = await tx.salesDocument.create({
        data: {
          businessId, createdBy: ctx.userId, kind: 'challan', number, date: day(input.date), mode: party ? 'credit' : 'cash', partyId: party?.id ?? null,
          cashName: party ? '' : input.cashName.trim(), cashPhone: party ? '' : input.cashPhone, taxMode: books.mode, notes: input.note, status: 'open',
          extra: { transport: input.transport, vehicle: input.vehicle },
        },
      });
      await tx.salesDocumentLine.createMany({
        data: L.map((l, k) => {
          const it = items.get(l.itemId)!;
          return { businessId, documentId: dc.id, position: k, itemId: it.id, name: it.name, hsn: it.hsn, qty: money(l.qty).toFixed(3), unit: it.unit?.code ?? '', price: '0' };
        }),
      });
      await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'create', entity: 'sales_document', entityId: dc.id, after: dc, ip: ctx.ip });
      return { id: dc.id, number, partyName: party?.name ?? input.cashName.trim(), items: L.length };
    });
  }
}

/**
 * Writes the old app's sales documents (plan.sales) into this shop, in the order
 * the old app replays them when it loads: invoices (with any extra money settling
 * older dues), then cancellations, then payments received, then credit notes.
 * Totals are kept exactly as printed; the books get the same entries a new sale makes.
 */
import { money, type Money } from '@billing/shared';
import type { PlanSales, PlanSaleLine } from '@billing/importer';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../common/db.service';
import type { LedgerService, PostLine } from '../../common/ledger.service';
import type { NumberingService } from '../../common/numbering.service';
import { autoAllocate, invoiceBalances, openDues, openingDue } from '../sales/dues';
import { accountFor, moneyInLines } from '../sales/money-in';

const day = (iso: string) => new Date(iso + 'T00:00:00Z');
const m = (v: string | null | undefined) => money(v ?? 0);
const min = (...v: Money[]) => v.reduce((a, b) => (b.lt(a) ? b : a));

export interface SalesImportCtx {
  businessId: string;
  userId: string;
  partyId: Map<string, string>;
  itemId: Map<string, string>;
  referrerId: Map<string, string>;
  ledger: LedgerService;
  numbers: NumberingService;
  warnings: string[];
}

export async function writeSales(tx: Tx, c: SalesImportCtx, s: PlanSales) {
  const base = { businessId: c.businessId, createdBy: c.userId };
  const who = { businessId: c.businessId, userId: c.userId };
  const godown = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
  const services = new Set((await tx.item.findMany({ where: { kind: 'service' }, select: { id: true } })).map((i) => i.id));
  const pid = (legacy: string | null) => (legacy ? (c.partyId.get(legacy) ?? null) : null);
  const claim = (docType: string, date: string, number: string) => c.numbers.claim(tx, c.businessId, c.userId, docType, date, number);
  const lineRows = (docId: string, L: PlanSaleLine[]) =>
    L.map((l, k) => ({
      businessId: c.businessId, documentId: docId, position: k, itemId: c.itemId.get(l.itemLegacyId)!, name: l.name, hsn: l.hsn, qty: l.qty, unit: l.unit,
      price: l.price, discPct: l.discPct, gstRate: l.gstRate, taxable: l.taxable, tax: l.tax, amount: l.amount,
      basePrice: l.basePrice, commOverride: l.commOverride ? (l.commOverride as Prisma.InputJsonValue) : Prisma.DbNull, commType: l.commType, commValue: l.commValue, commAmount: l.commAmount,
    }));
  const invId = new Map<string, string>();

  /* 1. invoices, oldest first */
  for (const v of s.invoices) {
    const partyId = pid(v.partyLegacyId);
    const t = v.totals;
    const tax = m(t.cgst).plus(m(t.sgst)).plus(m(t.igst));
    const items = v.lines.reduce((a, l) => a.plus(m(l.amount)), money(0));
    const doc = await tx.salesDocument.create({
      data: {
        ...base, kind: 'invoice', number: v.number, legacyId: v.number, date: day(v.date), dueDate: day(v.mode === 'cash' ? v.date : v.dueDate), mode: v.mode, partyId,
        cashName: v.cashName, cashPhone: v.cashPhone, billName: v.billName, taxMode: v.taxMode, pricesInclTax: v.pricesInclTax, placeOfSupply: v.placeOfSupply,
        roundOff: true, billDiscAmt: m(t.billDiscount).isZero() ? null : t.billDiscount, transport: t.transport, labour: t.labour, bankCharge: t.bankCharge,
        itemsTotal: items.toFixed(2), billDiscount: t.billDiscount, taxable: t.taxable, tax: tax.toFixed(2), cgst: t.cgst, sgst: t.sgst, igst: t.igst, tcs: t.tcs,
        roundAmount: t.round, total: t.total, notes: v.notes, extra: v.extra as Prisma.InputJsonValue, referrerId: v.referrerLegacyId ? (c.referrerId.get(v.referrerLegacyId) ?? null) : null,
      },
    });
    invId.set(v.number, doc.id);
    await tx.salesDocumentLine.createMany({ data: lineRows(doc.id, v.lines) });
    const goods = v.lines.filter((l) => !services.has(c.itemId.get(l.itemLegacyId)!));
    if (goods.length)
      await tx.stockMovement.createMany({
        data: goods.map((l) => ({
          ...base, itemId: c.itemId.get(l.itemLegacyId)!, godownId: godown.id, date: day(v.date), qty: m(l.qty).neg().toFixed(3),
          rate: m(l.qty).isZero() ? '0' : m(l.amount).div(m(l.qty)).toDecimalPlaces(2).toFixed(2), kind: 'sale', sourceType: 'sales_document', sourceId: doc.id, note: v.number,
        })),
      });
    const total = m(t.total);
    const charges = m(t.transport).plus(m(t.labour)).plus(m(t.bankCharge));
    await c.ledger.post(tx, who, {
      date: v.date, sourceType: 'sales_document', sourceId: doc.id, number: v.number, narration: `Sale ${v.number} (imported)`,
      lines: [
        { account: 'receivable', partyId, debit: total },
        { account: 'sales', credit: m(t.taxable) },
        { account: 'output_cgst', credit: m(t.cgst) },
        { account: 'output_sgst', credit: m(t.sgst) },
        { account: 'output_igst', credit: m(t.igst) },
        { account: 'tcs_payable', credit: m(t.tcs) },
        { account: 'charges_income', credit: charges },
        { account: 'round_off', credit: total.minus(m(t.taxable)).minus(tax).minus(m(t.tcs)).minus(charges) },
      ],
    });
    await claim('invoice', v.date, v.number);

    /* money taken on the invoice */
    const received = m(v.received);
    const amount = partyId ? received.plus(m(v.extraPaid)) : received;
    if (amount.gt(0)) {
      let splits = v.pays.map((p) => ({ mode: p.mode, amount: m(p.amount), ref: p.ref }));
      const paid = splits.reduce((a, p) => a.plus(p.amount), money(0));
      if (!paid.eq(amount)) {
        // walk-in change, or an old invoice without the split: record what was kept, in the first mode
        splits = [{ mode: splits[0]?.mode ?? 'Cash', amount, ref: splits.map((p) => p.ref).filter(Boolean).join(', ') }];
      }
      const number = v.receiptNo || (await c.numbers.next(tx, c.businessId, c.userId, 'receipt', v.date));
      const pay = await tx.payment.create({
        data: {
          ...base, direction: 'in', number, legacyId: number, date: day(v.date), partyId, amount: amount.toFixed(2), mode: [...new Set(splits.map((p) => p.mode))].join(' + '),
          reference: splits.map((p) => p.ref).filter(Boolean).join(', '), atSale: true, sourceId: doc.id, notes: `Received with ${v.number}`,
          splits: splits.map((p) => ({ mode: p.mode, amount: p.amount.toFixed(2), ref: p.ref })) as Prisma.InputJsonValue,
        },
      });
      if (v.receiptNo) await claim('receipt', v.date, number);
      const onBill = min(received, total);
      const alloc = [{ to: doc.id, amount: onBill }];
      let left = amount.minus(onBill);
      if (partyId && left.gt(0)) {
        const r = autoAllocate(await openDues(tx, partyId, { upTo: v.date, except: doc.id }), left);
        alloc.push(...r.alloc);
        left = r.left;
      }
      await tx.paymentAllocation.createMany({
        data: alloc.filter((a) => a.amount.gt(0)).map((a) => ({ businessId: c.businessId, paymentId: pay.id, amount: a.amount.toFixed(2), partyId, ...(a.to === 'opening' ? { kind: 'opening' } : { salesDocumentId: a.to }) })),
      });
      const debit = await moneyInLines(tx, who, { splits, paymentId: pay.id, partyId, date: v.date, memo: number });
      await c.ledger.post(tx, who, { date: v.date, sourceType: 'payment', sourceId: pay.id, number, narration: `Received with ${v.number} (imported)`, lines: [...debit, { account: 'receivable', partyId, credit: amount }] });
    }
  }

  /* 2. cancelled invoices: out of the dues, stock back, money received stays as advance */
  for (const v of s.invoices.filter((x) => x.cancelled)) {
    const id = invId.get(v.number)!;
    await c.ledger.cancel(tx, 'sales_document', id);
    const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId'], where: { sourceType: 'sales_document', sourceId: id }, _sum: { qty: true } });
    const back = net.filter((n) => n._sum.qty && !n._sum.qty.isZero());
    if (back.length)
      await tx.stockMovement.createMany({
        data: back.map((n) => ({ ...base, itemId: n.itemId, godownId: n.godownId, date: day(v.date), qty: n._sum.qty!.neg().toFixed(3), kind: 'cancel', sourceType: 'sales_document', sourceId: id, note: `Cancelled ${v.number}` })),
      });
    await tx.salesDocument.update({ where: { id }, data: { cancelledAt: new Date(v.date + 'T12:00:00+05:30'), cancelledBy: c.userId, cancelReason: 'Cancelled in the old app' } });
    if (!v.partyLegacyId) {
      for (const p of await tx.payment.findMany({ where: { sourceId: id, atSale: true } })) {
        await tx.payment.update({ where: { id: p.id }, data: { cancelledAt: new Date(), cancelledBy: c.userId } });
        await c.ledger.cancel(tx, 'payment', p.id);
      }
    }
  }

  /* 3. payments received, settled as the old app recorded (never more than is still due) */
  for (const r of s.receipts) {
    const partyId = c.partyId.get(r.partyLegacyId)!;
    const amount = m(r.amount);
    const pay = await tx.payment.create({
      data: {
        ...base, direction: 'in', number: r.number, legacyId: r.number, date: day(r.date), partyId, amount: amount.toFixed(2), mode: r.mode, reference: r.ref,
        splits: [{ mode: r.mode, amount: amount.toFixed(2), ref: r.ref }] as Prisma.InputJsonValue,
      },
    });
    await claim('receipt', r.date, r.number);
    let left = amount;
    for (const a of r.alloc) {
      const due = a.to === 'opening' ? await openingDue(tx, partyId) : ((await invoiceBalances(tx, [invId.get(a.to)!])).get(invId.get(a.to)!) ?? money(0));
      const u = min(m(a.amount), due, left);
      if (!u.gt(0)) continue;
      await tx.paymentAllocation.create({ data: { businessId: c.businessId, paymentId: pay.id, amount: u.toFixed(2), partyId, ...(a.to === 'opening' ? { kind: 'opening' } : { salesDocumentId: invId.get(a.to)! }) } });
      left = left.minus(u);
    }
    const lines: PostLine[] = /adjust/i.test(r.mode)
      ? [{ account: 'commission_payable', debit: amount, memo: `${r.mode} · ${r.number}` }]
      : await moneyInLines(tx, who, { splits: [{ mode: r.mode, amount, ref: r.ref }], paymentId: pay.id, partyId, date: r.date, memo: r.number });
    await c.ledger.post(tx, who, { date: r.date, sourceType: 'payment', sourceId: pay.id, number: r.number, narration: 'Payment received (imported)', lines: [...lines, { account: 'receivable', partyId, credit: amount }] });
  }

  /* 4. credit notes */
  for (const cn of s.creditNotes) {
    const partyId = pid(cn.partyLegacyId);
    const total = m(cn.total);
    let taxable = money(0);
    const rows = cn.lines.map((l) => {
      const a = m(l.amount);
      const tv = a.div(m(l.gstRate).div(100).plus(1)).toDecimalPlaces(2);
      taxable = taxable.plus(tv);
      return { l, tv, tx: a.minus(tv) };
    });
    const tax = total.minus(taxable);
    const firstInv = cn.invoices[0] ? s.invoices.find((x) => x.number === cn.invoices[0]!.no) : undefined;
    const books = await tx.businessSettings.findUnique({ where: { businessId: c.businessId } });
    const state = (await tx.business.findUniqueOrThrow({ where: { id: c.businessId } })).stateCode;
    const inter = !!firstInv && firstInv.taxMode === 'gst' && !!firstInv.placeOfSupply && firstInv.placeOfSupply !== state;
    const cgst = inter ? money(0) : tax.div(2).toDecimalPlaces(2);
    const sgst = inter ? money(0) : tax.minus(cgst);
    const doc = await tx.salesDocument.create({
      data: {
        ...base, kind: 'credit_note', number: cn.number, legacyId: cn.number, date: day(cn.date), mode: partyId ? 'credit' : 'cash', partyId, cashName: cn.cashName,
        taxMode: books?.gstEnabled ? 'gst' : 'none', placeOfSupply: firstInv?.placeOfSupply ?? state, roundOff: false, itemsTotal: total.toFixed(2), taxable: taxable.toFixed(2),
        tax: tax.toFixed(2), cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), igst: (inter ? tax : money(0)).toFixed(2), total: total.toFixed(2), status: cn.settle, reason: cn.reason,
        extra: { refundMode: cn.settle === 'refund' ? cn.refundMode : '', invoices: cn.invoices.map((i) => i.no) }, sourceId: firstInv ? (invId.get(firstInv.number) ?? null) : null,
      },
    });
    await tx.salesDocumentLine.createMany({
      data: rows.map((r, k) => ({
        businessId: c.businessId, documentId: doc.id, position: k, itemId: c.itemId.get(r.l.itemLegacyId)!, name: r.l.name, hsn: '', qty: r.l.qty, unit: r.l.unit, price: r.l.price,
        gstRate: r.l.gstRate, taxable: r.tv.toFixed(2), tax: r.tx.toFixed(2), amount: r.l.amount, againstId: r.l.invoiceNo ? (invId.get(r.l.invoiceNo) ?? null) : null,
      })),
    });
    const goods = cn.lines.filter((l) => !services.has(c.itemId.get(l.itemLegacyId)!));
    if (goods.length)
      await tx.stockMovement.createMany({
        data: goods.map((l) => ({ ...base, itemId: c.itemId.get(l.itemLegacyId)!, godownId: godown.id, date: day(cn.date), qty: l.qty, rate: l.price, kind: 'return', sourceType: 'sales_document', sourceId: doc.id, note: cn.number })),
      });
    await claim('credit_note', cn.date, cn.number);
    const tl: PostLine[] = [
      { account: 'sales_returns', debit: taxable },
      { account: 'output_cgst', debit: cgst },
      { account: 'output_sgst', debit: sgst },
      { account: 'output_igst', debit: inter ? tax : money(0) },
    ];
    if (cn.settle === 'adjust' && partyId) {
      let left = total;
      for (const i of cn.invoices) {
        const id = invId.get(i.no)!;
        const u = min((await invoiceBalances(tx, [id])).get(id) ?? money(0), m(i.amount), left);
        if (!u.gt(0)) continue;
        await tx.paymentAllocation.create({ data: { businessId: c.businessId, noteId: doc.id, salesDocumentId: id, partyId, amount: u.toFixed(2) } });
        left = left.minus(u);
      }
      await c.ledger.post(tx, who, { date: cn.date, sourceType: 'sales_document', sourceId: doc.id, number: cn.number, narration: `Credit note ${cn.number} (imported)`, lines: [...tl, { account: 'receivable', partyId, credit: total }] });
    } else {
      await c.ledger.post(tx, who, {
        date: cn.date, sourceType: 'sales_document', sourceId: doc.id, number: cn.number, narration: `Credit note ${cn.number} · refunded (imported)`,
        lines: [...tl, { account: await accountFor(tx, cn.refundMode), credit: total, memo: `Refund · ${cn.refundMode}` }],
      });
    }
  }

  /* 5. delivery challans */
  for (const d of s.challans) {
    const doc = await tx.salesDocument.create({
      data: {
        ...base, kind: 'challan', number: d.number, legacyId: d.number, date: day(d.date), mode: d.partyLegacyId ? 'credit' : 'cash', partyId: pid(d.partyLegacyId),
        cashName: d.cashName, cashPhone: d.cashPhone, taxMode: 'gst', notes: d.note, status: d.status,
        extra: { transport: d.transport, vehicle: d.vehicle, ...(d.invoiceNo && { invoiceNo: d.invoiceNo, invoiceId: invId.get(d.invoiceNo) }) },
        ...(d.status === 'cancelled' && { cancelledAt: new Date(d.date + 'T12:00:00+05:30'), cancelledBy: c.userId }),
      },
    });
    await tx.salesDocumentLine.createMany({
      data: d.lines.map((l, k) => ({ businessId: c.businessId, documentId: doc.id, position: k, itemId: c.itemId.get(l.itemLegacyId)!, name: l.name, qty: l.qty, unit: l.unit, price: '0' })),
    });
    await claim('challan', d.date, d.number);
  }

  /* 6. item-wise quotations */
  for (const q of s.quotations) {
    const t = q.totals;
    const doc = await tx.salesDocument.create({
      data: {
        ...base, kind: 'quotation', number: q.number, legacyId: q.number, date: day(q.date), dueDate: q.validTill ? day(q.validTill) : null, mode: q.mode, partyId: pid(q.partyLegacyId),
        cashName: q.cashName, cashPhone: q.cashPhone, taxMode: q.taxMode, pricesInclTax: q.pricesInclTax, placeOfSupply: q.placeOfSupply,
        transport: t.transport, labour: t.labour, bankCharge: t.bankCharge, billDiscount: t.billDiscount, billDiscAmt: m(t.billDiscount).isZero() ? null : t.billDiscount,
        itemsTotal: q.lines.reduce((a, l) => a.plus(m(l.amount)), money(0)).toFixed(2), taxable: t.taxable, tax: m(t.cgst).plus(m(t.sgst)).plus(m(t.igst)).toFixed(2),
        cgst: t.cgst, sgst: t.sgst, igst: t.igst, tcs: t.tcs, roundAmount: t.round, total: t.total, notes: q.notes, status: q.status,
        extra: { ...q.extra, ...(q.invoiceNo && { invoiceNo: q.invoiceNo, invoiceId: invId.get(q.invoiceNo) }) } as Prisma.InputJsonValue,
        referrerId: q.referrerLegacyId ? (c.referrerId.get(q.referrerLegacyId) ?? null) : null,
      },
    });
    await tx.salesDocumentLine.createMany({ data: lineRows(doc.id, q.lines) });
    await claim('quotation', q.date, q.number);
  }
}

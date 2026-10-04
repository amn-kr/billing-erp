import { money, type PurchaseInput } from '@billing/shared';
import type { PlanPurchases } from '@billing/importer';
import type { Tx } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import type { PurchasesService } from '../purchases/purchases.service';
import { billBalances } from '../purchases/dues';

/**
 * Bills, orders, debit notes and payments made from the old app, written through the same
 * purchase rules as new ones (stock, the books, numbers), oldest first.
 */
export async function writePurchases(tx: Tx, ctx: RequestContext, svc: PurchasesService, c: { partyId: Map<string, string>; itemId: Map<string, string>; warnings: string[] }, p: PlanPurchases) {
  const ids = new Map<string, string>(); // "kind:number" → new id
  for (const d of p.docs) {
    const partyId = c.partyId.get(d.partyLegacyId);
    if (!partyId) continue;
    const input: PurchaseInput = {
      kind: d.kind, number: d.number, supplierRef: d.supplierRef, date: d.date, dueDate: d.dueDate, partyId, pricesInclTax: d.pricesInclTax, roundOff: d.roundOff,
      billDiscPct: null, billDiscAmt: d.billDiscAmt, transport: d.transport, labour: d.labour,
      lines: d.lines.map((l) => ({ itemId: c.itemId.get(l.itemLegacyId)!, name: l.name, hsn: l.hsn, unit: l.unit, qty: l.qty, rate: l.rate, discPct: l.discPct, gstRate: l.gstRate })),
      payments: [], updatePrices: false, againstId: d.againstNo ? ids.get('bill:' + d.againstNo) ?? null : null, reason: (d.reason || 'Damaged goods') as PurchaseInput['reason'],
      fromOrderId: d.fromOrderNo ? ids.get('order:' + d.fromOrderNo) ?? null : null, notes: d.notes, extra: {},
    };
    const r = await svc.saveIn(tx, ctx, input, { status: d.status });
    ids.set(`${d.kind}:${d.number}`, r.id);
    if (money(r.total).minus(money(d.total)).abs().gt(0.009)) c.warnings.push(`${d.number}: total is ${r.total} here; the old app showed ${d.total}.`);
  }
  for (const pay of p.payments) {
    const partyId = c.partyId.get(pay.partyLegacyId);
    if (!partyId) continue;
    const party = await tx.party.findUniqueOrThrow({ where: { id: partyId }, select: { name: true } });
    const billIds = pay.alloc.flatMap((a) => { const id = ids.get('bill:' + a.billNo); return id ? [{ id, amount: money(a.amount) }] : []; });
    const bal = await billBalances(tx, billIds.map((b) => b.id));
    const alloc = billIds.map((b) => { const left = bal.get(b.id) ?? money(0); return { billId: b.id, amount: b.amount.lt(left) ? b.amount : left }; }).filter((a) => a.amount.gt(0));
    await svc.payOutIn(tx, ctx, { partyId, partyName: party.name, date: pay.date, amount: money(pay.amount), mode: pay.mode, ref: pay.ref, notes: '', alloc, atBill: null, legacyNo: pay.number });
  }
}

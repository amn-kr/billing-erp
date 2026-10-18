/**
 * Money taken on the invoice screen (prototype saveSI + xpApply):
 * - a receipt for what is kept on the bill (up to the total);
 * - from a party, anything above the total is a second entry "XP-<invoice no.>"
 *   that settles the party's older dues, oldest first; the rest stays as advance.
 * A walk-in sale keeps only the bill amount (the rest is change).
 * Used for new and edited invoices and by the importer, so both work the same way.
 */
import { Prisma } from '@prisma/client';
import { money, type Money } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import type { LedgerService } from '../../common/ledger.service';
import type { NumberingService } from '../../common/numbering.service';
import { day } from '../../common/lookups';
import { autoAllocate, openDues } from './dues';
import { cancelPendingCheques, moneyInLines } from './money-in';

export interface Part { mode: string; amount: Money; ref: string }
export interface AtSaleDeps { businessId: string; userId: string; ledger: LedgerService; numbers: NumberingService }
export interface AtSaleInput {
  docId: string; docNumber: string; date: string; partyId: string | null; total: Money; parts: Part[];
  /** keep this receipt number (import); otherwise the next PI- number */
  receiptNo?: string;
  legacy?: boolean;
}

/** Splits payment parts at an amount: the first parts fill it, the rest is left over (same modes and references). */
export function splitParts(parts: Part[], cap: Money): [Part[], Part[]] {
  const head: Part[] = [];
  const tail: Part[] = [];
  let room = cap;
  for (const p of parts) {
    if (!p.amount.gt(0)) continue;
    const take = room.lt(p.amount) ? room : p.amount;
    if (take.gt(0)) head.push({ ...p, amount: take });
    if (p.amount.gt(take)) tail.push({ ...p, amount: p.amount.minus(take) });
    room = room.minus(take);
  }
  return [head, tail];
}

export async function writeAtSale(tx: Tx, d: AtSaleDeps, o: AtSaleInput): Promise<{ received: Money; settledOld: Money; advance: Money }> {
  const who = { businessId: d.businessId, userId: d.userId };
  const old = await tx.payment.findMany({ where: { sourceId: o.docId, atSale: true } });
  for (const p of old.filter((x) => !x.cancelledAt)) {
    await cancelPendingCheques(tx, p.id, o.date, `Replaced when ${o.docNumber} was edited`);
    await tx.paymentAllocation.deleteMany({ where: { paymentId: p.id } });
  }
  const paid = o.parts.reduce((a, p) => a.plus(p.amount), money(0));
  const onBill = paid.lt(o.total) ? paid : o.total;
  const [main, rest] = splitParts(o.parts, onBill);
  const extra = o.partyId ? paid.minus(onBill) : money(0);
  // like the prototype, both entries show every mode used on the invoice
  const modes = [...new Set(o.parts.filter((p) => p.amount.gt(0)).map((p) => p.mode))].join(' + ');

  const upsert = async (kind: 'main' | 'xp', amount: Money, parts: Part[], alloc: { to: string; amount: Money }[]) => {
    const prev = old.find((p) => (kind === 'xp') === p.number.startsWith('XP-'));
    if (!amount.gt(0)) {
      if (prev && !prev.cancelledAt) {
        await tx.payment.update({ where: { id: prev.id }, data: { cancelledAt: new Date(), cancelledBy: d.userId } });
        await d.ledger.cancel(tx, 'payment', prev.id);
      }
      return;
    }
    const data = {
      date: day(o.date), partyId: o.partyId, amount: amount.toFixed(2), mode: modes, reference: parts.map((p) => p.ref).filter(Boolean).join(', '),
      splits: parts.map((p) => ({ mode: p.mode, amount: p.amount.toFixed(2), ref: p.ref })) as Prisma.InputJsonValue,
      notes: kind === 'xp' ? `Extra on ${o.docNumber}` : `Received with ${o.docNumber}`, cancelledAt: null, cancelledBy: null,
    };
    const number = prev?.number ?? (kind === 'xp' ? `XP-${o.docNumber}` : o.receiptNo || (await d.numbers.next(tx, d.businessId, d.userId, 'receipt', o.date)));
    const pay = prev
      ? await tx.payment.update({ where: { id: prev.id }, data })
      : await tx.payment.create({ data: { ...data, businessId: d.businessId, createdBy: d.userId, direction: 'in', atSale: true, sourceId: o.docId, number, ...(o.legacy && { legacyId: number }) } });
    if (kind === 'main' && o.receiptNo && !prev) await d.numbers.claim(tx, d.businessId, d.userId, 'receipt', o.date, number);
    if (alloc.length)
      await tx.paymentAllocation.createMany({
        data: alloc.filter((a) => a.amount.gt(0)).map((a) => ({
          businessId: d.businessId, paymentId: pay.id, amount: a.amount.toFixed(2), partyId: o.partyId, ...(a.to === 'opening' ? { kind: 'opening' } : { salesDocumentId: a.to }),
        })),
      });
    const debit = await moneyInLines(tx, who, { splits: parts, paymentId: pay.id, partyId: o.partyId, date: o.date, memo: number });
    await d.ledger.repost(tx, who, {
      date: o.date, sourceType: 'payment', sourceId: pay.id, number, narration: data.notes,
      lines: [...debit, { account: 'receivable', partyId: o.partyId, credit: amount }],
    });
  };

  await upsert('main', onBill, main, [{ to: o.docId, amount: onBill }]);
  let settledOld = money(0);
  let advance = money(0);
  if (extra.gt(0)) {
    const r = autoAllocate(await openDues(tx, o.partyId!, { upTo: o.date, except: o.docId }), extra);
    settledOld = extra.minus(r.left);
    advance = r.left;
    await upsert('xp', extra, rest, r.alloc);
  } else await upsert('xp', money(0), [], []);
  return { received: onBill, settledOld, advance };
}

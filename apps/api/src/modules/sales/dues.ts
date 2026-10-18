import { money, type Money } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import { isoOf } from '../../common/lookups';

/**
 * What is still owed on each sale invoice: total − money and credit notes settled
 * against it. Settlements from a cancelled receipt or credit note no longer count;
 * a cancelled invoice owes nothing. `skip` leaves out what one receipt or credit note
 * settled (the one open in its edit window).
 */
export async function invoiceBalances(tx: Tx, ids?: string[], skip?: string): Promise<Map<string, Money>> {
  const rows = await tx.$queryRaw<{ id: string; bal: string }[]>`
    SELECT d.id, CASE WHEN d.cancelled_at IS NOT NULL THEN 0 ELSE d.total - coalesce(s.used, 0) END::text AS bal
    FROM sales_documents d
    LEFT JOIN (
      SELECT a.sales_document_id AS id, sum(a.amount) AS used
      FROM payment_allocations a
      LEFT JOIN payments p ON p.id = a.payment_id
      LEFT JOIN sales_documents n ON n.id = a.note_id
      WHERE a.sales_document_id IS NOT NULL AND p.cancelled_at IS NULL AND n.cancelled_at IS NULL
        AND (${skip ?? null}::uuid IS NULL OR coalesce(a.payment_id, a.note_id) <> ${skip ?? null}::uuid)
      GROUP BY a.sales_document_id
    ) s ON s.id = d.id
    WHERE d.kind = 'invoice' AND (${ids ?? null}::uuid[] IS NULL OR d.id = ANY(${ids ?? null}::uuid[]))`;
  return new Map(rows.map((r) => [r.id, money(r.bal)]));
}

/** Money on a receipt (or credit on a credit note) not settled against anything live: the advance. */
export async function unusedAmounts(tx: Tx, kind: 'payment' | 'note', ids: string[]): Promise<Map<string, Money>> {
  if (!ids.length) return new Map();
  const col = kind === 'payment' ? 'payment_id' : 'note_id';
  const rows = await tx.$queryRawUnsafe<{ id: string; used: string }[]>(
    `SELECT a.${col} AS id, sum(a.amount)::text AS used
     FROM payment_allocations a LEFT JOIN sales_documents d ON d.id = a.sales_document_id
     WHERE a.${col} = ANY($1::uuid[]) AND (d.id IS NULL OR d.cancelled_at IS NULL)
     GROUP BY a.${col}`,
    ids,
  );
  return new Map(rows.map((r) => [r.id, money(r.used)]));
}

/** The party's opening balance still unpaid ("to receive" side only). */
export async function openingDue(tx: Tx, partyId: string, skip?: string): Promise<Money> {
  const p = await tx.party.findUnique({ where: { id: partyId }, select: { openingBalance: true, openingType: true } });
  if (!p || p.openingType === 'pay') return money(0);
  const [r] = await tx.$queryRaw<{ used: string | null }[]>`
    SELECT sum(a.amount)::text AS used FROM payment_allocations a
    LEFT JOIN payments p ON p.id = a.payment_id LEFT JOIN sales_documents n ON n.id = a.note_id
    WHERE a.kind = 'opening' AND a.party_id = ${partyId}::uuid AND p.cancelled_at IS NULL AND n.cancelled_at IS NULL
      AND (${skip ?? null}::uuid IS NULL OR coalesce(a.payment_id, a.note_id) <> ${skip ?? null}::uuid)`;
  const due = money(p.openingBalance.toString()).minus(money(r?.used ?? 0));
  return due.isNegative() ? money(0) : due;
}

export interface Due { to: string; kind: 'opening' | 'invoice'; number: string; date: string; dueDate: string | null; total: Money; balance: Money; at?: number }

/**
 * A customer's open dues, oldest first (prototype openDues): unpaid invoices and
 * the opening balance. `upTo` leaves out invoices dated after it; `except` leaves out
 * one invoice (the one being saved); `skip` counts the dues as if one receipt had not settled them.
 */
export async function openDues(tx: Tx, partyId: string, o: { upTo?: string; except?: string; skip?: string } = {}): Promise<Due[]> {
  const docs = await tx.salesDocument.findMany({
    where: { kind: 'invoice', partyId, cancelledAt: null, ...(o.except && { id: { not: o.except } }), ...(o.upTo && { date: { lte: new Date(o.upTo + 'T00:00:00Z') } }) },
    select: { id: true, number: true, date: true, dueDate: true, total: true, createdAt: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const bal = await invoiceBalances(tx, docs.map((d) => d.id), o.skip);
  const out: Due[] = [];
  const party = await tx.party.findUnique({ where: { id: partyId }, select: { openingDate: true, createdAt: true } });
  const ob = await openingDue(tx, partyId, o.skip);
  const obDate = isoOf(party?.openingDate ?? party?.createdAt ?? null)!;
  if (ob.gt(0) && (!o.upTo || obDate <= o.upTo)) {
    const date = obDate;
    out.push({ to: 'opening', kind: 'opening', number: 'Opening balance', date, dueDate: null, total: ob, balance: ob });
  }
  for (const d of docs) {
    const b = bal.get(d.id) ?? money(0);
    if (b.gt(0)) out.push({ to: d.id, kind: 'invoice', number: d.number, date: isoOf(d.date)!, dueDate: isoOf(d.dueDate), total: money(d.total.toString()), balance: b, at: d.createdAt.getTime() });
  }
  // oldest date first; on the same day the old app lists the newest entry first and the opening balance last
  return out
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind !== b.kind ? (a.kind === 'opening' ? 1 : -1) : (b.at ?? 0) - (a.at ?? 0)))
    .map(({ at: _at, ...d }) => d);
}

/** Fill dues oldest first with an amount; returns the allocations and what is left over. */
export function autoAllocate(dues: Due[], amount: Money): { alloc: { to: string; amount: Money }[]; left: Money } {
  let left = amount;
  const alloc: { to: string; amount: Money }[] = [];
  for (const d of dues) {
    if (!left.gt(0)) break;
    const u = left.lt(d.balance) ? left : d.balance;
    alloc.push({ to: d.to, amount: u });
    left = left.minus(u);
  }
  return { alloc, left };
}

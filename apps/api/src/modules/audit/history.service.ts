import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatIstDateTime, type Permission } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import { editDiffs, notAnEdit, refsOf, sentences, type Names } from './edit-history';

/** One box of the window: an edit, newest first. */
export interface HistoryEntry { id: string; at: string; when: string; user: string; lines: string[]; details: boolean }
export interface DocHistory { type: string; number: string; entries: HistoryEntry[] }

export const NOT_SAVED = 'Edited (details were not saved)';
export const NO_CHANGE = 'Saved again with no changes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALE_WORD: Record<string, string> = { invoice: 'Invoice', quotation: 'Quotation', challan: 'Delivery challan', credit_note: 'Credit note' };
const PURCHASE_WORD: Record<string, string> = { bill: 'Purchase bill', order: 'Purchase order', debit_note: 'Debit note' };

/**
 * Each kind of document: the permission its own list needs (whoever can open it can read its
 * history), the audit entity its edits are logged under, and how to find it (number and type word).
 */
const DOCS: Record<string, { perm: Permission; entity: string; find: (tx: Tx, id: string) => Promise<{ type: string; number: string } | null> }> = {
  sales: { perm: 'sales.view', entity: 'sales_document', find: async (tx, id) => { const d = await tx.salesDocument.findFirst({ where: { id }, select: { kind: true, number: true } }); return d && { type: SALE_WORD[d.kind] ?? 'Document', number: d.number }; } },
  receipt: { perm: 'sales.view', entity: 'payment', find: async (tx, id) => { const p = await tx.payment.findFirst({ where: { id, direction: 'in' }, select: { number: true } }); return p && { type: 'Payment received', number: p.number }; } },
  purchase: { perm: 'purchases.view', entity: 'purchase_document', find: async (tx, id) => { const d = await tx.purchaseDocument.findFirst({ where: { id }, select: { kind: true, number: true } }); return d && { type: PURCHASE_WORD[d.kind] ?? 'Document', number: d.number }; } },
  'payment-made': { perm: 'purchases.view', entity: 'payment', find: async (tx, id) => { const p = await tx.payment.findFirst({ where: { id, direction: 'out' }, select: { number: true } }); return p && { type: 'Payment made', number: p.number }; } },
  expense: { perm: 'money.view', entity: 'expense', find: async (tx, id) => { const x = await tx.expense.findFirst({ where: { id }, select: { number: true } }); return x && { type: 'Expense', number: x.number }; } },
  'bank-entry': { perm: 'money.view', entity: 'bank_entry', find: async (tx, id) => { const b = await tx.bankEntry.findFirst({ where: { id }, select: { number: true } }); return b && { type: 'Cash / bank entry', number: b.number }; } },
  'stock-adjustment': { perm: 'masters.view', entity: 'stock_adjustment', find: async (tx, id) => { const a = await tx.stockAdjustment.findFirst({ where: { id }, select: { number: true } }); return a && { type: 'Stock adjustment', number: a.number }; } },
  'stock-transfer': { perm: 'masters.view', entity: 'stock_transfer', find: async (tx, id) => { const t = await tx.stockTransfer.findFirst({ where: { id }, select: { number: true } }); return t && { type: 'Stock transfer', number: t.number }; } },
};
export const HISTORY_TYPES = Object.keys(DOCS);

/** Reads the edit history of one document from the audit log. Read only: no passcode, nothing written. */
@Injectable()
export class HistoryService {
  constructor(private readonly db: DbService) {}

  read(ctx: RequestContext, type: string, id: string): Promise<DocHistory> {
    const doc = DOCS[type];
    if (!doc) throw new NotFoundException({ message: 'That kind of document has no history.' });
    if (!ctx.businessId) throw new ForbiddenException({ message: 'Set up or choose a shop first.' });
    if (!ctx.permissions.includes(doc.perm)) throw new ForbiddenException({ message: 'Your role does not allow this. Ask the shop owner.' });
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      // row-level security already keeps other shops' records out; an id from another shop is simply not found
      const found = UUID.test(id) ? await doc.find(tx, id) : null;
      if (!found) throw new NotFoundException({ message: 'That document was not found.' });
      const rows = (await tx.auditLog.findMany({
        where: { businessId: ctx.businessId!, entity: doc.entity, entityId: id, action: 'update' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, userId: true, createdAt: true, before: true, after: true },
      })).filter((r) => !notAnEdit(doc.entity, r.before, r.after));
      const diffs = rows.map((r) => editDiffs(doc.entity, r.before, r.after));
      const names = await this.names(tx, refsOf(diffs.flatMap((d) => d ?? [])));
      const userIds = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
      const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
      return {
        ...found,
        entries: rows.map((r, k) => {
          const d = diffs[k];
          return {
            id: r.id, at: r.createdAt.toISOString(), when: formatIstDateTime(r.createdAt), user: (r.userId && users.get(r.userId)) || 'Unknown user',
            details: !!d, lines: d ? (d.length ? sentences(d, names) : [NO_CHANGE]) : [NOT_SAVED],
          };
        }),
      };
    });
  }

  /** Names for the ids the edits mention; what is not found (deleted, or not this shop's) is left out and shown as unknown. */
  private async names(tx: Tx, refs: ReturnType<typeof refsOf>): Promise<Names> {
    const ids = (s: Set<string>) => ({ in: [...s].filter((x) => UUID.test(x)) });
    const pairs = (L: { id: string; name: string }[]) => new Map(L.map((x) => [x.id, x.name]));
    const nums = (L: { id: string; number: string }[]) => new Map(L.map((x) => [x.id, x.number]));
    const sel = { id: true, name: true } as const;
    return {
      party: pairs(await tx.party.findMany({ where: { id: ids(refs.party) }, select: sel })),
      item: pairs(await tx.item.findMany({ where: { id: ids(refs.item) }, select: sel })),
      godown: pairs(await tx.godown.findMany({ where: { id: ids(refs.godown) }, select: sel })),
      account: pairs(await tx.cashBankAccount.findMany({ where: { id: ids(refs.account) }, select: sel })),
      referrer: pairs(await tx.referrer.findMany({ where: { id: ids(refs.referrer) }, select: sel })),
      sale: nums(await tx.salesDocument.findMany({ where: { id: ids(refs.sale) }, select: { id: true, number: true } })),
      purchase: nums(await tx.purchaseDocument.findMany({ where: { id: ids(refs.purchase) }, select: { id: true, number: true } })),
    };
  }
}

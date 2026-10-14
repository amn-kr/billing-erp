import { Injectable } from '@nestjs/common';
import { counterOf, formatNumber, prefixPattern } from '@billing/shared';
import type { Tx } from './db.service';
import { SERIES } from '../modules/businesses/businesses.service';

/** Where each document type keeps its numbers (fixed names, never from the request). */
const DOCS: Record<string, { table: string; where: string }> = {
  invoice: { table: 'sales_documents', where: `kind = 'invoice'` },
  quotation: { table: 'sales_documents', where: `kind = 'quotation'` },
  challan: { table: 'sales_documents', where: `kind = 'challan'` },
  credit_note: { table: 'sales_documents', where: `kind = 'credit_note'` },
  purchase_order: { table: 'purchase_documents', where: `kind = 'order'` },
  bill: { table: 'purchase_documents', where: `kind = 'bill'` },
  debit_note: { table: 'purchase_documents', where: `kind = 'debit_note'` },
  receipt: { table: 'payments', where: `direction = 'in'` },
  payment: { table: 'payments', where: `direction = 'out'` },
  expense: { table: 'expenses', where: 'true' },
  stock_adjustment: { table: 'stock_adjustments', where: 'true' },
  stock_transfer: { table: 'stock_transfers', where: 'true' },
  bank_entry: { table: 'bank_entries', where: 'true' },
  commission_payout: { table: 'commission_payouts', where: 'true' },
};

/**
 * The server assigns document numbers. Each document type has several prefixes with their own
 * counters; the active one numbers new documents. Counters keep going across financial years
 * (the owner's choice, 14 Oct 2026), and a number already used is skipped, so the same full
 * number is never given twice. Two people saving at the same moment never get the same number:
 * the prefix row is locked while the number is taken.
 */
@Injectable()
export class NumberingService {
  /** The type's active prefix row; a shop without one gets the default prefix. */
  private async active(tx: Tx, businessId: string, userId: string, docType: string) {
    const found = await tx.documentSeries.findFirst({ where: { docType, active: true } });
    if (found) return found;
    // rows without an active one (made by the old server while this version was being deployed): the newest becomes active
    const newest = await tx.documentSeries.findFirst({ where: { docType }, orderBy: [{ nextNumber: 'desc' }, { createdAt: 'desc' }] });
    if (newest) {
      await tx.$executeRaw`UPDATE document_series SET active = true WHERE id = ${newest.id}::uuid
        AND NOT EXISTS (SELECT 1 FROM document_series WHERE business_id = ${businessId}::uuid AND doc_type = ${docType} AND active)`;
      return tx.documentSeries.findFirstOrThrow({ where: { docType, active: true } });
    }
    const prefix = SERIES.find(([t]) => t === docType)?.[1] ?? docType.toUpperCase() + '-';
    // ON CONFLICT covers both unique indexes, so a second request at the same moment just reads the row
    await tx.$executeRaw`
      INSERT INTO document_series (business_id, doc_type, prefix, next_number, active, created_by)
      VALUES (${businessId}::uuid, ${docType}, ${prefix}, ${docType === 'quotation' ? 101 : 1}, true, ${userId}::uuid)
      ON CONFLICT DO NOTHING`;
    return tx.documentSeries.findFirstOrThrow({ where: { docType, active: true } });
  }

  /** Is this full number already on a document of the type? */
  async taken(tx: Tx, docType: string, number: string): Promise<boolean> {
    const d = DOCS[docType];
    if (!d) return false;
    const rows = await tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${d.table} WHERE ${d.where} AND number = $1 LIMIT 1`, number);
    return rows.length > 0;
  }

  /** How many documents of the type were numbered with this prefix (cancelled ones too). */
  async usedCount(tx: Tx, docType: string, prefix: string): Promise<number> {
    const d = DOCS[docType];
    if (!d) return 0;
    const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${d.table} WHERE ${d.where} AND number ~ $1`, prefixPattern(prefix));
    return Number(rows[0]?.n ?? 0);
  }

  /** A prefix added or renamed: its counter starts after the highest number already made with it. */
  async claimAll(tx: Tx, docType: string, id: string, prefix: string): Promise<void> {
    const d = DOCS[docType];
    if (!d) return;
    const rows = await tx.$queryRawUnsafe<{ n: bigint | null }[]>(
      `SELECT max(substring(number from $2::int)::bigint) AS n FROM ${d.table} WHERE ${d.where} AND number ~ $1 AND length(number) - $2::int < 9`,
      prefixPattern(prefix), prefix.length + 1);
    const n = Number(rows[0]?.n ?? 0);
    if (n) await tx.documentSeries.updateMany({ where: { id, nextNumber: { lte: n } }, data: { nextNumber: n + 1 } });
  }

  /** The number the next document would get, without taking it (shown in the editor). */
  async peek(tx: Tx, businessId: string, userId: string, docType: string, _date?: string): Promise<string> {
    const s = await this.active(tx, businessId, userId, docType);
    let n = s.nextNumber;
    while (await this.taken(tx, docType, formatNumber(s.prefix, n, s.padding))) n++;
    return formatNumber(s.prefix, n, s.padding);
  }

  /**
   * A number typed by hand (or brought in by an import). The prefix it was made with moves past
   * it, so that prefix never gives the same number again — also when it is made active later.
   */
  async claim(tx: Tx, businessId: string, userId: string, docType: string, _date: string, number: string): Promise<void> {
    await this.active(tx, businessId, userId, docType);
    const rows = await tx.documentSeries.findMany({ where: { docType } });
    // the longest matching prefix wins ("JE/INV/0001" belongs to JE/INV/, never to JE/)
    const s = rows.filter((r) => counterOf(number, r.prefix) !== null).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!s) return;
    const n = counterOf(number, s.prefix)!;
    if (n >= s.nextNumber) await tx.documentSeries.update({ where: { id: s.id }, data: { nextNumber: n + 1 } });
  }

  async next(tx: Tx, businessId: string, userId: string, docType: string, _date?: string): Promise<string> {
    await this.active(tx, businessId, userId, docType);
    for (;;) {
      const rows = await tx.$queryRaw<{ prefix: string; n: number; padding: number }[]>`
        UPDATE document_series SET next_number = next_number + 1, updated_at = now()
        WHERE business_id = ${businessId}::uuid AND doc_type = ${docType} AND active
        RETURNING prefix, next_number - 1 AS n, padding`;
      const r = rows[0]!;
      const number = formatNumber(r.prefix, r.n, r.padding);
      // a number typed by hand earlier may already sit on a document: skip it
      if (!(await this.taken(tx, docType, number))) return number;
    }
  }
}

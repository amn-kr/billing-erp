import { Injectable } from '@nestjs/common';
import { financialYearOf } from '@billing/shared';
import type { Tx } from './db.service';
import { SERIES } from '../modules/businesses/businesses.service';

const day = (iso: string) => new Date(iso + 'T00:00:00Z');

/**
 * The server assigns document numbers, per type, per financial year
 * (April–March). Two people saving at the same moment never get the same
 * number: the series row is locked while the number is taken.
 */
@Injectable()
export class NumberingService {
  private async series(tx: Tx, businessId: string, userId: string, docType: string, date: string) {
    const fy = financialYearOf(date);
    let year = await tx.financialYear.findFirst({ where: { label: fy.label } });
    year ??= await tx.financialYear.create({ data: { businessId, label: fy.label, startDate: day(fy.start), endDate: day(fy.end), createdBy: userId } });
    const prefix = SERIES.find(([t]) => t === docType)?.[1] ?? docType.toUpperCase() + '-';
    await tx.documentSeries.createMany({
      data: [{ businessId, financialYearId: year.id, docType, prefix, nextNumber: docType === 'quotation' ? 101 : 1, createdBy: userId }],
      skipDuplicates: true,
    });
    return year;
  }

  /** The number the next document would get, without taking it (shown in the editor). */
  async peek(tx: Tx, businessId: string, userId: string, docType: string, date: string): Promise<string> {
    const year = await this.series(tx, businessId, userId, docType, date);
    const s = await tx.documentSeries.findFirstOrThrow({ where: { financialYearId: year.id, docType } });
    return s.prefix + String(s.nextNumber).padStart(s.padding, '0');
  }

  /**
   * A number typed by hand. When it has the series prefix the series moves past it,
   * so the next automatic number never repeats it (the prototype took the highest used + 1).
   */
  async claim(tx: Tx, businessId: string, userId: string, docType: string, date: string, number: string): Promise<void> {
    const year = await this.series(tx, businessId, userId, docType, date);
    const s = await tx.documentSeries.findFirstOrThrow({ where: { financialYearId: year.id, docType } });
    const m = number.startsWith(s.prefix) ? /^(\d+)$/.exec(number.slice(s.prefix.length)) : null;
    if (!m) return;
    const n = Number(m[1]);
    if (n >= s.nextNumber && n < 1e9) await tx.documentSeries.update({ where: { id: s.id }, data: { nextNumber: n + 1 } });
  }

  async next(tx: Tx, businessId: string, userId: string, docType: string, date: string): Promise<string> {
    const year = await this.series(tx, businessId, userId, docType, date);
    const rows = await tx.$queryRaw<{ prefix: string; n: number; padding: number }[]>`
      UPDATE document_series SET next_number = next_number + 1, updated_at = now()
      WHERE business_id = ${businessId}::uuid AND financial_year_id = ${year.id}::uuid AND doc_type = ${docType}
      RETURNING prefix, next_number - 1 AS n, padding`;
    const r = rows[0]!;
    return r.prefix + String(r.n).padStart(r.padding, '0');
  }
}

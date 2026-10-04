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
  async next(tx: Tx, businessId: string, userId: string, docType: string, date: string): Promise<string> {
    const fy = financialYearOf(date);
    let year = await tx.financialYear.findFirst({ where: { label: fy.label } });
    year ??= await tx.financialYear.create({ data: { businessId, label: fy.label, startDate: day(fy.start), endDate: day(fy.end), createdBy: userId } });
    const prefix = SERIES.find(([t]) => t === docType)?.[1] ?? docType.toUpperCase() + '-';
    await tx.documentSeries.createMany({
      data: [{ businessId, financialYearId: year.id, docType, prefix, nextNumber: docType === 'quotation' ? 101 : 1, createdBy: userId }],
      skipDuplicates: true,
    });
    const rows = await tx.$queryRaw<{ prefix: string; n: number; padding: number }[]>`
      UPDATE document_series SET next_number = next_number + 1, updated_at = now()
      WHERE business_id = ${businessId}::uuid AND financial_year_id = ${year.id}::uuid AND doc_type = ${docType}
      RETURNING prefix, next_number - 1 AS n, padding`;
    const r = rows[0]!;
    return r.prefix + String(r.n).padStart(r.padding, '0');
  }
}

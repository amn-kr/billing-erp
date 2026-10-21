import { ConflictException, Injectable } from '@nestjs/common';
import { checkPartyRows, partyRowProblems, partySchema, type PartyImportContext, type PartyImportInput, type PartyImportSummary } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import { uniqueMessage } from '../../common/lookups';
import { planToday } from '../../config';
import { PartiesService } from './parties.service';

/**
 * Parties › ⋮ › Import Parties (Excel file or Bulk entry). The rows are checked in the browser;
 * here they are checked again against the shop as it is now, and the OK rows are saved in one
 * transaction (all of them or none), each one exactly as Add party saves it. Rejected rows,
 * duplicates and the sample file's example row are never saved, and an existing party is never changed.
 */
@Injectable()
export class PartyImportService {
  constructor(
    private readonly db: DbService,
    private readonly parties: PartiesService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** The shop's live parties (for the duplicate check) and whether GST is on. */
  private async load(tx: Tx): Promise<PartyImportContext> {
    const [parties, settings] = await Promise.all([
      tx.party.findMany({ where: { archivedAt: null }, select: { name: true, phone: true }, orderBy: { createdAt: 'asc' } }),
      tx.businessSettings.findFirst({ select: { gstEnabled: true } }),
    ]);
    return { parties, gst: !!settings?.gstEnabled };
  }

  context(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => this.load(tx));
  }

  async run(ctx: RequestContext, input: PartyImportInput): Promise<PartyImportSummary> {
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        // one import per shop at a time, so two imports cannot both add the same name or phone
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'party-import:' + ctx.businessId}))`;
        const checks = checkPartyRows(input.rows, await this.load(tx));
        const summary: PartyImportSummary = { saved: [], rejected: [], skipped: [], examples: [] };
        // opening balances are as of today (India), like Add party's default date
        const today = planToday();
        for (const c of checks) {
          if (c.status === 'rejected') { summary.rejected.push({ line: c.line, reasons: partyRowProblems(c) }); continue; }
          if (c.status === 'duplicate') { summary.skipped.push({ line: c.line, reasons: partyRowProblems(c) }); continue; }
          if (c.status === 'example') { summary.examples.push({ line: c.line, reasons: partyRowProblems(c) }); continue; }
          // the same form rules as Add party (POST /parties)
          const body = partySchema.parse({ ...c.party, openingDate: today });
          const p = await this.parties.insert(tx, ctx, body, { from: 'import', line: c.line });
          summary.saved.push({ line: c.line, id: p.id, name: p.name });
        }
        return summary;
      }, { timeout: 120_000 });
    } catch (e) {
      // a party with one of these names was added at the same moment: nothing was saved
      if (uniqueMessage(e)) throw new ConflictException({ message: 'A party with one of these names was just added. Nothing was saved — check the rows again.' });
      throw e;
    }
  }
}

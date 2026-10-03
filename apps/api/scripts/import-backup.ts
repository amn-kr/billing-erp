/**
 * Import a backup file from the old app into a shop, from the command line.
 *
 *   pnpm --filter @billing/api import -- --file ~/Downloads/billing-backup.json --email owner@shop.in [--dry-run] [--include-sample]
 *
 * The shop is the one the email owns. It must have no parties or items yet.
 * DATABASE_URL must be the app role (erp_app), so row-level security applies.
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { ImportsService } from '../src/modules/imports/imports.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes('--' + name);

async function main() {
  const file = arg('file');
  const email = arg('email')?.toLowerCase();
  if (!file || !email) throw new Error('Usage: --file <backup.json> --email <owner email> [--dry-run] [--include-sample]');
  const db = new DbService();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with the email ${email}.`);
  const owned = await db.scoped({ userId: user.id, email }, (tx) =>
    tx.membership.findMany({ where: { userId: user.id, status: 'active', role: { key: 'owner' } }, include: { business: true } }),
  );
  if (owned.length !== 1) throw new Error(`${email} owns ${owned.length} shops; this tool needs exactly one.`);
  const shop = owned[0]!.business;
  const svc = new ImportsService(db, new AuditService());
  const res = await svc.run(
    { userId: user.id, email, businessId: shop.id, ip: 'cli' },
    { fileName: path.basename(file), text: fs.readFileSync(file, 'utf8'), dryRun: flag('dry-run'), includeSample: flag('include-sample') },
  );
  console.log(`${res.dryRun ? 'Dry run — nothing saved.' : 'Imported.'} Shop: ${shop.name} (${shop.code})`);
  for (const [k, v] of Object.entries(res.counts)) console.log(`  ${k.padEnd(26)} ${v}`);
  if (res.warnings.length) {
    console.log('Notes:');
    for (const w of res.warnings) console.log('  - ' + w);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

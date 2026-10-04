/**
 * E2E only: shops whose books are importer fixtures, so the rebuilt screens can
 * be compared with the prototype showing the same backup.
 * - fresh-shop.backup.json (masters): ravi@gupta.example.com / demo-password-1
 * - sales-shop.backup.json (sales documents): ravi.sales@gupta.example.com / demo-password-1
 * - purchase-shop.backup.json (sales and purchases): ravi.purchases@gupta.example.com / demo-password-1
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { BusinessesService } from '../src/modules/businesses/businesses.service';
import { ImportsService } from '../src/modules/imports/imports.service';
import { LedgerService } from '../src/common/ledger.service';
import { NumberingService } from '../src/common/numbering.service';

async function seed(db: DbService, email: string, fixture: string) {
  const user = await db.user.create({ data: { email, name: 'Ravi Gupta', passwordHash: await hash('demo-password-1', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
  const shop = await new BusinessesService(db, new AuditService()).create(
    { userId: user.id, email, ip: '' },
    { name: 'Gupta Electricals & Hardware', owner: 'Ravi Gupta', phone: '', addr: '', city: 'Lucknow', pin: '', state: '09', gstin: '09AAGFG2231M1ZQ', inv: '101' },
    { today: '2026-10-01', trialDays: 14 },
  );
  const file = path.resolve(__dirname, '../../../packages/importer/fixtures', fixture);
  const imports = new ImportsService(db, new AuditService(), new LedgerService(), new NumberingService());
  return imports.run({ userId: user.id, email, businessId: shop.id, ip: '' }, { fileName: fixture, text: fs.readFileSync(file, 'utf8') });
}

async function main() {
  const db = new DbService();
  const r = await seed(db, 'ravi@gupta.example.com', 'fresh-shop.backup.json');
  console.log(`E2E masters shop ready: ${r.counts.parties} parties, ${r.counts.items} items`);
  const s = await seed(db, 'ravi.sales@gupta.example.com', 'sales-shop.backup.json');
  console.log(`E2E sales shop ready: ${s.counts.invoices} invoices, ${s.counts.receipts} payments`);
  const pu = await seed(db, 'ravi.purchases@gupta.example.com', 'purchase-shop.backup.json');
  console.log(`E2E purchase shop ready: ${pu.counts.purchaseBills} bills, ${pu.counts.paymentsMade} payments made`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

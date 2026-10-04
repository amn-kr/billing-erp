/**
 * E2E only: a second shop whose books are the importer fixture
 * packages/importer/fixtures/fresh-shop.backup.json, so the rebuilt masters
 * screens can be compared with the prototype showing the same backup.
 * Sign in as ravi@gupta.example.com / demo-password-1.
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { BusinessesService } from '../src/modules/businesses/businesses.service';
import { ImportsService } from '../src/modules/imports/imports.service';

async function main() {
  const db = new DbService();
  const email = 'ravi@gupta.example.com';
  const user = await db.user.create({ data: { email, name: 'Ravi Gupta', passwordHash: await hash('demo-password-1', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
  const shop = await new BusinessesService(db, new AuditService()).create(
    { userId: user.id, email, ip: '' },
    { name: 'Gupta Electricals & Hardware', owner: 'Ravi Gupta', phone: '', addr: '', city: 'Lucknow', pin: '', state: '09', gstin: '09AAGFG2231M1ZQ', inv: '101' },
    { today: '2026-10-01', trialDays: 14 },
  );
  const file = path.resolve(__dirname, '../../../packages/importer/fixtures/fresh-shop.backup.json');
  const r = await new ImportsService(db, new AuditService()).run({ userId: user.id, email, businessId: shop.id, ip: '' }, { fileName: 'fresh-shop.backup.json', text: fs.readFileSync(file, 'utf8') });
  console.log(`E2E masters shop ready: ${r.counts.parties} parties, ${r.counts.items} items`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

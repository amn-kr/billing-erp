// Wipes a database and applies all migrations. For test databases only.
// Usage: MIGRATE_DATABASE_URL=postgresql://erp_owner:...@host/billing_erp_e2e node scripts/reset-db.mjs
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const url = process.env.MIGRATE_DATABASE_URL;
if (!url || !/_(test|e2e)(\?|$)/.test(url)) {
  console.error('Refusing: MIGRATE_DATABASE_URL must point at a *_test or *_e2e database.');
  process.exit(1);
}
const db = new PrismaClient({ datasourceUrl: url });
await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
await db.$executeRawUnsafe('CREATE SCHEMA public');
await db.$disconnect();
execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
console.log('Database reset and migrated.');

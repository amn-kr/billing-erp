import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { TEST_MIGRATE_DB } from './env';

/** Fresh test database for each run: wipe the schema and apply all migrations as the owner role. */
export default async function setup() {
  const owner = new PrismaClient({ datasourceUrl: TEST_MIGRATE_DB });
  await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await owner.$executeRawUnsafe('CREATE SCHEMA public');
  await owner.$disconnect();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: TEST_MIGRATE_DB } });
}

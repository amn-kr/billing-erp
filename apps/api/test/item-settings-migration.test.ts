import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_MIGRATE_DB } from './env';

/**
 * Migration 20261108120000_item_settings on shops made before it, run as the owner role with row-level
 * security forced, as on the live database: a shop with both old switches, with one, and with none.
 */
const NEW = '20261108120000_item_settings';
const PRISMA = path.join(__dirname, '../prisma');
const url = new URL(TEST_MIGRATE_DB);
const dbName = url.pathname.slice(1) + '_itemset_mig';
const scratch = Object.assign(new URL(TEST_MIGRATE_DB), { pathname: '/' + dbName }).toString();
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const U = '00000000-0000-4000-8000-0000000000aa';
let dir: string;
let db: PrismaClient;

const deploy = () => execSync(`npx prisma migrate deploy --schema ${path.join(dir, 'schema.prisma')}`, { stdio: 'pipe', env: { ...process.env, DATABASE_URL: scratch } });
const T = ['users', 'businesses', 'business_settings', 'change_log'];
const open = async (word: 'FORCE' | 'NO FORCE') => { for (const t of T) await db.$executeRawUnsafe(`ALTER TABLE ${t} ${word} ROW LEVEL SECURITY`); };
const SHOPS: [number, string[], string][] = [[1, ['batch_expiry', 'mrp_pack'], '{"mrp":true}'], [2, ['batch_expiry'], '{}'], [3, ['mrp_pack', 'medical'], '{}'], [4, [], '{"mrp":true}']];

beforeAll(async () => {
  const admin = new PrismaClient({ datasourceUrl: TEST_MIGRATE_DB });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
  cpSync(path.join(PRISMA, 'schema.prisma'), path.join(dir, 'schema.prisma'));
  for (const m of readdirSync(path.join(PRISMA, 'migrations'))) if (m !== NEW) cpSync(path.join(PRISMA, 'migrations', m), path.join(dir, 'migrations', m), { recursive: true });
  deploy();

  db = new PrismaClient({ datasourceUrl: scratch });
  await open('NO FORCE');
  await db.$executeRawUnsafe(`INSERT INTO users (id, email, password_hash) VALUES ('${U}', 'mig@test.example.com', 'x')`);
  for (const [n, list, data] of SHOPS) {
    await db.$executeRawUnsafe(`INSERT INTO businesses (id, code, name, short_name, owner_user_id, state_code, trial_ends_on, created_by) VALUES ('${id(n)}', 'BE-900${n}', 'Shop ${n}', 'S${n}', '${U}', '09', '2030-01-01', '${U}')`);
    await db.$executeRawUnsafe(`INSERT INTO business_settings (business_id, data, features, created_by) VALUES ('${id(n)}', '${data}', ARRAY[${list.map((k) => `'${k}'`).join(',')}]::text[], '${U}')`);
  }
  await open('FORCE');

  cpSync(path.join(PRISMA, 'migrations', NEW), path.join(dir, 'migrations', NEW), { recursive: true });
  deploy();
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
  const admin = new PrismaClient({ datasourceUrl: TEST_MIGRATE_DB });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$disconnect();
});

const row = async (n: number) => {
  await open('NO FORCE');
  const r = await db.$queryRawUnsafe<{ features: string[]; data: unknown; item_options: unknown }[]>(`SELECT features, data, item_options FROM business_settings WHERE business_id = '${id(n)}'`);
  await open('FORCE');
  return r[0]!;
};

describe('the two old switch words become today’s boxes', () => {
  it('both on: all five boxes on', async () => {
    expect((await row(1)).features.sort()).toEqual(['batch_no', 'exp_date', 'mfg_date', 'mrp', 'pack_loose']);
  });
  it('one on: only its boxes', async () => {
    expect((await row(2)).features.sort()).toEqual(['batch_no', 'exp_date', 'mfg_date']);
  });
  it('Medical stays', async () => {
    expect((await row(3)).features.sort()).toEqual(['medical', 'mrp', 'pack_loose']);
  });
  it('off stays off: nothing stored, so Category, Brand, Series and Location are on', async () => {
    expect((await row(4)).features).toEqual([]);
  });
  it('general settings aren’t touched, and labels start empty', async () => {
    expect(await row(1)).toMatchObject({ data: { mrp: true }, item_options: {} });
    expect(await row(4)).toMatchObject({ data: { mrp: true }, item_options: {} });
  });
  it('the real-time backup hears about each changed shop, and not about the shop that didn’t change', async () => {
    await open('NO FORCE');
    const count = async (n: number) => (await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM change_log WHERE business_id = '${id(n)}' AND tbl = 'business_settings' AND op = 'U'`))[0]!.n;
    const a = await count(1), d = await count(4);
    await open('FORCE');
    expect(Number(a)).toBe(2);
    expect(Number(d)).toBe(0);
  });
  it('row-level security is forced again afterwards', async () => {
    const r = await db.$queryRawUnsafe<{ relforcerowsecurity: boolean }[]>(`SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('business_settings', 'change_log')`);
    expect(r.map((x) => x.relforcerowsecurity)).toEqual([true, true]);
  });
});

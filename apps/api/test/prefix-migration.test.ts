import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_MIGRATE_DB } from './env';

/**
 * Migration 20261014120000_transaction_prefixes on books made before it: numbering rows of two
 * financial years. A scratch database gets every earlier migration, the old-style rows, then the
 * new migration — run as the owner role with row-level security forced, as on GitHub.
 */
const NEW = '20261014120000_transaction_prefixes';
const PRISMA = path.join(__dirname, '../prisma');
const url = new URL(TEST_MIGRATE_DB);
const dbName = url.pathname.slice(1) + '_mig';
const scratch = Object.assign(new URL(TEST_MIGRATE_DB), { pathname: '/' + dbName }).toString();
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const U = '00000000-0000-4000-8000-0000000000aa';
let dir: string;
let db: PrismaClient;

const deploy = () => execSync(`npx prisma migrate deploy --schema ${path.join(dir, 'schema.prisma')}`, { stdio: 'pipe', env: { ...process.env, DATABASE_URL: scratch } });

beforeAll(async () => {
  const admin = new PrismaClient({ datasourceUrl: TEST_MIGRATE_DB });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  // the migrations up to (not including) the new one
  dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
  cpSync(path.join(PRISMA, 'schema.prisma'), path.join(dir, 'schema.prisma'));
  for (const m of readdirSync(path.join(PRISMA, 'migrations'))) if (m !== NEW) cpSync(path.join(PRISMA, 'migrations', m), path.join(dir, 'migrations', m), { recursive: true });
  deploy();

  db = new PrismaClient({ datasourceUrl: scratch });
  const T = ['users', 'businesses', 'financial_years', 'document_series', 'change_log'];
  for (const t of T) await db.$executeRawUnsafe(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`);
  await db.$executeRawUnsafe(`INSERT INTO users (id, email, password_hash) VALUES ('${U}', 'mig@test.example.com', 'x')`);
  for (const [id, code] of [[A, 'BE-9001'], [B, 'BE-9002']]) {
    await db.$executeRawUnsafe(`INSERT INTO businesses (id, code, name, short_name, owner_user_id, state_code, trial_ends_on, created_by) VALUES ('${id}', '${code}', 'Shop ${code}', 'Shop', '${U}', '09', '2026-12-31', '${U}')`);
  }
  const fy = async (biz: string, label: string, start: string, end: string) => (await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO financial_years (business_id, label, start_date, end_date, created_by) VALUES ('${biz}', '${label}', '${start}', '${end}', '${U}') RETURNING id`))[0]!.id;
  const series = (biz: string, year: string, docType: string, prefix: string, next: number) => db.$executeRawUnsafe(
    `INSERT INTO document_series (business_id, financial_year_id, doc_type, prefix, next_number, created_by) VALUES ('${biz}', '${year}', '${docType}', '${prefix}', ${next}, '${U}')`);
  const a25 = await fy(A, '2025-26', '2025-04-01', '2026-03-31');
  const a26 = await fy(A, '2026-27', '2026-04-01', '2027-03-31');
  const b26 = await fy(B, '2026-27', '2026-04-01', '2027-03-31');
  // the owner's case: the same prefix in two financial years, the older year with the HIGHER counter
  await series(A, a25, 'invoice', 'INV-', 57);
  await series(A, a26, 'invoice', 'INV-', 12);
  await series(A, a25, 'quotation', 'Q-', 150);
  await series(A, a26, 'quotation', 'Q-', 101);
  // a prefix used only in the older year stays, not active
  await series(A, a25, 'receipt', 'OLD/PI/', 40);
  await series(A, a26, 'receipt', 'PI-', 3);
  await series(A, a26, 'challan', 'DC-', 9);
  await series(B, b26, 'invoice', 'INV-', 5);
  for (const t of T) await db.$executeRawUnsafe(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);

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

const rows = async (biz: string) => {
  await db.$executeRawUnsafe('ALTER TABLE document_series NO FORCE ROW LEVEL SECURITY');
  const r = await db.$queryRawUnsafe<{ doc_type: string; prefix: string; next_number: number; active: boolean }[]>(
    `SELECT doc_type, prefix, next_number, active FROM document_series WHERE business_id = '${biz}' ORDER BY doc_type, prefix`);
  await db.$executeRawUnsafe('ALTER TABLE document_series FORCE ROW LEVEL SECURITY');
  return r.map((x) => `${x.doc_type} ${x.prefix} ${x.next_number}${x.active ? ' active' : ''}`);
};

describe('numbering rows of two financial years', () => {
  it('the same prefix and type in two years becomes one active row with the HIGHEST counter', async () => {
    expect(await rows(A)).toEqual([
      'challan DC- 9 active',
      'invoice INV- 57 active',
      'quotation Q- 150 active',
      'receipt OLD/PI/ 40',
      'receipt PI- 3 active',
    ]);
  });

  it('another business is not touched', async () => {
    expect(await rows(B)).toEqual(['invoice INV- 5 active']);
  });

  it('allows only one active prefix per type, and each prefix once', async () => {
    await db.$executeRawUnsafe('ALTER TABLE document_series NO FORCE ROW LEVEL SECURITY');
    try {
      await expect(db.$executeRawUnsafe(`INSERT INTO document_series (business_id, doc_type, prefix, next_number, active, created_by) VALUES ('${A}', 'invoice', 'NEW-', 1, true, '${U}')`)).rejects.toThrow(/Key \(business_id, doc_type\)=.* already exists/);
      await expect(db.$executeRawUnsafe(`INSERT INTO document_series (business_id, doc_type, prefix, next_number, created_by) VALUES ('${A}', 'invoice', 'INV-', 1, '${U}')`)).rejects.toThrow(/Key \(business_id, doc_type, prefix\)=.* already exists/);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE document_series FORCE ROW LEVEL SECURITY');
    }
  });

  it('keeps row-level security forced', async () => {
    const r = await db.$queryRawUnsafe<{ relname: string; relforcerowsecurity: boolean }[]>(`SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('document_series', 'financial_years', 'change_log') ORDER BY relname`);
    expect(r.every((x) => x.relforcerowsecurity)).toBe(true);
  });
});

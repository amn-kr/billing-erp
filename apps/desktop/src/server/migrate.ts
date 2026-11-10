/**
 * Single-PC mode: the database's setup and upgrades, the same migrations as the live server
 * (apps/api/prisma/migrations), recorded in Prisma's own table (_prisma_migrations), so the books
 * look the same as on the server and could be read by Prisma's tools.
 * Each migration runs in one transaction: it applies fully or not at all.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface Migration { name: string; sql: string; checksum: string }
export interface Applied { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }

/** The migrations in a folder, oldest first (folders named <timestamp>_<name>, each with migration.sql). */
export function readMigrations(dir: string): Migration[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Which migrations still need to run. Stops with a plain message if the database is in a state an
 * upgrade must not touch: a migration that started and never finished, one that was changed after it
 * ran, or a database newer than this copy of the app.
 */
export function pending(all: Migration[], applied: Applied[]): Migration[] {
  const done = new Map(applied.filter((a) => !a.rolled_back_at).map((a) => [a.migration_name, a]));
  const half = applied.find((a) => !a.finished_at && !a.rolled_back_at);
  if (half) throw new Error(`An earlier upgrade of the books stopped half-way (${half.migration_name}). Restore the copy made before it.`);
  for (const m of all) {
    const a = done.get(m.name);
    if (a && a.checksum !== m.checksum) throw new Error(`The upgrade ${m.name} differs from the one already applied to these books.`);
  }
  const known = new Set(all.map((m) => m.name));
  const newer = [...done.keys()].filter((n) => !known.has(n));
  if (newer.length) throw new Error(`These books were opened by a newer version of the app (${newer[0]}). Install the newest version.`);
  return all.filter((m) => !done.has(m.name));
}

const TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * First start and every start after: the app's role (erp_app, which row-level security applies to) with
 * its password, the books' database, then any migrations not yet applied. Connects as the superuser.
 */
export async function prepare(o: { port: number; adminPassword: string; appPassword: string; database: string; migrations: Migration[] }): Promise<string[]> {
  const conn = (database: string) => new pg.Client({ host: '127.0.0.1', port: o.port, user: 'postgres', password: o.adminPassword, database });

  const admin = conn('postgres');
  await admin.connect();
  try {
    const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'erp_app'`);
    await admin.query(`${role.rowCount ? 'ALTER' : 'CREATE'} ROLE erp_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${lit(o.appPassword)}`);
    const db = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [o.database]);
    if (!db.rowCount) await admin.query(`CREATE DATABASE ${q(o.database)} ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await admin.end();
  }

  const c = conn(o.database);
  await c.connect();
  const ran: string[] = [];
  try {
    await c.query(TABLE);
    const applied = (await c.query<Applied>('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"')).rows;
    for (const m of pending(o.migrations, applied)) {
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)', [crypto.randomUUID(), m.checksum, m.name]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`Upgrading the books failed at ${m.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      ran.push(m.name);
    }
  } finally {
    await c.end();
  }
  return ran;
}

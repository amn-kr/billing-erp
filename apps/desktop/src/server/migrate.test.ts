import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pending, readMigrations, type Applied, type Migration } from './migrate';

const m = (name: string, sql = `-- ${name}`): Migration => ({ name, sql, checksum: `sum-${sql}` });
const a = (x: Migration, over: Partial<Applied> = {}): Applied => ({ migration_name: x.name, checksum: x.checksum, finished_at: new Date(), rolled_back_at: null, ...over });

describe('pending', () => {
  const [one, two, three] = [m('20261001_init'), m('20261002_items'), m('20261003_sales')];

  it('a new database gets every migration, oldest first', () => {
    expect(pending([one!, two!, three!], []).map((x) => x.name)).toEqual(['20261001_init', '20261002_items', '20261003_sales']);
  });

  it('an app update applies only the new ones', () => {
    expect(pending([one!, two!, three!], [a(one!), a(two!)]).map((x) => x.name)).toEqual(['20261003_sales']);
    expect(pending([one!, two!], [a(one!), a(two!)])).toEqual([]);
  });

  it('a migration rolled back earlier runs again', () => {
    expect(pending([one!, two!], [a(one!), a(two!, { rolled_back_at: new Date() })]).map((x) => x.name)).toEqual(['20261002_items']);
  });

  it('stops when an earlier upgrade stopped half-way', () => {
    expect(() => pending([one!, two!], [a(one!), a(two!, { finished_at: null })])).toThrow(/stopped half-way \(20261002_items\)/);
  });

  it('stops when an applied migration was changed afterwards', () => {
    expect(() => pending([one!, m('20261002_items', '-- changed')], [a(one!), a(two!)])).toThrow(/20261002_items differs/);
  });

  it('stops when the books were opened by a newer app', () => {
    expect(() => pending([one!], [a(one!), a(two!)])).toThrow(/newer version of the app/);
  });
});

describe('readMigrations', () => {
  it('reads <timestamp>_<name>/migration.sql folders in order, with a sha256 checksum', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const [n, sql] of [['20261002_b', 'SELECT 2;'], ['20261001_a', 'SELECT 1;']] as const) {
      fs.mkdirSync(path.join(dir, n));
      fs.writeFileSync(path.join(dir, n, 'migration.sql'), sql);
    }
    fs.writeFileSync(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
    const r = readMigrations(dir);
    expect(r.map((x) => x.name)).toEqual(['20261001_a', '20261002_b']);
    expect(r[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads the app’s own migrations (apps/api/prisma/migrations)', () => {
    const dir = path.join(__dirname, '..', '..', '..', 'api', 'prisma', 'migrations');
    const all = readMigrations(dir);
    expect(all.length).toBeGreaterThan(30);
    expect(all.every((x) => /^[0-9a-f]{64}$/.test(x.checksum))).toBe(true);
  });
});

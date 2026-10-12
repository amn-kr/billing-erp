/**
 * Which tables a backup holds, read from the database itself so a new shop table is backed up
 * without anyone remembering to list it here (an API test checks it also has the change trigger).
 */
import type { Tx } from '../../common/db.service';

/** Not backed up: sign-in sessions, invitations (sent again if needed) and the backup's own tables. */
export const NOT_BACKED_UP = ['sessions', 'invites', 'change_log', 'backup_destinations', 'backup_files'] as const;
/**
 * Backed up but not put back by a restore: who may open the books and what was paid for belong to
 * the account, not to the books. The owner is added to restored books; staff are invited again.
 */
export const NOT_RESTORED = ['memberships', 'subscriptions', 'subscription_payments'] as const;

export interface TableInfo {
  name: string;
  /** the column naming the shop: business_id, or id on businesses itself */
  shopCol: string;
  pk: string[];
  columns: string[];
  /** tables this one points at (foreign keys), within the backed-up set */
  deps: string[];
}

/** The backed-up tables, parents before children (the order rows can be inserted in). */
export async function shopTables(tx: Tx): Promise<TableInfo[]> {
  const rows = await tx.$queryRawUnsafe<{ name: string; columns: string[]; pk: string[] | null; deps: string[] | null }[]>(`
    SELECT c.relname AS name,
      ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
      ARRAY(SELECT a.attname::text FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            WHERE i.indrelid = c.oid AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)) AS pk,
      ARRAY(SELECT DISTINCT f.confrelid::regclass::text FROM pg_constraint f WHERE f.conrelid = c.oid AND f.contype = 'f' AND f.confrelid <> c.oid) AS deps
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND (c.relname = 'businesses' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped))
      AND c.relname <> ALL ($1::text[])`, [...NOT_BACKED_UP]);
  const names = new Set(rows.map((r) => r.name));
  const all = rows.map((r) => ({
    name: r.name,
    shopCol: r.name === 'businesses' ? 'id' : 'business_id',
    pk: r.pk ?? [],
    columns: r.columns,
    deps: (r.deps ?? []).filter((d) => names.has(d)),
  }));
  // parents first (Kahn's algorithm); ties in name order so the order is always the same
  const out: TableInfo[] = [];
  const done = new Set<string>();
  let left = all.sort((a, b) => a.name.localeCompare(b.name));
  while (left.length) {
    const ready = left.filter((t) => t.deps.every((d) => done.has(d)));
    if (!ready.length) throw new Error('Circular links between tables: ' + left.map((t) => t.name).join(', '));
    for (const t of ready) { out.push(t); done.add(t.name); }
    left = left.filter((t) => !done.has(t.name));
  }
  return out;
}

/** "a","b" — table and column names come from the database catalogue, quoted anyway. */
export const q = (name: string) => '"' + name.replace(/"/g, '""') + '"';

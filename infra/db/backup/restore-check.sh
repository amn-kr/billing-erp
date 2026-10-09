#!/usr/bin/env bash
# Restore test: decrypt a backup, restore it into an EMPTY throwaway database and check it.
#   RESTORE_DATABASE_URL  a superuser connection to an empty database (never the live one)
#   BACKUP_PASSPHRASE     the passphrase the backup was locked with
#   $1                    the .dump.gpg file
# Checks: the restore runs without errors, the migrations and shop tables are all there, row-level
# security is still switched on, and shop-by-shop no shop can see another shop's rows.
set -euo pipefail
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL}" "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
src="${1:?pass the .dump.gpg file}"
here="$(cd "$(dirname "$0")" && pwd)"
PG="${PG_BIN:-}"
case "$RESTORE_DATABASE_URL" in *neon.tech*) echo "::error::Refusing to restore into a Neon database: use a throwaway one." >&2; exit 1;; esac

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --decrypt --output "$tmp/db.dump" "$src"

# the API's role must exist for the restored grants and the isolation check
$PG psql "$RESTORE_DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN CREATE ROLE erp_app NOLOGIN; END IF; END \$\$;"
$PG pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --exit-on-error < "$tmp/db.dump"

$PG psql "$RESTORE_DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE m int; t int; f int; last text;
BEGIN
  SELECT count(*), max(migration_name) INTO m, last FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity) INTO t, f
  FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind = 'r'
    AND c.relname <> 'sessions'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped);
  IF m = 0 THEN RAISE EXCEPTION 'No finished migrations in the restored copy.'; END IF;
  IF t < 20 THEN RAISE EXCEPTION 'Only % shop tables restored.', t; END IF;
  IF f <> t THEN RAISE EXCEPTION '% of % shop tables lost row-level security in the restore.', t - f, t; END IF;
  RAISE NOTICE 'Restored: % migrations (latest %), % shop tables, all with row-level security.', m, last, t;
END $$;
SELECT 'Rows: ' || (SELECT count(*) FROM businesses) || ' shops, ' || (SELECT count(*) FROM parties) || ' parties, ' || (SELECT count(*) FROM items) || ' items, ' || (SELECT count(*) FROM sales_documents) || ' sales documents, ' || (SELECT count(*) FROM journal_entries) || ' journal entries';
SQL
$PG psql "$RESTORE_DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -f "$here/isolation-check.sql"
echo "Restore test passed."

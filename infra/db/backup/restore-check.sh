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

# Every role the backup's grants name must exist, or the restore stops: erp_app (the API's role, which the
# isolation check runs as) and Neon's own roles (neon_superuser, cloud_admin, neondb_owner). They are read
# from the backup's grant entries and created as plain NOLOGIN roles with no special powers, so the
# grants restore exactly as on Neon and erp_app gets nothing it doesn't have there.
$PG pg_restore --list "$tmp/db.dump" | grep -E '^[0-9]+;.* (ACL|DEFAULT ACL) ' > "$tmp/acl.list" || true
$PG pg_restore --no-owner --use-list="$tmp/acl.list" --file="$tmp/acl.sql" "$tmp/db.dump"
roles="$( { echo erp_app; grep -v '^--' "$tmp/acl.sql" | grep -oE '\b(FOR ROLE|TO|FROM|BY) "?[A-Za-z_][A-Za-z0-9_$]*"?' | awk '{print $NF}' | tr -d '"'; } | grep -vix public | sort -u)"
for r in $roles; do
  $PG psql "$RESTORE_DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -v r="$r" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS', :'r') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r')
\gexec
SQL
done
echo "Roles for the restored grants: $(echo $roles | tr ' ' ',')"
# erp_app must stay an ordinary role, or the isolation check below would prove nothing
$PG psql "$RESTORE_DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'erp_app can bypass row-level security in the throwaway database.'; END IF; END \$\$;"
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

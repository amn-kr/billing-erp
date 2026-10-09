#!/usr/bin/env bash
# Daily backup of the live database: a full pg_dump, encrypted with a passphrase.
#   BACKUP_DATABASE_URL  the Neon owner connection (neondb_owner: it can read every shop's rows)
#   BACKUP_PASSPHRASE    the passphrase the file is locked with (keep a copy somewhere safe!)
#   $1                   output folder (default: ./backup-out)
# Writes  billing-erp-YYYY-MM-DD-HHMM.dump.gpg  and prints its size and table / row counts only.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}" "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
out="${1:-backup-out}"
mkdir -p "$out"
PG="${PG_BIN:-}"   # e.g. "docker run --rm --network host postgres:16 " to use a matching client

# Row-level security is forced on every shop table, so only a role that may bypass it sees all rows.
bypass=$($PG psql "$BACKUP_DATABASE_URL" -tAX -c "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user")
if [ "$bypass" != "t" ]; then
  echo "::error::The backup role cannot bypass row-level security, so the backup would miss shop data. Use the Neon owner role (neondb_owner)." >&2
  exit 1
fi

stamp=$(TZ=Asia/Kolkata date +%Y-%m-%d-%H%M)
file="$out/billing-erp-$stamp.dump"
# custom format (compressed); owners and grants are restored by the restore script
$PG pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner > "$file"
# a backup that cannot be read back, or holds no tables, is no backup
tables=$(pg_restore --list "$file" | grep -c ' TABLE DATA ' || true)
if [ "$tables" -lt 20 ]; then
  echo "::error::The backup holds data for only $tables tables: something went wrong." >&2
  exit 1
fi
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 --output "$file.gpg" "$file"
rm -f "$file"

rows=$($PG psql "$BACKUP_DATABASE_URL" -tAX -c "SELECT count(*) || ' shops, ' || (SELECT count(*) FROM sales_documents) || ' sales documents, ' || (SELECT count(*) FROM journal_entries) || ' journal entries' FROM businesses")
echo "Backup written: $(basename "$file.gpg") ($(du -h "$file.gpg" | cut -f1), $tables tables) — $rows"
echo "file=$file.gpg" >> "${GITHUB_OUTPUT:-/dev/null}"

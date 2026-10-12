-- Real-time backup, part 1: the change list.
--
-- Every insert, update or delete of a shop's row is copied into change_log by a trigger, in the
-- same transaction as the save itself, so a saved change can never be missing from the list.
-- The packer later numbers each shop's committed changes 1, 2, 3 … (seq) in commit order, sends the changes
-- after a destination's bookmark (backup_destinations.cursor_seq) and moves the bookmark only once
-- the destination has confirmed the file (backup_files).
--
-- change_log has forced row-level security like every shop table. A data migration that writes
-- shop rows without a shop context must lift FORCE on change_log too (as it already does for the
-- tables it fills), or the trigger's insert is refused.

CREATE TABLE "change_log" (
    "id" BIGSERIAL NOT NULL,
    "business_id" UUID NOT NULL,
    -- the shop's change number, 1, 2, 3 … given by the packer in commit order; NULL until then
    "seq" BIGINT,
    "tbl" TEXT NOT NULL,
    "op" CHAR(1) NOT NULL,
    -- the whole row after the change (before it, for a delete)
    "data" JSONB NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "change_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "change_log_op" CHECK (op IN ('I', 'U', 'D'))
);
CREATE INDEX change_log_unsealed ON change_log (business_id, id) WHERE seq IS NULL;
CREATE UNIQUE INDEX change_log_business_seq ON change_log (business_id, seq);

CREATE TABLE "backup_destinations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    -- drive | local
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    -- the last change number this destination has confirmed
    "cursor_seq" BIGINT NOT NULL DEFAULT 0,
    "last_ok_at" TIMESTAMPTZ(6),
    "failing_since" TIMESTAMPTZ(6),
    "last_error" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_try_at" TIMESTAMPTZ(6),
    "last_snapshot_at" TIMESTAMPTZ(6),
    -- while one server is sending to this destination, others leave it alone
    "lease_until" TIMESTAMPTZ(6),
    -- folder name, account shown on screen; never a token in clear text
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_destinations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_destinations_kind" CHECK (kind IN ('drive', 'local'))
);
CREATE UNIQUE INDEX "backup_destinations_business_id_kind_key" ON "backup_destinations"("business_id", "kind");
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "backup_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    -- changes | snapshot
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- changes: the numbers after after_seq up to to_seq; snapshot: the books as of to_seq
    "after_seq" BIGINT NOT NULL,
    "to_seq" BIGINT NOT NULL,
    "changes" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    -- the destination's own id for the file (e.g. a Drive file id)
    "ref" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_files_kind" CHECK (kind IN ('changes', 'snapshot'))
);
CREATE INDEX "backup_files_destination_id_kind_to_seq_idx" ON "backup_files"("destination_id", "kind", "to_seq");
ALTER TABLE "backup_files" ADD CONSTRAINT "backup_files_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "backup_files" ADD CONSTRAINT "backup_files_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── row-level security: only the current shop (the backup worker may list which shops have destinations)
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_log FORCE ROW LEVEL SECURITY;
CREATE POLICY change_log_tenant ON change_log USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
ALTER TABLE backup_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_destinations FORCE ROW LEVEL SECURITY;
CREATE POLICY backup_destinations_tenant ON backup_destinations USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
CREATE POLICY backup_destinations_worker ON backup_destinations FOR SELECT USING (current_setting('app.worker', true) = 'backup');
ALTER TABLE backup_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_files FORCE ROW LEVEL SECURITY;
CREATE POLICY backup_files_tenant ON backup_files USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

GRANT SELECT, INSERT, UPDATE ON change_log, backup_destinations, backup_files TO erp_app;
GRANT USAGE ON SEQUENCE change_log_id_seq TO erp_app;

-- ── the trigger: TG_ARGV[0] names the column holding the shop (business_id, or id on businesses)
CREATE FUNCTION log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  b uuid := (r ->> TG_ARGV[0])::uuid;
BEGIN
  -- system rows (no shop) and updates that changed nothing are not backed up
  IF b IS NULL OR (TG_OP = 'UPDATE' AND to_jsonb(OLD) = r) THEN
    RETURN NULL;
  END IF;
  INSERT INTO change_log (business_id, tbl, op, data) VALUES (b, TG_TABLE_NAME, left(TG_OP, 1), r);
  RETURN NULL;
END $$;

-- every shop table except sign-in sessions, invitations and the backup's own tables
-- (an API test checks that every new shop table gets this trigger too)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
      AND c.relname NOT IN ('sessions', 'invites', 'change_log', 'backup_destinations', 'backup_files')
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_change(%L)', t || '_backup', t, 'business_id');
  END LOOP;
END $$;
CREATE TRIGGER businesses_backup AFTER INSERT OR UPDATE OR DELETE ON businesses FOR EACH ROW EXECUTE FUNCTION log_change('id');

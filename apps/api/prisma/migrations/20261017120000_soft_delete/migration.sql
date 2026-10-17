-- Delete for saved sales documents and payments received. Delete never erases a row: it undoes the
-- document's effects the way Cancel does (so cancelled_at is set too and every total leaves it out),
-- then marks it deleted so the normal lists hide it. The row stays in the database and in backups.
-- Additive only: new columns with empty defaults, no existing row or column changes. The tables
-- already have row-level security on business_id, the app role's grants (no DELETE) and the
-- backup change trigger, which copies whole rows, so nothing else is needed.
ALTER TABLE "sales_documents" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
                              ADD COLUMN "deleted_by" UUID,
                              ADD COLUMN "delete_reason" TEXT NOT NULL DEFAULT '';

ALTER TABLE "payments" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
                       ADD COLUMN "deleted_by" UUID,
                       ADD COLUMN "delete_reason" TEXT NOT NULL DEFAULT '';

-- To undo: ALTER TABLE ... DROP COLUMN deleted_at, DROP COLUMN deleted_by, DROP COLUMN delete_reason;
-- (only the "deleted" marks are lost; those documents then show as cancelled)

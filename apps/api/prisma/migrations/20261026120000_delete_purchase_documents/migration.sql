-- Delete for purchase bills and debit notes, the same way as sales documents (20261017120000_soft_delete):
-- undone like Cancel (cancelled_at is set too), then marked deleted so the lists hide it. The row stays
-- in the database and in backups, and its number is never given again. Payments made already have these
-- columns (payments table). Additive only: new columns with empty defaults; row-level security, the app
-- role's grants and the backup change trigger already cover the table.
ALTER TABLE "purchase_documents" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
                                 ADD COLUMN "deleted_by" UUID,
                                 ADD COLUMN "delete_reason" TEXT NOT NULL DEFAULT '';

-- To undo: ALTER TABLE "purchase_documents" DROP COLUMN deleted_at, DROP COLUMN deleted_by, DROP COLUMN delete_reason;
-- (only the "deleted" marks are lost; those documents then show as cancelled)

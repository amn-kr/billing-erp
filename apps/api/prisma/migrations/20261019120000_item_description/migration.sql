-- Items › Bulk update items: a description for each item (owner's request, 19 Oct 2026).
-- Additive only: a new text column with an empty default; no existing row or column changes. The
-- table already has row-level security on business_id, the app role's grants and the backup change
-- trigger, which copies whole rows, so nothing else is needed. Older backups restore with ''.
ALTER TABLE "items" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

-- To undo: ALTER TABLE "items" DROP COLUMN "description"; (only the typed descriptions are lost)

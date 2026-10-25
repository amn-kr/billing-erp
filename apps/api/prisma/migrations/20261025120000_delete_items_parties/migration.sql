-- Delete for items and parties that were never used (no bill, payment or stock entry; an opening stock
-- or opening balance alone is allowed). Like documents, a delete never erases a row: the item or party
-- is made inactive (archived_at, so its name and code are free again and every list and picker leaves
-- it out) and marked deleted, which also hides it from "Show inactive". Its opening stock is put back
-- (a cancel movement) and a party's opening balance set to zero, so no total counts it.
-- Additive only: new empty columns. Row-level security, the app role's grants (no DELETE) and the
-- backup change trigger, which copies whole rows, already cover both tables.
ALTER TABLE "items" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
                    ADD COLUMN "deleted_by" UUID;

ALTER TABLE "parties" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
                      ADD COLUMN "deleted_by" UUID;

-- To undo: ALTER TABLE items DROP COLUMN deleted_at, DROP COLUMN deleted_by; (the same for parties)
-- (deleted items and parties then show under "Show inactive")

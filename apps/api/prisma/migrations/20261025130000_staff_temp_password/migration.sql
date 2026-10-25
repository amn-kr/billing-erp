-- Settings › General › Team › Reset password (owner's request, 25 Oct 2026): the shop owner gives a
-- staff member a temporary password, shown once, which must be changed at the next sign-in.
-- Additive only: two new columns on users with safe defaults; no existing row or column changes.
-- users has no business_id, so it is not in shop backups; the app role's grants already cover it.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "temp_password_expires_at" TIMESTAMPTZ(6);

-- To undo: ALTER TABLE "users" DROP COLUMN "must_change_password", DROP COLUMN "temp_password_expires_at";

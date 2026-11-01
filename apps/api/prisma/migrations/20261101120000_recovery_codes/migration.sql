-- Recovery codes (owner's request, 1 Nov 2026): ten one-time codes a person makes for their own account and
-- keeps safe; one of them lets them choose a new password on the sign-in page when they forget it.
-- Only a hash of each code is kept. "Make new codes" marks the unused old ones replaced (nothing is deleted).
-- Additive only: a new table and two new columns on users with safe defaults. Like users, it has no
-- business_id, so it is not in shop backups.
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "replaced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recovery_codes_code_hash_key" ON "recovery_codes"("code_hash");
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
GRANT SELECT, INSERT, UPDATE ON "recovery_codes" TO erp_app;

-- wrong recovery codes in a row, and the time until which codes for this account are refused
ALTER TABLE "users" ADD COLUMN "recovery_fails" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "recovery_wait_until" TIMESTAMPTZ(6);

-- To undo: DROP TABLE "recovery_codes"; ALTER TABLE "users" DROP COLUMN "recovery_fails", DROP COLUMN "recovery_wait_until";

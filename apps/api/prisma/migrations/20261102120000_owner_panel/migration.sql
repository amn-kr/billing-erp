-- Owner panel, part 1 (owner's request, 1 Nov 2026): the software owner's own accounts, sign-ins and log,
-- and a status on each shop (Suspend / Reactivate). Kept apart from shop users: none of these tables has a
-- business_id, so they are not in shop backups, and shop requests never set the panel's database setting.
-- Additive only: three new tables, one new column with a safe default, and read/change rules for the panel.

-- the software owner's accounts (one for now; made once on the setup page)
CREATE TABLE "super_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    -- wrong passwords in a row, and the time until which sign-in is refused
    "failed_tries" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

-- a signed-in panel device; the refresh token is stored only as a SHA-256 hash
CREATE TABLE "owner_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "owner_sessions_token_hash_key" ON "owner_sessions"("token_hash");
CREATE INDEX "owner_sessions_admin_id_idx" ON "owner_sessions"("admin_id");
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- everything done in or to the panel: who, when, which shop, what changed. Append-only.
CREATE TABLE "owner_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "business_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "owner_audit_log_created_at_idx" ON "owner_audit_log"("created_at");
CREATE INDEX "owner_audit_log_business_id_idx" ON "owner_audit_log"("business_id");

GRANT SELECT, INSERT, UPDATE ON "super_admins", "owner_sessions" TO erp_app;
GRANT SELECT, INSERT ON "owner_audit_log" TO erp_app;
REVOKE UPDATE, DELETE ON "owner_audit_log" FROM erp_app;

-- active | suspended. A suspended shop can't sign in; nothing of it is deleted.
ALTER TABLE "businesses" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "businesses" ADD COLUMN "suspended_at" TIMESTAMPTZ(6);
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_status_check" CHECK ("status" IN ('active', 'suspended'));

-- ── the panel's database setting: set only by the API after it checked a panel sign-in (never for shop requests)
CREATE FUNCTION app_owner_admin_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.owner_admin_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_owner_admin_id() TO erp_app;

-- The panel may read every shop's name and contact row, its members and their names, and change a shop's status.
-- It gets NO rule on invoices, parties, items, payments or any other shop table: Postgres refuses those rows.
CREATE POLICY businesses_owner_read ON businesses FOR SELECT USING (app_owner_admin_id() IS NOT NULL);
CREATE POLICY businesses_owner_update ON businesses FOR UPDATE USING (app_owner_admin_id() IS NOT NULL) WITH CHECK (app_owner_admin_id() IS NOT NULL);
CREATE POLICY memberships_owner_read ON memberships FOR SELECT USING (app_owner_admin_id() IS NOT NULL);
-- A shop's status change is copied into its real-time backup by the businesses_backup trigger: let that one
-- trigger write the shop row's change entry (nothing else; the panel can't read change_log).
CREATE POLICY change_log_owner_insert ON change_log FOR INSERT WITH CHECK (app_owner_admin_id() IS NOT NULL AND tbl = 'businesses');

-- To undo: DROP POLICY businesses_owner_read ON businesses; DROP POLICY businesses_owner_update ON businesses;
-- DROP POLICY memberships_owner_read ON memberships; DROP POLICY change_log_owner_insert ON change_log; DROP FUNCTION app_owner_admin_id();
-- ALTER TABLE businesses DROP CONSTRAINT businesses_status_check, DROP COLUMN status, DROP COLUMN suspended_at;
-- DROP TABLE owner_audit_log; DROP TABLE owner_sessions; DROP TABLE super_admins;

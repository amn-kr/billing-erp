-- Transaction passcode: asked when a saved document is changed or cancelled.
-- One row per shop, kept apart from the settings JSON so the hash never travels with them
-- (same idea as price_locks). Additive only: no existing row changes; every shop starts switched off.
CREATE TABLE "txn_passcodes" (
    "business_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "passcode_hash" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "wait_until" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "txn_passcodes_pkey" PRIMARY KEY ("business_id")
);

ALTER TABLE "txn_passcodes" ADD CONSTRAINT "txn_passcodes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security like every shop-owned table; the app role can't delete it.
ALTER TABLE txn_passcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn_passcodes FORCE ROW LEVEL SECURITY;
CREATE POLICY txn_passcodes_tenant ON txn_passcodes USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
GRANT SELECT, INSERT, UPDATE ON txn_passcodes TO erp_app;

-- Real-time backup: record its changes like every other shop table.
CREATE TRIGGER txn_passcodes_backup AFTER INSERT OR UPDATE OR DELETE ON txn_passcodes FOR EACH ROW EXECUTE FUNCTION log_change('business_id');

-- To undo: DROP TABLE txn_passcodes; (removes only the passcode; no document is touched)

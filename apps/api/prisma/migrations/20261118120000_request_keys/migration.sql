-- One-time keys against double bills (Phase 8, step 8.1b; owner, 18 Nov 2026).
-- A phone on weak internet may send the same new bill twice. Each save carries a one-time key;
-- the first one is saved, a repeat gets the first answer back. Keys are kept 7 days, then removed.
-- Additive only: a new table, no existing row changes. Not part of backups (like sign-in sessions).
CREATE TABLE "request_keys" (
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_keys_pkey" PRIMARY KEY ("business_id", "key")
);
CREATE INDEX "request_keys_business_id_created_at_idx" ON "request_keys"("business_id", "created_at");

ALTER TABLE "request_keys" ADD CONSTRAINT "request_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security like every shop-owned table.
ALTER TABLE request_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY request_keys_tenant ON request_keys USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON request_keys TO erp_app;

-- To undo: DROP TABLE request_keys; (only the keys go; no document is touched)

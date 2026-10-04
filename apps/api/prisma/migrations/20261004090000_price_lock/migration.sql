-- CreateTable
CREATE TABLE "price_locks" (
    "business_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "wait_until" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_locks_pkey" PRIMARY KEY ("business_id")
);

-- AddForeignKey
ALTER TABLE "price_locks" ADD CONSTRAINT "price_locks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security like every shop-owned table; the app role can't delete it.
ALTER TABLE price_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_locks FORCE ROW LEVEL SECURITY;
CREATE POLICY price_locks_tenant ON price_locks USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
GRANT SELECT, INSERT, UPDATE ON price_locks TO erp_app;

-- Brands & Series: notes on a brand, and series added by hand (items keep their series as text).
ALTER TABLE brands ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE "brand_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "size" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "brand_series_business_id_brand_id_idx" ON "brand_series"("business_id", "brand_id");
-- one series name per brand, ignoring capital letters
CREATE UNIQUE INDEX brand_series_name ON brand_series (business_id, brand_id, lower(name));
ALTER TABLE "brand_series" ADD CONSTRAINT "brand_series_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brand_series" ADD CONSTRAINT "brand_series_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE brand_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_series FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_series_tenant ON brand_series USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
GRANT SELECT, INSERT, UPDATE ON brand_series TO erp_app;

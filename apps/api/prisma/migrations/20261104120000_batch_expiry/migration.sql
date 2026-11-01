-- Batch and expiry (Features › batch_expiry, owner's request, 1 Nov 2026). Additive only: one new table and empty
-- columns. Existing items stay untracked and existing stock has no batch ("No batch"), so nothing changes for them.
CREATE TABLE "batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "batches_business_id_item_id_idx" ON "batches"("business_id", "item_id");
-- one batch no. per item, ignoring capital letters
CREATE UNIQUE INDEX batches_item_no ON batches (business_id, item_id, lower(batch_no));
ALTER TABLE "batches" ADD CONSTRAINT "batches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
CREATE POLICY batches_tenant ON batches USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
GRANT SELECT, INSERT, UPDATE ON batches TO erp_app;
CREATE TRIGGER batches_backup AFTER INSERT OR UPDATE OR DELETE ON batches FOR EACH ROW EXECUTE FUNCTION log_change('business_id');

ALTER TABLE "items" ADD COLUMN "track_batch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stock_movements" ADD COLUMN "batch_id" UUID;
ALTER TABLE "stock_adjustments" ADD COLUMN "batch_id" UUID;
ALTER TABLE "purchase_document_lines" ADD COLUMN "batch_id" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- To undo: drop these columns and constraints, then DROP TABLE "batches".

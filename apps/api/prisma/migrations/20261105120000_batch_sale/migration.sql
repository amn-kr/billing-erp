-- Batch and expiry, part 1b (Features › batch_expiry): which batches a sale or credit note line used, as
-- [{ batchId, qty }]. Additive only: one empty column. The stock itself stays in stock_movements (batch_id).
ALTER TABLE "sales_document_lines" ADD COLUMN "batch_alloc" JSONB;

-- To undo: ALTER TABLE "sales_document_lines" DROP COLUMN "batch_alloc";

-- MRP (Features › mrp_pack, owner's request, 2 Nov 2026): a batch's own MRP. Additive only: one empty column; a batch
-- without one uses the item's MRP.
ALTER TABLE "batches" ADD COLUMN "mrp" DECIMAL(14,2);

-- To undo: ALTER TABLE "batches" DROP COLUMN "mrp";

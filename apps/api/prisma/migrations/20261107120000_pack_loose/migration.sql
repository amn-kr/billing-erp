-- Pack and loose (Features › mrp_pack, owner's request, 2 Nov 2026). Additive only: empty columns; every existing row
-- stays as it is and means what it meant.
-- An item sold by the pack: 1 pack_unit = pack_size of its own unit, the unit its stock is counted in.
ALTER TABLE "items" ADD COLUMN "pack_unit_id" UUID;
ALTER TABLE "items" ADD COLUMN "pack_size" DECIMAL(14,3);
ALTER TABLE "items" ADD CONSTRAINT "items_pack_unit_id_fkey" FOREIGN KEY ("pack_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A line in packs keeps the pack size it was made with (none = the item's own unit).
ALTER TABLE "sales_document_lines" ADD COLUMN "pack_size" DECIMAL(14,3);
ALTER TABLE "purchase_document_lines" ADD COLUMN "pack_size" DECIMAL(14,3);
-- The exact cost of one loose unit, where the 2 decimals of "rate" would drift (none = "rate" is exact).
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost" DECIMAL(14,6);

-- To undo: DROP these five columns.

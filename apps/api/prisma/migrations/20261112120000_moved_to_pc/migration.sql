-- Bring online books to this PC (Phase 6, step 7b; owner, 12 Nov 2026): when a shop's books were taken down to
-- a "This PC only" PC, the online shop becomes view-only from then on. One new column, empty for every shop.
-- Nothing else is touched.
ALTER TABLE "businesses" ADD COLUMN "moved_to_pc_at" TIMESTAMPTZ(6);

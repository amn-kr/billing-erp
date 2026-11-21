-- Owner, 21 Nov 2026: a sale line's final rate can be any amount, also far above the
-- price-list rate. A higher rate is kept as a minus discount, so the discount % column
-- needs room for large minus numbers (it held only down to about -9,999%).
-- Widening a numeric column keeps every saved value as it is.
ALTER TABLE "sales_document_lines" ALTER COLUMN "disc_pct" TYPE DECIMAL(24,8);

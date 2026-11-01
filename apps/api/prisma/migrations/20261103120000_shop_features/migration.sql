-- Features (owner's request, 1 Nov 2026): what a shop's owner turned on in Settings › Features.
-- Additive only: one new column on the shop's settings row, empty for every shop, so every shop starts with
-- everything off. The row is already protected per shop, backed up and restored, so nothing else is needed.
ALTER TABLE "business_settings" ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- To undo: ALTER TABLE "business_settings" DROP COLUMN "features";

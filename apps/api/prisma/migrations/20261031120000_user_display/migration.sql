-- Density and text size for each person (owner's request, 31 Oct 2026): Settings › General › Display and the
-- account menu. Additive only: two text columns on users with the prototype's look as the default, so every
-- existing person keeps exactly today's screens. users is not shop data (no business_id, no backup trigger);
-- the API only ever changes the signed-in person's own row. The app role already has UPDATE on users.
ALTER TABLE "users"
  ADD COLUMN "ui_density" TEXT NOT NULL DEFAULT 'comfortable' CHECK ("ui_density" IN ('comfortable', 'compact')),
  ADD COLUMN "ui_text_size" TEXT NOT NULL DEFAULT 'normal' CHECK ("ui_text_size" IN ('small', 'normal', 'large'));

-- To undo: ALTER TABLE "users" DROP COLUMN "ui_density", DROP COLUMN "ui_text_size"; (only the choices are lost)

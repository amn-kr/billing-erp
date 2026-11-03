-- Settings › Items (owner's request, 3 Nov 2026): one page for every item switch, with labels and date formats.
-- One new column, empty for every shop. Then the two old switch words become today's boxes. No item, batch or
-- bill is touched, and a shop with neither switch on isn't touched at all.
ALTER TABLE "business_settings" ADD COLUMN "item_options" JSONB NOT NULL DEFAULT '{}';

-- every shop's row, not one shop's: row-level security would otherwise hide them from this update, and refuse
-- the change log entry each changed row writes for the real-time backup (see 20261012120000_backup_change_log)
ALTER TABLE "business_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_log" NO FORCE ROW LEVEL SECURITY;

UPDATE "business_settings"
SET "features" = array_cat(array_remove("features", 'batch_expiry'), ARRAY['batch_no', 'exp_date', 'mfg_date'])
WHERE 'batch_expiry' = ANY ("features");

UPDATE "business_settings"
SET "features" = array_cat(array_remove("features", 'mrp_pack'), ARRAY['mrp', 'pack_loose'])
WHERE 'mrp_pack' = ANY ("features");

ALTER TABLE "change_log" FORCE ROW LEVEL SECURITY;
ALTER TABLE "business_settings" FORCE ROW LEVEL SECURITY;

-- To undo: ALTER TABLE "business_settings" DROP COLUMN "item_options"; and swap the words back.

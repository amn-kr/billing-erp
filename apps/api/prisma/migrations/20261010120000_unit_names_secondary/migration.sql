-- Additive only. A unit gets a full name beside its short code (e.g. "Coil" for COIL).
-- An item may have a secondary unit and a conversion rate: 1 base unit = unit_rate secondary units
-- (e.g. 1 COIL = 90 MTR). Existing items keep one unit (both columns stay empty).
ALTER TABLE units ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN secondary_unit_id uuid REFERENCES units(id);
ALTER TABLE items ADD COLUMN unit_rate numeric(14,3);

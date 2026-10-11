-- Same link rules as items.unit_id (items_unit_id_fkey).
ALTER TABLE items DROP CONSTRAINT items_secondary_unit_id_fkey;
ALTER TABLE items ADD CONSTRAINT items_secondary_unit_id_fkey FOREIGN KEY (secondary_unit_id) REFERENCES units(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Godown and price-list names are unique per shop ignoring case (like parties and items).
DROP INDEX "godowns_business_id_name_key";
DROP INDEX "price_lists_business_id_name_key";
CREATE UNIQUE INDEX godowns_live_name ON godowns (business_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX price_lists_live_name ON price_lists (business_id, lower(name)) WHERE archived_at IS NULL;

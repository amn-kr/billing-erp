-- Settings › Transactions.
--
-- 1. Parties get a billing name (printed under Bill To instead of the party name when filled).
-- 2. Numbering no longer depends on the financial year: each shop has several prefixes per
--    document type, each with its own counter, and exactly one of them is active (used for new
--    documents). Every existing prefix is kept with its counter. When the same prefix exists in
--    more than one financial year, the rows become one row with the HIGHEST counter, so no number
--    is ever given out twice. The prefix of the latest financial year is the active one.
--
-- Undo (only while no shop has added a second prefix for a type): drop the two new indexes and
-- the "active" column, make financial_year_id required again, recreate the old unique index
-- (business_id, financial_year_id, doc_type), revoke DELETE on document_series from erp_app and
-- drop parties.billing_name. Documents are never touched by this migration or its undo.

ALTER TABLE "parties" ADD COLUMN "billing_name" TEXT NOT NULL DEFAULT '';

-- the rows below are rewritten without a shop context (see 20261012120000_backup_change_log)
-- (financial_years too: with forced row-level security its dates would be invisible here)
ALTER TABLE document_series NO FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_years NO FORCE ROW LEVEL SECURITY;
ALTER TABLE change_log NO FORCE ROW LEVEL SECURITY;

ALTER TABLE "document_series" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "document_series" ALTER COLUMN "financial_year_id" DROP NOT NULL;

-- the prefix of each type's latest financial year is the active one
UPDATE document_series SET active = true
WHERE id IN (
  SELECT DISTINCT ON (s.business_id, s.doc_type) s.id
  FROM document_series s LEFT JOIN financial_years f ON f.id = s.financial_year_id
  ORDER BY s.business_id, s.doc_type, f.start_date DESC NULLS LAST, s.created_at DESC
);

-- the same prefix in several years: keep one row with the highest counter (active if any of them was)
CREATE TEMP TABLE series_merge ON COMMIT DROP AS
SELECT business_id, doc_type, prefix, max(next_number) AS next_number, bool_or(active) AS active,
       (array_agg(id ORDER BY active DESC, next_number DESC, created_at DESC))[1] AS keep
FROM document_series
GROUP BY business_id, doc_type, prefix;

UPDATE document_series s SET next_number = m.next_number, active = m.active
FROM series_merge m WHERE s.id = m.keep AND (s.next_number <> m.next_number OR s.active <> m.active);

DELETE FROM document_series s
USING series_merge m
WHERE s.business_id = m.business_id AND s.doc_type = m.doc_type AND s.prefix = m.prefix AND s.id <> m.keep;

DROP INDEX "document_series_business_id_financial_year_id_doc_type_key";
CREATE UNIQUE INDEX "document_series_business_id_doc_type_prefix_key" ON "document_series"("business_id", "doc_type", "prefix");
-- exactly one active prefix per document type (the "at least one" half is kept by the API)
CREATE UNIQUE INDEX "document_series_one_active" ON "document_series"("business_id", "doc_type") WHERE active;

ALTER TABLE change_log FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_years FORCE ROW LEVEL SECURITY;
ALTER TABLE document_series FORCE ROW LEVEL SECURITY;

-- a prefix that no document uses yet may be deleted (Settings › Transactions); row-level security
-- still limits it to the shop's own rows. Every other table stays "never delete".
GRANT DELETE ON document_series TO erp_app;

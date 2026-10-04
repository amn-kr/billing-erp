-- CreateTable
CREATE TABLE "cash_bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sub" TEXT NOT NULL DEFAULT '',
    "account_no" TEXT NOT NULL DEFAULT '',
    "ifsc" TEXT NOT NULL DEFAULT '',
    "upi" TEXT NOT NULL DEFAULT '',
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opening_date" DATE,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "legacy_id" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "due_date" DATE,
    "mode" TEXT NOT NULL DEFAULT 'credit',
    "party_id" UUID,
    "cash_name" TEXT NOT NULL DEFAULT '',
    "cash_phone" TEXT NOT NULL DEFAULT '',
    "bill_name" TEXT NOT NULL DEFAULT '',
    "tax_mode" TEXT NOT NULL,
    "prices_incl_tax" BOOLEAN NOT NULL DEFAULT true,
    "place_of_supply" TEXT NOT NULL DEFAULT '',
    "round_off" BOOLEAN NOT NULL DEFAULT true,
    "bill_disc_pct" DECIMAL(7,3),
    "bill_disc_amt" DECIMAL(14,2),
    "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bank_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tcs_rate" DECIMAL(5,2),
    "items_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bill_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tcs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "referrer_id" UUID,
    "source_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_id" UUID,
    "name" TEXT NOT NULL,
    "hsn" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "price" DECIMAL(14,2) NOT NULL,
    "disc_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "comm_type" TEXT NOT NULL DEFAULT 'none',
    "comm_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "comm_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "against_id" UUID,

    CONSTRAINT "sales_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_ref" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "due_date" DATE,
    "party_id" UUID NOT NULL,
    "tax_mode" TEXT NOT NULL,
    "prices_incl_tax" BOOLEAN NOT NULL DEFAULT false,
    "inter_state" BOOLEAN NOT NULL DEFAULT false,
    "round_off" BOOLEAN NOT NULL DEFAULT true,
    "bill_disc_pct" DECIMAL(7,3),
    "bill_disc_amt" DECIMAL(14,2),
    "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "items_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bill_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "source_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_id" UUID,
    "name" TEXT NOT NULL,
    "hsn" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "rate" DECIMAL(14,2) NOT NULL,
    "disc_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "against_id" UUID,

    CONSTRAINT "purchase_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "party_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "account_id" UUID,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "at_sale" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "payment_id" UUID,
    "note_id" UUID,
    "sales_document_id" UUID,
    "purchase_document_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "cheque_no" TEXT NOT NULL,
    "bank" TEXT NOT NULL DEFAULT '',
    "cheque_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "party_id" UUID,
    "payment_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "account_id" UUID,
    "status_date" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "statement_balance" DECIMAL(14,2) NOT NULL,
    "cleared" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "party_id" UUID,
    "payee" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'Cash',
    "account_id" UUID,
    "reference" TEXT NOT NULL DEFAULT '',
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "category_id" UUID,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "referrer_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'Cash',
    "account_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "legacy_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "narration" TEXT NOT NULL DEFAULT '',
    "cancelled_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "party_id" UUID,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_bank_accounts_business_id_legacy_id_idx" ON "cash_bank_accounts"("business_id", "legacy_id");

-- CreateIndex
CREATE INDEX "sales_documents_business_id_kind_date_idx" ON "sales_documents"("business_id", "kind", "date");

-- CreateIndex
CREATE INDEX "sales_documents_business_id_party_id_idx" ON "sales_documents"("business_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_business_id_kind_number_key" ON "sales_documents"("business_id", "kind", "number");

-- CreateIndex
CREATE INDEX "sales_document_lines_business_id_document_id_idx" ON "sales_document_lines"("business_id", "document_id");

-- CreateIndex
CREATE INDEX "purchase_documents_business_id_kind_date_idx" ON "purchase_documents"("business_id", "kind", "date");

-- CreateIndex
CREATE INDEX "purchase_documents_business_id_party_id_idx" ON "purchase_documents"("business_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_documents_business_id_kind_number_key" ON "purchase_documents"("business_id", "kind", "number");

-- CreateIndex
CREATE INDEX "purchase_document_lines_business_id_document_id_idx" ON "purchase_document_lines"("business_id", "document_id");

-- CreateIndex
CREATE INDEX "payments_business_id_party_id_idx" ON "payments"("business_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_direction_number_key" ON "payments"("business_id", "direction", "number");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_sales_document_id_idx" ON "payment_allocations"("business_id", "sales_document_id");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_purchase_document_id_idx" ON "payment_allocations"("business_id", "purchase_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_entries_business_id_number_key" ON "bank_entries"("business_id", "number");

-- CreateIndex
CREATE INDEX "cheques_business_id_status_idx" ON "cheques"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_business_id_account_id_statement_date_key" ON "reconciliations"("business_id", "account_id", "statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_business_id_number_key" ON "expenses"("business_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "commission_payouts_business_id_number_key" ON "commission_payouts"("business_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_business_id_key_key" ON "ledger_accounts"("business_id", "key");

-- CreateIndex
CREATE INDEX "journal_entries_business_id_source_type_source_id_idx" ON "journal_entries"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_entries_business_id_date_idx" ON "journal_entries"("business_id", "date");

-- CreateIndex
CREATE INDEX "journal_lines_business_id_account_id_idx" ON "journal_lines"("business_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_lines_business_id_party_id_idx" ON "journal_lines"("business_id", "party_id");

-- AddForeignKey
ALTER TABLE "cash_bank_accounts" ADD CONSTRAINT "cash_bank_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "purchase_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── Checks ─────────
ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_kind CHECK (kind IN ('quotation', 'challan', 'invoice', 'credit_note'));
ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_kind CHECK (kind IN ('order', 'bill', 'debit_note'));
ALTER TABLE payments ADD CONSTRAINT payments_direction CHECK (direction IN ('in', 'out'));
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0);
ALTER TABLE bank_entries ADD CONSTRAINT bank_entries_kind CHECK (kind IN ('in', 'out', 'transfer'));
ALTER TABLE cheques ADD CONSTRAINT cheques_direction CHECK (direction IN ('received', 'issued'));
ALTER TABLE cheques ADD CONSTRAINT cheques_status CHECK (status IN ('pending', 'cleared', 'bounced'));
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_type CHECK (type IN ('asset', 'liability', 'income', 'expense', 'equity'));
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_one_side CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0));

-- Every journal entry must balance (debits = credits), checked when the transaction commits.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN RAISE EXCEPTION 'journal entry % does not balance (debit %, credit %)', NEW.entry_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- ───────── Row-level security: every new table belongs to one shop ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_bank_accounts','sales_documents','sales_document_lines','purchase_documents','purchase_document_lines',
    'payments','payment_allocations','bank_entries','cheques','reconciliations','expense_categories','expenses','expense_lines',
    'commission_payouts','ledger_accounts','journal_entries','journal_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id())', t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO erp_app', t);
  END LOOP;
END $$;

-- Journal lines are insert-only: a cancelled document's entry is marked cancelled, never edited.
REVOKE UPDATE ON journal_lines FROM erp_app;
-- Editing a saved document replaces its lines and allocations; those are the only deletes the app may do.
GRANT DELETE ON sales_document_lines, purchase_document_lines, expense_lines, payment_allocations TO erp_app;

-- ───────── Numbering: the prototype's prefixes ─────────
-- (the owner role is bound by FORCE RLS, so lift it for this one-off fix of every shop's rows)
ALTER TABLE document_series NO FORCE ROW LEVEL SECURITY;
UPDATE document_series SET prefix = 'Q-', next_number = greatest(next_number, 101) WHERE doc_type = 'quotation';
UPDATE document_series SET prefix = 'ORD-' WHERE doc_type = 'purchase_order';
UPDATE document_series SET prefix = 'PO-' WHERE doc_type = 'payment';
INSERT INTO document_series (business_id, financial_year_id, doc_type, prefix, next_number, created_by)
SELECT s.business_id, s.financial_year_id, n.doc_type, n.prefix, 1, s.created_by
FROM document_series s CROSS JOIN (VALUES ('bank_entry', 'BT-'), ('commission_payout', 'CP-')) AS n(doc_type, prefix)
WHERE s.doc_type = 'invoice'
ON CONFLICT DO NOTHING;
ALTER TABLE document_series FORCE ROW LEVEL SECURITY;

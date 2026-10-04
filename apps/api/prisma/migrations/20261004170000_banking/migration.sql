-- Banking: a bank account's branch, and cash deposits / withdrawals as their own kinds of entry.
ALTER TABLE cash_bank_accounts ADD COLUMN branch TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_entries DROP CONSTRAINT bank_entries_kind;
ALTER TABLE bank_entries ADD CONSTRAINT bank_entries_kind CHECK (kind IN ('in', 'out', 'transfer', 'deposit', 'withdraw'));

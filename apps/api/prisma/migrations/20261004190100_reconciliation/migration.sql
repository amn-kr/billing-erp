-- A reconciliation can be saved before the statement's closing balance is typed in.
ALTER TABLE reconciliations ALTER COLUMN statement_balance DROP NOT NULL;

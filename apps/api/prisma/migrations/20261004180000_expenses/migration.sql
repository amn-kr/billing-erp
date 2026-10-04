-- Expenses: each line keeps its quantity and rate (prototype xpLines), and a cheque can belong to an expense.
ALTER TABLE expense_lines ADD COLUMN qty NUMERIC(14,3) NOT NULL DEFAULT 1;
ALTER TABLE expense_lines ADD COLUMN rate NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE cheques ADD COLUMN expense_id UUID;

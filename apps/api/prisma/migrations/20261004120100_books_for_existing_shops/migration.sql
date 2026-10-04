-- Shops made before Phase 3 get the books a new shop starts with: Cash in hand, expense categories, ledger accounts.
-- (the owner role is bound by FORCE RLS, so lift it for this one-off fill of every shop)
ALTER TABLE businesses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE business_settings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_bank_accounts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts NO FORCE ROW LEVEL SECURITY;

INSERT INTO cash_bank_accounts (business_id, kind, name, sub, is_default, opening_balance, opening_date, created_by)
SELECT b.id, 'cash', 'Cash in hand', 'Shop counter', true, coalesce(nullif(s.data->>'cashOpen', '')::numeric, 0), (now() AT TIME ZONE 'Asia/Kolkata')::date, b.created_by
FROM businesses b LEFT JOIN business_settings s ON s.business_id = b.id
WHERE NOT EXISTS (SELECT 1 FROM cash_bank_accounts c WHERE c.business_id = b.id);

INSERT INTO expense_categories (business_id, name, created_at, created_by)
SELECT b.id, n.name, now() + n.k * interval '1 millisecond', b.created_by
FROM businesses b CROSS JOIN (VALUES ('Rent', 0), ('Salary & wages', 1), ('Electricity', 2), ('Telephone & internet', 3), ('Transport & freight', 4), ('Petrol & travel', 5), ('Tea & refreshments', 6), ('Packing material', 7), ('Shop maintenance', 8), ('Repairs', 9), ('Office & stationery', 10), ('Advertising', 11), ('Professional fees', 12), ('Bank charges', 13), ('Shop expenses', 14), ('Other', 15)) AS n(name, k)
WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.business_id = b.id);

INSERT INTO ledger_accounts (business_id, key, name, type, created_by)
SELECT b.id, a.key, a.name, a.type, b.created_by
FROM businesses b CROSS JOIN (VALUES
  ('receivable', 'Sundry debtors (customers)', 'asset'),
  ('payable', 'Sundry creditors (suppliers)', 'liability'),
  ('cheques_in_hand', 'Cheques in hand', 'asset'),
  ('cheques_issued', 'Cheques issued (not cleared)', 'liability'),
  ('sales', 'Sales', 'income'),
  ('sales_returns', 'Sales returns', 'income'),
  ('charges_income', 'Transport, labour & bank charges collected', 'income'),
  ('purchases', 'Purchases', 'expense'),
  ('purchase_returns', 'Purchase returns', 'expense'),
  ('charges_expense', 'Transport & labour on purchases', 'expense'),
  ('output_cgst', 'Output CGST', 'liability'),
  ('output_sgst', 'Output SGST', 'liability'),
  ('output_igst', 'Output IGST', 'liability'),
  ('input_cgst', 'Input CGST', 'asset'),
  ('input_sgst', 'Input SGST', 'asset'),
  ('input_igst', 'Input IGST', 'asset'),
  ('tcs_payable', 'TCS collected', 'liability'),
  ('round_off', 'Round off', 'expense'),
  ('expenses', 'Shop expenses', 'expense'),
  ('commission', 'Referral commission', 'expense'),
  ('commission_payable', 'Commission payable', 'liability'),
  ('opening', 'Opening balances', 'equity')) AS a(key, name, type)
ON CONFLICT DO NOTHING;

ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE business_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_bank_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;

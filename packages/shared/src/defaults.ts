/**
 * What a new shop starts with — the same defaults the prototype gives a shop
 * after "Start fresh" (reference/design/app.html: GROUPS, UNITS, CATS, S.taxes,
 * PLS, CRULES, ECATS). Sample data never goes here (that is the demo seed).
 */
export const DEFAULT_PARTY_GROUPS = ['General', 'Retail customers', 'Wholesale customers', 'Contractors', 'Suppliers', 'Electricians'] as const;

export const DEFAULT_UNITS = ['PCS', 'BOX', 'KG', 'MTR', 'COIL', 'BAG', 'LTR', 'NOS', 'SET', 'PAIR'] as const;

export const DEFAULT_CATEGORIES = ['Hardware', 'Wires & cables', 'Lighting', 'Switches & MCBs', 'Fans', 'Pipes & fittings', 'Paints & putty', 'Accessories', 'Services'] as const;

export interface DefaultTax {
  legacyId: string;
  kind: 'GST' | 'TCS' | 'TDS';
  rate: string;
  name: string;
  note: string;
  old?: boolean;
}

export const DEFAULT_TAXES: readonly DefaultTax[] = [
  { legacyId: 'g0', kind: 'GST', rate: '0', name: 'GST 0%', note: 'Nil-rated and exempt goods' },
  { legacyId: 'g025', kind: 'GST', rate: '0.25', name: 'GST 0.25%', note: 'Rough precious stones' },
  { legacyId: 'g3', kind: 'GST', rate: '3', name: 'GST 3%', note: 'Gold, silver, jewellery' },
  { legacyId: 'g5', kind: 'GST', rate: '5', name: 'GST 5%', note: 'Essentials and some services' },
  { legacyId: 'g12', kind: 'GST', rate: '12', name: 'GST 12%', note: 'Older slab, kept for earlier bills', old: true },
  { legacyId: 'g18', kind: 'GST', rate: '18', name: 'GST 18%', note: 'Standard rate' },
  { legacyId: 'g28', kind: 'GST', rate: '28', name: 'GST 28%', note: 'Older slab, kept for earlier bills', old: true },
  { legacyId: 'g40', kind: 'GST', rate: '40', name: 'GST 40%', note: 'Luxury and sin goods' },
  { legacyId: 'tcs1', kind: 'TCS', rate: '1', name: 'TCS 1%', note: 'Scrap · section 206C(1)' },
  { legacyId: 't194c1', kind: 'TDS', rate: '1', name: '194C · 1%', note: 'Contractor, individual or HUF' },
  { legacyId: 't194c2', kind: 'TDS', rate: '2', name: '194C · 2%', note: 'Contractor, company or firm' },
  { legacyId: 't194j10', kind: 'TDS', rate: '10', name: '194J · 10%', note: 'Professional fees' },
  { legacyId: 't194j2', kind: 'TDS', rate: '2', name: '194J · 2%', note: 'Technical services' },
  { legacyId: 't194h', kind: 'TDS', rate: '2', name: '194H · 2%', note: 'Commission or brokerage' },
  { legacyId: 't194i', kind: 'TDS', rate: '10', name: '194I · 10%', note: 'Rent of land or building' },
  { legacyId: 't194q', kind: 'TDS', rate: '0.1', name: '194Q · 0.1%', note: 'Purchase of goods above ₹50 lakh a year' },
];

export interface DefaultPriceList {
  legacyId: string;
  name: string;
  isDefault: boolean;
  rule: 'base' | 'disc' | 'mark';
  value: string;
  roundTo: string;
  groups: readonly string[];
  active: boolean;
}

export const DEFAULT_PRICE_LISTS: readonly DefaultPriceList[] = [
  { legacyId: 'pl1', name: 'Retail price', isDefault: true, rule: 'base', value: '0', roundTo: '0', groups: ['Retail customers', 'General'], active: true },
  { legacyId: 'pl2', name: 'Wholesale', isDefault: false, rule: 'disc', value: '8', roundTo: '1', groups: ['Wholesale customers'], active: true },
  { legacyId: 'pl3', name: 'Contractor rate', isDefault: false, rule: 'disc', value: '5', roundTo: '5', groups: ['Contractors'], active: false },
  { legacyId: 'pl4', name: 'Bulk project (cost plus)', isDefault: false, rule: 'mark', value: '12', roundTo: '10', groups: [], active: false },
];

/** Commission per category (prototype CRULES: t = n none / p percent / f fixed). */
export const DEFAULT_COMMISSION: Readonly<Record<string, { kind: 'none' | 'percent' | 'fixed'; value: string }>> = {
  'Wires & cables': { kind: 'none', value: '0' },
  'Pipes & fittings': { kind: 'none', value: '0' },
  Services: { kind: 'none', value: '0' },
  'Switches & MCBs': { kind: 'percent', value: '10' },
  Lighting: { kind: 'percent', value: '10' },
  Fans: { kind: 'percent', value: '8' },
  Accessories: { kind: 'percent', value: '10' },
  'Paints & putty': { kind: 'percent', value: '5' },
  Hardware: { kind: 'percent', value: '5' },
};

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Salary & wages', 'Electricity', 'Telephone & internet', 'Transport & freight', 'Petrol & travel', 'Tea & refreshments',
  'Packing material', 'Shop maintenance', 'Repairs', 'Office & stationery', 'Advertising', 'Professional fees', 'Bank charges', 'Shop expenses', 'Other',
] as const;

/**
 * The books behind every document. Each sale, bill, payment and expense is
 * written as a balanced journal entry against these accounts. Cash and bank
 * accounts get their own ledger account each (key "cb:<id>").
 */
export const LEDGER_ACCOUNTS: ReadonlyArray<{ key: string; name: string; type: 'asset' | 'liability' | 'income' | 'expense' | 'equity' }> = [
  { key: 'receivable', name: 'Sundry debtors (customers)', type: 'asset' },
  { key: 'payable', name: 'Sundry creditors (suppliers)', type: 'liability' },
  { key: 'cheques_in_hand', name: 'Cheques in hand', type: 'asset' },
  { key: 'cheques_issued', name: 'Cheques issued (not cleared)', type: 'liability' },
  { key: 'sales', name: 'Sales', type: 'income' },
  { key: 'sales_returns', name: 'Sales returns', type: 'income' },
  { key: 'charges_income', name: 'Transport, labour & bank charges collected', type: 'income' },
  { key: 'purchases', name: 'Purchases', type: 'expense' },
  { key: 'purchase_returns', name: 'Purchase returns', type: 'expense' },
  { key: 'charges_expense', name: 'Transport & labour on purchases', type: 'expense' },
  { key: 'output_cgst', name: 'Output CGST', type: 'liability' },
  { key: 'output_sgst', name: 'Output SGST', type: 'liability' },
  { key: 'output_igst', name: 'Output IGST', type: 'liability' },
  { key: 'input_cgst', name: 'Input CGST', type: 'asset' },
  { key: 'input_sgst', name: 'Input SGST', type: 'asset' },
  { key: 'input_igst', name: 'Input IGST', type: 'asset' },
  { key: 'tcs_payable', name: 'TCS collected', type: 'liability' },
  { key: 'round_off', name: 'Round off', type: 'expense' },
  { key: 'expenses', name: 'Shop expenses', type: 'expense' },
  { key: 'commission', name: 'Referral commission', type: 'expense' },
  { key: 'commission_payable', name: 'Commission payable', type: 'liability' },
  { key: 'opening', name: 'Opening balances', type: 'equity' },
  { key: 'other_income', name: 'Interest & other income', type: 'income' },
  { key: 'capital', name: 'Owner’s capital', type: 'equity' },
  { key: 'drawings', name: 'Owner’s drawings', type: 'equity' },
  { key: 'loans', name: 'Loans', type: 'liability' },
  { key: 'bank_charges', name: 'Bank charges', type: 'expense' },
  { key: 'cash_difference', name: 'Cash short / excess', type: 'expense' },
];

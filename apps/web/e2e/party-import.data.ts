/**
 * Parties › Import Parties: the party the shop already has (for the duplicate rows) and the prepared
 * file — good rows, a wrong GSTIN, a "Both" party type, an amount with 3 decimals, a party the shop
 * already has, and the same party twice. The same rows, tab-separated, are pasted into Bulk entry.
 * All names, phones and GSTINs are made up (the GSTINs have a correct check digit unless marked).
 */
import type { APIRequestContext } from '@playwright/test';
import { APP } from './setup';

export async function partyShop(request: APIRequestContext, who: { email: string; password: string }): Promise<void> {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const r = await request.post(APP + '/api/parties', { headers, data: { name: 'Mehta Electricals', phone: '9876543210' } });
  if (!r.ok()) throw new Error(`party failed: ${r.status()} ${await r.text()}`);
}

export const HEADINGS = ['Party name', 'Party type', 'Phone', 'Email', 'GSTIN', 'Billing address', 'City', 'State', 'Opening balance', 'Balance type', 'Credit limit'];
/** file rows 2–9 */
export const ROWS: (string | number)[][] = [
  // 2–4 good rows
  ['Sharma Traders', 'Customer', '9123456780', 'sharma@example.com', '09AAJPM7745Q1ZP', 'Shop 4, Aminabad', 'Lucknow', 'Uttar Pradesh', 12500.5, 'To receive', 50000],
  ['Gupta Wires', 'Supplier', '9988776655', '', '27ABCDE1234F1Z0', 'Plot 12, MIDC', 'Pune', '', 8000, 'To pay', ''],
  ['Verma Kirana', '', '', '', '', '', 'Kanpur', '', 300, 'To collect', ''],
  // 5 wrong GSTIN check digit → Rejected
  ['Bad GSTIN Stores', 'Customer', '9000000005', '', '09AAJPM7745Q1Z2', '', '', '', '', '', ''],
  // 6 "Both" → Rejected
  ['Both Ways Co', 'Both', '', '', '', '', '', '', '', '', ''],
  // 7 three decimals → Rejected
  ['Decimal Mart', 'Customer', '', '', '', '', '', '', '10.555', 'To receive', ''],
  // 8 the shop already has this party → Duplicate - skipped
  ['MEHTA ELECTRICALS', 'Customer', '', '', '', '', '', '', 500, 'To receive', ''],
  // 9 same name as row 2 → Duplicate - skipped
  ['Sharma Traders', 'Customer', '9111111111', '', '', '', '', '', '', '', ''],
];
/** the good rows' balances as the Parties list shows them */
export const SAVED = [['Sharma Traders', '12,500.50'], ['Gupta Wires', '8,000.00'], ['Verma Kirana', '300.00']] as const;

/** Writes the prepared file as .xlsx. */
export async function writePartyFile(file: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Parties');
  ws.addRow(HEADINGS);
  for (const r of ROWS) ws.addRow(r);
  await wb.xlsx.writeFile(file);
}

/** The same rows as text copied from Excel (tab between cells), with or without the heading row. */
export const pasted = (withHeadings: boolean) => [...(withHeadings ? [HEADINGS] : []), ...ROWS].map((r) => r.join('\t')).join('\n') + '\n';

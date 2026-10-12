/**
 * Items › Import products: the shop the checks run against (a second godown, a Bajaj fan, two Havells
 * switch variants, Anchor with its Roma series) and the owner's sample file — one row for each case:
 * good rows, new brands / series / parent item, duplicates, missing columns, bad dates and the other checks.
 */
import type { APIRequestContext } from '@playwright/test';
import { APP } from './setup';

export async function importShop(request: APIRequestContext, who: { email: string; password: string }): Promise<void> {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const post = async <T = { id: string }>(p: string, data: object): Promise<T> => {
    const r = await request.post(APP + '/api' + p, { headers, data });
    if (!r.ok()) throw new Error(`${p} failed: ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  };
  await post('/godowns', { name: 'Back godown' });
  await post('/items', { name: 'BAJAJ BAHAR HS 225M E/F', code: 'BJ-BAHAR225', brand: 'Bajaj', unit: 'PCS', category: 'Fans', gstRate: 18, sale: '1550', purchase: '1319.24', openingQty: '4', openingRate: '1319.24', openingDate: '2026-04-01' });
  await post('/items', { name: 'Modular switch 6A · Havells Coral', code: 'AHCSXXW061', brand: 'Havells', group: 'Modular switch 6A', series: 'Coral', unit: 'PCS', category: 'Switches & MCBs', gstRate: 18, sale: '55', purchase: '42' });
  await post('/items', { name: 'Modular switch 6A · Havells Oro', code: 'AHOSXXW061', brand: 'Havells', group: 'Modular switch 6A', series: 'Oro', unit: 'PCS', category: 'Switches & MCBs', gstRate: 18, sale: '75', purchase: '58' });
  const anchor = await post('/brands', { name: 'Anchor' });
  await post('/brand-series', { brandId: anchor.id, name: 'Roma' });
}

type Cell = string | number;
/** Product type, name, brand, series, brand code, opening stock, at price, as of date, unit, sale price, stock alert, location, category, GST %, HSN (file rows 2–24) */
export const SAMPLE: Cell[][] = [
  // 2–3 good rows
  ['Single Range', 'BAJAJ MAXIMA NEO 150MM E/F WHITE', 'Bajaj', '', 'BJ-MAX150', 6, 1052, '01-04-2026', 'PCS', 1250, 2, 'Main shop', 'Fans', 18, '8414'],
  // (no brand code: it is optional)
  ['Multi Range', 'Modular switch 6A', 'Anchor', 'Roma', '', 200, 18, '01-04-2026', 'PCS', 26, 50, 'Back godown', 'Switches & MCBs', 18, '8536'],
  // 4–6 new series / brand / parent item (warnings: will be created)
  ['Multi Range', 'Modular switch 6A', 'Havells', 'Fabio', 'AHFSXXW061', 120, 48, '01-04-2026', 'PCS', 65, 20, '', 'Switches & MCBs', 18, '8536'],
  ['Multi Range', 'LED batten 20W', 'Wipro', 'Garnet', 'WP-GB20', 40, 165, '15/09/2026', 'PCS', 240, 10, '', 'Lighting', 18, '9405'],
  ['Multi Range', 'LED batten 20W', 'Philips', 'Astra Line', 'PH-AL20', 25, 180, '15-Sep-2026', 'PCS', 260, 5, '', 'Lighting', 18, '9405'],
  // 7–12 duplicates: existing name, twice in the file, code in use, existing variant, code twice in the file
  ['Single Range', 'BAJAJ BAHAR HS 225M E/F', 'Bajaj', '', 'BJ-BAHAR225-N', 2, 1319.24, '01-04-2026', 'PCS', 1550, 1, '', 'Fans', 18, '8414'],
  ['Single Range', 'KELINO MULTI HOLDER 9014', 'Kelino', '', 'KL-9014', 50, 22, '01-04-2026', 'PCS', 30, 10, '', 'Accessories', 18, '8536'],
  ['Single Range', 'Kelino multi holder 9014', 'Kelino', '', 'KL-9014B', 10, 22, '01-04-2026', 'PCS', 30, 10, '', 'Accessories', 18, '8536'],
  ['Single Range', 'ORIENT 6A 2PIN TOP PLUG WHITE', 'Orient', '', 'AHCSXXW061', 30, 17, '01-04-2026', 'PCS', 20, 5, '', 'Accessories', 18, '8536'],
  ['Multi Range', 'Modular switch 6A', 'Havells', 'Coral', 'AH-CORAL-NEW', 10, 42, '01-04-2026', 'PCS', 55, 5, '', 'Switches & MCBs', 18, '8536'],
  ['Multi Range', 'LED batten 20W', 'Wipro', 'Garnet Plus', 'WP-GB20', 15, 190, '01-04-2026', 'PCS', 270, 5, '', 'Lighting', 18, '9405'],
  // 13–14 required columns missing
  ['Single Range', 'G.M. 20A AERO SWITCH 2WAY WH', '', '', '', 15, 35, '01-04-2026', 'PCS', 48, '', '', 'Switches & MCBs', 18, ''],
  ['Multi Range', 'Modular switch 6A', 'Havells', '', 'AH-NOSERIES', 10, 40, '01-04-2026', 'PCS', 52, '', '', '', 18, ''],
  // 15–16 bad dates: not a date, in the future
  ['Single Range', 'RR 9W WH C/L 65K', 'RR', '', 'RR-9W65K', 30, 110, '31-02-2026', 'PCS', 150, 5, '', 'Lighting', 18, '9405'],
  ['Single Range', 'NW WALL LIGHT WW 4WAY', 'NW', '', 'NW-WL4', 5, 565, '01-01-2027', 'PCS', 750, 1, '', 'Lighting', 18, '9405'],
  // 17–24 no rate, negative, unknown unit, unknown godown, new category + no sale/date/GST, below cost, bad number/GST/HSN, bad type
  ['Single Range', 'G2 9W ZIVA C/L WH', 'G2', '', 'G2-Z9', 12, '', '01-04-2026', 'PCS', 140, 2, '', 'Lighting', 18, '9405'],
  ['Single Range', 'INDOTECH 5-30A LCB METER', 'Indotech', '', 'IT-LCB530', -5, 460, '01-04-2026', 'PCS', 550, 2, '', 'Accessories', 18, '9028'],
  ['Single Range', 'HAVELLS ONLOAD C/O 200A FP SIDE HANDLE', 'Havells', '', 'HV-OL200', 2, 22308, '01-04-2026', 'DOZEN', 26500, 1, '', 'Switches & MCBs', 18, '8536'],
  ['Single Range', 'KELINO PEDENT HOLDER 9013', 'Kelino', '', 'KL-9013', 40, 18, '01-04-2026', 'PCS', 30, 10, 'Shop 2', 'Accessories', 18, '8536'],
  ['Single Range', 'SOLAR STREET LIGHT 30W', 'Havells', '', 'HV-SSL30', 3, 2100, '', 'PCS', '', 1, '', 'Solar', '', ''],
  ['Single Range', 'KELINO MALE FEMALE 6A UNQ', 'Kelino', '', 'KL-MF6A', 20, 32, '01-04-2026', 'PCS', 30, 5, '', 'Accessories', 18, '8536'],
  ['Single Range', 'ANCHOR 6A SOCKET', 'Anchor', 'Roma', 'AN-S6', 25, 'abc', '01-04-2026', 'PCS', 45, 5, '', 'Switches & MCBs', 15, '12AB'],
  ['Double Range', 'NW BATTEN 20W SHINE', 'NW', '', 'NW-B20', 10, 95, '01-04-2026', 'PCS', 130, 2, '', 'Lighting', 18, '9405'],
];

/** Fills the downloaded template's Products sheet with rows, as a person would in Excel. */
export async function fillTemplate(template: string, out: string, rows: Cell[][] = SAMPLE): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(template);
  const ws = wb.getWorksheet('Products')!;
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    r.forEach((v, c) => { if (v !== '') row.getCell(c + 1).value = v; });
    row.commit();
  });
  await wb.xlsx.writeFile(out);
}

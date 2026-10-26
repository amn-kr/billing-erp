/**
 * A shop for Items › Bulk active / inactive (flows and pictures): products with brands, categories
 * and stock, two variants of one switch range, a service (never listed on this page), and one
 * inactive "Door bell" whose name an active item now has. Fixed names and codes.
 */
import type { APIRequestContext } from '@playwright/test';
import { signedApi, type Who } from './bulk.data';
import { freshShop } from './setup';

/** [name, code, category, brand, opening stock] */
const ITEMS: [string, string, string, string, string][] = [
  ['Ceiling fan 1200mm', 'CF12', 'Fans', 'CROMPTON', '25'],
  ['Table fan 400mm', 'TF40', 'Fans', 'USHA', ''],
  ['LED bulb 9W', 'LB9', 'Lighting', 'PHILIPS', '300'],
  ['LED batten 20W', 'LB20', 'Lighting', 'PHILIPS', ''],
  ['Wire 1.5 sq mm', 'WR15', 'Wires', 'POLYCAB', '12'],
  ['Insulation tape', 'IT1', '', '', ''],
  ['Door bell', 'DB1', '', 'ANCHOR', '5'],
];

export async function bulkActiveShop(request: APIRequestContext): Promise<Who> {
  const who = await freshShop(request);
  const a = await signedApi(request, who);
  const ids: Record<string, string> = {};
  for (const [name, code, category, brand, qty] of ITEMS) {
    const it = await a.post<{ id: string }>('/items', { name, code, category, sale: '100', purchase: '80', gstRate: 18, unit: 'PCS', ...(brand && { brand }), ...(qty && { openingQty: qty }) });
    ids[name] = it.id;
  }
  const sw = { group: '6A-10A 1WAY SWITCH', category: 'Switches', gstRate: 18, unit: 'PCS', sale: '42', purchase: '34' };
  await a.post('/items', { ...sw, name: '6A-10A 1WAY SWITCH · HAVELLS CORAL', brand: 'HAVELLS', series: 'CORAL', openingQty: '120' });
  await a.post('/items', { ...sw, name: '6A-10A 1WAY SWITCH · NORWOOD CLASSIC', brand: 'NORWOOD', series: 'CLASSIC' });
  await a.post('/items', { kind: 'service', name: 'Fan fitting', sale: '250', gstRate: 18, unit: 'NOS' });
  // the old Door bell is inactive; a new active one has its name
  await a.post(`/items/${ids['Door bell']}/archive`, {});
  await a.post('/items', { name: 'Door bell', code: 'DB2', sale: '199', purchase: '130', gstRate: 18, unit: 'PCS', brand: 'ANCHOR' });
  return who;
}

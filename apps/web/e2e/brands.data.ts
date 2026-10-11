/** Items for the Brands & Series checks: the 6A-10A 1WAY SWITCH in Havells and Norwood series, and LED 12W. */
import type { APIRequestContext } from '@playwright/test';
import { APP } from './setup';

export async function brandItems(request: APIRequestContext, who: { email: string; password: string }): Promise<void> {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const sw = { group: '6A-10A 1WAY SWITCH', category: 'Switches', hsn: '8536', gstRate: 18, minStock: '20' };
  for (const data of [
    { ...sw, name: '6A-10A 1WAY SWITCH · HAVELLS CORAL', brand: 'HAVELLS', series: 'CORAL', sale: '42', purchase: '34', openingQty: '120' },
    { ...sw, name: '6A-10A 1WAY SWITCH · HAVELLS PEARLZ', brand: 'HAVELLS', series: 'PEARLZ', sale: '48', purchase: '39', openingQty: '80' },
    { ...sw, name: '6A-10A 1WAY SWITCH · NORWOOD CLASSIC', brand: 'NORWOOD', series: 'CLASSIC', sale: '28', purchase: '21', openingQty: '15' },
    { name: 'LED 12W', category: 'Lighting', hsn: '8539', gstRate: 18, brand: 'HAVELLS', sale: '95', purchase: '72', minStock: '10', openingQty: '60' },
  ]) {
    const r = await request.post(APP + '/api/items', { headers, data });
    if (!r.ok()) throw new Error(`adding ${data.name} failed: ${r.status()} ${await r.text()}`);
  }
}

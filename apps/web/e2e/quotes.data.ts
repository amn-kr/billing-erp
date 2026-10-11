/**
 * A shop's own quotation columns and rows: brands and series on Items › Brands & Series, and parent
 * items with a variant per brand and series (the Quotation page has no sample brands any more).
 */
import type { APIRequestContext } from '@playwright/test';
import { APP } from './setup';

export async function quoteBrands(request: APIRequestContext, who: { email: string; password: string }, withItems = true): Promise<void> {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const post = async (p: string, data: Record<string, unknown>) => {
    const r = await request.post(APP + '/api' + p, { headers, data });
    if (!r.ok()) throw new Error(`${p} failed: ${r.status()} ${await r.text()}`);
    return r.json() as Promise<{ id: string }>;
  };
  const anchor = await post('/brands', { name: 'Anchor' });
  const havells = await post('/brands', { name: 'Havells' });
  await post('/brand-series', { brandId: anchor.id, name: 'Roma' });
  await post('/brand-series', { brandId: havells.id, name: 'Coral' });
  if (!withItems) return;
  const v = { category: 'Switches & MCBs', hsn: '8536', unit: 'PCS', gstRate: 18, openingQty: '100' };
  for (const [group, brand, series, sale] of [
    ['Modular switch 6A', 'Anchor', 'Roma', '38'], ['Modular switch 6A', 'Havells', 'Coral', '52'],
    ['Modular socket 6A', 'Anchor', 'Roma', '64'], ['Modular socket 6A', 'Havells', 'Coral', '89'],
  ] as const) await post('/items', { ...v, name: `${group} · ${brand} ${series}`, group, brand, series, sale, purchase: String(Math.round(Number(sale) * 0.8)) });
}

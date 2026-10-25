/** Edit, Delete and Inactive for items and parties: a shop with a used and an unused item and party (flows and pictures). */
import { expect, type APIRequestContext } from '@playwright/test';
import { APP, freshShop } from './setup';

type Who = { email: string; password: string };
const D = '2026-10-01';

async function api(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  return async <T>(path: string, data: object) => {
    const r = await request.post(APP + '/api' + path, { headers, data });
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  };
}

/** A shop with a used and an unused item, a used and an unused party, and one with ₹400 received against its opening balance. */
export async function shop(request: APIRequestContext) {
  const who = await freshShop(request);
  const post = await api(request, who);
  const fan = await post<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm', sale: '1890', gstRate: 18, openingQty: '10', openingRate: '1500' });
  await post('/items', { name: 'LED bulb 9W', code: 'LB09', sale: '95', gstRate: 18, openingQty: '40', openingRate: '56' });
  const mehta = await post<{ id: string }>('/parties', { name: 'Mehta Electricals', phone: '9845011122' });
  await post('/parties', { name: 'Masum Raza', openingBalance: '1000', openingDate: D });
  // ₹400 of its opening balance received: the opening balance can't go below that
  const patel = await post<{ id: string }>('/parties', { name: 'Patel Kirana', openingBalance: '1000', openingDate: D });
  await post('/receipts', { partyId: patel.id, date: D, amount: '400', mode: 'Cash', ref: '', allocations: [{ to: 'opening', amount: '400' }] });
  for (const qty of ['2', '1'])
    await post('/sales', { kind: 'invoice', date: D, dueDate: D, mode: 'credit', partyId: mehta.id, payments: [], lines: [{ itemId: fan.id, name: fan.name, qty, price: '1890', discPct: '0', gstRate: '18' }] });
  return who;
}


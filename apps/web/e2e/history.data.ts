/** Practice data for the "View history" tests (flows and pictures). Made-up names and passcodes. */
import { expect, type APIRequestContext } from '@playwright/test';
import { APP } from './setup';

const PASS = '4826';
const D = '2026-10-01';
type Who = { email: string; password: string };

async function api(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const send = (method: 'post' | 'put') => async <T>(path: string, data: object) => {
    const r = await request[method](APP + '/api' + path, { headers, data });
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  };
  return { get: async <T>(path: string) => (await (await request.get(APP + '/api' + path, { headers })).json()) as T, post: send('post'), put: send('put') };
}

/** A sale edited twice (the second edit changes 4 things), one never edited, a purchase bill and an expense edited once. */
export async function books(request: APIRequestContext, who: Who) {
  const a = await api(request, who);
  const fan = await a.post<{ id: string; name: string }>('/items', { name: 'Ceiling fan 1200mm (history)', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25', openingDate: D });
  const bulb = await a.post<{ id: string; name: string }>('/items', { name: 'LED bulb 9W (history)', sale: '95', purchase: '62', gstRate: 18, openingQty: '200', openingDate: D });
  const verma = await a.post<{ id: string }>('/parties', { name: 'Verma Traders (history)' });
  const kc = await a.post<{ id: string }>('/parties', { name: 'Kanpur Cables (history)', kind: 'supplier' });
  const ln = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, discPct: '0', gstRate: '18' });
  const sale = (lines: object[], more: object = {}) => ({ date: D, dueDate: D, partyId: verma.id, lines, ...more });
  const inv = await a.post<{ id: string; number: string }>('/sales', sale([ln(fan, '6', '1890')]));
  await a.put(`/sales/${inv.id}`, sale([ln(fan, '8', '1890')]));
  await a.put(`/sales/${inv.id}`, sale([ln(fan, '8', '1950'), ln(bulb, '10', '95')], { notes: 'Deliver on Monday' }));
  const plain = await a.post<{ id: string; number: string }>('/sales', sale([ln(bulb, '2', '95')]));
  const bl = (qty: string) => ({ kind: 'bill', date: D, dueDate: D, partyId: kc.id, lines: [{ itemId: bulb.id, name: bulb.name, qty, rate: '62', discPct: '0', gstRate: '18' }] });
  const bill = await a.post<{ id: string; number: string }>('/purchases', bl('10'));
  await a.put(`/purchases/${bill.id}`, bl('12'));
  const cat = (await a.get<{ id: string; name: string }[]>('/expense-categories')).find((c) => c.name === 'Repairs')!.id;
  const xp = (amt: string) => ({ date: D, categoryId: cat, mode: 'Cash', payee: 'Cool Air Services', reference: '', notes: '', lines: [{ name: 'AC servicing', qty: '1', rate: amt, gst: '0', amt }] });
  const ex = await a.post<{ id: string; number: string }>('/expenses', xp('1200'));
  await a.put(`/expenses/${ex.id}`, xp('1500'));
  await a.post('/settings/passcode/on', { passcode: PASS });
  return { inv, plain, bill, ex, fan };
}

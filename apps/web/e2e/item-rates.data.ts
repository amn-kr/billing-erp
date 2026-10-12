/** Items for the rate-table checks (owner's cases 1–5): real bills, sales and a debit note, all on fixed dates. */
import type { APIRequestContext } from '@playwright/test';
import { APP } from './setup';

export const RATE_ITEMS = {
  several: 'Modular switch 6A',
  firstZero: 'Ceiling rose',
  midZero: 'Fan regulator',
  none: 'Door bell',
  many: 'LED batten 20W',
  service: 'Wiring labour',
} as const;

export async function rateItems(request: APIRequestContext, who: { email: string; password: string }): Promise<void> {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const post = async <T = { id: string; name: string; sale: string }>(p: string, data: object): Promise<T> => {
    const r = await request.post(APP + '/api' + p, { headers, data });
    if (!r.ok()) throw new Error(`${p} failed: ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const sup = await post('/parties', { name: 'Kanpur Cables', kind: 'supplier' });
  const cust = await post('/parties', { name: 'Mehta Electricals' });
  const item = (name: string, purchase: number, extra: object = {}) =>
    post('/items', { name, sale: String(Math.round(purchase * 1.35)), purchase: String(purchase), gstRate: 18, unit: 'PCS', category: 'Switches', ...extra });
  type It = { id: string; name: string; sale: string };
  const ln = (it: It, qty: number, rate: number) => ({ itemId: it.id, name: it.name, qty: String(qty), rate: String(rate), discPct: '0', gstRate: '18' });
  const bill = (it: It, qty: number, rate: number, date: string) => post('/purchases', { kind: 'bill', partyId: sup.id, date, dueDate: date, lines: [ln(it, qty, rate)] });
  const sell = (it: It, qty: number, date: string) =>
    post('/sales', { partyId: cust.id, date, dueDate: date, lines: [{ itemId: it.id, name: it.name, qty: String(qty), price: it.sale, discPct: '0', gstRate: '18' }], payments: [] });

  // added newest last, so the list (newest first) shows: many, none, midZero, firstZero, several
  const a = await item(RATE_ITEMS.several, 70, { openingQty: '30', openingRate: '60', openingDate: '2026-05-01' });
  await bill(a, 40, 65, '2026-06-02'); await bill(a, 50, 61, '2026-07-03'); await bill(a, 100, 55, '2026-08-04'); await bill(a, 205, 70, '2026-09-05');
  await sell(a, 9, '2026-09-20');

  const b = await item(RATE_ITEMS.firstZero, 55);
  await bill(b, 10, 48, '2026-05-10'); await bill(b, 10, 50, '2026-06-10'); await bill(b, 20, 52, '2026-07-10'); await bill(b, 30, 55, '2026-08-10');
  await sell(b, 25, '2026-09-01');

  const c = await item(RATE_ITEMS.midZero, 70);
  await bill(c, 10, 60, '2026-06-01');
  const mid = await bill(c, 8, 65, '2026-07-01');
  await bill(c, 6, 70, '2026-08-01');
  await post('/purchases', { kind: 'debit_note', partyId: sup.id, againstId: mid.id, reason: 'Damaged goods', date: '2026-08-15', dueDate: '2026-08-15', lines: [ln(c, 8, 65)] });

  const d = await item(RATE_ITEMS.none, 35);
  await bill(d, 5, 30, '2026-06-01'); await bill(d, 5, 35, '2026-07-01'); await sell(d, 10, '2026-08-01');

  const e = await item(RATE_ITEMS.many, 64);
  const rates = [52, 58, 49, 61, 55, 67, 60, 72, 57, 63, 69, 54, 66, 75, 59, 64];
  for (let i = 0; i < rates.length; i++) await bill(e, 10 + ((i * 37) % 90), rates[i]!, `2026-${String(4 + Math.floor(i / 3)).padStart(2, '0')}-${String(3 + (i % 3) * 9).padStart(2, '0')}`);
  await sell(e, 30, '2026-09-25');

  await post('/items', { name: RATE_ITEMS.service, kind: 'service', sale: '500', gstRate: 18 });
}

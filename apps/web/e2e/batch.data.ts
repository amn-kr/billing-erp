/** A shop with Batch and expiry ticked, a tracked item with batches and a supplier, made through the API. */
import { request as playwrightRequest } from '@playwright/test';
import { APP } from './setup';

export const ITEM = 'Paracetamol 500';
export const SUPPLIER = 'Ram Pharma';

export async function batchShop(owner: { email: string; password: string }, opts: { bills?: boolean } = { bills: true }): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const tok = ((await (await api.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
    const send = async (method: 'post' | 'put', path: string, data: unknown) => {
      const r = await api[method](APP + '/api' + path, { data, headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok()) throw new Error(`${path} failed: ${r.status()} ${await r.text()}`);
      return r.json() as Promise<{ id: string }>;
    };
    await send('put', '/settings/features', { enabled: ['batch_expiry'] });
    const date = '2026-10-01';
    const it = await send('post', '/items', { name: ITEM, kind: 'goods', unit: 'PCS', gstRate: 0, trackBatch: true, openingQty: '1', openingRate: '10', openingDate: date });
    const sup = await send('post', '/parties', { name: SUPPLIER, kind: 'supplier' });
    if (opts.bills === false) return;
    const buy = (qty: string, rate: string, batchNo: string, mfg: string, expiry: string) =>
      send('post', '/purchases', { kind: 'bill', date, dueDate: date, partyId: sup.id, transport: '0', labour: '0', lines: [{ itemId: it.id, name: ITEM, qty, rate, discPct: '0', gstRate: '0', batchNo, mfg, expiry }] });
    // dates far from today, so the pictures don't change with the calendar: one long expired, the others years away
    await buy('3', '12', 'A123', '01/26', '03/40');
    await buy('4', '15', 'B456', '03/26', '08/41');
    await buy('1', '9', 'X100', '01/18', '01/20');
  } finally {
    await api.dispose();
  }
}

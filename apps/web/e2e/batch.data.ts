/** A shop with Batch and expiry ticked, a tracked item with batches and a supplier, made through the API. */
import { request as playwrightRequest } from '@playwright/test';
import { APP } from './setup';

export const ITEM = 'Paracetamol 500';
export const SUPPLIER = 'Ram Pharma';
export const CUSTOMER = 'Raju Stores';

/** A shop with both features ticked and an item sold by the pack: 1 STRIP = 10 TAB, 5 strips bought, in two batches. */
export async function packShop(owner: { email: string; password: string }, opts: { invoice?: boolean; features?: string[] } = {}): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const tok = ((await (await api.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
    const send = async (method: 'post' | 'put', path: string, data: unknown) => {
      const r = await api[method](APP + '/api' + path, { data, headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok()) throw new Error(`${path} failed: ${r.status()} ${await r.text()}`);
      return r.json() as Promise<{ id: string }>;
    };
    await send('put', '/settings/features', { enabled: ['batch_expiry', 'mrp_pack'] });
    const date = '2026-10-01';
    const it = await send('post', '/items', { name: ITEM, kind: 'goods', unit: 'TAB', packUnit: 'STRIP', packSize: '10', gstRate: 0, trackBatch: true, sale: '100', mrp: '120' });
    const sup = await send('post', '/parties', { name: SUPPLIER, kind: 'supplier' });
    const cust = await send('post', '/parties', { name: CUSTOMER });
    const buy = (qty: string, rate: string, batchNo: string, expiry: string, batchMrp: string) =>
      send('post', '/purchases', { kind: 'bill', date, dueDate: date, partyId: sup.id, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [{ itemId: it.id, name: ITEM, qty, unit: 'STRIP', rate, discPct: '0', gstRate: '0', batchNo, expiry, batchMrp }] });
    await buy('3', '60', 'A123', '03/40', '120');
    await buy('2', '70', 'B456', '08/41', '125');
    if (opts.invoice) await send('post', '/sales', { kind: 'invoice', date, dueDate: date, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], lines: [{ itemId: it.id, name: ITEM, qty: '2', unit: 'STRIP', price: '100', discPct: '0', gstRate: '0' }] });
    if (opts.features) await send('put', '/settings/features', { enabled: opts.features });
  } finally {
    await api.dispose();
  }
}

export async function batchShop(owner: { email: string; password: string }, opts: { bills?: boolean; invoice?: boolean; mrp?: boolean } = { bills: true }): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const tok = ((await (await api.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
    const send = async (method: 'post' | 'put', path: string, data: unknown) => {
      const r = await api[method](APP + '/api' + path, { data, headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok()) throw new Error(`${path} failed: ${r.status()} ${await r.text()}`);
      return r.json() as Promise<{ id: string }>;
    };
    await send('put', '/settings/features', { enabled: opts.mrp ? ['batch_expiry', 'mrp_pack'] : ['batch_expiry'] });
    const date = '2026-10-01';
    const it = await send('post', '/items', { name: ITEM, kind: 'goods', unit: 'PCS', gstRate: 0, trackBatch: true, openingQty: '1', openingRate: '10', openingDate: date, ...(opts.mrp && { sale: '150', mrp: '100' }) });
    const sup = await send('post', '/parties', { name: SUPPLIER, kind: 'supplier' });
    const cust = await send('post', '/parties', { name: CUSTOMER });
    if (opts.bills === false) return;
    const buy = (qty: string, rate: string, batchNo: string, mfg: string, expiry: string) =>
      send('post', '/purchases', { kind: 'bill', date, dueDate: date, partyId: sup.id, transport: '0', labour: '0', lines: [{ itemId: it.id, name: ITEM, qty, rate, discPct: '0', gstRate: '0', batchNo, mfg, expiry, ...(opts.mrp && { batchMrp: batchNo === 'A123' ? '120' : '125' }) }] });
    // dates far from today, so the pictures don't change with the calendar: one long expired, the others years away
    await buy('3', '12', 'A123', '01/26', '03/40');
    await buy('4', '15', 'B456', '03/26', '08/41');
    await buy('1', '9', 'X100', '01/18', '01/20');
    // an invoice to return from and to print: 3 from No batch + A123
    if (opts.invoice) await send('post', '/sales', { kind: 'invoice', date, dueDate: date, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], fromQuotationIds: [], lines: [{ itemId: it.id, name: ITEM, qty: '3', unit: 'PCS', price: '20', discPct: '0', gstRate: '0' }] });
  } finally {
    await api.dispose();
  }
}

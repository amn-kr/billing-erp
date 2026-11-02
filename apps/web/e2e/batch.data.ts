/** A shop with Batch and expiry ticked, a tracked item with batches and a supplier, made through the API. */
import { request as playwrightRequest } from '@playwright/test';
import { APP } from './setup';

export const ITEM = 'Paracetamol 500';
export const SUPPLIER = 'Ram Pharma';
export const CUSTOMER = 'Raju Stores';

/**
 * A shop with batches near their expiry, for the frozen test clock (1 Oct 2026): one expired, one in 30 days, one in 60, one
 * in 89, one far away. Two suppliers, and one sale from each of the first two.
 */
export async function expiryShop(owner: { email: string; password: string }, opts: { features?: string[] } = {}): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const tok = ((await (await api.post(APP + '/api/auth/login', { data: owner })).json()) as { accessToken: string }).accessToken;
    const send = async (method: 'post' | 'put', path: string, data: unknown) => {
      const r = await api[method](APP + '/api' + path, { data, headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok()) throw new Error(`${path} failed: ${r.status()} ${await r.text()}`);
      return r.json() as Promise<{ id: string }>;
    };
    await send('put', '/settings/features', { enabled: ['batch_expiry', 'mrp_pack'] });
    const date = '2026-08-01';
    const ram = await send('post', '/parties', { name: SUPPLIER, kind: 'supplier' });
    const sun = await send('post', '/parties', { name: 'Sun Distributors', kind: 'supplier' });
    const cust = await send('post', '/parties', { name: CUSTOMER });
    const item = (name: string, x: object) => send('post', '/items', { name, kind: 'goods', gstRate: 0, trackBatch: true, ...x });
    const tab = { unit: 'TAB', packUnit: 'STRIP', packSize: '10' };
    const buy = (sup: string, it: { id: string }, name: string, unit: string, qty: string, rate: string, batchNo: string, expiry: string) =>
      send('post', '/purchases', { kind: 'bill', date, dueDate: date, partyId: sup, transport: '0', labour: '0', pricesInclTax: false, roundOff: false, lines: [{ itemId: it.id, name, qty, unit, rate, discPct: '0', gstRate: '0', batchNo, expiry }] });
    const cro = await item('Crocin 500', { ...tab, sale: '30', mrp: '35' });
    const azi = await item('Azithral 500', { ...tab, sale: '120', mrp: '135' });
    const syr = await item('Benadryl syrup', { unit: 'BTL', sale: '110', mrp: '125' });
    const vit = await item('Vitamin D3', { ...tab, sale: '90', mrp: '100' });
    const ors = await item('ORS sachet', { unit: 'PCS', sale: '20', mrp: '22' });
    await buy(ram.id, cro, 'Crocin 500', 'STRIP', '6', '22', 'C101', '09/26');
    await buy(ram.id, azi, 'Azithral 500', 'STRIP', '4', '90', 'A77', '10/26');
    await buy(sun.id, syr, 'Benadryl syrup', 'BTL', '8', '75', 'S12', '11/26');
    await buy(ram.id, vit, 'Vitamin D3', 'STRIP', '10', '60', 'V9', '29/12/2026');
    await buy(sun.id, ors, 'ORS sachet', 'PCS', '40', '12', 'O1', '06/28');
    const line = (it: { id: string }, name: string, qty: string, unit: string, price: string) => ({ itemId: it.id, name, qty, unit, price, discPct: '0', gstRate: '0' });
    await send('post', '/sales', { kind: 'invoice', date, dueDate: date, mode: 'credit', partyId: cust.id, transport: '0', labour: '0', bankCharge: '0', pricesInclTax: true, roundOff: false, notes: '', extra: {}, payments: [], lines: [line(cro, 'Crocin 500', '2', 'STRIP', '30'), line(azi, 'Azithral 500', '1', 'STRIP', '120')] });
    if (opts.features) await send('put', '/settings/features', { enabled: opts.features });
  } finally {
    await api.dispose();
  }
}

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

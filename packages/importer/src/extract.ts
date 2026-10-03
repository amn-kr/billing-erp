/**
 * Step 1 of an import: let the prototype itself read the backup.
 *
 * The prototype keeps part of its data in code (sample catalogue, defaults)
 * and overlays the saved keys on top, replaying documents as it loads. Rather
 * than re-implementing all of that, we open reference/design/app.html in a
 * headless browser, restore the backup exactly as "Restore books" would, and
 * read the resulting books out of the page. The clock is set to the time the
 * backup was taken, so defaults such as "today" match what the shop saw.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { backupSchema, snapshotSchema, type Backup, type Snapshot } from './snapshot.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE = path.resolve(HERE, '../../../reference/design/app.html');

export class ImportError extends Error {}

export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('This file is not a backup: it is not valid JSON.');
  }
  const r = backupSchema.safeParse(raw);
  if (!r.success) throw new ImportError('This file isn’t a backup from the Billing ERP app (Settings › General › Backup & restore).');
  return r.data;
}

/** Runs inside the prototype page after the backup is loaded. Uses the prototype's own globals. */
/* eslint-disable */
function readBooks(): unknown {
  const w = window as any;
  const g = (expr: string) => (0, eval)(expr);
  const BZ = g('BZ'), S = g('S'), IT = g('IT'), PARTIES = g('PARTIES'), PLS = g('PLS'), PLO = g('PLO');
  const raw = new Map<string, any>(PARTIES.map((p: any) => [p.id, p]));
  const str = (v: any) => (v === undefined || v === null ? '' : String(v));
  const n = (v: any) => { const x = +String(v ?? '').replace(/,/g, ''); return Number.isFinite(x) ? x : 0; };
  const isoOf = (dmy: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(dmy) ? dmy.split('/').reverse().join('-') : dmy);
  const parties = g('allParties()').map((p: any) => {
    const r = raw.get(p.id) || {};
    const ob = p.tx.find((t: any) => t.type === 'Opening balance');
    return {
      id: p.id, name: str(p.name), role: p.role === 's' ? 's' : 'c', group: str(p.group || 'General'),
      phone: str(p.phone), email: str(r.email), gstin: str(p.gstin).toUpperCase(), gstType: str(r.gtype),
      state: str(r.state || p.state),
      billing: { line: str(r.bLine || r.billing), city: str(r.bCity || p.city), pin: str(r.bPin), state: str(r.bState) },
      shipping: str(r.ship === 'same' ? 'same' : r.ship || r.shipping),
      creditLimit: n(r.lim ?? p.limit), creditDays: n(r.days ?? p.days),
      opening: ob ? { amount: n(ob.total), date: isoOf(ob.date), kind: p.role === 's' ? 'pay' : 'receive' } : null,
      extra: (r.extra || []).map((x: any) => ({ field: str(x.f), value: str(x.v) })),
      addedOn: str(r.added), sample: !p.isNew,
    };
  });
  const items = IT.map((i: any) => ({
    id: str(i.id), name: str(i.name), service: !!i.svc, code: str(i.code), hsn: str(i.hsn), unit: str(i.unit),
    category: str(i.cat), gst: n(i.gst), group: str(i.grp), brand: str(i.brand), series: str(i.series),
    sale: n(i.sale), purchase: n(i.purch), mrp: n(i.mrp), listPrice: n(i.lp), wholesale: n(i.whole), wholesaleQty: n(i.wholeQty),
    minStock: n(i.min), location: str(i.loc), hasImage: !!i.img,
    opening: (i.tx || []).filter((t: any) => t.type === 'Opening stock').map((t: any) => ({ qty: n(t.qty), price: n(t.price), date: isoOf(str(t.date)) })),
    stock: i.svc ? null : g('stockOf')(i), sample: !i.isNew,
  }));
  const activeMap = (() => { try { return JSON.parse(localStorage.getItem('erp-pl-active') || '{}') || {}; } catch { return {}; } })();
  const priceLists = PLS.map((p: any) => ({
    id: str(p.id), name: str(p.name), isDefault: !!p.def, rule: str(p.rule), value: n(p.val), round: n(p.round),
    groups: (p.groups || []).map(str), active: p.def ? true : activeMap[p.id] !== false,
    overrides: Object.fromEntries(Object.entries(PLO[p.id] || {}).map(([k, v]) => [k, n(v)])),
  }));
  const keys: Record<string, unknown> = {};
  for (const k of ['erp-invoices', 'erp-pdocs', 'erp-precv', 'erp-cnotes', 'erp-exps', 'erp-quotes', 'erp-btx', 'erp-ppays', 'erp-dchal', 'erp-chq', 'erp-recon', 'erp-compay', 'erp-salehist', 'erp-salemod']) {
    const v = localStorage.getItem(k);
    if (v != null) { try { keys[k] = JSON.parse(v); } catch { keys[k] = v; } }
  }
  const { taxes, ...settings } = S;
  return {
    format: 'billing-erp-snapshot', version: 1,
    backup: { at: '', biz: str(BZ.name), fresh: !!BZ.fresh, keptSampleItems: !!BZ.keepItems },
    business: {
      name: str(BZ.name), short: str(BZ.short), owner: str(BZ.owner), phone: str(BZ.phone), email: str(BZ.email),
      addr: str(BZ.addr), city: str(BZ.city), pin: str(BZ.pin), state: str(S.state), gstin: str(S.gstin).toUpperCase(),
      gstEnabled: !!S.gst, upi: str(S.upi), invoiceNext: n(BZ.invNext) || 1,
    },
    settings,
    taxes: (taxes || []).map((t: any) => ({ id: str(t.id), type: str(t.type), rate: n(t.rate), name: str(t.name), note: str(t.note), old: !!t.old })),
    partyGroups: g('GROUPS').map(str), units: g('UNITS').map(str), categories: g('CATS').map(str), brands: g('BRANDS()').map(str),
    parties, items, priceLists,
    priceHistory: (g('PSTORE').hist || []),
    priceRules: (() => { try { return JSON.parse(localStorage.getItem('erp-prules') || '{}') || {}; } catch { return {}; } })(),
    pricePinSet: !!localStorage.getItem('erp-price-pin'),
    godowns: g('GD').map((d: any) => ({ id: str(d.id), name: str(d.name), addr: str(d.addr), manager: str(d.mgr), phone: str(d.ph), isDefault: !!d.def })),
    referrers: g('ELEC').map((e: any) => ({ id: str(e.id), name: str(e.name), phone: str(e.phone), city: str(e.city), partyId: str(e.party) })),
    commissionRules: g('CRULES'),
    expenseCategories: (g('ECATS') || []).map(str),
    accounts: g('ACCTS') || [],
    quotationGrid: g('typeof QS!=="undefined"?QS:null'),
    documents: keys,
  };
}
/* eslint-enable */

export interface ExtractOptions {
  browser?: Browser;
  /** path to a Chromium build; defaults to Playwright's own (PLAYWRIGHT_BROWSERS_PATH) */
  executablePath?: string;
}

/** Backup file → snapshot of the books, as the prototype sees them. */
export async function extractSnapshot(backup: Backup, opts: ExtractOptions = {}): Promise<Snapshot> {
  const browser = opts.browser ?? (await chromium.launch(opts.executablePath ? { executablePath: opts.executablePath } : {}));
  try {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
    // the prototype only needs fonts for looks; block all network
    await ctx.route(/^https?:/, (r) => r.abort());
    const page = await ctx.newPage();
    const at = new Date(backup.at);
    if (!Number.isNaN(at.getTime())) await page.clock.setFixedTime(at);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = 'file://' + PROTOTYPE;
    await page.goto(url);
    // same as the prototype's bkpApply(): replace every erp-* key with the backup's
    await page.evaluate((keys) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(keys)) if (v != null) localStorage.setItem(k, v);
    }, backup.keys);
    await page.goto(url);
    await page.waitForFunction(() => typeof (window as any).bkpMake === 'function');
    const snap = (await page.evaluate(readBooks)) as Snapshot;
    snap.backup.at = backup.at;
    if (errors.length) throw new ImportError('The prototype could not open this backup: ' + errors[0]);
    return snapshotSchema.parse(snap);
  } finally {
    if (!opts.browser) await browser.close();
  }
}

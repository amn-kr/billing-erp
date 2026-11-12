/**
 * Bring my online books to this PC (Phase 6, step 7b): the sign-in page as the Windows app shows it in
 * single-PC mode. The browser stands in for the app (window.billingDesktop with local: true) and the PC's
 * server answers come from here; the real round trip runs in the API tests and the Windows app's test.
 */
import type { Page } from '@playwright/test';

export const PC_SHOPS = [
  { id: '7d1c4a52-2f0e-4c8e-9a51-3b6f2a1d9e01', code: 'BE-1042', name: 'Verma Traders', city: 'Lucknow', movedToPcOn: null },
  { id: '7d1c4a52-2f0e-4c8e-9a51-3b6f2a1d9e02', code: 'BE-1043', name: 'Verma Electricals', city: 'Kanpur', movedToPcOn: '2026-11-03T06:30:00.000Z' },
];
export const COUNTS = { invoices: 214, parties: 38, items: 126, purchaseBills: 41, paymentsReceived: 97, salesTotalThisYear: '1872310.00' };

/** This page as the Windows app's single-PC mode; returns what the page sent to bring the books. */
export async function onThisPc(page: Page) {
  const sent: { shops?: unknown; bring?: unknown } = {};
  await page.addInitScript(() => {
    (window as unknown as { billingDesktop: unknown }).billingDesktop = { local: true, printers: async () => ({ printers: [], chosen: null }), choosePrinter: async () => undefined, print: async () => ({ ok: false, reason: 'none' }) };
  });
  await page.route('**/api/auth/refresh', (r) => r.fulfill({ status: 401, json: { message: 'Please sign in.' } }));
  await page.route('**/api/auth/login', (r) => r.fulfill({ status: 401, json: { statusCode: 401, message: 'There’s no account with this email on this computer yet. Your online account is separate.', code: 'not_on_pc' } }));
  await page.route('**/api/cloud/bring/shops', (r) => { sent.shops = r.request().postDataJSON(); return r.fulfill({ json: { shops: PC_SHOPS } }); });
  await page.route('**/api/cloud/bring', (r) => {
    sent.bring = r.request().postDataJSON();
    return r.fulfill({ json: { accessToken: 'pc-token', expiresIn: 900, code: 'BE-1001', name: 'Verma Traders', already: false, matches: true, here: COUNTS, online: COUNTS } });
  });
  return sent;
}

/** Sign in with an online account the PC doesn't have. */
export async function typeOnlineAccount(page: Page, app: string) {
  await page.goto(app + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', 'pooja.verma@gmail.com');
  await page.fill('#aPass', 'online password 1');
  await page.click('#aGo');
  await page.waitForSelector('#aNotHere');
}

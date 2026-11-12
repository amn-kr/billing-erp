/**
 * Bring my online books to this PC (Phase 6, step 7b): new, so compared with owner-approved pictures
 * (e2e/approved/, approved by the owner 12 Nov 2026) at 1280, 1366 and 1920 px — the PC's "no account here" message, the shop choice, the
 * done card, and the view-only line on a moved shop's screens online.
 */
import { test } from '@playwright/test';
import { onThisPc, typeOnlineAccount } from './bring.data';
import { approvedShot, hideHeader } from './shots';
import { APP, WIDTHS, freshShop, newPage, signInAs } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('PC sign-in: not on this PC, choose the shop, books brought', async ({ browser }) => {
      const page = await newPage(browser, width);
      await onThisPc(page);
      await typeOnlineAccount(page, APP);
      await page.mouse.move(0, 0);
      await approvedShot(`pc-not-here-${width}`, page, '#box');
      await page.click('#aBring');
      await page.click('#bFind');
      await page.waitForSelector('#bGo');
      await page.mouse.move(0, 0);
      await approvedShot(`pc-bring-shops-${width}`, page, '#box');
      await page.click('#bGo');
      await page.waitForSelector('#bDone');
      await page.mouse.move(0, 0);
      await approvedShot(`pc-bring-done-${width}`, page, '#box');
    });

    test('online: the view-only line of a shop moved to a PC', async ({ browser, request }) => {
      const page = await newPage(browser, width);
      const who = await freshShop(request);
      const { accessToken } = await (await request.post(APP + '/api/auth/login', { data: who })).json();
      const me = await (await request.get(APP + '/api/me', { headers: { Authorization: `Bearer ${accessToken}` } })).json();
      await request.post(APP + '/api/cloud/moved-to-pc', { headers: { Authorization: `Bearer ${accessToken}` }, data: { businessId: me.business.id, pcCode: 'BE-1001' } });
      // a fixed date, so the picture stays the same
      await page.route('**/api/me', async (r) => { const res = await r.fetch(); const j = await res.json(); if (j.business) j.business.movedToPcOn = '2026-11-12T06:30:00.000Z'; return r.fulfill({ response: res, json: j }); });
      await signInAs(page, who);
      await page.goto(APP + '/parties');
      await page.waitForSelector('#movedBar');
      await hideHeader(page);
      await approvedShot(`moved-to-pc-bar-${width}`, page, '#movedBar');
    });
  });
}

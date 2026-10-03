/**
 * Phase 2 screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/fresh-shop.backup.json, imported into the
 * rebuild's e2e shop). Pixel comparison at 1280, 1366 and 1920 px.
 */
import { expect, test, type Page } from '@playwright/test';
import { compare } from './compare';
import { APP, RAVI, WIDTHS, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

const MAX_RATIO = 0;
const shot = (p: Page, sel: string) => p.locator(sel).screenshot({ animations: 'disabled', caret: 'hide' });
async function same(name: string, a: Buffer, b: Buffer) {
  const d = compare(name, a, b);
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Parties screen and Add party dialog', async ({ browser }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'parties');
      await signInAs(app, RAVI);
      await app.goto(APP + '/parties');
      await app.waitForSelector('#ptList .ptr');
      await app.waitForTimeout(400);
      await same(`parties-${width}`, await shot(proto, '#vParties'), await shot(app, '#vParties'));

      // second party selected
      await proto.click('#ptList .ptr:nth-child(3)');
      await app.click('#ptList .ptr:nth-child(3)');
      await proto.waitForTimeout(200);
      await app.waitForTimeout(200);
      await same(`parties-supplier-${width}`, await shot(proto, '#ptRight'), await shot(app, '#ptRight'));

      // Add party: each tab, then the error state
      await proto.evaluate(() => (window as unknown as { openParty: () => void }).openParty());
      await app.click('#vParties .pthd .btn.p');
      for (const tab of ['addr', 'cred', 'extra']) {
        await proto.click(`#ap [data-aptab="${tab}"]`);
        await app.click(`#ap [data-aptab="${tab}"]`);
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        await same(`addparty-${tab}-${width}`, await shot(proto, '#ap .mdl'), await shot(app, '#ap .mdl'));
      }
      await proto.click('#ap [data-aptab="addr"]');
      await app.click('#ap [data-aptab="addr"]');
      await proto.click('#apSave');
      await app.click('#apSave');
      await proto.locator('#apName').blur();
      await app.locator('#apName').blur();
      await same(`addparty-error-${width}`, await shot(proto, '#ap .mdl'), await shot(app, '#ap .mdl'));
    });
  });
}

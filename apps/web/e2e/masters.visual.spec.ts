/**
 * Phase 2 screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/fresh-shop.backup.json, imported into the
 * rebuild's e2e shop). Pixel comparison at 1280, 1366 and 1920 px.
 */
import { expect, test, type Page } from '@playwright/test';
import { compare } from './compare';
import { APP, RAVI, WIDTHS, freshShop, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';

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

    test('Items screen, Add item and Adjust stock', async ({ browser }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'items');
      await signInAs(app, RAVI);
      await app.goto(APP + '/items');
      await app.waitForSelector('#itList .ptr');
      await app.waitForSelector('#itHead h2');
      await app.waitForTimeout(400);
      await same(`items-${width}`, await shot(proto, '#vItems'), await shot(app, '#vItems'));
      // sidebar, including the low-stock counter on Items & stock
      await same(`items-side-${width}`, await shot(proto, '#side'), await shot(app, '#side'));

      // an item with opening stock (third in the list)
      await proto.click('#itList .ptr:nth-child(3)');
      await app.click('#itList .ptr:nth-child(3)');
      await app.waitForSelector('#itTx tr td.n');
      await proto.waitForTimeout(200);
      await app.waitForTimeout(300);
      await same(`items-stock-${width}`, await shot(proto, '#itRight'), await shot(app, '#itRight'));

      // Adjust stock
      await proto.click('#itAdj');
      await app.click('#itAdj');
      await proto.fill('#adjQty', '5');
      await app.fill('#adjQty', '5');
      await proto.evaluate(() => document.getElementById('adjQty')!.dispatchEvent(new Event('input', { bubbles: true })));
      await proto.locator('#adjQty').blur();
      await app.locator('#adjQty').blur();
      await same(`adjust-${width}`, await shot(proto, '#adj .mdl'), await shot(app, '#adj .mdl'));
      // (the prototype asks "Discard this stock adjustment?" here; that confirmation comes with the shared discard dialog)
      await proto.evaluate(() => (window as unknown as { closeM: (id: string) => void }).closeM('adj'));
      await app.click('#adjCancel');

      // Add item: product (both tabs), service, several brands/sizes, error
      await proto.evaluate(() => (window as unknown as { openItem: () => void }).openItem());
      await app.click('#vItems .pthd .btn.p');
      await app.waitForSelector('#ai:not([hidden]) #aiUnit option', { state: 'attached' });
      for (const tab of ['price', 'stock']) {
        await proto.click(`#ai [data-aitab="${tab}"]`);
        await app.click(`#ai [data-aitab="${tab}"]`);
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        await same(`additem-${tab}-${width}`, await shot(proto, '#ai .mdl'), await shot(app, '#ai .mdl'));
      }
      await proto.click('#ai [data-aitab="price"]');
      await app.click('#ai [data-aitab="price"]');
      await proto.click('#aiSave');
      await app.click('#aiSave');
      await proto.locator('#aiName').blur();
      await app.locator('#aiName').blur();
      await same(`additem-error-${width}`, await shot(proto, '#ai .mdl'), await shot(app, '#ai .mdl'));
      for (const p of [proto, app]) await p.evaluate(() => { const c = document.getElementById('aiVar') as HTMLInputElement; c.click(); });
      await proto.mouse.move(0, 0);
      await app.mouse.move(0, 0);
      await same(`additem-variants-${width}`, await shot(proto, '#ai .mdl'), await shot(app, '#ai .mdl'));
      // (unticking "different brands or sizes" crashes the prototype's script, so reopen the form instead)
      await proto.evaluate(() => { const w = window as unknown as { closeM: (id: string) => void; openItem: () => void }; w.closeM('ai'); w.openItem(); });
      await app.click('#aiClose');
      await app.click('#vItems .pthd .btn.p');
      for (const p of [proto, app]) await p.click('#aiTypeSw .tgs');
      await proto.locator('#aiName').blur();
      await app.locator('#aiName').blur();
      await proto.mouse.move(0, 0);
      await app.mouse.move(0, 0);
      await same(`additem-service-${width}`, await shot(proto, '#ai .mdl'), await shot(app, '#ai .mdl'));
    });

    test('Godowns screen, Add godown and Transfer stock', async ({ browser, request }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'gds');
      // this test adds a godown and moves stock, so it gets its own copy of the imported books
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/godowns');
      await app.waitForSelector('#gdRows tr');
      await app.waitForSelector('#trRows .ptempty');
      await app.waitForTimeout(300);
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(100); };
      await same(`godowns-${width}`, await shot(proto, '#vGds'), await shot(app, '#vGds'));

      // Add godown: empty, refused, then saved (the new godown is selected)
      await both((p) => p.click('#gdAdd'));
      await settle();
      await same(`gdm-${width}`, await shot(proto, '#gdm .mdl'), await shot(app, '#gdm .mdl'));
      await both((p) => p.fill('#gdName', 'Aminabad godown'));
      await both((p) => p.fill('#gdPh', '12345'));
      await both((p) => p.click('#gdm [type="submit"]'));
      await settle();
      await same(`gdm-error-${width}`, await shot(proto, '#gdm .mdl'), await shot(app, '#gdm .mdl'));
      await both((p) => p.fill('#gdAddr', 'Gali no. 3, Aminabad, Lucknow 226018'));
      await both((p) => p.fill('#gdMgr', 'Ravi Yadav'));
      await both((p) => p.fill('#gdPh', '98222 33344'));
      await both((p) => p.click('#gdm [type="submit"]'));
      await app.waitForSelector('#gdm', { state: 'hidden' });
      await app.waitForSelector('#gdRows .ptempty');
      await settle();
      await same(`godowns-added-${width}`, await shot(proto, '#vGds'), await shot(app, '#vGds'));

      // Transfer stock from the main shop: dialog, too much, then moved
      await both((p) => p.click('#gdCards .gdc:first-child'));
      await app.waitForSelector('#gdRows td.n');
      await both((p) => p.click('#trBtn'));
      await app.waitForSelector('#trAv:not(:empty)');
      await settle();
      await same(`trm-${width}`, await shot(proto, '#trm .mdl'), await shot(app, '#trm .mdl'));
      await both((p) => p.fill('#trQty', '9999'));
      await both((p) => p.click('#trm [type="submit"]'));
      await settle();
      await same(`trm-error-${width}`, await shot(proto, '#trm .mdl'), await shot(app, '#trm .mdl'));
      // an item that has stock in the main shop (top row of the table)
      const top = await app.locator('#gdRows tr:first-child td:first-child').innerText();
      await both((p) => p.selectOption('#trItem', { label: top }));
      await both((p) => p.fill('#trQty', '5'));
      await both((p) => p.click('#trm [type="submit"]'));
      await app.waitForSelector('#trRows .trr');
      await settle();
      await same(`godowns-moved-${width}`, await shot(proto, '#vGds'), await shot(app, '#vGds'));
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
    });
  });
}

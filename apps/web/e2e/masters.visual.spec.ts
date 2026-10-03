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
/**
 * Screenshot the same element in both pages and compare. Under a full parallel run
 * the browser now and then smooths text a shade differently, or catches a toast
 * mid-fade; a real difference shows every time, so take a fresh pair up to twice more.
 */
async function sameShot(name: string, proto: Page, app: Page, sel: string) {
  let d = compare(name, await shot(proto, sel), await shot(app, sel));
  for (let n = 0; n < 2 && !(d.sizeMatches && d.ratio <= MAX_RATIO); n++) {
    await proto.waitForTimeout(400);
    d = compare(name, await shot(proto, sel), await shot(app, sel));
  }
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
      await sameShot(`parties-${width}`, proto, app, '#vParties');

      // second party selected
      await proto.click('#ptList .ptr:nth-child(3)');
      await app.click('#ptList .ptr:nth-child(3)');
      await proto.waitForTimeout(200);
      await app.waitForTimeout(200);
      await sameShot(`parties-supplier-${width}`, proto, app, '#ptRight');

      // Add party: each tab, then the error state
      await proto.evaluate(() => (window as unknown as { openParty: () => void }).openParty());
      await app.click('#vParties .pthd .btn.p');
      for (const tab of ['addr', 'cred', 'extra']) {
        await proto.click(`#ap [data-aptab="${tab}"]`);
        await app.click(`#ap [data-aptab="${tab}"]`);
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        await sameShot(`addparty-${tab}-${width}`, proto, app, '#ap .mdl');
      }
      await proto.click('#ap [data-aptab="addr"]');
      await app.click('#ap [data-aptab="addr"]');
      await proto.click('#apSave');
      await app.click('#apSave');
      await proto.locator('#apName').blur();
      await app.locator('#apName').blur();
      await sameShot(`addparty-error-${width}`, proto, app, '#ap .mdl');
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
      await sameShot(`items-${width}`, proto, app, '#vItems');
      // sidebar, including the low-stock counter on Items & stock
      await sameShot(`items-side-${width}`, proto, app, '#side');

      // an item with opening stock (third in the list)
      await proto.click('#itList .ptr:nth-child(3)');
      await app.click('#itList .ptr:nth-child(3)');
      await app.waitForSelector('#itTx tr td.n');
      await proto.waitForTimeout(200);
      await app.waitForTimeout(300);
      await sameShot(`items-stock-${width}`, proto, app, '#itRight');

      // Adjust stock
      await proto.click('#itAdj');
      await app.click('#itAdj');
      await proto.fill('#adjQty', '5');
      await app.fill('#adjQty', '5');
      await proto.evaluate(() => document.getElementById('adjQty')!.dispatchEvent(new Event('input', { bubbles: true })));
      await proto.locator('#adjQty').blur();
      await app.locator('#adjQty').blur();
      await sameShot(`adjust-${width}`, proto, app, '#adj .mdl');
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
        await sameShot(`additem-${tab}-${width}`, proto, app, '#ai .mdl');
      }
      await proto.click('#ai [data-aitab="price"]');
      await app.click('#ai [data-aitab="price"]');
      await proto.click('#aiSave');
      await app.click('#aiSave');
      await proto.locator('#aiName').blur();
      await app.locator('#aiName').blur();
      await sameShot(`additem-error-${width}`, proto, app, '#ai .mdl');
      for (const p of [proto, app]) await p.evaluate(() => { const c = document.getElementById('aiVar') as HTMLInputElement; c.click(); });
      await proto.mouse.move(0, 0);
      await app.mouse.move(0, 0);
      await sameShot(`additem-variants-${width}`, proto, app, '#ai .mdl');
      // (unticking "different brands or sizes" crashes the prototype's script, so reopen the form instead)
      await proto.evaluate(() => { const w = window as unknown as { closeM: (id: string) => void; openItem: () => void }; w.closeM('ai'); w.openItem(); });
      await app.click('#aiClose');
      await app.click('#vItems .pthd .btn.p');
      for (const p of [proto, app]) await p.click('#aiTypeSw .tgs');
      await proto.locator('#aiName').blur();
      await app.locator('#aiName').blur();
      await proto.mouse.move(0, 0);
      await app.mouse.move(0, 0);
      await sameShot(`additem-service-${width}`, proto, app, '#ai .mdl');
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
      await sameShot(`godowns-${width}`, proto, app, '#vGds');

      // Add godown: empty, refused, then saved (the new godown is selected)
      await both((p) => p.click('#gdAdd'));
      await settle();
      await sameShot(`gdm-${width}`, proto, app, '#gdm .mdl');
      await both((p) => p.fill('#gdName', 'Aminabad godown'));
      await both((p) => p.fill('#gdPh', '12345'));
      await both((p) => p.click('#gdm [type="submit"]'));
      await settle();
      await sameShot(`gdm-error-${width}`, proto, app, '#gdm .mdl');
      await both((p) => p.fill('#gdAddr', 'Gali no. 3, Aminabad, Lucknow 226018'));
      await both((p) => p.fill('#gdMgr', 'Ravi Yadav'));
      await both((p) => p.fill('#gdPh', '98222 33344'));
      await both((p) => p.click('#gdm [type="submit"]'));
      await app.waitForSelector('#gdm', { state: 'hidden' });
      await app.waitForSelector('#gdRows .ptempty');
      await settle();
      await sameShot(`godowns-added-${width}`, proto, app, '#vGds');

      // Transfer stock from the main shop: dialog, too much, then moved
      await both((p) => p.click('#gdCards .gdc:first-child'));
      await app.waitForSelector('#gdRows td.n');
      await both((p) => p.click('#trBtn'));
      await app.waitForSelector('#trAv:not(:empty)');
      await settle();
      await sameShot(`trm-${width}`, proto, app, '#trm .mdl');
      await both((p) => p.fill('#trQty', '9999'));
      await both((p) => p.click('#trm [type="submit"]'));
      await settle();
      await sameShot(`trm-error-${width}`, proto, app, '#trm .mdl');
      // an item that has stock in the main shop (top row of the table)
      const top = await app.locator('#gdRows tr:first-child td:first-child').innerText();
      await both((p) => p.selectOption('#trItem', { label: top }));
      await both((p) => p.fill('#trQty', '5'));
      await both((p) => p.click('#trm [type="submit"]'));
      await app.waitForSelector('#trRows .trr');
      await settle();
      await sameShot(`godowns-moved-${width}`, proto, app, '#vGds');
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
    });

    test('Stock adjustments screen and New adjustment', async ({ browser, request }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'adjs');
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/stock-adjustments');
      await app.waitForSelector('#adjRows .ptempty');
      await app.waitForTimeout(300);
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(100); };
      await sameShot(`adjs-${width}`, proto, app, '#vAdjs');

      // New adjustment: item picker shown, first item chosen
      await both((p) => p.click('#adjNew'));
      await app.waitForSelector('#adjItem option', { state: 'attached' });
      await settle();
      await sameShot(`adjnew-${width}`, proto, app, '#adj .mdl');
      const label = (await app.locator('#adjItem option', { hasText: 'Copper wire' }).first().innerText()).trim();
      await both((p) => p.selectOption('#adjItem', { label }));
      await both((p) => p.click('#adjSeg [data-am="reduce"]'));
      await both((p) => p.fill('#adjQty', '2'));
      await proto.evaluate(() => document.getElementById('adjQty')!.dispatchEvent(new Event('input', { bubbles: true })));
      await both((p) => p.selectOption('#adjWhy', 'Damaged'));
      await settle();
      await sameShot(`adjnew-picked-${width}`, proto, app, '#adj .mdl');
      await both((p) => p.click('#adj [type="submit"]'));
      await app.waitForSelector('#adjRows td.mono');
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      // the prototype makes up a random reference (ADJ-0xx); the rebuild numbers them, so show the same text before comparing
      const ref = await app.locator('#adjRows td.mono').innerText();
      await proto.evaluate((r) => { document.querySelector('#adjRows td.mono')!.textContent = r; }, ref);
      await settle();
      await sameShot(`adjs-one-${width}`, proto, app, '#vAdjs');

      // filters
      await both((p) => p.click('#adjKind [data-ak="add"]'));
      await settle();
      await sameShot(`adjs-nomatch-${width}`, proto, app, '#vAdjs');
    });

    test('Price manager: Price View, PIN, Price Setup, preview and history', async ({ browser, request }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'prices');
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/prices');
      await app.waitForSelector('#pmRows tr td.pmv');
      await app.waitForTimeout(300);
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(100); };
      await sameShot(`prices-${width}`, proto, app, '#vPrices');

      // Price Setup asks for a PIN; the first time it sets one
      await both((p) => p.click('#pmLock'));
      await app.waitForSelector('#plkm:not([hidden])');
      await settle();
      await sameShot(`plkm-set-${width}`, proto, app, '#plkm .mdl');
      await both((p) => p.locator('#plkPin').pressSequentially('2468'));
      await both((p) => p.locator('#plkPin2').pressSequentially('1357'));
      await settle();
      await sameShot(`plkm-mismatch-${width}`, proto, app, '#plkm .mdl');
      await both((p) => p.locator('#plkPin2').pressSequentially('2468'));
      await app.waitForSelector('#psm:not([hidden])');
      await proto.waitForSelector('#psm:not([hidden])');
      await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 }));
      await settle();
      await sameShot(`psm-rule-${width}`, proto, app, '#psm .mdl');

      // this shop has no brands yet, so Brand rules asks to pick one; Fine-tune items: LED bulb 9W at purchase + 25 %
      await both((p) => p.click('#psTabs [data-pst="item"]'));
      await settle();
      await sameShot(`psm-item-${width}`, proto, app, '#psm .mdl');
      const row = (p: Page) => p.locator('#psBody tr[data-psi]', { hasText: 'LED bulb 9W' }).locator('[data-pm]').first();
      await both((p) => row(p).fill('25'));
      // (the prototype selects the box's text on focus, racing the typing; leave the box so both look settled)
      await both((p) => row(p).blur());
      await settle();
      await sameShot(`psm-item-typed-${width}`, proto, app, '#psm .mdl');
      await both((p) => p.click('#psGo'));
      await app.waitForSelector('#ppv:not([hidden])');
      await settle();
      await sameShot(`ppv-${width}`, proto, app, '#ppv .mdl');
      await both((p) => p.click('#ppvApply'));
      await app.waitForSelector('#ppv', { state: 'hidden' });
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await settle();
      await sameShot(`psm-item-saved-${width}`, proto, app, '#psm .mdl');
      await both((p) => p.click('#psClose'));
      await app.waitForSelector('#psm', { state: 'hidden' });
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await app.waitForTimeout(400);
      await settle();
      await sameShot(`prices-after-${width}`, proto, app, '#vPrices');

      // History: the server's clock stamps the rebuild's rows, so show the same time before comparing
      await both((p) => p.click('#pmHist'));
      await app.waitForSelector('#phRows tr td.mu');
      const times = await app.locator('#phRows tr td:first-child').allInnerTexts();
      await proto.evaluate((t) => document.querySelectorAll('#phRows tr td:first-child').forEach((td, k) => { td.textContent = t[k] ?? td.textContent; }), times);
      await settle();
      await sameShot(`phm-${width}`, proto, app, '#phm .mdl');
    });

    test('Price Setup brand rules on the sample catalogue', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto, 'sample-shop');
      await openPrototypeView(proto, 'prices');
      await signInAs(app, await freshShop(request, 'sample-shop', { includeSample: true }));
      await app.goto(APP + '/prices');
      await app.waitForSelector('#pmRows tr td.pmv');
      await app.waitForTimeout(500);
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(150); };
      await sameShot(`prices-sample-${width}`, proto, app, '#vPrices');
      await both((p) => p.click('#pmLock'));
      await both((p) => p.locator('#plkPin').pressSequentially('2468'));
      await both((p) => p.locator('#plkPin2').pressSequentially('2468'));
      await app.waitForSelector('#psm:not([hidden]) .prhd');
      // let the "PIN saved" message go first (it sits over the dialog)
      await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 }));
      await settle();
      // the first brand is picked; no rule saved yet
      await sameShot(`prules-${width}`, proto, app, '#psm .mdl');
      await both((p) => p.selectOption('#psBody [data-prf="sale"] [data-k="m"]', 'lp'));
      await both((p) => p.fill('#psBody [data-prf="sale"] [data-k="v"]', '10'));
      await both((p) => p.locator('#psBody [data-prf="sale"] [data-k="v"]').blur());
      await settle();
      await sameShot(`prules-set-${width}`, proto, app, '#psm .mdl');
      await both((p) => p.click('#psGo'));
      await app.waitForSelector('#ppv:not([hidden])');
      await settle();
      await sameShot(`prules-ppv-${width}`, proto, app, '#ppv .mdl');
      await both((p) => p.click('#ppvApply'));
      await app.waitForSelector('#ppv', { state: 'hidden' });
      await app.waitForTimeout(500);
      await settle();
      await sameShot(`prules-saved-${width}`, proto, app, '#psm .mdl');
    });

    test('Price manager: rate list and Excel files', async ({ browser, request }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'prices');
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/prices');
      await app.waitForSelector('#pmRows tr td.pmv');
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(100); };
      await both((p) => p.click('#pmRate'));
      await app.waitForSelector('#rlSheet .rlh small:not(:empty)');
      await settle();
      await sameShot(`rlm-${width}`, proto, app, '#rlm .mdl');
      await both((p) => p.selectOption('#rlGroup', 'brand'));
      await both((p) => p.click('#rlCols [data-rlcol="unit"]'));
      await both((p) => p.fill('#rlTitle', 'Contractor rates'));
      await settle();
      await sameShot(`rlm-brand-${width}`, proto, app, '#rlm .mdl');
      if (width !== 1366) return;
      // the files: same names and the same cells as the prototype's
      const { default: ExcelJS } = await import('exceljs');
      const cells = async (path: string) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(path);
        const out: unknown[][] = [];
        wb.worksheets[0]!.eachRow({ includeEmpty: true }, (r, n) => { out[n - 1] = (r.values as unknown[]).slice(1).map((v) => (v === undefined ? null : v)); });
        return Array.from(out, (r) => r ?? []);
      };
      const grab = async (p: Page, sel: string) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return { name: d.suggestedFilename(), path: await d.path() }; };
      const [px, ax] = [await grab(proto, '#rlXls'), await grab(app, '#rlXls')];
      expect(ax.name).toBe(px.name);
      expect(await cells(ax.path)).toEqual(await cells(px.path));
      const [pp, ap] = [await grab(proto, '#rlPdf'), await grab(app, '#rlPdf')];
      expect(ap.name).toBe(pp.name);
      expect((await import('node:fs')).readFileSync(ap.path).subarray(0, 5).toString()).toBe('%PDF-');
      await both((p) => p.click('#rlClose'));
      const [pe, ae] = [await grab(proto, '#pmExport'), await grab(app, '#pmExport')];
      expect(ae.name).toBe(pe.name);
      expect(await cells(ae.path)).toEqual(await cells(pe.path));
    });
  });
}

/**
 * Phase 2 screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/fresh-shop.backup.json, imported into the
 * rebuild's e2e shop). Pixel comparison at 1280, 1366 and 1920 px.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { approvedShot, hideHeader, sameShot, shot } from './shots';
import { withDotsAll, withLineDots } from './row-dots';
import { APP, RAVI, WIDTHS, freshShop, newPage, openPrototypeView, prototypeWithBackup, signInAs } from './setup';
import { BKP, fakeBackup } from './backup.data';
import { brandItems } from './brands.data';

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
      // about 35 s when every picture matches; a changed picture is taken up to three times, so give it room
      test.slow();
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'items');
      await signInAs(app, RAVI);
      await app.goto(APP + '/items');
      await app.waitForSelector('#itList .ptr');
      await app.waitForSelector('#itHead h2');
      await app.waitForTimeout(400);
      // owner's change: the item card has a "Purchase rate of stock left" table the prototype doesn't
      // have (checked with its own approved pictures in item-rates.visual); it is left out here so the
      // rest of the card is still compared with the prototype pixel for pixel
      await app.addStyleTag({ content: '#itRates{display:none!important}' });
      // owner's change: the top bar has the Brands & Series button, so it is compared with its approved
      // picture; the rest of the screen is still compared with the prototype
      await approvedShot(`items-bar-${width}`, app, '#vItems .pthd');
      // Stock value by purchase-rate lots and the automatic purchase price (owner, Oct 2026) change the figures on
      // Items, Godowns, Stock adjustments, Price manager and Price Setup, so those are compared with approved pictures
      await approvedShot(`items-${width}`, app, '#vItems .ptg');
      // sidebar, including the low-stock counter on Items & stock
      await sameShot(`items-side-${width}`, proto, app, '#side');

      // an item with opening stock (third in the list)
      await proto.click('#itList .ptr:nth-child(3)');
      await app.click('#itList .ptr:nth-child(3)');
      await app.waitForSelector('#itTx tr td.n');
      await proto.waitForTimeout(200);
      await app.waitForTimeout(300);
      // owner's change (Oct 2026): "Latest / Avg purchase price" and the figures one size smaller, so the card
      // is compared with its approved picture
      await approvedShot(`items-stock-${width}`, app, '#itRight');

      // Adjust stock
      await proto.click('#itAdj');
      await app.click('#itAdj');
      await proto.fill('#adjQty', '5');
      await app.fill('#adjQty', '5');
      await proto.evaluate(() => document.getElementById('adjQty')!.dispatchEvent(new Event('input', { bubbles: true })));
      await proto.locator('#adjQty').blur();
      await app.locator('#adjQty').blur();
      await approvedShot(`adjust-${width}`, app, '#adj .mdl');
      // something was typed, so Cancel asks first
      for (const p of [proto, app]) await p.click('#adjCancel');
      await app.waitForSelector('#dcf:not([hidden])');
      await app.waitForTimeout(100);
      await sameShot(`dcf-${width}`, proto, app, '#dcf .mdl');
      for (const p of [proto, app]) await p.keyboard.press('Enter');
      await sameShot(`dcf-armed-${width}`, proto, app, '#dcf .mdl');
      // (a second Enter would discard too, but only within 2.5 s; the screenshots can take longer)
      for (const p of [proto, app]) await p.click('#dcfYes');
      await app.waitForSelector('#adj', { state: 'hidden' });

      // Add item: the owner approved a new look (Single / Variant switch, Select unit window, add-new popups),
      // so these are compared with approved pictures (e2e/approved/) instead of the prototype.
      // Product (both tabs), error, variant, Select unit, the four popups, service.
      const look = async () => { await app.mouse.move(0, 0); await app.waitForTimeout(200); };
      await app.click('#vItems .pthd .btn.p');
      await app.waitForSelector('#ai:not([hidden]) #aiName');
      await app.waitForSelector('#aiCatL .aiso:nth-child(3)', { state: 'attached' });
      for (const tab of ['price', 'stock']) {
        await app.click(`#ai [data-aitab="${tab}"]`);
        await look();
        await approvedShot(`additem-${tab}-${width}`, app, '#ai .mdl');
      }
      await app.click('#ai [data-aitab="price"]');
      await app.click('#aiSave');
      await app.locator('#aiName').blur();
      await look();
      await approvedShot(`additem-error-${width}`, app, '#ai .mdl');
      await app.click('#aiVar');
      await look();
      await approvedShot(`additem-variants-${width}`, app, '#ai .mdl');
      // Select unit with a secondary unit chosen
      await app.click('#aiUnit');
      await app.selectOption('#aiUBase', 'COIL');
      await app.selectOption('#aiUSec', 'MTR');
      await app.fill('#aiURate', '90');
      await app.locator('#aiURate').blur();
      await look();
      await approvedShot(`additem-units-${width}`, app, '#aiUnits .mdl');
      // add-new popups (Escape closes only the popup on top)
      await app.selectOption('#aiUBase', '__new');
      await look();
      await approvedShot(`addpop-unit-${width}`, app, '#aiAdd_unit .mdl');
      await app.keyboard.press('Escape');
      await app.keyboard.press('Escape');
      await app.waitForSelector('#aiUnits', { state: 'hidden' });
      for (const [kind, sel, row] of [['group', '#aiName', '+ Add new parent item'], ['brand', '#aiBrandSel', '+ Add new brand'], ['cat', '#aiCat', '+ Add category']] as const) {
        await app.click(sel);
        await app.locator(`${sel}L`).getByRole('option', { name: row, exact: true }).click();
        await look();
        await approvedShot(`addpop-${kind}-${width}`, app, `#aiAdd_${kind} .mdl`);
        await app.keyboard.press('Escape');
        await app.waitForSelector(`#aiAdd_${kind}`, { state: 'hidden' });
      }
      await app.click('#aiClose');
      await app.click('#vItems .pthd .btn.p');
      await app.click('#aiTypeSw .tgs');
      await app.locator('#aiName').blur();
      await look();
      await approvedShot(`additem-service-${width}`, app, '#ai .mdl');
    });

    test('Add item › Variant: the open Series list and Add series popup (owner-approved searchable drop-downs)', async ({ browser, request }) => {
      const app = await newPage(browser, width);
      const who = await freshShop(request);
      // 6A-10A 1WAY SWITCH in HAVELLS CORAL / PEARLZ and NORWOOD CLASSIC
      await brandItems(request, who);
      await signInAs(app, who);
      await app.goto(APP + '/items');
      await app.click('#vItems .pthd .btn.p');
      await app.click('#aiVar');
      await app.fill('#aiName', '1way');
      await app.keyboard.press('Enter');
      await app.fill('#aiBrandSel', 'havells');
      await app.keyboard.press('Enter');
      await app.click('#aiSeries');
      await app.locator('#aiSeriesL').getByRole('option', { name: '+ Add series', exact: true }).click();
      await app.fill('#aiAdd_seriesN', 'Allure');
      await app.click('#aiAdd_seriesGo');
      await expect(app.locator('#aiSeries')).toHaveValue('Allure');
      // the "added" message at the top would cover the window
      await app.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 });
      // the list: only HAVELLS series; the two this parent item has are "already added"
      await app.click('#aiSeries');
      await expect(app.locator('#aiSeriesL [role="option"]')).toHaveText(['Allure', 'CORALalready added', 'PEARLZalready added', '+ Add series']);
      await app.mouse.move(0, 0);
      await app.waitForTimeout(200);
      await approvedShot(`additem-serieslist-${width}`, app, '#ai .mdl');
      await app.keyboard.press('Escape');
      await app.click('#aiSeries');
      await app.locator('#aiSeriesL').getByRole('option', { name: '+ Add series', exact: true }).click();
      await app.mouse.move(0, 0);
      await app.waitForTimeout(200);
      await approvedShot(`addpop-series-${width}`, app, '#aiAdd_series .mdl');
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
      await approvedShot(`godowns-${width}`, app, '#vGds');

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
      await approvedShot(`godowns-added-${width}`, app, '#vGds');

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
      await withLineDots(proto, app);
      await approvedShot(`godowns-moved-${width}`, app, '#vGds');
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
      await withDotsAll(proto, app, '#adjRows');
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
      await approvedShot(`adjnew-picked-${width}`, app, '#adj .mdl');
      await both((p) => p.click('#adj [type="submit"]'));
      await app.waitForSelector('#adjRows td.mono');
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      // the prototype makes up a random reference (ADJ-0xx); the rebuild numbers them, so show the same text before comparing
      const ref = await app.locator('#adjRows td.mono').innerText();
      await proto.evaluate((r) => { document.querySelector('#adjRows td.mono')!.textContent = r; }, ref);
      await settle();
      await withDotsAll(proto, app, '#adjRows');
      await approvedShot(`adjs-one-${width}`, app, '#vAdjs');

      // filters
      await both((p) => p.click('#adjKind [data-ak="add"]'));
      await settle();
      await withDotsAll(proto, app, '#adjRows');
      await approvedShot(`adjs-nomatch-${width}`, app, '#vAdjs');
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
      await approvedShot(`prices-${width}`, app, '#vPrices');

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
      await approvedShot(`psm-item-${width}`, app, '#psm .mdl');
      const row = (p: Page) => p.locator('#psBody tr[data-psi]', { hasText: 'LED bulb 9W' }).locator('[data-pm]').first();
      await both((p) => row(p).fill('25'));
      // (the prototype selects the box's text on focus, racing the typing; leave the box so both look settled)
      await both((p) => row(p).blur());
      await settle();
      await approvedShot(`psm-item-typed-${width}`, app, '#psm .mdl');
      await both((p) => p.click('#psGo'));
      await app.waitForSelector('#ppv:not([hidden])');
      await settle();
      await approvedShot(`ppv-${width}`, app, '#ppv .mdl');
      await both((p) => p.click('#ppvApply'));
      await app.waitForSelector('#ppv', { state: 'hidden' });
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await settle();
      await approvedShot(`psm-item-saved-${width}`, app, '#psm .mdl');
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
      await approvedShot(`prices-sample-${width}`, app, '#vPrices');
      await both((p) => p.click('#pmLock'));
      await both((p) => p.locator('#plkPin').pressSequentially('2468'));
      await both((p) => p.locator('#plkPin2').pressSequentially('2468'));
      await app.waitForSelector('#psm:not([hidden]) .prhd');
      // let the "PIN saved" message go first (it sits over the dialog)
      await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 }));
      await settle();
      // the window's rounded corners would show the top bar behind it (changed by the owner; checked on its own)
      await hideHeader(proto, app);
      // the first brand is picked; no rule saved yet
      await approvedShot(`prules-${width}`, app, '#psm .mdl');
      await both((p) => p.selectOption('#psBody [data-prf="sale"] [data-k="m"]', 'lp'));
      await both((p) => p.fill('#psBody [data-prf="sale"] [data-k="v"]', '10'));
      await both((p) => p.locator('#psBody [data-prf="sale"] [data-k="v"]').blur());
      await settle();
      await approvedShot(`prules-set-${width}`, app, '#psm .mdl');
      await both((p) => p.click('#psGo'));
      await app.waitForSelector('#ppv:not([hidden])');
      await settle();
      // the "Rule saved" message fades at its own pace: hidden only while this picture is taken (the screen is unchanged)
      const noToast = await app.addStyleTag({ content: '#toast{visibility:hidden!important}' });
      await approvedShot(`prules-ppv-${width}`, app, '#ppv .mdl');
      await noToast.evaluate((e) => (e as Element).remove());
      await both((p) => p.click('#ppvApply'));
      await app.waitForSelector('#ppv', { state: 'hidden' });
      await app.waitForTimeout(500);
      await settle();
      await approvedShot(`prules-saved-${width}`, app, '#psm .mdl');
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
      // the purchase price is automatic (owner, Oct 2026): the imported Copper wire's is its opening rate, 1540 (the old app kept 1560)
      const want = await cells(pe.path);
      const wire = want.find((r) => r.includes('Copper wire 1.5 sq mm (90 m)'))!;
      expect(wire.filter((v) => v === 1560)).toHaveLength(1);
      wire[wire.indexOf(1560)] = 1540;
      expect(await cells(ae.path)).toEqual(want);
    });

    test('New price list opens after the price PIN', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto, 'sample-shop');
      await openPrototypeView(proto, 'prices');
      await signInAs(app, await freshShop(request, 'sample-shop', { includeSample: true }));
      await app.goto(APP + '/prices');
      await app.waitForSelector('#pmRows tr td.pmv');
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await app.waitForTimeout(300); await proto.waitForTimeout(150); };
      // the rebuild asks for the PIN first (owner's choice); the prototype is opened the way its own screenshots were
      await app.click('#pmNewPl');
      await app.locator('#plkPin').pressSequentially('2468');
      await app.locator('#plkPin2').pressSequentially('2468');
      await app.waitForSelector('#plm:not([hidden]) #plGroups label');
      await proto.evaluate("PLK.locked=false;rerenderPriceViews();$('plNew').click()");
      await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 }));
      await settle();
      await sameShot(`plm-${width}`, proto, app, '#plm .mdl');
      await both((p) => p.click('#plm [type="submit"]'));
      await settle();
      await sameShot(`plm-error-${width}`, proto, app, '#plm .mdl');
      await both((p) => p.fill('#plName', 'Dealer price'));
      await both((p) => p.selectOption('#plRule', 'mark'));
      await both((p) => p.fill('#plVal', '20'));
      await both((p) => p.locator('#plVal').dispatchEvent('input'));
      await both((p) => p.click('#plGroups label:nth-child(2)'));
      await settle();
      await sameShot(`plm-filled-${width}`, proto, app, '#plm .mdl');
      await both((p) => p.click('#plm [type="submit"]'));
      await app.waitForSelector('#plm', { state: 'hidden' });
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await app.waitForSelector('#pmHead th:has-text("Dealer price")');
      // the rebuild locks prices again when the window closes; do the same in the prototype
      await proto.evaluate("PLK.locked=true;rerenderPriceViews()");
      await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 }));
      await settle();
      await sameShot(`prices-newpl-${width}`, proto, app, '#vPrices .pthd');
      await sameShot(`prices-newpl-head-${width}`, proto, app, '#pmHead');
    });

    test('Settings: Taxes & GST, tax list, GST off question', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'set');
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/settings');
      await app.waitForSelector('#pv .pvl');
      await app.waitForTimeout(300);
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 })); await app.waitForTimeout(300); };
      // the page is taller than the window, so its pictures would include the top bar (changed by the owner; checked on its own)
      await hideHeader(proto, app);
      await sameShot(`set-tax-${width}`, proto, app, '#vSet');
      // TCS and TDS on: their default rates and the preview lines appear
      await both((p) => p.click('#cTcs .tgs'));
      await both((p) => p.click('#cTds .tgs'));
      await settle();
      await sameShot(`set-tax-tcs-tds-${width}`, proto, app, '#vSet');
      await both((p) => p.click('#cGst [data-reg="composition"]'));
      await settle();
      await sameShot(`set-tax-comp-${width}`, proto, app, '#vSet');
      await both((p) => p.click('#cGst [data-reg="regular"]'));
      // a wrong GSTIN is explained
      await both((p) => p.fill('#sGstin', '09AAGFG2231'));
      await settle();
      await sameShot(`set-gstin-${width}`, proto, app, '#cGst');
      await both((p) => p.fill('#sGstin', '09AAGFG2231M1ZQ'));
      await both((p) => p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }));
      // the tax list: the prototype's "used in" figures are made up, so show the rebuild's real counts there
      await both((p) => p.click('#taxListBtn'));
      await app.waitForSelector('#tl:not([hidden]) #tlBody tr');
      const used = await app.locator('#tlBody tr td:nth-child(4)').evaluateAll((tds) => tds.map((t) => t.innerHTML));
      await proto.evaluate((u) => document.querySelectorAll('#tlBody tr td:nth-child(4)').forEach((td, k) => { td.innerHTML = u[k] ?? td.innerHTML; }), used);
      await settle();
      await sameShot(`tl-${width}`, proto, app, '#tl .mdl');
      await both((p) => p.click('#tlForm [type="submit"]'));
      await settle();
      await sameShot(`tl-error-${width}`, proto, app, '#tl .mdl');
      await both((p) => p.click('#tlTabs [data-tl="TDS"]'));
      await settle();
      await sameShot(`tl-tds-${width}`, proto, app, '#tl .mdl');
      await both((p) => p.click('#tlClose'));
      // turning GST off asks first (the prototype quotes a made-up invoice count)
      await both((p) => p.click('#cGst .tgs'));
      await app.waitForSelector('#cfm:not([hidden])');
      await proto.evaluate(() => { const p = document.querySelector('#cfm p')!; p.textContent = p.textContent!.replace(/Your existing \d+ invoices/, 'Your existing invoices'); });
      await settle();
      await sameShot(`cfm-${width}`, proto, app, '#cfm .mdl');
      await both((p) => p.click('#cfmYes'));
      await settle();
      // the prototype refreshes its bell count only when the bell is opened; the rebuild keeps it current
      const bell = await app.locator('#bellCnt').innerText();
      await proto.evaluate((b) => { document.getElementById('bellCnt')!.textContent = b; }, bell);
      await sameShot(`set-gst-off-${width}`, proto, app, '#vSet');
    });

    test('Settings: Items & prices, General, Start fresh', async ({ browser, request }) => {
      test.setTimeout(180_000);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      // the Backup & restore card shows the database's size, which changes from run to run: a fixed answer
      await fakeBackup(app, BKP.none);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'set');
      await signInAs(app, await freshShop(request, 'fresh-shop'));
      await app.goto(APP + '/settings');
      await app.waitForSelector('#pv .pvl');
      const both = async (fn: (p: Page) => Promise<unknown>) => { for (const p of [proto, app]) await fn(p); };
      const settle = async () => { await both((p) => p.mouse.move(0, 0)); await both((p) => p.waitForFunction(() => !document.getElementById('toast')?.classList.contains('on'), null, { timeout: 10_000 })); await app.waitForTimeout(300); };
      /** texts the rebuild changes on purpose (it never deletes books; data lives on the server): show the same before comparing */
      const align = async (sels: string[]) => {
        const html = await app.evaluate((ss) => ss.map((q) => [...document.querySelectorAll(q)].map((e) => e.outerHTML)), sels);
        await proto.evaluate(([ss, hh]) => ss.forEach((q, k) => document.querySelectorAll(q).forEach((e, j) => { if (hh[k]![j]) e.outerHTML = hh[k]![j]!; })), [sels, html] as const);
      };
      await both((p) => p.click('#subnav [data-settab="items"]'));
      await app.waitForSelector('#cPlSet .tgl');
      await settle();
      // the heading and the side menu are as in the prototype; the Items card has the owner-approved
      // "Item codes" section under the price lists, so it is compared with its approved picture
      await sameShot(`set-items-head-${width}`, proto, app, '#vSet .hero');
      await sameShot(`set-items-nav-${width}`, proto, app, '#subnav');
      await approvedShot(`set-items-${width}`, app, '#cPlSet');
      await both((p) => p.click('#cPlSet .tgl:nth-of-type(3) .tgs'));
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await settle();
      await approvedShot(`set-items-on-${width}`, app, '#cPlSet');
      // General
      await both((p) => p.click('#subnav [data-settab="gen"]'));
      await app.waitForSelector('#bzCard #bzName');
      // the whole Backup & restore card (owner-approved, new): the page behind the Start fresh window must match, it shows at the window's rounded corners
      await align(['#bzFresh', '#bkpCard']);
      await settle();
      // owner's change: General has the Colour combination and Shortcuts moved from the top bar, so it is compared
      // with its approved picture; from here on the top bar is hidden (it has its own check), also behind the Start fresh window
      await hideHeader(proto, app);
      // the prototype's page is still photographed (and the picture dropped), as when this was compared with it:
      // taking the picture scrolls the page and redraws its text, and the next checks expect both pages in that state
      await shot(proto, '#vSet');
      await approvedShot(`set-gen-${width}`, app, '#vSet');
      await both((p) => p.fill('#bzName', ''));
      await both((p) => p.click('#bzSaveBtn'));
      await settle();
      await sameShot(`set-bz-error-${width}`, proto, app, '#bzCard');
      await both((p) => p.fill('#bzName', 'Gupta Electricals & Hardware'));
      await both((p) => p.fill('#sUpi', 'gupta@'));
      await both((p) => p.locator('#sUpi').blur());
      await settle();
      // (the UPI row sits lower now, on a half pixel, so it is compared with its approved picture)
      await approvedShot(`set-upi-error-${width}`, app, '#cGen .plset');
      await both((p) => p.fill('#sUpi', 'gupta@okhdfcbank'));
      await both((p) => p.locator('#sUpi').blur());
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await both((p) => p.locator('label.tgs:has(#sMrp)').click());
      await expect(app.locator('#toast')).toHaveText(await proto.locator('#toast').innerText());
      await settle();
      // Start fresh window
      await both((p) => p.click('#bzFreshBtn'));
      await app.waitForSelector('#bzm:not([hidden]) #bzfName');
      await align(['#bzm .dh small', '#bzm label.cb2', '#bzmGo']);
      await both((p) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()));
      await settle();
      await sameShot(`bzm-${width}`, proto, app, '#bzm .mdl');
    });

    test('Restore books window (import upload)', async ({ browser, request }) => {
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      await prototypeWithBackup(proto);
      await openPrototypeView(proto, 'set');
      // (the prototype's General button only works once another tab has been opened)
      await proto.click('#subnav [data-settab="items"]');
      await proto.click('#subnav [data-settab="gen"]');
      await signInAs(app, await freshShop(request));
      await app.goto(APP + '/settings');
      await app.click('#subnav [data-settab="gen"]');
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/importer/fixtures/fresh-shop.backup.json');
      for (const p of [proto, app]) await p.setInputFiles('#bkpFile', file);
      await app.waitForSelector('#rsmCheck');
      await proto.waitForSelector('#rsm:not([hidden])');
      for (const p of [proto, app]) await p.mouse.move(0, 0);
      await app.waitForTimeout(300);
      // header and the summary of what is in the file; the explanation below differs on purpose (the rebuild adds, it never replaces)
      await sameShot(`rsm-head-${width}`, proto, app, '#rsm .dh');
      await sameShot(`rsm-summary-${width}`, proto, app, '#rsmBody .rcv');
    });
  });
}

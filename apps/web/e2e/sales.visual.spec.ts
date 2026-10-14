/**
 * Phase 3 sales screens vs the prototype, both showing the same books
 * (packages/importer/fixtures/sales-shop.backup.json: invoices, a payment, a
 * return, challans and a quotation made through the prototype's own screens).
 *
 * The entry windows are full screen (owner's change: no sidebar or top bar), so pictures of the
 * editor and of the pop-ups over it are compared with owner-approved pictures (e2e/approved/).
 */
import { expect, test, type Page } from '@playwright/test';
import { approvedShot, sameShot } from './shots';
import { APP, PROTO_PRINT, SALES, WIDTHS, freshShop, newPage, openPrototypeView, prototypeWithBackup, savePrint, signInAs } from './setup';

/** `who`: a shop of its own for tests that add records (the shared sales shop must stay as the prototype's) */
async function pages(browser: Parameters<typeof newPage>[0], width: number, view: string, path: string, ready: string, who = SALES) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  await prototypeWithBackup(proto, 'sales-shop');
  await openPrototypeView(proto, view);
  // the invoice window is compared with the prototype's, so print with the prototype's layout ("Simple")
  await savePrint(app.request, who, PROTO_PRINT);
  await signInAs(app, who);
  await app.goto(APP + path);
  await app.waitForSelector(ready);
  return { proto, app };
}
const both = async (a: Page, b: Page, fn: (p: Page) => Promise<unknown>) => { await fn(a); await fn(b); };
/**
 * Deliberate difference (owner's request): the rebuild's editor has bill tabs above the
 * title, drawn with the prototype's own leftover bill-tab styles. Copy the strip into the
 * prototype so everything else is still compared pixel for pixel.
 */
async function withTabs(proto: Page, app: Page) {
  const html = await app.locator('#siTabs').evaluate((e) => e.outerHTML);
  await proto.evaluate((h) => { document.getElementById('siTabs')?.remove(); document.querySelector('#vNewInv > .sitop')!.insertAdjacentHTML('afterbegin', h); window.dispatchEvent(new Event('resize')); }, html);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Sales invoices: list, actions menu, preview, cancelled invoice, filters', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await sameShot(`sales-${width}`, proto, app, '#vSales');

      // right-click actions on a partly paid invoice
      const menu = (no: string) => both(proto, app, async (p) => { const b = await p.locator(`#slRows tr[data-sno="${no}"]`).boundingBox(); await p.mouse.click(b!.x + 200, b!.y + 10, { button: 'right' }); });
      await menu('INV-0101');
      // deliberate difference: invoices are never deleted, so "Delete" is greyed out with a reason
      await proto.evaluate(() => { const b = document.querySelector<HTMLButtonElement>('#slCtx [data-sla="del"]')!; b.disabled = true; b.title = 'Invoices are never deleted — cancel instead'; });
      await sameShot(`sales-menu-${width}`, proto, app, '#slCtx');
      await both(proto, app, (p) => p.keyboard.press('Escape'));

      // the invoice preview (discount, transport, round off)
      await menu('INV-0103');
      await both(proto, app, (p) => p.click('#slCtx [data-sla="prev"]'));
      await app.waitForSelector('#ipv:not([hidden]) .ivh');
      await sameShot(`sales-preview-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));

      // a cancelled invoice
      await menu('INV-0104');
      await both(proto, app, (p) => p.click('#slCtx [data-sla="prev"]'));
      await app.waitForSelector('#ipv:not([hidden]) .ivcan');
      await sameShot(`sales-cancelled-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));

      // status filter in the column head, then "Paid" applied
      await both(proto, app, (p) => p.click('[data-thf="slSt"]'));
      await sameShot(`sales-filter-${width}`, proto, app, '#thfPop');
      await both(proto, app, (p) => p.click('#thfPop [data-thv="paid"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`sales-paid-${width}`, proto, app, '#vSales');
    });

    test('Payments received and the Receive payment window', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'pin', '/payments-received', '#rcRows tr[data-rcno]');
      await sameShot(`receipts-${width}`, proto, app, '#vPin');
      // a customer with an unpaid invoice and an opening balance: dues filled oldest first
      await both(proto, app, (p) => p.click('#rcNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#rcParty option', { hasText: 'Raju Electrician' }).getAttribute('value'); await p.selectOption('#rcParty', id!); });
      await app.waitForSelector('#rcBills input[data-rca]');
      await both(proto, app, (p) => p.locator('#rcRef').click());
      await sameShot(`receive-${width}`, proto, app, '#rcm .mdl');
      // a mistake shows the prototype's message
      await both(proto, app, async (p) => { await p.selectOption('#rcModeI', 'Cheque'); await p.click('#rcSave'); });
      await sameShot(`receive-error-${width}`, proto, app, '#rcm .mdl');
    });

    test('Credit notes and New credit note', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'cns', '/credit-notes', '#cnRows tr[data-cnno]');
      await sameShot(`creditnotes-${width}`, proto, app, '#vCns');
      await both(proto, app, (p) => p.click('#cnRows tr[data-cnno="CN-0001"]'));
      await sameShot(`creditnote-view-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, (p) => p.click('#slmCancel'));
      // a customer with two invoices: tick the first, return one coil
      await both(proto, app, (p) => p.click('#cnNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#cnParty option', { hasText: 'Mehta Electricals' }).getAttribute('value'); await p.selectOption('#cnParty', id!); });
      await both(proto, app, (p) => p.click('#cnInvs [data-cninv="INV-0101"]'));
      await app.waitForSelector('#cnRowsI [data-cnq]');
      await both(proto, app, async (p) => { await p.fill('#cnRowsI tr[data-cnk="0"] [data-cnq]', '1'); await p.locator('#cnRowsI tr[data-cnk="0"] [data-cnq]').dispatchEvent('input'); });
      await both(proto, app, (p) => p.locator('#cnDate').click());
      await sameShot(`creditnote-new-${width}`, proto, app, '#cnm .mdl');
    });

    test('Delivery challans: list, print view, New delivery challan', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'dcs', '/delivery-challans', '#dcRows tr[data-dcno]');
      await sameShot(`challans-${width}`, proto, app, '#vDcs');
      await both(proto, app, (p) => p.click('#dcRows [data-dcprint="DC-0001"]'));
      await app.waitForSelector('#ipv:not([hidden]) .dch');
      await sameShot(`challan-print-${width}`, proto, app, '#ipv .mdl');
      await both(proto, app, (p) => p.click('#ipvClose'));
      await both(proto, app, (p) => p.click('#dcNew'));
      await both(proto, app, async (p) => { const id = await p.locator('#dcParty option', { hasText: 'Raju Electrician' }).getAttribute('value'); await p.selectOption('#dcParty', id!); });
      await both(proto, app, async (p) => { await p.fill('#dcAddI', 'LED bulb 9W'); await p.locator('#dcAddI').dispatchEvent('change'); });
      await app.waitForSelector('#dcRowsI [data-dcq]');
      await both(proto, app, (p) => p.locator('#dcTr').click());
      await sameShot(`challan-new-${width}`, proto, app, '#dcm .mdl');
    });

    test('Invoice editor: new sale, a credit sale with items, discount & charges, payment', async ({ browser }) => {
      test.setTimeout(150_000); // five side-by-side shots of a large screen
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await proto.evaluate(() => (window as unknown as { openInvoice: () => void }).openInvoice());
      await app.click('#vSales .pthd .btn.p');
      await app.waitForSelector('#vNewInv #siRows tr[data-ln]');
      await proto.waitForTimeout(300);
      await withTabs(proto, app);
      await approvedShot(`editor-new-${width}`, app, '#vNewInv');
      // choose the party from the list, then add two items through rapid entry
      await both(proto, app, async (p) => { await p.fill('#siParty', 'Mehta'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); });
      for (const [item, qty] of [['LED bulb', '10'], ['Copper wire', '1']] as const) {
        await both(proto, app, async (p) => { await p.locator('#qeItem').fill(item); await p.waitForTimeout(100); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.locator('#qeQty').fill(qty); await p.locator('#qeQty').press('Control+Enter'); });
      }
      await both(proto, app, async (p) => { await p.locator('#siBill').click(); await p.mouse.move(0, 0); });
      await proto.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await withTabs(proto, app);
      await approvedShot(`editor-filled-${width}`, app, '#vNewInv');
      // discount & charges pop-up
      await both(proto, app, (p) => p.click('#siChgBtn'));
      await both(proto, app, async (p) => { await p.fill('#siBdP', '5'); await p.locator('#siBdP').dispatchEvent('input'); await p.fill('#siChTr', '100'); await p.locator('#siChTr').dispatchEvent('input'); });
      await withTabs(proto, app);
      await approvedShot(`editor-charges-${width}`, app, '#siChgPop');
      await both(proto, app, (p) => p.click('#siChgDone'));
      // payment pop-up with a part payment
      await both(proto, app, (p) => p.click('#siPayBtn'));
      await both(proto, app, async (p) => { await p.locator('#siPayC [data-pk="amt"]').fill('1000'); await p.locator('#siPayC [data-pk="amt"]').dispatchEvent('input'); });
      await withTabs(proto, app);
      await approvedShot(`editor-payment-${width}`, app, '#siPayPop');
      await both(proto, app, (p) => p.click('[data-paydone="si"]'));
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await withTabs(proto, app);
      await approvedShot(`editor-footer-${width}`, app, '#vNewInv .sift');
    });

    test('Invoice editor extras: transport, terms, description, attachments, profit & loss', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await proto.evaluate(() => (window as unknown as { openInvoice: () => void }).openInvoice());
      await app.click('#vSales .pthd .btn.p');
      await app.waitForSelector('#vNewInv #siRows tr[data-ln]');
      await both(proto, app, async (p) => { await p.fill('#siParty', 'Mehta'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); });
      for (const [item, qty] of [['LED bulb', '10'], ['Copper wire', '1']] as const) {
        await both(proto, app, async (p) => { await p.locator('#qeItem').fill(item); await p.waitForTimeout(100); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.locator('#qeQty').fill(qty); await p.locator('#qeQty').press('Control+Enter'); });
      }
      const tool = (k: string) => both(proto, app, async (p) => { await p.click(`#siTools [data-dgt="si:${k}"]`); await p.waitForTimeout(100); });
      // (copied in first: the prototype reopens an open extras pop-up on resize, which moves focus)
      await withTabs(proto, app);
      // transport details, typed in
      await tool('tr');
      await both(proto, app, async (p) => { await p.click('#siTrans'); await p.keyboard.type('Sharma Roadways'); await p.click('#siVeh'); await p.keyboard.type('UP32 AB 1234'); });
      await approvedShot(`editor-transport-${width}`, app, '#siPop');
      await tool('te');
      await approvedShot(`editor-terms-${width}`, app, '#siPop');
      await tool('de');
      await both(proto, app, async (p) => { await p.click('#siDesc'); await p.keyboard.type('Site: Gomti Nagar'); });
      // attach a photo with the paper-clip (a file picker until something is attached)
      await both(proto, app, (p) => p.locator('#siTools input[data-dgfile="si"]').setInputFiles({ name: 'site-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') }));
      await proto.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await approvedShot(`editor-description-${width}`, app, '#siPop');
      await tool('at');
      await approvedShot(`editor-attachments-${width}`, app, '#siPop');
      await tool('pl');
      await approvedShot(`editor-profit-${width}`, app, '#siPop');
      // the chips under the items and the tool buttons show what was added
      await both(proto, app, async (p) => { await p.click('#siPop [data-dgdone]'); await p.mouse.move(0, 0); });
      await withTabs(proto, app);
      await approvedShot(`editor-extras-${width}`, app, '#vNewInv .dgb');
      await approvedShot(`editor-tools-${width}`, app, '#vNewInv .sift');
    });

    test('Invoice editor previous rates: last prices for this customer, and using one', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await proto.evaluate(() => (window as unknown as { openInvoice: () => void }).openInvoice());
      await app.click('#vSales .pthd .btn.p');
      await app.waitForSelector('#vNewInv #siRows tr[data-ln]');
      await withTabs(proto, app);
      await both(proto, app, async (p) => { await p.fill('#siParty', 'Mehta'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); });
      await both(proto, app, async (p) => { await p.locator('#qeItem').fill('LED bulb'); await p.waitForTimeout(100); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.locator('#qeQty').fill('5'); await p.locator('#qeQty').press('Control+Enter'); });
      await both(proto, app, async (p) => { await p.click('#siRows tr[data-ln="0"] [data-f="qty"]'); await p.waitForSelector('#phPop:not([hidden])'); });
      await approvedShot(`prev-rates-${width}`, app, '#phPop');
      await both(proto, app, async (p) => { await p.click('#phPop tbody tr >> nth=0'); await p.mouse.move(0, 0); });
      await proto.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await approvedShot(`prev-rates-used-${width}`, app, '#siRows tr[data-ln="0"]');
    });

    test('Invoice editor: import from quotation, the "From quotation" chip and removing it', async ({ browser }) => {
      test.setTimeout(120_000);
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      await proto.evaluate(() => (window as unknown as { openInvoice: () => void }).openInvoice());
      await app.click('#vSales .pthd .btn.p');
      await app.waitForSelector('#vNewInv #siRows tr[data-ln]');
      await withTabs(proto, app);
      await both(proto, app, async (p) => { await p.click('#siTitle'); await p.click('#siImpQ'); }); // (the title click closes the party list)
      await app.waitForSelector('#iqm:not([hidden]) .iqr');
      // the windows' rounded corners show a little of the editor behind them, and what it shows there can change
      // from run to run (a 5-pixel flake on main); hide the editor while these windows are photographed
      const behind = (hide: boolean) => app.evaluate((h) => {
        document.getElementById('e2eNoEditor')?.remove();
        if (h) { const s = document.createElement('style'); s.id = 'e2eNoEditor'; s.textContent = '#vNewInv{visibility:hidden!important}'; document.head.append(s); }
      }, hide);
      await behind(true);
      await approvedShot(`import-quote-${width}`, app, '#iqm .mdl');
      // a brand-wise quotation asks which brand to bill
      await both(proto, app, (p) => p.click('#iqList [data-iq="Q-0101"]'));
      await approvedShot(`import-quote-brand-${width}`, app, '#iqm .mdl');
      await both(proto, app, (p) => p.click('#iqList [data-iq="Q-0102"]'));
      await approvedShot(`import-quote-picked-${width}`, app, '#iqm .mdl');
      await behind(false);
      await both(proto, app, async (p) => { await p.click('#iqGo'); await p.mouse.move(0, 0); });
      await proto.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await approvedShot(`import-quote-chip-${width}`, app, '#siMid');
      // the quoted rate is kept (the prototype re-prices the lines from the price list here)
      await expect(app.locator('#siRows tr[data-ln="1"] [data-f="price"]')).toHaveValue('1739');
      await both(proto, app, (p) => p.click('#siMid [data-qrx="Q-0102"]'));
      await behind(true);
      await approvedShot(`import-quote-remove-${width}`, app, '#slm .mdl');
      await behind(false);
      await both(proto, app, (p) => p.click('#slmOk'));
      await expect(app.locator('#siRows tr[data-ln]')).toHaveCount(1);
    });

    test('Quick sale window: empty, with a customer and items, credit', async ({ browser }) => {
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]');
      // the rebuild has no top-bar Quick sale button any more (owner moved it to Settings); Alt+N opens the same window
      await proto.click('#qsBtn');
      await app.keyboard.press('Alt+n');
      await app.waitForSelector('#qsm .qsr');
      await both(proto, app, (p) => p.waitForTimeout(100));
      await sameShot(`quick-${width}`, proto, app, '#qsm .mdl');
      await both(proto, app, async (p) => {
        await p.fill('#qsParty', 'Mehta'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
        await p.locator('#qsRows .qs-item').first().fill('LED'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
        await p.locator('#qsRows .qsq').first().fill('3');
        await p.click('#qsPay [data-qspay="Credit"]');
      });
      await sameShot(`quick-filled-${width}`, proto, app, '#qsm .mdl');
      // (saving is checked in sales.flows: the shared sales shop must stay as the prototype's)
    });

    test('Quotations page: brand-wise grid, quantities, saved list, ranges, share, referral, convert', async ({ browser }) => {
      test.setTimeout(150_000);
      const { proto, app } = await pages(browser, width, 'quo', '/quotations', '#qBody [data-qq="r1"]');
      await both(proto, app, (p) => p.mouse.move(0, 0));
      await sameShot(`quo-${width}`, proto, app, '#vQuo');
      await both(proto, app, async (p) => { await p.fill('#qBody [data-qq="r5"]', '30'); await p.fill('#qBody [data-qq="p4"]', '15'); await p.fill('#qDisc', '5'); await p.click('#qNo'); await p.mouse.move(0, 0); });
      // (how far the table scrolled while typing is incidental)
      await both(proto, app, (p) => p.evaluate(() => { document.querySelector('#vQuo .qtw')!.scrollTop = 0; }));
      await sameShot(`quo-filled-${width}`, proto, app, '#vQuo');
      await both(proto, app, (p) => p.click('#qSerBtn'));
      await sameShot(`quo-ranges-${width}`, proto, app, '#qSerPop');
      await both(proto, app, (p) => p.click('#qAddSer'));
      // (the prototype leaves the ranges list open behind the window; the rebuild closes it)
      await proto.evaluate(() => { document.getElementById('qSerPop')!.hidden = true; });
      // owner's change: the window offers the shop's brands from Items › Brands & Series (the prototype lists its items' brands)
      await approvedShot(`quo-add-range-${width}`, app, '#qam .mdl');
      await both(proto, app, (p) => p.click('#qaCancel'));
      await both(proto, app, (p) => p.click('#qShare'));
      await sameShot(`quo-share-${width}`, proto, app, '#qSharePop');
      // (the prototype leaves the share menu open under Referral; the rebuild closes it)
      await both(proto, app, async (p) => { await p.click('#qNo'); await p.click('#qRefBtn'); });
      await sameShot(`quo-referral-${width}`, proto, app, '#qRefPop');
      await both(proto, app, (p) => p.click('#qNo'));
      // saved list: newest first in the rebuild (the prototype lists them in the order it stored them)
      await both(proto, app, (p) => p.click('#qSaved'));
      await proto.evaluate(() => { const b = document.getElementById('qlRows')!; [...b.children].reverse().forEach((r) => b.appendChild(r)); document.querySelectorAll('#qlRows [data-qdl]').forEach((x) => { x.setAttribute('title', 'Cancel quotation'); }); });
      await sameShot(`quo-saved-${width}`, proto, app, '#qlm .mdl');
      await both(proto, app, (p) => p.click('#qlClose'));
    });

    test('Invoice editor referral: add electrician, commission loaded on the rates, commission on this bill', async ({ browser, request }) => {
      test.setTimeout(150_000);
      // adds an electrician (and party), so it works in a copy of the sales shop
      const { proto, app } = await pages(browser, width, 'sales', '/sales', '#slRows tr[data-sno]', await freshShop(request, 'sales-shop'));
      await proto.evaluate(() => (window as unknown as { openInvoice: () => void }).openInvoice());
      await app.click('#vSales .pthd .btn.p');
      await app.waitForSelector('#vNewInv #siRows tr[data-ln]');
      await withTabs(proto, app);
      await both(proto, app, async (p) => { await p.fill('#siParty', 'Mehta'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); });
      for (const [item, qty] of [['LED bulb', '10'], ['Copper wire', '1']] as const) {
        await both(proto, app, async (p) => { await p.locator('#qeItem').fill(item); await p.waitForTimeout(100); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.locator('#qeQty').fill(qty); await p.locator('#qeQty').press('Control+Enter'); });
      }
      await both(proto, app, async (p) => { await p.click('#siCmBtn'); await p.waitForTimeout(100); await p.selectOption('#siRef', '__new'); });
      await sameShot(`referral-add-${width}`, proto, app, '#slm .mdl');
      // the mobile must have 10 digits
      await both(proto, app, async (p) => { await p.fill('#elN', 'Ramesh Kumar'); await p.fill('#elP', '94150'); await p.click('#slmOk'); });
      await sameShot(`referral-add-error-${width}`, proto, app, '#slm .mdl');
      await both(proto, app, async (p) => { await p.fill('#elP', '9415011111'); await p.fill('#elC', 'Lucknow'); await p.click('#slmOk'); });
      await proto.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await app.evaluate(() => document.getElementById('toast')?.classList.remove('on'));
      await approvedShot(`referral-pop-${width}`, app, '#siCmPop');
      // commission on this bill, then a flat ₹20 per unit for the first category on this bill only
      await both(proto, app, (p) => p.click('#siCmChip'));
      await approvedShot(`referral-bill-${width}`, app, '#slm .mdl');
      await both(proto, app, async (p) => { await p.selectOption('#slmBody [data-bcat] select >> nth=0', 'f'); await p.fill('#slmBody [data-bcat] input >> nth=0', '20'); await p.locator('#slmBody [data-bcat] input >> nth=0').press('Tab'); await p.click('#slmT'); });
      // (clicked away first: the prototype redraws the window and drops focus, the rebuild keeps it moving with Tab)
      await approvedShot(`referral-bill-rule-${width}`, app, '#slm .mdl');
      await both(proto, app, async (p) => { await p.click('#slmOk'); await p.keyboard.press('Escape'); await p.mouse.move(0, 0); });
      await approvedShot(`referral-grid-${width}`, app, '#vNewInv .dggrid');
    });
  });
}

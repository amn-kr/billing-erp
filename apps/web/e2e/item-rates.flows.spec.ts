/** Items › item details: the "Purchase rate of stock left" table against the real API (owner's rate rules). */
import { expect, test, type Page } from '@playwright/test';
import { RATE_ITEMS, rateItems } from './item-rates.data';
import { APP, freshShop, newPage, signInAs } from './setup';

const open = async (page: Page, name: string) => {
  await page.locator('#itList .ptr', { hasText: name }).click();
  await expect(page.locator('#itHead h2')).toHaveText(name);
};
const row = (page: Page, label: 'Rate' | 'Rest qty') => page.locator('#itRates tr', { has: page.locator(`th:text-is("${label}")`) }).locator('td');
/** "In stock" figure in the item header, e.g. "416 PCS" */
const inStock = (page: Page) => page.locator('#itHead .itfig > div', { has: page.locator('small:text-is("In stock")') }).locator('b');

test('Rate table: rates oldest first, sold-out rules, no stock, many rates scroll in their own box, none for services', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser, 1280);
  const who = await freshShop(request);
  await rateItems(request, who);
  await signInAs(page, who);
  await page.goto(APP + '/items');

  // several rates, oldest first; Status: average rate and total = In stock
  await open(page, RATE_ITEMS.several);
  await expect(row(page, 'Rate')).toHaveText(['60.00', '65.00', '61.00', '55.00', '70.00', 'Avg rate64.33']);
  await expect(row(page, 'Rest qty')).toHaveText(['21', '40', '50', '100', '205', 'Total qty416 PCS']);
  await expect(inStock(page)).toHaveText('416 PCS');
  await expect(row(page, 'Rate').first()).toHaveAttribute('title', /^60\.00 — bought from 01\/05\/2026\n21 PCS left, worth 1,260\.00\n5% of the stock$/);
  // the costliest rate has the strongest tint
  const tint = (i: number) => row(page, 'Rate').nth(i).evaluate((td) => getComputedStyle(td).getPropertyValue('--k'));
  expect(await tint(4)).toBe('42%');
  expect(await tint(3)).toBe('10%');

  // first rates sold out: only the newest sold-out one stays, grey
  await open(page, RATE_ITEMS.firstZero);
  await expect(row(page, 'Rate')).toHaveText(['50.00', '52.00', '55.00', 'Avg rate54.00']);
  await expect(row(page, 'Rest qty')).toHaveText(['0', '15', '30', 'Total qty45 PCS']);
  await expect(row(page, 'Rate').first()).toHaveClass('r z');
  await expect(page.locator('#itRates .itrtk')).toContainText('1 older sold-out rate hidden');

  // a sold-out rate in the middle stays
  await open(page, RATE_ITEMS.midZero);
  await expect(row(page, 'Rate')).toHaveText(['60.00', '65.00', '70.00', 'Avg rate63.75']);
  await expect(row(page, 'Rest qty')).toHaveText(['10', '0', '6', 'Total qty16 PCS']);

  // no stock: a message, not an empty table
  await open(page, RATE_ITEMS.none);
  await expect(page.locator('#itRates table')).toHaveCount(0);
  await expect(page.locator('#itRates .itrte')).toHaveText('No stock left. Last bought at 35.00.');

  // many rates: the table scrolls inside its box; the card and the page never get wider
  await open(page, RATE_ITEMS.many);
  await expect(row(page, 'Rate')).toHaveCount(17);
  const box = await page.evaluate(() => {
    const w = document.querySelector<HTMLElement>('#itRates .itrtw')!;
    const card = document.getElementById('itHead')!;
    return { scrolls: w.scrollWidth > w.clientWidth, cardFits: card.scrollWidth <= card.clientWidth, pageFits: document.documentElement.scrollWidth <= innerWidth };
  });
  expect(box).toEqual({ scrolls: true, cardFits: true, pageFits: true });
  await expect(row(page, 'Rest qty').last()).toHaveText('Total qty790 PCS');

  // services have no stock, so no table
  await page.click('#itKindBtn');
  await page.click('[data-ik="s"]');
  await open(page, RATE_ITEMS.service);
  await expect(page.locator('#itRates')).toHaveCount(0);
});

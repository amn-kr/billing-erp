/**
 * Density and text size (owner's request, 31 Oct 2026): each person picks Comfortable or Compact and Small,
 * Normal or Large text, in the account menu or in Settings › General › Display. Comfortable + Normal is the
 * prototype's look and adds nothing to the page; printed paper never changes.
 */
import { expect, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const h = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
const sizes = async (page: Page) => ({ row: await h(page, '#slRows tr'), head: await h(page, '#vSales thead tr'), top: await h(page, 'header.top'), btn: await h(page, '#vSales .btn.p') });
const ui = (page: Page) => page.evaluate(() => ({ on: 'ui' in document.documentElement.dataset, sheet: [...document.querySelectorAll('style')].some((s) => s.textContent!.includes(':root[data-ui]')) }));

/** padding of a printed-invoice table cell, on the page as it would be in a preview */
const paperCell = (page: Page) => page.evaluate(() => {
  document.getElementById('e2ePaper')?.remove();
  document.body.insertAdjacentHTML('beforeend', '<div class="ivsheet" id="e2ePaper"><table class="ivtab"><tbody><tr><td>x</td></tr></tbody></table></div>');
  const td = document.querySelector('#e2ePaper td')!;
  const s = getComputedStyle(td);
  return `${s.paddingTop} ${s.fontSize}`;
});

test('Display: Compact and Large text from the account menu and Settings, kept on the account; Comfortable is unchanged', async ({ browser, request }) => {
  const who = await freshShop(request, 'sales-shop');
  const page = await newPage(browser, 1366);
  await signInAs(page, who);
  await page.goto(APP + '/sales');
  await page.waitForSelector('#slRows tr');

  // the default: the prototype's sizes, nothing added
  expect(await ui(page)).toEqual({ on: false, sheet: false });
  expect(await sizes(page)).toEqual({ row: 39, head: 35, top: 68, btn: 42 });
  const paper = await paperCell(page);

  // account menu › Display › Compact
  await page.click('#avBtn');
  await expect(page.locator('#miDisplaySub')).toHaveText('Comfortable · Normal text');
  await page.click('#miDisplay');
  await expect(page.locator('#dsp')).toBeVisible();
  await page.click('#dspDen [data-v="compact"]');
  await expect(page.locator('#toast')).toHaveText('Display: Compact · Normal text');
  await expect(page.locator('#dspDen [data-v="compact"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#dspDone');
  await expect(page.locator('#dsp')).toBeHidden();
  expect(await ui(page)).toEqual({ on: true, sheet: true });
  expect(await sizes(page)).toEqual({ row: 31, head: 28, top: 54, btn: 34 });
  // printed paper keeps its sizes
  expect(await paperCell(page)).toBe(paper);

  // kept on the account: still Compact when signing in on another browser
  const other = await newPage(browser, 1366);
  await signInAs(other, who);
  await other.goto(APP + '/sales');
  await other.waitForSelector('#slRows tr');
  expect(await sizes(other)).toEqual({ row: 31, head: 28, top: 54, btn: 34 });
  await other.close();

  // Settings › General › Display shows the same choice; Large text there
  await page.goto(APP + '/settings');
  await page.click('[data-settab="gen"]');
  await expect(page.locator('#setDen [data-v="compact"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#setTxt [data-v="normal"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#setTxt [data-v="large"]');
  await expect(page.locator('#toast')).toHaveText('Display: Compact · Large text');
  // 14px × 93% (Compact) × 110% (Large)
  expect(parseFloat(await page.evaluate(() => getComputedStyle(document.body).fontSize))).toBeCloseTo(14 * 0.93 * 1.1, 1);
  expect(await paperCell(page)).toBe(paper);

  // back to Comfortable + Normal: exactly the prototype's sizes again, and nothing added
  await page.click('#setDen [data-v="comfortable"]');
  await page.click('#setTxt [data-v="normal"]');
  await expect(page.locator('#toast')).toHaveText('Display: Comfortable · Normal text');
  await page.goto(APP + '/sales');
  await page.waitForSelector('#slRows tr');
  expect(await ui(page)).toEqual({ on: false, sheet: false });
  expect(await sizes(page)).toEqual({ row: 39, head: 35, top: 68, btn: 42 });
});

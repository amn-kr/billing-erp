/** Items › Brands & Series against the real API: view, add, rename, change brand, make inactive. */
import { expect, test } from '@playwright/test';
import { brandItems } from './brands.data';
import { APP, freshShop, newPage, signInAs } from './setup';

test('Brands & Series: counts from items, add, rename, change brand, inactive, never deleted', async ({ browser, request }) => {
  const page = await newPage(browser, 1366);
  const who = await freshShop(request);
  // empty shop: friendly messages on both tabs
  await signInAs(page, who);
  await page.goto(APP + '/items/brands');
  await expect(page.locator('#bsEmpty')).toContainText('No brands yet.');
  await page.click('[data-bst="series"]');
  await expect(page.locator('#bsEmpty')).toHaveText('Add a brand first, then its series.');

  await brandItems(request, who);
  // one way in: the button in the Products top bar (the old "Add brand / size" button is gone)
  await page.goto(APP + '/items');
  await page.click('[data-gid="6A-10A 1WAY SWITCH"]');
  await expect(page.locator('[data-addvar]')).toHaveCount(0);
  await page.click('#vItems .pthd #itBrands');
  await expect(page).toHaveURL(APP + '/items/brands');
  await expect(page.locator('#bsTot')).toHaveText('2 brands3 series');
  const cells = (name: string) => page.locator('#bsRows tr', { has: page.locator('td:first-child b', { hasText: new RegExp(`^${name}$`) }) }).locator('td');
  // Brand, Series, Items, Total stock, Stock value, Last updated, Status
  await expect(cells('HAVELLS')).toHaveText(['HAVELLS', '2', '3', '260', '11,520.00', /^\d\d\/\d\d\/\d{4}$/, 'Active', '']);
  await expect(cells('NORWOOD')).toHaveText(['NORWOOD', '1', '1', '15', '315.00', /^\d\d\/\d\d\/\d{4}$/, 'Active', '']);

  // a brand row shows that brand's series
  await page.locator('#bsRows tr', { hasText: 'HAVELLS' }).locator('td').first().click();
  await expect(page.locator('#bsBrand option:checked')).toHaveText('HAVELLS');
  await expect(page.locator('#bsRows tr td:first-child b')).toHaveText(['CORAL', 'PEARLZ']);
  await page.selectOption('#bsBrand', 'all');
  await page.fill('#bsQ', 'classic');
  await expect(page.locator('#bsRows tr td:first-child b')).toHaveText(['CLASSIC']);
  await page.fill('#bsQ', '');

  // Add brand: a name is needed, the same name (any capitals) is refused, notes are kept
  await page.click('[data-bst="brands"]');
  await page.click('#bsAddBrand');
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#bsErr')).toHaveText('Enter the brand name.');
  await page.fill('#bsfName', 'havells');
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#bsErr')).toHaveText('A brand called havells already exists.');
  await page.fill('#bsfName', 'Legrand');
  await page.fill('#bsfNotes', 'Delhi dealer');
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#toast')).toHaveText('Legrand added');
  await expect(cells('Legrand').first()).toHaveText('LegrandDelhi dealer');

  // Add series on the Legrand brand (its series list opens)
  await page.click('[data-bst="series"]');
  await page.click('#bsAddSeries');
  await page.selectOption('#bsfBrand', { label: 'Legrand' });
  await page.fill('#bsfName', 'Myrius');
  await page.fill('#bsfSize', '6A');
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#toast')).toHaveText('Legrand Myrius added');
  await expect(page.locator('#bsBrand option:checked')).toHaveText('Legrand');
  await expect(page.locator('#bsRows tr td')).toHaveText(['Myrius', 'Legrand', '6A', '0', '0', '0.00', 'Active', '']);

  // Rename a series typed on items: the item follows
  await page.selectOption('#bsBrand', 'all');
  await page.locator('#bsRows tr', { hasText: 'CORAL' }).locator('[data-smenu]').click();
  await page.click('#bsMenu [data-sma="rename"]');
  await expect(page.locator('#bsm .hint')).toHaveText('The 1 item in this series moves to the new name too.');
  await page.fill('#bsfName', 'Coral Plus');
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#toast')).toHaveText('HAVELLS CORAL renamed to Coral Plus');
  // Change brand: Coral Plus moves to Norwood with its item
  await page.locator('#bsRows tr', { hasText: 'Coral Plus' }).locator('[data-smenu]').click();
  await page.click('#bsMenu [data-sma="brand"]');
  await page.selectOption('#bsfBrand', { label: 'NORWOOD' });
  await page.click('#bsm [type="submit"]');
  await expect(page.locator('#toast')).toHaveText('Coral Plus moved to NORWOOD');
  await expect(page.locator('#bsRows tr', { hasText: 'Coral Plus' }).locator('td').nth(1)).toHaveText('NORWOOD');

  // Delete is never done: a clear message instead; Make inactive keeps the brand listed
  await page.click('[data-bst="brands"]');
  await page.locator('#bsRows tr', { hasText: 'HAVELLS' }).locator('[data-bmenu]').click();
  await page.click('#bsMenu [data-bma="delete"]');
  await expect(page.locator('#toast')).toHaveText('HAVELLS is used by 2 items, so it can’t be deleted. Make it inactive instead.');
  await page.locator('#bsRows tr', { hasText: 'Legrand' }).locator('[data-bmenu]').click();
  await page.click('#bsMenu [data-bma="active"]');
  await expect(page.locator('#toast')).toHaveText('Legrand is now inactive — its items keep working');
  await expect(cells('Legrand').nth(6)).toHaveText('Inactive');

  // back on Products, the moved variant shows under its new brand and series
  await page.click('#bsBack');
  await page.click('[data-gid="6A-10A 1WAY SWITCH"]');
  await expect(page.locator('#itList .ptr.vsub')).toContainText(['NORWOOD Coral Plus']);
});

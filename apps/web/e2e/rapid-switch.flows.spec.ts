/**
 * The ⚡ button in the item grid's Total row (owner, 21 Nov 2026).
 * On (the default): the rapid entry row shows, items come in only through it, so the bill has
 * no empty row and no Add row button. Off: the rapid entry row hides, the empty row and Add row show.
 * The choice is remembered on this computer.
 */
import { expect, test, type Page } from '@playwright/test';
import { APP, freshShop, newPage, signInAs } from './setup';

const rows = (p: Page) => p.locator('#siRows tr[data-ln]');
const sw = (p: Page) => p.locator('#qeSw');

test('rapid entry on: no empty row; off: the empty row; remembered', async ({ browser, request }) => {
  const p = await newPage(browser, 1366);
  await signInAs(p, await freshShop(request, 'sales-shop'));
  await p.goto(APP + '/sales/new');
  await p.waitForSelector('#qeItem');

  // on, as a new computer starts: no empty row, no Add row
  await expect(sw(p)).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(p)).toHaveCount(0);
  await expect(p.locator('#siAddRow')).toHaveCount(0);

  // an item through rapid entry: one row, still no empty row after it
  await p.locator('#qeItem').fill('LED bulb');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.locator('#qeQty').fill('2');
  await p.locator('#qeQty').press('Control+Enter');
  await expect(rows(p)).toHaveCount(1);
  await expect(rows(p).first().locator('[data-f="name"]')).toHaveValue(/LED bulb/);

  // off: rapid entry hides, the empty row and Add row show, the item stays
  await sw(p).click();
  await expect(sw(p)).toHaveAttribute('aria-pressed', 'false');
  await expect(p.locator('#qeRow')).toHaveCount(0);
  await expect(rows(p)).toHaveCount(2);
  await expect(rows(p).nth(1).locator('[data-f="name"]')).toHaveValue('');
  await expect(p.locator('#siAddRow')).toBeVisible();

  // a name typed with no item and no rate: gone when rapid entry is turned on again
  await rows(p).nth(1).locator('[data-f="name"]').fill('just a note');
  await p.keyboard.press('Escape');
  await sw(p).click();
  await expect(p.locator('#qeRow')).toHaveCount(1);
  await expect(rows(p)).toHaveCount(1);

  // remembered: off, then a new bill opens with the empty row and no rapid entry
  await sw(p).click();
  await p.reload();
  await p.waitForSelector('#siRows');
  await expect(sw(p)).toHaveAttribute('aria-pressed', 'false');
  await expect(p.locator('#qeRow')).toHaveCount(0);
  // back on for the other tests on this computer
  await sw(p).click();
  await expect(sw(p)).toHaveAttribute('aria-pressed', 'true');
});

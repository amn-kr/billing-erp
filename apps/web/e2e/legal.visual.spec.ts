/**
 * The public Privacy policy and Terms of service pages (no sign-in; Google's sign-in screen links to them):
 * new, so compared with their owner-approved pictures (e2e/approved/, approved 13 Oct 2026) at 1280, 1366 and 1920 px.
 */
import { test } from '@playwright/test';
import { approvedShot } from './shots';
import { APP, WIDTHS, newPage } from './setup';

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Privacy policy and Terms of service pages', async ({ browser }) => {
      const page = await newPage(browser, width);
      for (const [name, path] of [['privacy', '/privacy.html'], ['terms', '/terms.html']] as const) {
        await page.goto(APP + path);
        await page.waitForSelector('#notAdvice');
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(0, 0);
        await approvedShot(`${name}-${width}`, page, 'main');
      }
    });
  });
}

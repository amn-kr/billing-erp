/** Side-by-side screenshots of the prototype and the rebuild, compared pixel for pixel. */
import { expect, type Page } from '@playwright/test';
import { compare } from './compare';
import { settle } from './setup';

/** Both pages render on the same machine, so the target is an exact match. */
export const MAX_RATIO = 0;

export async function shot(p: Page, sel: string): Promise<Buffer> {
  await settle(p);
  return p.locator(sel).screenshot({ animations: 'disabled', caret: 'hide' });
}

/**
 * Screenshot the same element in both pages and compare. Each try first waits for
 * both pages to be still (see settle); a real difference shows on every try.
 */
export async function sameShot(name: string, proto: Page, app: Page, sel: string): Promise<void> {
  let d = compare(name, await shot(proto, sel), await shot(app, sel));
  for (let n = 0; n < 2 && !(d.sizeMatches && d.ratio <= MAX_RATIO); n++) {
    await proto.waitForTimeout(700);
    d = compare(name, await shot(proto, sel), await shot(app, sel));
  }
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
}

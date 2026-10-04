/** Side-by-side screenshots of the prototype and the rebuild, compared pixel for pixel. */
import { expect, type Page } from '@playwright/test';
import { compare } from './compare';
import { settle } from './setup';

/** Both pages render on the same machine, so the target is an exact match (apart from text-edge shading, see compare.ts). */
export const MAX_RATIO = 0;

/**
 * Redraw all text from scratch. Chrome keeps text painted earlier (e.g. while a
 * pop-up was still opening) until that text changes, and the prototype rewrites
 * whole blocks on each keystroke while React only touches what changed, so the same
 * words could differ by a few anti-aliased pixels. Hiding the text for two frames
 * and showing it again repaints it in both pages without moving focus.
 */
async function repaint(p: Page): Promise<void> {
  await p.evaluate(async () => {
    // two frames and a pause: under load Chrome can skip drawing a frame, and a change it never
    // drew counts as no change, which would leave the old pixels in place
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))));
    // end short animations (e.g. the 1.2 s flash on a new item row) so both pages are in their final state
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity)) a.finish();
    await frames();
    const s = document.createElement('style');
    s.textContent = '*{-webkit-text-fill-color:transparent!important}';
    document.head.append(s);
    await frames();
    s.remove();
    await frames();
  });
}

export async function shot(p: Page, sel: string): Promise<Buffer> {
  await settle(p);
  await repaint(p);
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

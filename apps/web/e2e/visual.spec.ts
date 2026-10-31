/**
 * Phase 1 gate: the sign-in page and the app frame must look like the prototype.
 * Each check photographs the same element in the prototype and in the rebuild
 * and compares them pixel by pixel, at 1280, 1366 and 1920 px.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { compare } from './compare';
import { approvedShot, shot } from './shots';
import { APP, PROTOTYPE_LOGIN, WIDTHS, newPage, prototypeFresh, signIn } from './setup';

/** Allowed share of differing pixels. Both pages render on the same machine, so the target is an exact match. */
const MAX_RATIO = 0;

async function pair(browser: Browser, width: number) {
  const proto = await newPage(browser, width);
  const app = await newPage(browser, width);
  return { proto, app };
}

async function same(name: string, a: Buffer, b: Buffer) {
  const d = compare(name, a, b);
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
}


for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('sign-in page', async ({ browser }) => {
      const { proto, app } = await pair(browser, width);
      await proto.goto(PROTOTYPE_LOGIN);
      await proto.evaluate(() => document.querySelectorAll<HTMLElement>('#box > div').forEach((d) => (d.hidden = d.id !== 'vAuth')));
      await proto.evaluate(() => document.fonts.ready);
      await app.goto(APP + '/login');
      await app.waitForSelector('#vAuth:not([hidden])');
      await app.evaluate(() => document.fonts.ready);
      // owner's change (13 Oct 2026): a "Privacy policy · Terms of service" line under the features (Google requires it);
      // it has its own approved picture, and is copied into the prototype page so the rest is still compared with it
      await approvedShot(`login-legal-${width}`, app, '#legal');
      const legal = await app.evaluate(() => document.getElementById('legal')!.outerHTML);
      await proto.evaluate((html) => document.querySelector('.pitch .feat')!.insertAdjacentHTML('afterend', html), legal);
      await same(`login-${width}`, await proto.screenshot({ fullPage: true }), await app.screenshot({ fullPage: true }));
      // "Create account" tab
      // The prototype page's script stops early without Firebase settings, so run the same steps its tab handler does.
      await proto.evaluate(() => {
        const $ = (id: string) => document.getElementById(id)!;
        document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === 'up'));
        $('lName').hidden = false;
        $('aGo').textContent = 'Create account';
        $('authT').textContent = 'Create your account';
        $('authS').textContent = 'Then set up your shop in one step.';
      });
      await app.click('[data-mode="up"]');
      await same(`login-create-${width}`, await shot(proto, '#box'), await shot(app, '#box'));
    });

    test('app frame: sidebar, top bar, home heading', async ({ browser }) => {
      const { proto, app } = await pair(browser, width);
      await prototypeFresh(proto);
      await signIn(app);
      await same(`sidebar-${width}`, await shot(proto, '#side'), await shot(app, '#side'));
      // owner's change: Quick sale, colours and sync moved to Settings › General, so the top bar has its own approved picture
      await approvedShot(`topbar-${width}`, app, 'header.top');
      await same(`hero-${width}`, await shot(proto, '#vDash .hero'), await shot(app, '#vDash .hero'));
    });

    test('top bar menus', async ({ browser }) => {
      const { proto, app } = await pair(browser, width);
      await prototypeFresh(proto);
      await signIn(app);
      // menus have rounded corners: hide the page content behind them (it differs: Home is rebuilt in Phase 4)
      for (const p of [proto, app]) await p.addStyleTag({ content: 'main.page > section { visibility: hidden !important }' });
      // (the colour menu moved to Settings › General; it is in the set-gen picture)
      for (const [btn, pop] of [['#avBtn', '#avPop'], ['#orgBtn', '#orgPop'], ['#bellBtn', '#bellPop']] as const) {
        await proto.click(btn);
        await app.click(btn);
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        // owner's addition (31 Oct 2026): Display (density and text size) in the account menu; copied into the
        // prototype's menu, before Lock screen, so the rest of the menu is still compared pixel for pixel
        if (pop === '#avPop') {
          const item = await app.locator('#miDisplay').evaluate((e) => e.outerHTML);
          await proto.evaluate((html) => { if (!document.getElementById('miDisplay')) document.getElementById('miLock')!.insertAdjacentHTML('beforebegin', html); }, item);
        }
        await same(`${pop.slice(1)}-${width}`, await shot(proto, pop), await shot(app, pop));
        await proto.keyboard.press('Escape');
        await app.keyboard.press('Escape');
        await proto.mouse.click(700, 400);
        await app.mouse.click(700, 400);
      }
    });

    test('collapsed sidebar and sign-out dialog', async ({ browser }) => {
      const { proto, app } = await pair(browser, width);
      await prototypeFresh(proto);
      await signIn(app);
      await proto.click('#miniBtn');
      await app.click('#miniBtn');
      await proto.mouse.move(700, 400);
      await app.mouse.move(700, 400);
      await proto.waitForTimeout(400);
      await app.waitForTimeout(400);
      await same(`sidebar-mini-${width}`, await shot(proto, '#side'), await shot(app, '#side'));
      await proto.click('#miniBtn');
      await app.click('#miniBtn');
      await proto.click('#avBtn');
      await proto.click('#miOut');
      await app.click('#avBtn');
      await app.click('#miOut');
      await same(`signout-${width}`, await shot(proto, '#so .mdl'), await shot(app, '#so .mdl'));
    });
  });
}

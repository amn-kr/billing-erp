/**
 * The Windows app, step 1 (online): it opens the app, its screens are the prototype's pixel for pixel
 * (both drawn inside the app's own Chrome, at 1280, 1366 and 1920 px), links to WhatsApp and other
 * websites open outside it, and it shows "Not connected" when the app cannot be reached.
 */
import { createRequire } from 'node:module';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { compare } from '../../web/e2e/compare';
import { shot } from '../../web/e2e/shots';
import { APP, PROTOTYPE_LOGIN, prototypeFresh, signIn, WIDTHS } from '../../web/e2e/setup';
import { launch as open } from './launch';

const common = createRequire(import.meta.url)('../../../tools/design-baseline/common.cjs') as {
  FROZEN_TIME: string;
  HEIGHTS: Record<number, number>;
  routeFonts: (target: unknown) => Promise<void>;
};

async function launch(appUrl = APP): Promise<{ app: ElectronApplication; win: Page }> {
  const { app, win } = await open(appUrl);
  await common.routeFonts(app.context());
  return { app, win };
}

/** Window inside size = the picture width and height used everywhere else. */
async function size(page: Page, width: number) {
  // the app's page sits in the window under the title bar; a page still starting can drop the first setting
  await expect.poll(async () => {
    await page.setViewportSize({ width, height: common.HEIGHTS[width] ?? 800 });
    return page.evaluate(() => window.innerWidth);
  }).toBe(width);
}

/** The prototype in a second window of the same app (same Chrome, so the same drawing of text). */
async function prototypeWindow(app: ElectronApplication, width: number): Promise<Page> {
  const opened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: true, enableLargerThanScreen: true, webPreferences: { sandbox: true, contextIsolation: true } });
    void w.loadURL('about:blank');
  });
  const proto = await opened;
  await size(proto, width);
  await proto.clock.setFixedTime(new Date(common.FROZEN_TIME));
  return proto;
}

function same(name: string, a: Buffer, b: Buffer) {
  const d = compare(`desktop-${name}`, a, b);
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/desktop-${name}-diff.png)`).toBeLessThanOrEqual(0);
}

test('opens the app’s sign-in page in its own window', async () => {
  const { app, win } = await launch();
  try {
    await win.waitForSelector('#vAuth:not([hidden])');
    expect(new URL(win.url()).origin).toBe(APP);
    const shown = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((w) => w.isVisible()));
    expect(shown).toEqual([true]);
  } finally {
    await app.close();
  }
});

test('WhatsApp and other websites open outside the app, never inside it', async () => {
  const { app, win } = await launch();
  try {
    await win.waitForSelector('#vAuth:not([hidden])');
    // catch what the app hands to the computer's browser instead of really opening it
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { opened: string[] };
      g.opened = [];
      shell.openExternal = async (url: string) => { g.opened.push(url); };
    });
    await win.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://wa.me/919876543210?text=Hello';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.append(a);
      a.click();
    });
    await win.evaluate(() => { location.href = 'https://example.com/'; });
    // a file on the computer is refused, not opened
    await win.evaluate(() => { location.href = 'file:///etc/hosts'; });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([
      'https://wa.me/919876543210?text=Hello',
      'https://example.com/',
    ]);
    expect(new URL(win.url()).origin).toBe(APP);
    expect(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1);
  } finally {
    await app.close();
  }
});

test('shows “Not connected” when the app cannot be reached, and tries again', async () => {
  // nothing listens on this port
  const { app, win } = await launch('http://localhost:5999');
  try {
    await win.waitForSelector('#offline');
    await expect(win.locator('h1')).toHaveText('Not connected');
    await expect(win.locator('#next')).toContainText('Trying again in');
    expect(new URL(win.url()).searchParams.get('to')).toBe('http://localhost:5999/');
  } finally {
    await app.close();
  }
});

for (const width of WIDTHS) {
  test(`${width}px: sign-in page and app frame look exactly like the prototype`, async () => {
    const { app, win } = await launch();
    try {
      await size(win, width);
      await win.clock.setFixedTime(new Date(common.FROZEN_TIME));
      const proto = await prototypeWindow(app, width);

      // sign-in page (same steps as the web app's visual.spec.ts)
      await proto.goto(PROTOTYPE_LOGIN);
      await proto.evaluate(() => document.querySelectorAll<HTMLElement>('#box > div').forEach((d) => (d.hidden = d.id !== 'vAuth')));
      await proto.evaluate(() => document.querySelectorAll('#vAuth .or, #aGoogle').forEach((e) => e.remove()));
      await win.goto(APP + '/login');
      await win.waitForSelector('#vAuth:not([hidden])');
      for (const p of [proto, win]) await p.evaluate(() => document.fonts.ready);
      // owner's change (13 Oct 2026): the Privacy · Terms line, copied into the prototype page
      const legal = await win.evaluate(() => document.getElementById('legal')!.outerHTML);
      await proto.evaluate((html) => document.querySelector('.pitch .feat')!.insertAdjacentHTML('afterend', html), legal);
      same(`login-${width}`, await proto.screenshot({ fullPage: true }), await win.screenshot({ fullPage: true }));

      // the app frame after signing in
      await prototypeFresh(proto);
      await signIn(win);
      same(`sidebar-${width}`, await shot(proto, '#side'), await shot(win, '#side'));
      same(`hero-${width}`, await shot(proto, '#vDash .hero'), await shot(win, '#vDash .hero'));
    } finally {
      await app.close();
    }
  });
}

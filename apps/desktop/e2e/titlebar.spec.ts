/**
 * The title bar (owner, 10 Nov 2026): the page's title, the app's version and a "Check for updates"
 * button, above the app. GitHub is stood in for (BILLING_FAKE_UPDATE): "latest", "offline" or a version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { APP } from '../../web/e2e/setup';
import { launch } from './launch';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')) as { version: string }).version;
const restarted = (app: ElectronApplication) => app.evaluate(() => !!(globalThis as unknown as { restartedToUpdate?: boolean }).restartedToUpdate);

test('the title bar shows the page’s title and the version, with the app below it', async () => {
  const { app, win, bar } = await launch(APP, { BILLING_FAKE_UPDATE: 'latest' });
  try {
    await win.waitForSelector('#vAuth:not([hidden])');
    await expect(bar.locator('#title')).toHaveText(await win.title());
    await expect(bar.locator('#ver')).toHaveText(`Version ${VERSION}`);
    await expect(bar.locator('#upd')).toHaveText('Check for updates');
    // the bar is 36 px tall and the app fills the rest of the window, right under it
    const box = await app.evaluate(({ BaseWindow }) => {
      const w = BaseWindow.getAllWindows()[0]!;
      const [bar, page] = w.contentView.children.slice().sort((a, b) => a.getBounds().y - b.getBounds().y);
      return { content: w.getContentBounds(), bar: bar!.getBounds(), page: page!.getBounds() };
    });
    expect(box.bar).toMatchObject({ x: 0, y: 0, height: 36, width: box.content.width });
    expect(box.page).toMatchObject({ x: 0, y: 36, width: box.content.width, height: box.content.height - 36 });
    // the title bar has no printing, and the app's page has no update controls
    expect(await bar.evaluate(() => typeof (window as unknown as { billingDesktop?: unknown }).billingDesktop)).toBe('undefined');
    expect(await win.evaluate(() => typeof (window as unknown as { titlebar?: unknown }).titlebar)).toBe('undefined');
  } finally {
    await app.close();
  }
});

test('Check for updates with nothing new: Checking…, Up to date, then the button again', async () => {
  const { app, bar } = await launch(APP, { BILLING_FAKE_UPDATE: 'latest' });
  try {
    const btn = bar.locator('#upd');
    await expect(btn).toHaveText('Check for updates');
    await btn.click();
    await expect(btn).toHaveText('Checking…');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText('Up to date');
    await expect(btn).toHaveText('Check for updates', { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('Check for updates without internet says so, and can be clicked again', async () => {
  const { app, bar } = await launch(APP, { BILLING_FAKE_UPDATE: 'offline' });
  try {
    const btn = bar.locator('#upd');
    await btn.click();
    await expect(btn).toHaveText('Couldn’t check — try again');
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(btn).toHaveText('Checking…');
  } finally {
    await app.close();
  }
});

test('a newer version downloads with progress, then Restart updates', async () => {
  const { app, bar } = await launch(APP, { BILLING_FAKE_UPDATE: '9.9.9' });
  try {
    const btn = bar.locator('#upd');
    await btn.click();
    await expect(btn).toHaveText('Downloading v9.9.9… 50%');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText('Restart to update to v9.9.9');
    await expect(btn).toHaveAttribute('title', /Save any bill you are typing first/);
    expect(await restarted(app)).toBe(false);
    await btn.click();
    await expect.poll(() => restarted(app)).toBe(true);
  } finally {
    await app.close();
  }
});

test('a copy that is not installed says updates come to the installed app', async () => {
  const { app, bar } = await launch(APP);
  try {
    await expect(bar.locator('#upd')).toHaveText('Updates: installed app only');
    await expect(bar.locator('#upd')).toBeDisabled();
  } finally {
    await app.close();
  }
});

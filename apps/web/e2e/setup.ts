import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
// Same frozen clock, timezone and local fonts as the Phase 0 baseline.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const common = createRequire(import.meta.url)('../../../tools/design-baseline/common.cjs') as {
  FROZEN_TIME: string;
  WIDTHS: number[];
  HEIGHTS: Record<number, number>;
  newPage: (b: Browser, w: number) => Promise<Page>;
};

export const { WIDTHS, newPage } = common;
const ROOT = path.resolve(HERE, '../../..');
export const PROTOTYPE = 'file://' + path.join(ROOT, 'reference/design/app.html');
export const PROTOTYPE_LOGIN = 'file://' + path.join(ROOT, 'reference/firebase-site/public/index.html');
export const APP = 'http://localhost:5174';

export const OWNER = { email: 'aman@sharma.example.com', password: 'demo-password-1' };

/**
 * The prototype in the same state as a newly set-up shop in the rebuild:
 * Settings › Start fresh with Sharma Electricals' details (empty books,
 * 7-day trial from today), cloud status "synced".
 */
export async function prototypeFresh(page: Page): Promise<void> {
  await page.goto(PROTOTYPE);
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { bzOpen: () => void }).bzOpen());
  await page.fill('#bzfName', 'Sharma Electricals & Hardware');
  await page.fill('#bzfOwner', 'Aman Kumar');
  await page.fill('#bzfPhone', '+91 98765 43210');
  await page.fill('#bzfEmail', 'aman@sharma.example.com');
  await page.fill('#bzfAddr', 'Shop 12, Naka Hindola');
  await page.fill('#bzfCity', 'Lucknow');
  await page.fill('#bzfPin', '226018');
  await page.fill('#bzfGstin', '09ABCPS4821K1Z6');
  await page.evaluate(() => {
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    $('bzfKeep').checked = false;
    $('bzfOk').checked = true;
    $('bzfOk').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('#bzm input').forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  });
  await page.click('#bzmGo');
  await page.waitForSelector('#vDash:not([hidden])');
  await page.evaluate(() => {
    (window as unknown as { SYNC: { setSt: (s: string) => void } }).SYNC.setSt('ok');
    const t = document.getElementById('toast');
    if (t) t.classList.remove('on');
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto(APP + '/login');
  await page.waitForSelector('#vAuth:not([hidden])');
  await page.fill('#aEmail', OWNER.email);
  await page.fill('#aPass', OWNER.password);
  await page.click('#aGo');
  await page.waitForSelector('#app');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

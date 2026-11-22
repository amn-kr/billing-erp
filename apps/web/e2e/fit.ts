/**
 * Fit checks (owner, 22 Nov 2026; CLAUDE.md "The one hard rule"). Each screen has one approved picture at
 * 1366 px. Right after that picture, the same screen is drawn at the common laptop and monitor widths below
 * and measured, without pictures:
 * - nothing sticks out of the window (the page itself never scrolls sideways),
 * - no button or box sits on top of another,
 * - no text or amount is cut off (text that ends in "…" is allowed),
 * - no button is too small to click.
 * A problem fails the test with the screen, the width and the element in plain words.
 */
import { expect, type Page } from '@playwright/test';
import { settle } from './setup';

export const FIT_WIDTHS = [1280, 1366, 1440, 1536, 1600, 1920];
/** Window heights that go with each width (the usual screens of that width). */
const HEIGHT: Record<number, number> = { 1280: 800, 1366: 768, 1440: 900, 1536: 864, 1600: 900, 1920: 1080 };
/** Smallest button, in px (the theme's smallest icon buttons are 26 px). */
export const MIN_BUTTON = 20;

/**
 * Menus that close by themselves when the window changes size (the row ⋮ menu and the sidebar's pop-out).
 * While one is open the screen is not resized, so the test's next step still finds it open.
 */
const CLOSES_ON_RESIZE = '.ctxm:not([hidden]), #fly:not([hidden])';

export async function fitCheck(page: Page, sel: string, name: string): Promise<void> {
  if (process.env.SKIP_FIT) return;
  if (await page.locator(CLOSES_ON_RESIZE).count()) return;
  const start = page.viewportSize();
  if (!start) return;
  try {
    for (const width of FIT_WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT[width]! });
      await settle(page);
      const problems = await page.evaluate(measure, { sel, minButton: MIN_BUTTON });
      expect.soft(problems, `fit check: ${name} at ${width} px`).toEqual([]);
    }
  } finally {
    await page.setViewportSize(start);
    await settle(page);
  }
}

/** Runs inside the page. Returns one plain sentence per problem. */
function measure({ sel, minButton }: { sel: string; minButton: number }): string[] {
  const out: string[] = [];
  const root = document.querySelector<HTMLElement>(sel);
  if (!root || !root.getClientRects().length) return out;
  const W = innerWidth;

  const say = (el: Element) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };
  const shown = (el: Element) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.opacity === '0' || s.display === 'none') return false;
    }
    return true;
  };
  /** inside a box that scrolls sideways on purpose (a wide table), or one that clips it */
  const scrollsOrClips = (el: Element) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o !== 'visible') return true;
    }
    return false;
  };

  // 1. the page itself never scrolls sideways
  const over = document.documentElement.scrollWidth - W;
  if (over > 1) out.push(`the page is ${over}px wider than the window`);

  const all = [root, ...root.querySelectorAll('*')].filter(shown);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    // 2. nothing sticks out of the window
    if ((r.right > W + 1 || r.left < -1) && !scrollsOrClips(el)) out.push(`${say(el)} goes outside the window`);
    // 3. no text cut off: a box whose own text is wider than the box, and that hides the rest without "…"
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (ownText && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      if (s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis') out.push(`${say(el)}: text is cut off`);
    }
  }

  // 4. buttons big enough, 5. no control on top of another
  const controls = all.filter((el) => el.matches('button, [role="button"], a.btn, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea'));
  for (const el of controls) {
    if (!el.matches('button, [role="button"], a.btn')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < minButton || r.height < minButton) out.push(`${say(el)} is too small (${Math.round(r.width)}×${Math.round(r.height)}px)`);
  }
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i]!.getBoundingClientRect();
    for (let j = i + 1; j < controls.length; j++) {
      if (controls[i]!.contains(controls[j]!) || controls[j]!.contains(controls[i]!)) continue;
      const b = controls[j]!.getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 2 && y > 2) out.push(`${say(controls[i]!)} overlaps ${say(controls[j]!)}`);
    }
  }
  return [...new Set(out)];
}

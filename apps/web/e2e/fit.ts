/**
 * Fit checks (owner, 22 Nov 2026; CLAUDE.md "The one hard rule"). Each screen has one approved picture at
 * 1366 px. Right after that picture, the same screen is drawn at the common laptop and monitor widths below
 * and measured, without pictures:
 * - nothing sticks out of the window (the page itself never scrolls sideways),
 * - no button or box sits on top of another,
 * - no text or amount is cut off (text that ends in "…" is allowed),
 * - no button is too small to click (a button drawn as a box; buttons drawn as plain text links are left out).
 * Left out on purpose: labels hidden for screen readers (1 px), an icon button inside a box (the search box's
 * ✕), anything scrolled out of sight inside its list, and what scrolls under a part that stays in place on
 * purpose (a sticky column or footer, e.g. Bulk entry's remove-row column).
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
    if (r.width < 2 || r.height < 2) return false; // e.g. .vh, a label only for screen readers
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.opacity === '0' || s.display === 'none') return false;
      if (s.clip !== 'auto' && s.clip !== '' && s.position === 'absolute') return false;
    }
    return true;
  };
  /** the part of the element that can be seen: cut by every box around it that hides what sticks out */
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = e.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    return { left, top, right, bottom };
  };
  /** a button drawn as a box (a fill or a border), not as a plain text link */
  const boxed = (el: Element) => {
    const s = getComputedStyle(el);
    const fill = !/rgba\(.*,\s*0\)|transparent/.test(s.backgroundColor);
    const line = ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s.getPropertyValue(`border-${k.toLowerCase()}-width`)) > 0 && s.getPropertyValue(`border-${k.toLowerCase()}-style`) !== 'none');
    return fill || line;
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
    if (!el.matches('button, [role="button"], a.btn') || !boxed(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < minButton || r.height < minButton) out.push(`${say(el)} is too small (${Math.round(r.width)}×${Math.round(r.height)}px)`);
  }
  const sticky = (el: Element) => {
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') return true;
    return false;
  };
  const inside = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) =>
    a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  const boxes = controls.map(seen);
  for (let i = 0; i < controls.length; i++) {
    const a = boxes[i]!;
    if (a.right - a.left < 2 || a.bottom - a.top < 2) continue; // scrolled out of sight
    for (let j = i + 1; j < controls.length; j++) {
      if (controls[i]!.contains(controls[j]!) || controls[j]!.contains(controls[i]!)) continue;
      const b = boxes[j]!;
      if (b.right - b.left < 2 || b.bottom - b.top < 2) continue;
      // an icon button inside a box on purpose (the ✕ in a search box, the ▾ of a list)
      if (inside(a, b) || inside(b, a)) continue;
      if (sticky(controls[i]!) !== sticky(controls[j]!)) continue;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 2 && y > 2) out.push(`${say(controls[i]!)} overlaps ${say(controls[j]!)}`);
    }
  }
  return [...new Set(out)];
}

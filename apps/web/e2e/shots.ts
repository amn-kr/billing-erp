/**
 * Picture tests (owner, 22 Nov 2026; CLAUDE.md "The one hard rule"): every screen is compared with its
 * owner-approved picture at 1366 px (e2e/approved/<name>.png), then fit-checked at six widths (fit.ts).
 * The prototype is no longer the measure of the look.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { compare } from './compare';
import { fitCheck } from './fit';
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
 * Hide the top bar in the given pages (keeping its space). The owner moved three header buttons to
 * Settings, so the header no longer matches the prototype; it has its own check (topbar). Pictures of
 * pages taller than the window, and windows with rounded corners, would otherwise show it too.
 */
export async function hideHeader(...pages: Page[]): Promise<void> {
  for (const p of pages) await p.addStyleTag({ content: 'header.top{visibility:hidden!important}' });
}

/** Owner-approved pictures of looks the prototype doesn't have (e.g. the Add item window's Single / Variant switch). */
export const APPROVED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'approved');

/**
 * Compare an element of the rebuild with its owner-approved picture (e2e/approved/<name>.png), with the
 * same rules as sameShot. Used only where the owner approved a look change from the prototype. A
 * missing or different picture fails the test and leaves the candidate in test-results/visual/<name>-actual.png;
 * it is never saved here — a person copies it into e2e/approved/ after the owner says OK.
 * The pictures are taken on CI's Linux machine, so they are compared there.
 */
export async function approvedShot(name: string, app: Page, sel: string): Promise<void> {
  const file = path.join(APPROVED, `${name}.png`);
  if (!fs.existsSync(file)) {
    const out = path.resolve(APPROVED, '../../test-results/visual');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${name}-actual.png`), await shot(app, sel));
    expect.soft(false, `${name}: no approved picture yet (candidate: test-results/visual/${name}-actual.png)`).toBe(true);
    return;
  }
  const want = fs.readFileSync(file);
  let got = await shot(app, sel);
  let d = compare(name, want, got);
  for (let n = 0; n < 2 && !(d.sizeMatches && d.ratio <= MAX_RATIO); n++) {
    await app.waitForTimeout(700);
    got = await shot(app, sel);
    d = compare(name, want, got);
  }
  if (!(d.sizeMatches && d.ratio <= MAX_RATIO)) {
    // the new look, so a person can show it to the owner and copy it into e2e/approved/ after an OK
    const out = path.resolve(APPROVED, '../../test-results/visual');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${name}-actual.png`), got);
  }
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match the approved picture`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ from the approved picture (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
  await fitCheck(app, sel, name);
}

/**
 * A screen that used to be compared with the prototype. With its approved picture it is an approvedShot.
 * Until that picture exists (the switch of 22 Nov 2026), the screen is still compared with the prototype,
 * and only when both are exactly the same is the app's picture left as the candidate in
 * test-results/visual/<name>-actual.png (so the new picture is the look the owner approved in Phase 0);
 * the test then fails with "no approved picture yet" until a person copies it into e2e/approved/.
 */
export async function sameShot(name: string, proto: Page, app: Page, sel: string): Promise<void> {
  if (fs.existsSync(path.join(APPROVED, `${name}.png`))) {
    await approvedShot(name, app, sel);
    return;
  }
  await withRowHeight(proto);
  let got = await shot(app, sel);
  let d = compare(name, await shot(proto, sel), got);
  for (let n = 0; n < 2 && !(d.sizeMatches && d.ratio <= MAX_RATIO); n++) {
    await proto.waitForTimeout(700);
    got = await shot(app, sel);
    d = compare(name, await shot(proto, sel), got);
  }
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
  if (d.sizeMatches && d.ratio <= MAX_RATIO) {
    const out = path.resolve(APPROVED, '../../test-results/visual');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${name}-actual.png`), got);
    expect.soft(false, `${name}: no approved picture yet; the candidate is the same as the prototype (test-results/visual/${name}-actual.png)`).toBe(true);
  }
  await fitCheck(app, sel, name);
}

/**
 * The same as sameShot, for tests that take their own pictures (whole pages): with an approved picture the
 * app's picture is compared with it; until then with the prototype's, and when they are exactly the same
 * the app's picture is left as the candidate (see sameShot).
 */
export function samePicture(name: string, proto: Buffer, app: Buffer): void {
  const file = path.join(APPROVED, `${name}.png`);
  const approved = fs.existsSync(file);
  const d = compare(name, approved ? fs.readFileSync(file) : proto, app);
  const what = approved ? ' from the approved picture' : '';
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match${what}`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ${what} (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(MAX_RATIO);
  if (!(d.sizeMatches && d.ratio <= MAX_RATIO) && !approved) return;
  if (!approved || !(d.sizeMatches && d.ratio <= MAX_RATIO)) {
    const out = path.resolve(APPROVED, '../../test-results/visual');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${name}-actual.png`), app);
  }
  if (!approved) expect.soft(false, `${name}: no approved picture yet; the candidate is the same as the prototype (test-results/visual/${name}-actual.png)`).toBe(true);
}

/**
 * Deliberate difference (owner's request, 25 Oct 2026, answered 31 Oct 2026): every table row has one
 * height (features/shell/row-height.css). Put that small style file into the prototype too, so
 * everything else is still compared pixel for pixel.
 */
export async function withRowHeight(proto: Page): Promise<void> {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/shell/row-height.css'), 'utf8');
  await proto.evaluate((css) => {
    if (document.getElementById('rowHeightCss')) return;
    const st = document.createElement('style');
    st.id = 'rowHeightCss';
    st.textContent = css;
    document.head.appendChild(st);
    window.dispatchEvent(new Event('resize'));
  }, css);
}

/**
 * Deliberate difference (owner's request, 18 Oct 2026): every document list has a ⋮ actions button
 * in each row, drawn with the prototype's own leftover ⋮ styles (.slact / .slm; for lists other than
 * Sales the same rules repeated in features/shell/row-menu.css). Copy the rebuild's ⋮ cells, and that
 * small style file, into the prototype so everything else is still compared pixel for pixel.
 */
export async function withDots(proto: Page, app: Page, tbody: string) {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/shell/row-menu.css'), 'utf8');
  const cells = await app.locator(`${tbody} tr`).evaluateAll((rows) => rows.map((r) => { const b = r.querySelector('[data-slm]'); return b ? { own: b.parentElement!.classList.contains('slact'), html: b.parentElement!.classList.contains('slact') ? b.parentElement!.outerHTML : b.outerHTML } : null; }));
  const th = await app.locator(tbody).evaluate((b) => { const h = b.closest('table')!.querySelector('thead tr')!.lastElementChild!; return h.classList.contains('slact') ? h.outerHTML : ''; });
  await proto.evaluate(({ tbody, cells, th, css }) => {
    const b = document.querySelector(tbody)!;
    const head = b.closest('table')!.querySelector('thead tr')!;
    if (th && !head.lastElementChild!.classList.contains('slact')) head.insertAdjacentHTML('beforeend', th);
    [...b.children].forEach((r, k) => { const c = cells[k]; if (!c || r.querySelector('[data-slm]')) return; if (c.own) r.insertAdjacentHTML('beforeend', c.html); else r.lastElementChild!.insertAdjacentHTML('beforeend', ' ' + c.html); });
    if (!document.getElementById('rowMenuCss')) { const st = document.createElement('style'); st.id = 'rowMenuCss'; st.textContent = css; document.head.appendChild(st); }
    window.dispatchEvent(new Event('resize'));
  }, { tbody, cells, th, css });
}

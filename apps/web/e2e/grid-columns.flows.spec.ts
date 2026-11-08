/**
 * Sale and purchase item grids (owner's report, 7 Nov 2026): the heading, rapid entry, item and Total rows
 * have the same columns at the same places, the table fills its card, the total shows once (under Amount),
 * and a switched-off column's width is shared out over the other columns instead of leaving a gap.
 * Checked with Brand/Series on and off, GST on and off, Comfortable and Compact, and with batch, MRP and
 * pack/loose on, at 1280, 1366 and 1920 px.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { APP, freshShop, newPage, openItemSettings, signInAs, untick } from './setup';

const WIDTHS = [1280, 1366, 1920];

interface Grid {
  cols: number; head: number[]; qe: number[]; line: number[]; foot: number[];
  table: { l: number; r: number }; box: { l: number; r: number };
  amtAt: number; amtCount: number; qtyAt: number; th: { qt: number; am: number; amL: number; amR: number; qtL: number; qtR: number };
}

/** Right edges of every column, per row type, plus where the totals sit. */
async function measure(page: Page, sec: string): Promise<Grid> {
  return page.evaluate((sec) => {
    const t = document.querySelector<HTMLTableElement>(`${sec} .dgt`)!;
    const rgt = (els: Element[]) => els.map((e) => Math.round(e.getBoundingClientRect().right));
    const H = [...t.tHead!.rows].filter((r) => !r.classList.contains('qe'));
    // heading edges: every heading cell's right edge (the two rows together give one per column)
    const head = [...new Set(rgt(H.flatMap((r) => [...r.cells])))].sort((a, b) => a - b);
    const q = t.querySelector('tr.qe'); // purchase has no rapid entry row
    const line0 = t.tBodies[0]!.querySelector('tr[data-ln]')!;
    const qe = rgt([...(q ?? line0).children]);
    const line = rgt([...line0.children]);
    const fr = t.tFoot!.rows[0]!;
    const foot = rgt([...fr.cells]);
    const th = (k: string) => t.querySelector(`thead th.${k}`)!.getBoundingClientRect();
    const tr = t.getBoundingClientRect(), wr = t.closest('.dgw')!.getBoundingClientRect();
    const amt = fr.querySelector('[data-t="amt"]')!.getBoundingClientRect(), qty = fr.querySelector('[data-t="qty"]')!.getBoundingClientRect();
    return {
      cols: t.querySelectorAll('colgroup col').length, head, qe, line, foot,
      table: { l: Math.round(tr.left), r: Math.round(tr.right) }, box: { l: Math.round(wr.left), r: Math.round(wr.right) },
      amtAt: Math.round(amt.right), amtCount: fr.querySelectorAll('[data-t="amt"]').length, qtyAt: Math.round(qty.right),
      th: { qt: th('qt').width, am: th('am').width, amL: Math.round(th('am').left), amR: Math.round(th('am').right), qtL: Math.round(th('qt').left), qtR: Math.round(th('qt').right) },
    };
  }, sec);
}

/** All rows line up, the table fills the card, the totals sit under their headings. */
async function checkLined(page: Page, sec: string, what: string): Promise<Grid> {
  const g = await measure(page, sec);
  const near = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= 1);
  expect(near(g.qe, g.line), `${what}: rapid entry row lines up with the item rows (${g.qe} / ${g.line})`).toBe(true);
  expect(near(g.foot, g.line), `${what}: Total row lines up with the item rows (${g.foot} / ${g.line})`).toBe(true);
  expect(near(g.head, g.line), `${what}: headings line up with the item rows (${g.head} / ${g.line})`).toBe(true);
  // no empty space to the right (at 1280 px with every column on it is wider and scrolls, as before)
  expect(Math.abs(g.table.l - g.box.l) <= 1 && g.table.r >= g.box.r - 1, `${what}: the table fills its card (${g.table.r} / ${g.box.r})`).toBe(true);
  expect(g.amtCount, `${what}: the total shows once`).toBe(1);
  expect(Math.abs(g.amtAt - g.th.amR) <= 1, `${what}: the total sits under Amount`).toBe(true);
  expect(Math.abs(g.qtyAt - g.th.qtR) <= 1, `${what}: the quantity total sits under Qty`).toBe(true);
  // no <colgroup> when every column is on; otherwise one <col> per column
  if (g.cols) expect(g.line.length, `${what}: one <col> per column`).toBe(g.cols);
  return g;
}

/** Sale and purchase at every width; returns Qty/Amount widths at 1366 to compare setups. */
async function checkBoth(page: Page, what: string) {
  const out: Record<string, Grid> = {};
  for (const [sec, path] of [['#vNewInv', '/sales/new'], ['#vPEd', '/purchases/new?kind=bill']] as const) {
    await page.goto(APP + path);
    await page.waitForSelector(`${sec} .dgt tfoot tr`);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(150);
      const g = await checkLined(page, sec, `${what}, ${sec === '#vNewInv' ? 'sale' : 'purchase'}, ${w}px`);
      if (w === 1366) out[sec] = g;
    }
  }
  return out;
}

async function setGst(request: APIRequestContext, who: { email: string; password: string }, on: boolean) {
  const login = await request.post(APP + '/api/auth/login', { data: who });
  expect(login.ok()).toBe(true);
  const r = await request.patch(APP + '/api/settings', { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` }, data: { gstEnabled: on } });
  expect(r.ok(), await r.text()).toBe(true);
}

test('item grids: every row lines up and a switched-off column’s width is shared out', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const owner = await freshShop(request);
  const page = await newPage(browser, 1366);
  await signInAs(page, owner);

  // every column on: the CSS alone sizes the table (no widths of ours), as in the prototype
  const all = await checkBoth(page, 'all on');
  for (const sec of ['#vNewInv', '#vPEd']) expect(all[sec]!.cols, `${sec}: every column on sets no widths`).toBe(0);

  // Brand and Series off (Brand takes Series with it): no gap, the other columns grow
  await openItemSettings(page);
  await untick(page, 'f_brand');
  const off = await checkBoth(page, 'Brand and Series off');
  for (const sec of ['#vNewInv', '#vPEd']) {
    expect(off[sec]!.th.qt, `${sec}: Qty gets a share`).toBeGreaterThan(all[sec]!.th.qt + 5);
    expect(off[sec]!.th.am, `${sec}: Amount gets a share`).toBeGreaterThan(all[sec]!.th.am + 10);
  }

  // batch, MRP and pack/loose on: still lined up
  await openItemSettings(page, 1);
  await page.click('#f_mrp');
  await page.click('#f_pack_loose');
  await openItemSettings(page, 2);
  await page.click('#f_batch_no');
  await checkBoth(page, 'batch, MRP and pack on');

  // Compact (the account menu is on the home page; the bill screens hide it)
  await page.goto(APP + '/');
  await page.click('#avBtn');
  await page.click('#miDisplay');
  await page.click('#dspDen [data-v="compact"]');
  await page.click('#dspDone');
  await checkBoth(page, 'Compact');

  // GST off: HSN and both Tax columns go too
  await setGst(request, owner, false);
  const noGst = await checkBoth(page, 'GST off');
  for (const sec of ['#vNewInv', '#vPEd']) expect(noGst[sec]!.th.am, `${sec}: Amount grows more with GST off`).toBeGreaterThan(off[sec]!.th.am + 5);
});

/**
 * The software owner's panel against reference/design/owner-panel.html at 1280, 1366 and 1920 px: the customers
 * page and the customer drawer, with the design's own twelve sample customers in both (the rebuild gets them
 * through its API answer). Owner's decisions (1 Nov 2026), applied to the design before comparing:
 * no "Sample data" label or browser note; one "Paid" plan; Business type shows the mode ("General");
 * "Enrolled via" is Email; the trial bar counts the 14-day trial; the trial-ended text is the new one;
 * the plan form has one "Paid plan" box and a typed "Amount received (₹)" (owner-approved mock), so no prices.
 * New parts with no design (the setup card, the Sign out link, the paused message, the plan form's changes)
 * have owner-approved pictures.
 */
import { expect, test, type Page } from '@playwright/test';
import type { OwnerCustomer, OwnerPayment } from '@billing/shared';
import { compare } from './compare';
import { approvedShot, shot } from './shots';
import { APP, PROTOTYPE_OWNER, WIDTHS, newPage, panelAccount, signInPanel } from './setup';

const TODAY = '2026-10-01';

interface Seed { id: string; mob: string; email: string; biz: string; owner: string; enrolled: string; trialEnd: string; plan: string | null; till: string | null; susp: boolean; pay: { d: string; m: number; amt: number; mode: string; ref: string }[] }

const idOf = (code: string) => `00000000-0000-4000-8000-${code.replace('BE-', '').padStart(12, '0')}`;

/** The design's sample customers, as both pages will show them (the owner's decisions above). */
async function prototypeWithDecisions(proto: Page): Promise<{ customers: OwnerCustomer[]; payments: Record<string, OwnerPayment[]> }> {
  await proto.goto(PROTOTYPE_OWNER);
  await proto.evaluate(() => localStorage.clear());
  await proto.reload();
  const seed = await proto.evaluate(() => (globalThis as unknown as { eval: (s: string) => unknown }).eval('SEED') as Seed[]);
  await proto.evaluate(() => {
    const w = globalThis as unknown as { eval: (s: string) => unknown };
    w.eval(`PLANS.paid={n:'Paid',pm:0,d:''};
      C=SEED.map(c=>({...c,type:'General',via:'email',plan:c.plan?'paid':null,pay:c.pay.map(p=>({...p,p:'paid'}))}));
      render();`);
    document.querySelector('.hero .sample')?.remove();
    document.querySelector('.page > .note')?.remove();
  });
  const customers: OwnerCustomer[] = seed.map((c) => ({
    id: idOf(c.id),
    code: c.id, name: c.biz, ownerName: c.owner, mobile: c.mob, email: c.email, businessType: 'General', via: 'email', enrolled: c.enrolled,
    plan: c.plan ? 'paid' : 'trial', trialEndsOn: c.trialEnd, paidUntil: c.till, status: c.susp ? 'suspended' : 'active',
  }));
  // the payment history, newest first, as the API gives it
  const payments = Object.fromEntries(seed.map((c) => [idOf(c.id), c.pay.slice().reverse().map((p, i) => ({
    id: `${c.id}-${i}`, paidOn: p.d, months: p.m, amount: p.amt.toFixed(2), paidBy: p.mode, reference: p.ref, startsOn: p.d, endsOn: p.d,
  }))]));
  return { customers, payments };
}

/**
 * The design's drawer with the owner's decisions: one "Paid plan" box and the "Amount received (₹)" box
 * (owner-approved mock, its own pictures), "₹0" until an amount is typed, the new trial wording and 14-day bar.
 */
async function prototypeDrawerWithDecisions(proto: Page): Promise<void> {
  await proto.evaluate(() => {
    const d = document.getElementById('drw')!;
    const plans = d.querySelector<HTMLElement>('#af .plans');
    if (plans) {
      plans.style.gridTemplateColumns = '1fr';
      plans.innerHTML = '<button type="button" role="radio" aria-checked="true" class="on" data-plan="paid"><b>Paid plan</b><small>All features · you set the amount</small></button>';
      d.querySelector('#af .two')!.insertAdjacentHTML('afterend', '<label class="fl" for="aAmt">Amount received (₹)<input class="fi" id="aAmt" inputmode="decimal" autocomplete="off"></label>');
      d.querySelector('#af .sum .tt b')!.textContent = '₹0';
    }
    const box = d.querySelector('.subbox');
    const text = box?.querySelector('div:nth-of-type(2)');
    if (text) text.textContent = text.textContent!.replace('The account is locked until you activate a plan.', 'The shop sees a reminder to choose a plan.');
    // the 14-day trial: the same bar the rebuild draws ((days left + 1) / 14)
    const bar = box?.querySelector<HTMLElement>('.meter i[style*="var(--blue)"]');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (parseFloat(bar.style.width) * 7) / 14))}%`;
  });
}

async function panelWith(app: Page, { customers, payments }: { customers: OwnerCustomer[]; payments: Record<string, OwnerPayment[]> }): Promise<void> {
  await app.route('**/api/owner/customers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ today: TODAY, customers }) }));
  await app.route('**/api/owner/customers/*', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customer: customers.find((c) => c.id === id), payments: payments[id] ?? [] }) });
  });
  await signInPanel(app);
  await app.waitForSelector('#rows tr[data-id="BE-1012"]');
}

async function same(name: string, a: Buffer, b: Buffer) {
  const d = compare(name, a, b);
  expect.soft(d.sizeMatches, `${name}: size ${d.width}×${d.height} must match`).toBe(true);
  expect.soft(d.ratio, `${name}: ${d.diffPixels} pixels differ (see test-results/visual/${name}-diff.png)`).toBeLessThanOrEqual(0);
}

const quiet = (p: Page) => p.addStyleTag({ content: '#toast{visibility:hidden!important}' });

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('owner panel: customers page and drawers match the design', async ({ browser, request }) => {
      test.setTimeout(120_000);
      await panelAccount(request);
      const proto = await newPage(browser, width);
      const app = await newPage(browser, width);
      const data = await prototypeWithDecisions(proto);
      await panelWith(app, data);
      await quiet(proto);
      await quiet(app);

      // the Sign out link next to "Software owner" is new: its own approved picture, then copied into the design
      await app.mouse.move(0, 0);
      await approvedShot(`owner-me-${width}`, app, '.me');
      const me = await app.evaluate(() => document.querySelector('.me small')!.innerHTML);
      await proto.evaluate((html) => { document.querySelector('.me small')!.innerHTML = html; }, me);

      await proto.mouse.move(0, 0);
      await same(`owner-customers-${width}`, await shot(proto, 'body'), await shot(app, 'body'));

      for (const f of ['trial', 'expired', 'susp']) {
        await proto.click(`#chips [data-f="${f}"]`);
        await app.click(`#chips [data-f="${f}"]`);
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        await same(`owner-chip-${f}-${width}`, await shot(proto, '.card'), await shot(app, '.card'));
      }
      await proto.click('#chips [data-f="all"]');
      await app.click('#chips [data-f="all"]');

      // trial with days left, trial ended, paid, paid ending soon, suspended
      for (const code of ['BE-1012', 'BE-1010', 'BE-1008', 'BE-1002', 'BE-1003']) {
        await proto.click(`#rows tr[data-id="${code}"]`);
        await app.click(`#rows tr[data-id="${code}"]`);
        await prototypeDrawerWithDecisions(proto);
        await app.waitForSelector('#drw .hist > div');
        for (const p of [proto, app]) await p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); document.getElementById('drw')!.scrollTop = 0; });
        await proto.mouse.move(0, 0);
        await app.mouse.move(0, 0);
        await same(`owner-drawer-${code}-${width}`, await shot(proto, '#drw'), await shot(app, '#drw'));
        // the plan form's new parts: one "Paid plan" box and the amount box (owner-approved mock); taken last, as it scrolls the drawer
        if (code === 'BE-1012') await approvedShot(`owner-plan-form-${width}`, app, '#af');
        await proto.keyboard.press('Escape');
        await app.keyboard.press('Escape');
      }
    });

    test('owner setup card, the account made, and the paused sign-in message', async ({ browser }) => {
      const page = await newPage(browser, width);
      // the setup page's look, whether or not this run's account exists yet
      await page.route('**/api/owner/setup', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"open":true}' }) : r.fulfill({ status: 204 })));
      await page.goto(APP + '/login?setup');
      await page.waitForSelector('#fOwnerSetup');
      await page.fill('#osCode', 'example-setup-code');
      await page.fill('#osName', 'Aman Kumar');
      await page.fill('#osEmail', 'owner@example.com');
      await page.fill('#osPass', 'an example password');
      await page.fill('#osPass2', 'an example password');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(0, 0);
      await approvedShot(`owner-setup-${width}`, page, '#box');
      await page.click('#osGo');
      await page.waitForSelector('#osDone');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(0, 0);
      await approvedShot(`owner-setup-done-${width}`, page, '#box');

      const s = await newPage(browser, width);
      await s.route('**/api/auth/login', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'This shop’s account is paused. Please contact support.', code: 'suspended' }) }));
      await s.goto(APP + '/login');
      await s.waitForSelector('#vAuth:not([hidden])');
      await s.fill('#aEmail', 'shop@example.com');
      await s.fill('#aPass', 'a password 1');
      await s.click('#aGo');
      await s.waitForSelector('#aErr:not(:empty)');
      await s.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await s.mouse.move(0, 0);
      await approvedShot(`owner-paused-signin-${width}`, s, '#box');
    });
  });
}

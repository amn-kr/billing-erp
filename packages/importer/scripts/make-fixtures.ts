/**
 * Makes backup files the way a shop would: by using the prototype's own
 * screens (Start fresh, Add party, Add item, …) and then downloading a backup.
 * Output: fixtures/*.backup.json
 *
 *   pnpm --filter @billing/importer fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../fixtures');
const APP = 'file://' + path.resolve(HERE, '../../../reference/design/app.html');

async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  await ctx.route(/^https?:/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T14:00:00+05:30'));
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(APP);
  await page.waitForTimeout(600);
  return { page, close: () => browser.close() };
}

async function startFresh(page: Page, keepItems: boolean) {
  await page.evaluate(() => (window as any).bzOpen());
  await page.fill('#bzfName', 'Gupta Electricals & Hardware');
  await page.fill('#bzfOwner', 'Ravi Gupta');
  await page.fill('#bzfPhone', '+91 94150 12345');
  await page.fill('#bzfEmail', 'ravi@gupta.example.com');
  await page.fill('#bzfAddr', '45, Latouche Road');
  await page.fill('#bzfCity', 'Lucknow');
  await page.fill('#bzfPin', '226001');
  await page.fill('#bzfGstin', '09AAGFG2231M1ZQ');
  await page.fill('#bzfInv', '101');
  await page.fill('#bzfCash', '15000');
  await page.evaluate((keep) => {
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    $('bzfKeep').checked = keep;
    $('bzfOk').checked = true;
    $('bzfOk').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('#bzm input').forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true })));
  }, keepItems);
  await page.click('#bzmGo');
  await page.waitForSelector('#vDash:not([hidden])');
  await page.waitForTimeout(400);
}

/** Fills the Add party dialog field by field (all three tabs) and saves. */
/** Move the frozen clock on, as a real person typing would (the prototype makes ids from the time). */
let tick = 0;
const later = (page: Page) => page.clock.setFixedTime(new Date(Date.parse('2026-10-01T14:00:00+05:30') + ++tick * 61_000));

async function addParty(page: Page, f: Record<string, string>, opts: { pay?: boolean; ship?: string } = {}) {
  await later(page);
  await page.evaluate(() => (window as any).openParty());
  for (const tab of ['addr', 'cred', 'extra']) {
    await page.evaluate((t) => (document.querySelector(`#ap [data-aptab="${t}"]`) as HTMLButtonElement)?.click(), tab);
    if (tab === 'cred' && opts.pay) await page.evaluate(() => { (0, eval)('AP').type = 'pay'; });
    await page.evaluate((vals) => {
      document.querySelectorAll<HTMLInputElement>('#ap [data-f]').forEach((el) => {
        if (vals[el.dataset.f!] !== undefined) { el.value = vals[el.dataset.f!]!; el.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    }, f);
  }
  await page.evaluate(() => (window as any).apSave(false));
  const err = await page.evaluate(() => JSON.stringify((0, eval)('AP').err));
  if (err !== '{}') throw new Error('party not saved: ' + err);
}

async function addItem(page: Page, f: Record<string, string>, svc = false) {
  await later(page);
  await page.evaluate(() => (window as any).openItem());
  if (svc) await page.evaluate(() => { const s = document.getElementById('aiSvc') as HTMLInputElement | null; if (s) { s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  for (const tab of ['price', 'stock']) {
    await page.evaluate((t) => (document.querySelector(`#ai [data-aitab="${t}"]`) as HTMLButtonElement)?.click(), tab);
    await page.evaluate((vals) => {
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#ai [data-f]').forEach((el) => {
        if (vals[el.dataset.f!] !== undefined) { el.value = vals[el.dataset.f!]!; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }, f);
  }
  await page.evaluate(() => (window as any).saveItem(false));
  const err = await page.evaluate(() => JSON.stringify((0, eval)('AI').err));
  if (err !== '{}') throw new Error('item not saved: ' + err);
}

async function save(page: Page, name: string) {
  const b = await page.evaluate(() => (window as any).bkpMake());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(b, null, 1) + '\n');
  console.log(name, Object.keys(b.keys).length, 'keys');
}

/* ---------- sales, through the prototype's own editor and dialogs ---------- */
const ev = (page: Page, js: string) => page.evaluate((code) => (0, eval)(code), js);

interface SaleSpec { party?: string; cash?: string; date?: string; due?: string; lines: [item: string, qty: number, disc?: number][]; pays?: [mode: string, amt: number, ref?: string][]; bdiscP?: number; chTr?: number; quote?: boolean; challan?: string; ref?: string; full?: boolean }
async function sale(page: Page, s: SaleSpec) {
  await later(page);
  await ev(page, `(() => {
    const s = ${JSON.stringify(s)};
    const party = s.party ? allParties().find((p) => p.name === s.party) : null;
    if (s.quote) openQuoteDoc(party ? { party: party.id } : {});
    else if (s.challan) dcConvert(DCHAL.find((d) => d.no === s.challan).no);
    else openInvoice(party ? { party: party.id } : {});
    if (!party && !s.challan) { SI.mode = 'cash'; SI.cashName = s.cash || ''; }
    if (s.date) { SI.date = s.date; SI.due = s.due || s.date; SI.dueTouched = true; }
    if (s.ref) SI.ref = ELEC.find((e) => e.name === s.ref).id;
    if (!s.challan) SI.lines = s.lines.map(([n, q, d]) => { const L = lineFor(IT.find((i) => i.name === n)); L.qty = q; L.disc = d || 0; return L; });
    if (s.bdiscP) SI.bdiscP = String(s.bdiscP);
    if (s.chTr) SI.chTr = String(s.chTr);
    renderSI();
    if (s.full) { SI.pays = [{ mode: 'UPI', amt: calc().total, ref: '' }]; SI.recvTouched = true; }
    else if (s.pays) { SI.pays = s.pays.map(([mode, amt, ref]) => ({ mode, amt, ref: ref || '' })); SI.recvTouched = true; }
    else if (!s.quote) { SI.recvTouched = true; SI.pays = [{ mode: SI.mode === 'cash' ? 'Cash' : 'UPI', amt: SI.mode === 'cash' ? calc().total : 0, ref: '' }]; }
    renderSI();
    SI.chgOk = true;
    saveSI(false);
    if (SI && SI.err) throw new Error('sale not saved: ' + SI.err);
  })()`);
  await page.evaluate(() => { const m = document.getElementById('ipv'); if (m && !m.hidden) (window as any).closeM('ipv'); });
}

async function salesShop(page: Page) {
  await sale(page, { party: 'Mehta Electricals', date: '2026-09-10', due: '2026-09-25', lines: [['Copper wire 1.5 sq mm (90 m)', 2], ['LED bulb 9W', 10]], pays: [['UPI', 2000, 'UTR88213']] });
  await sale(page, { cash: 'Suresh', date: '2026-09-18', lines: [['MCB 32A double pole', 1]] });
  await sale(page, { party: 'Raju Electrician', date: '2026-09-28', due: '2026-10-13', lines: [['Fan installation', 1], ['LED bulb 9W', 5, 10]], bdiscP: 5, chTr: 100 });
  await sale(page, { party: 'Mehta Electricals', date: '2026-09-30', due: '2026-10-30', lines: [['LED bulb 9W', 4]] });
  await sale(page, { party: 'Raju Electrician', lines: [['LED bulb 9W', 2]], pays: [['Cash', 500]] }); // extra 310 settles old dues
  // cancel the fourth invoice through the sales list
  await later(page);
  await ev(page, `slConfirm('cancel', 'INV-0104'); document.getElementById('slmOk').click();`);
  // a payment from Mehta, settled oldest first
  await later(page);
  await ev(page, `(() => { const p = allParties().find((x) => x.name === 'Mehta Electricals'); rcOpen({ party: p.id }); })()`);
  await page.fill('#rcAmt', '5000');
  await page.dispatchEvent('#rcAmt', 'input');
  await page.selectOption('#rcModeI', 'Cheque');
  await page.fill('#rcRef', '004512');
  await page.click('#rcSave');
  // goods returned against the first invoice
  await later(page);
  await ev(page, `cnOpen({ inv: 'INV-0101' })`);
  await page.fill('#cnRowsI tr[data-cnk="1"] [data-cnq]', '2');
  await page.dispatchEvent('#cnRowsI tr[data-cnk="1"] [data-cnq]', 'input');
  await page.click('#cnSave');
  // two challans: one billed, one still open
  for (const [who, item, q] of [['Raju Electrician', 'LED bulb 9W', '6'], ['Mehta Electricals', 'Copper wire 1.5 sq mm (90 m)', '3']] as const) {
    await later(page);
    await ev(page, `dcOpen()`);
    await ev(page, `(() => { const s = document.getElementById('dcParty'); s.value = allParties().find((x) => x.name === ${JSON.stringify(who)}).id; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.fill('#dcAddI', item);
    await page.dispatchEvent('#dcAddI', 'change');
    await page.fill('#dcRowsI [data-dcq]', q);
    await page.dispatchEvent('#dcRowsI [data-dcq]', 'input');
    await page.fill('#dcTr', 'Self');
    await page.click('#dcSave');
  }
  await sale(page, { challan: 'DC-0001', lines: [] });
  // an item-wise quotation
  await sale(page, { quote: true, party: 'Mehta Electricals', lines: [['MCB 32A double pole', 4], ['Copper wire 1.5 sq mm (90 m)', 1]] });
}

interface PurSpec { kind: 'bill' | 'po' | 'dn'; party: string; date: string; due?: string; exp?: string; ref?: string; lines: [item: string, qty: number, rate: number, disc?: number][]; pays?: [mode: string, amt: number, ref?: string][]; against?: string; reason?: string; fromPo?: string; chTr?: number }
async function purchase(page: Page, s: PurSpec) {
  await later(page);
  await ev(page, `(() => {
    const s = ${JSON.stringify(s)};
    const party = allParties().find((p) => p.name === s.party);
    openPDoc(s.kind, { party: party.id, ...(s.fromPo ? { fromPo: s.fromPo, notes: 'Against order ' + s.fromPo + '.' } : {}) });
    PE.date = s.date; if (s.due) PE.due = s.due; if (s.exp) PE.exp = s.exp; if (s.ref) PE.ref = s.ref;
    if (s.against) PE.against = s.against; if (s.reason) PE.reason = s.reason; if (s.chTr) PE.chTr = String(s.chTr);
    PE.lines = s.lines.map(([n, q, r, d]) => { const it = IT.find((i) => i.name === n); return { id: it.id, name: it.name, hsn: it.hsn || '', qty: q, unit: it.unit, rate: r, disc: d || 0, gst: it.gst || 0 }; });
    if (s.pays) PE.pays = s.pays.map(([mode, amt, ref]) => ({ mode, amt, ref: ref || '' }));
    renderPE();
    savePE();
    if (PE && PE.err && document.getElementById('vPEd') && !document.getElementById('vPEd').hidden) throw new Error('purchase not saved: ' + PE.err);
  })()`);
}

async function purchaseShop(page: Page) {
  await purchase(page, { kind: 'bill', party: 'Kanpur Cables Pvt Ltd', date: '2026-09-20', due: '2026-10-20', ref: 'KC/2209', lines: [['Copper wire 1.5 sq mm (90 m)', 10, 1500], ['LED bulb 9W', 100, 58]], pays: [['Bank transfer', 5000, 'NEFT 4471']] });
  await purchase(page, { kind: 'po', party: 'Kanpur Cables Pvt Ltd', date: '2026-09-25', exp: '2026-09-30', lines: [['LED bulb 9W', 50, 58]] });
  await purchase(page, { kind: 'po', party: 'Kanpur Cables Pvt Ltd', date: '2026-09-29', exp: '2026-10-05', lines: [['MCB 32A double pole', 20, 300]] });
  await purchase(page, { kind: 'bill', party: 'Kanpur Cables Pvt Ltd', date: '2026-09-30', due: '2026-10-30', ref: 'KC/2240', fromPo: 'ORD-0001', lines: [['LED bulb 9W', 50, 58]] });
  await purchase(page, { kind: 'dn', party: 'Kanpur Cables Pvt Ltd', date: '2026-10-01', against: 'PB-0001', reason: 'Damaged goods', lines: [['LED bulb 9W', 5, 58]] });
  // a cheque payment, settled oldest bill first
  await later(page);
  await ev(page, `(() => { const p = allParties().find((x) => x.name === 'Kanpur Cables Pvt Ltd'); openPayModal(p.id); })()`);
  await page.fill('#pyAmt', '10000');
  await page.dispatchEvent('#pyAmt', 'input');
  await page.selectOption('#pyMode', 'Cheque');
  await page.fill('#pyRef', '004890');
  await page.dispatchEvent('#pyRef', 'input');
  await page.click('#pySave');
}

/* ---------- banking, through the prototype's account and move-money windows ---------- */
async function bankAccount(page: Page, f: { name: string; type: string; no: string; ifsc: string; branch: string; open: string; od: string; def?: boolean }) {
  await later(page);
  await ev(page, 'bamOpen()');
  await page.fill('#bamName', f.name);
  await page.selectOption('#bamType', f.type);
  await page.fill('#bamNo', f.no);
  await page.fill('#bamIfsc', f.ifsc);
  await page.fill('#bamBr', f.branch);
  await page.fill('#bamOpen', f.open);
  await page.fill('#bamOd', f.od);
  await page.setChecked('#bamDef', !!f.def);
  await page.click('#bamSave');
  if (!(await page.locator('#bam').isHidden())) throw new Error('account not saved: ' + (await page.textContent('#bamErr')));
}
async function moveMoney(page: Page, f: { kind: string; date: string; amount: string; from?: string; to?: string; acct?: string; cat?: string; ref?: string; note?: string }) {
  await later(page);
  await ev(page, `bmmOpen(${JSON.stringify(f.kind)})`);
  const id = (name: string) => ev(page, `ACCTS.find((a) => a.name === ${JSON.stringify(name)}).id`) as Promise<string>;
  if (f.from) await page.selectOption('#bmmFrom', await id(f.from));
  if (f.to) await page.selectOption('#bmmTo', await id(f.to));
  if (f.acct) await page.selectOption('#bmmAcct', await id(f.acct));
  if (f.cat) await page.selectOption('#bmmCat', f.cat);
  await page.fill('#bmmAmt', f.amount);
  await page.fill('#bmmDate', f.date);
  await page.fill('#bmmRef', f.ref ?? '');
  await page.fill('#bmmNote', f.note ?? '');
  await page.click('#bmmSave');
  if (!(await page.locator('#bmm').isHidden())) throw new Error('entry not saved: ' + (await page.textContent('#bmmErr')));
}
async function expense(page: Page, f: { cat: string; date: string; payee?: string; ref?: string; mode: string; acct: string; note?: string; lines: [name: string, qty: string, rate: string, gst: string][] }) {
  await later(page);
  await ev(page, 'xpOpen()');
  await page.selectOption('#xpCat', f.cat);
  await page.fill('#xpDate', f.date);
  await page.fill('#xpPayee', f.payee ?? '');
  await page.fill('#xpRef', f.ref ?? '');
  for (let i = 0; i < f.lines.length; i++) {
    if (i) await page.click('#xpAddL');
    const [name, qty, rate, gst] = f.lines[i]!;
    const row = page.locator(`#xpLines tr[data-xl="${i}"]`);
    await row.locator('[data-f="name"]').fill(name);
    await row.locator('[data-f="qty"]').fill(qty);
    await row.locator('[data-f="rate"]').fill(rate);
    if (gst !== '0') await row.locator('[data-f="gst"]').selectOption(gst);
  }
  await page.selectOption('#xpMode', f.mode);
  await page.selectOption('#xpAcct', await (ev(page, `ACCTS.find((a) => a.name === ${JSON.stringify(f.acct)}).id`) as Promise<string>));
  await page.fill('#xpNote', f.note ?? '');
  await page.click('#xpSave');
  if (!(await page.locator('#xpm').isHidden())) throw new Error('expense not saved: ' + (await page.textContent('#xpErr')));
}
async function expenseCategory(page: Page, name: string) {
  await ev(page, 'xcOpen()');
  await page.fill('#xcNew', name);
  await page.click('#xcAdd');
  await page.click('#xcDone');
}

async function bankShop(page: Page) {
  await bankAccount(page, { name: 'HDFC Bank', type: 'Current account', no: '50200012347703', ifsc: 'HDFC0001234', branch: 'Hazratganj, Lucknow', open: '125000', od: '2026-09-01', def: true });
  await bankAccount(page, { name: 'State Bank of India', type: 'Savings account', no: '32190012190', ifsc: 'SBIN0000125', branch: 'Aminabad, Lucknow', open: '40000', od: '2026-09-01' });
  await moveMoney(page, { kind: 'deposit', date: '2026-09-28', amount: '10000', from: 'Cash in hand', to: 'HDFC Bank', ref: 'Slip 2231', note: 'Cash deposited at branch' });
  await moveMoney(page, { kind: 'transfer', date: '2026-09-29', amount: '25000', from: 'HDFC Bank', to: 'State Bank of India', ref: 'IMPS 66120', note: 'Moved to savings' });
  await moveMoney(page, { kind: 'out', date: '2026-09-30', amount: '354', acct: 'HDFC Bank', cat: 'Bank charges', note: 'SMS & service charges' });
  await moveMoney(page, { kind: 'in', date: '2026-09-30', amount: '412', acct: 'State Bank of India', cat: 'Interest received', note: 'Quarterly interest' });
  await moveMoney(page, { kind: 'out', date: '2026-10-01', amount: '650', acct: 'Cash in hand', cat: 'Shop expense', note: 'Tea & snacks' });
}
async function expenseShop(page: Page) {
  await expense(page, { cat: 'Rent', date: '2026-09-01', payee: 'R.K. Properties', ref: 'IMPS 66010', mode: 'Bank transfer', acct: 'HDFC Bank', lines: [['Shop rent · September', '1', '25000', '0']] });
  await expense(page, { cat: 'Repairs', date: '2026-09-26', payee: 'Cool Air Services', ref: 'UPI 9932', mode: 'UPI', acct: 'HDFC Bank', lines: [['Shop AC servicing', '1', '2950', '18']] });
  await expense(page, { cat: 'Packing material', date: '2026-09-22', payee: 'Gupta Packers', ref: 'Bill 778', mode: 'Cash', acct: 'Cash in hand', lines: [['Carton boxes', '100', '18', '0'], ['Tape rolls', '12', '45', '0']] });
  await expenseCategory(page, 'Generator diesel');
  // Mehta's cheque deposited in HDFC, through the Cheques page
  await later(page);
  await ev(page, "go('chq')");
  await page.click('#cqRows [data-cqok="R:PI-0625"]');
  await page.selectOption('#bcmAcct', await (ev(page, `ACCTS.find((a) => a.name === 'HDFC Bank').id`) as Promise<string>));
  await page.click('#bcmSave');
  await ev(page, "go('dash')");
  await expense(page, { cat: 'Generator diesel', date: '2026-10-01', payee: 'Indian Oil', mode: 'Cash', acct: 'Cash in hand', note: 'Power cut', lines: [['Diesel', '20', '92.5', '0']] });
}

/* ---------- electrician commission, through the prototype's commission page ---------- */
async function commissionShop(page: Page) {
  await later(page);
  await ev(page, 'elecEdit()');
  await page.fill('#elN', 'Sunil Electrician');
  await page.fill('#elP', '9839044556');
  await page.fill('#elC', 'Lucknow');
  await page.click('#slmOk');
  await sale(page, { party: 'Mehta Electricals', ref: 'Sunil Electrician', date: '2026-09-25', due: '2026-10-25', lines: [['MCB 32A double pole', 5]], full: true });
  await sale(page, { party: 'Raju Electrician', ref: 'Sunil Electrician', date: '2026-09-29', due: '2026-10-14', lines: [['MCB 32A double pole', 2]], pays: [['Cash', 300]] });
  await sale(page, { party: 'Sunil Electrician', date: '2026-09-30', due: '2026-10-15', lines: [['LED bulb 9W', 10]] });
  // one MCB back from the fully paid referred bill
  await later(page);
  await ev(page, `cnOpen({ inv: 'INV-0107' })`);
  await page.fill('#cnRowsI tr[data-cnk="0"] [data-cnq]', '1');
  await page.dispatchEvent('#cnRowsI tr[data-cnk="0"] [data-cnq]', 'input');
  await page.click('#cnSave');
  // pay some commission in cash, then adjust some against his own bill
  for (const [mode, amt] of [['Cash', '100'], ['Adjust', '50']] as const) {
    await later(page);
    await ev(page, `cmPay(ELEC.find((e) => e.name === 'Sunil Electrician').id)`);
    await page.selectOption('#cpM', mode);
    await page.fill('#cpA', amt);
    await page.click('#slmOk');
    if (!(await page.locator('#slm').isHidden())) throw new Error('commission not paid: ' + (await page.textContent('#cpErr')));
  }
}

// 1. the sample shop, untouched
{
  const { page, close } = await open();
  await save(page, 'sample-shop.backup.json');
  await close();
}

// 2. a real-looking fresh shop, entered through the prototype's dialogs
{
  const { page, close } = await open();
  await startFresh(page, false);
  await addParty(page, {
    name: 'Mehta Electricals', phone: '9415012345', group: 'Wholesale customers', gstin: '09AAJPM7745Q1Z2', email: 'mehta@example.com',
    billing: '12, Aminabad Market', ob: '25,000', obDate: '2026-04-01', days: '30',
  });
  await addParty(page, { name: 'Raju Electrician', phone: '9839011223', group: 'Retail customers', ob: '1500', days: '15' });
  await addParty(page, { name: 'Kanpur Cables Pvt Ltd', phone: '9935512345', group: 'Suppliers', gstin: '09AABCK1234L1Z5', ob: '48000', obDate: '2026-04-01' }, { pay: true });
  await addParty(page, { name: 'Walk-in Ramesh', phone: '' });
  await addItem(page, { name: 'Copper wire 1.5 sq mm (90 m)', hsn: '8544', unit: 'COIL', cat: 'Wires & cables', code: 'CW15', sale: '1890', mrp: '2350', purch: '1560', gst: '18', oq: '25', op: '1540', od: '2026-04-01', min: '10', loc: 'Rack A1' });
  await addItem(page, { name: 'LED bulb 9W', hsn: '8539', unit: 'PCS', cat: 'Lighting', sale: '95', purch: '62', gst: '12', oq: '200', min: '50' });
  await addItem(page, { name: 'MCB 32A double pole', hsn: '8536', unit: 'PCS', cat: 'Switches & MCBs', sale: '420', mrp: '560', purch: '310', gst: '18', oq: '0', min: '5' });
  await addItem(page, { name: 'Fan installation', hsn: '9987', unit: 'NOS', cat: 'Services', sale: '350', gst: '18' }, true);
  await save(page, 'fresh-shop.backup.json');
  await salesShop(page);
  await save(page, 'sales-shop.backup.json');
  await purchaseShop(page);
  await save(page, 'purchase-shop.backup.json');
  await bankShop(page);
  await expenseShop(page);
  await save(page, 'bank-shop.backup.json');
  await commissionShop(page);
  await save(page, 'commission-shop.backup.json');
  await close();
}

// 3. started fresh but kept the sample catalogue
{
  const { page, close } = await open();
  await startFresh(page, true);
  await addParty(page, { name: 'Sonu Wiring Works', phone: '9415522114', group: 'Contractors' });
  await save(page, 'fresh-kept-items.backup.json');
  await close();
}

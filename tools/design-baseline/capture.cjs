/*
 * Phase 0 — design baseline.
 * Opens the prototype (reference/design/app.html), visits all 27 screens and
 * all 41 dialogs plus the sign-in page, and saves a screenshot of each at
 * 1280, 1366 and 1920 px wide into reference/baseline/<width>/.
 *
 *   node tools/design-baseline/capture.cjs            # all widths
 *   node tools/design-baseline/capture.cjs 1366       # one width
 *
 * The clock is frozen (1 Oct 2026, 14:00 IST, the date the sample data is
 * built around) and fonts come from a local copy, so runs are repeatable.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { FROZEN_TIME, WIDTHS, newPage } = require('./common.cjs');

const ROOT = path.resolve(__dirname, '../..');
const APP = 'file://' + path.join(ROOT, 'reference/design/app.html');
const LOGIN = 'file://' + path.join(ROOT, 'reference/firebase-site/public/index.html');
const OUT = path.join(ROOT, 'reference/baseline');

/* screen id -> section shown. Order follows the sidebar. */
const SCREENS = [
  ['dash', 'vDash'], ['parties', 'vParties'], ['items', 'vItems'], ['prices', 'vPrices'],
  ['adjs', 'vAdjs'], ['gds', 'vGds'], ['quo', 'vQuo'], ['sales', 'vSales'],
  ['newinv', 'vNewInv'], ['dcs', 'vDcs'], ['pin', 'vPin'], ['cns', 'vCns'], ['com', 'vCom'],
  ['pos', 'vPos'], ['pur', 'vPur'], ['ped', 'vPEd'], ['pmade', 'vPmade'], ['dns', 'vDns'],
  ['exp', 'vExp'], ['bks', 'vBks'], ['cash', 'vCash'], ['chq', 'vChq'], ['rec', 'vRec'],
  ['rep', 'vRep'], ['set', 'vSet'], ['sub', 'vSub'],
];
/* screens that are not reached with go(view) */
const SCREEN_OPEN = {
  newinv: 'openInvoice({})',
  ped: "openPDoc('bill')",
};
/* vPls (Price lists) is retired in the prototype: go('pls') redirects to the
   Price manager, so it is not captured. Its "New price list" dialog (plm) is. */

/* dialog id -> how the prototype itself opens it (falls back to openM(id)). */
const DIALOGS = {
  ov: 'openInv(0)',
  cfm: "openM('cfm')",
  tl: "go('set');renderTL();openM('tl')",
  rq: 'openReq(Object.keys(PLN)[0])',
  pf: "$('miProfile').click()",
  so: "$('miOut').click()",
  ap: 'openParty()',
  rp: "go('parties');PV2.sel=allParties().find(x=>x.tx.length&&balanceOf(x)>0).id;renderParties();openRecv('all')",
  adj: "go('items');openAdj(IT[0])",
  ai: 'openItem()',
  ks: "openM('ks')",
  gdm: "go('gds');$('gdAdd')&&$('gdAdd').click()",
  trm: "go('gds');openTr()",
  plm: "PLK.locked=false;$('plNew').click()",
  ipv: 'showPreview(INVS[0]?INVS[0].no:allSales()[0].no)',
  psm: "go('prices');PLK.locked=false;psOpen()",
  ppv: "go('prices');previewChanges(IT.slice(0,6).map(i=>({i,f:'sale',ov:i.sale,nv:Math.round(i.sale*1.05)})),'Sale price +5%','')",
  phm: "go('prices');$('pmHist').click()",
  plkm: "go('prices');openPinModal('set')",
  qsm: 'openQuickSale()',
  pvm: 'showPDoc(PDOCS[0].no)',
  ppm: "openPayModal(allParties().find(x=>x.role==='s').id)",
  qlm: "go('quo');$('qSaved').click()",
  qcm: "go('quo');const q=document.querySelector('#vQuo .qq');q.value='2';q.dispatchEvent(new Event('input',{bubbles:true}));openConvert()",
  qam: "go('quo');$('qAddRow')&&$('qAddRow').click()",
  rlm: "go('prices');openRateList()",
  avm: "go('items');openAddVar()",
  slm: "slModal({title:'Sign out?',sub:'aman@sharma.example.com',body:'<p style=\"margin:0\">Sample message.</p>',ok:'Sign out',onOk:()=>{}})",
  iqm: 'openInvoice({});iqOpen()',
  pkm: 'plOpen(allSales().find(s=>s.bal>0).no)',
  pkl: 'pllOpen()',
  rcm: 'rcOpen()',
  cnm: 'cnOpen()',
  dcm: 'dcOpen()',
  bam: 'bamOpen()',
  bmm: "go('bks');bmmOpen('deposit')",
  bcm: "go('chq');bcmOpen(allCheques().find(c=>c.s.st==='pending').key,'ok')",
  dcf: "askDiscard('this bill',()=>{})",
  xpm: 'xpOpen()',
  xcm: 'xcOpen()',
  bzm: 'bzOpen()',
  rsm: "rsOpen(bkpMake(),'File · billing-backup.json')",
};

async function closeAll(p) {
  await p.evaluate(() => {
    document.querySelectorAll('.ov').forEach((o) => {
      if (!o.hidden) { try { closeM(o.id); } catch (e) { o.hidden = true; } }
    });
    try { closePops(); } catch (e) {}
    try { if (!$('ov').hidden) closeInv(); } catch (e) {}
    try { go('dash'); } catch (e) {}
  });
}

async function run(width) {
  const dir = path.join(OUT, String(width));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dialogs'), { recursive: true });
  const browser = await chromium.launch();
  const p = await newPage(browser, width);
  const errors = [];
  const report = { width, screens: {}, dialogs: {} };
  p.on('pageerror', (e) => errors.push(e.message));

  /* sign-in page (website version) */
  await p.goto(LOGIN);
  await p.evaluate(() => { document.querySelectorAll('#box > div').forEach((d) => { d.hidden = d.id !== 'vAuth'; }); });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(dir, 'screens', 'login.png'), fullPage: true });
  report.screens.login = 'ok';

  await p.goto(APP);
  await p.waitForTimeout(900);
  report.fontLoaded = await p.evaluate(() => document.fonts.ready.then(() => [...document.fonts].some((f) => /Jakarta/.test(f.family) && f.status === 'loaded')));

  for (const [id, section] of SCREENS) {
    await closeAll(p);
    const how = SCREEN_OPEN[id] || `go('${id}')`;
    const ok = await p.evaluate(({ how, section }) => {
      try { (0, eval)(how); } catch (e) { return 'error: ' + e.message; }
      const s = document.getElementById(section);
      return s && !s.hidden ? 'ok' : 'not shown';
    }, { how, section });
    await p.waitForTimeout(250);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: path.join(dir, 'screens', `${id}.png`), fullPage: true });
    report.screens[id] = ok;
  }

  for (const [id, how] of Object.entries(DIALOGS)) {
    await closeAll(p);
    await p.waitForTimeout(80);
    const res = await p.evaluate(({ id, how }) => {
      let note = 'ok';
      if (how) { try { (0, eval)(how); } catch (e) { note = 'fallback (' + e.message + ')'; } }
      else note = 'fallback (needs data from another step)';
      const el = document.getElementById(id);
      if (el && el.hidden) { try { openM(id); } catch (e) { el.hidden = false; } if (note === 'ok') note = 'fallback (opener did not show it)'; }
      return note;
    }, { id, how });
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(dir, 'dialogs', `${id}.png`) });
    report.dialogs[id] = res;
  }

  report.errors = errors;
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
  return report;
}

(async () => {
  const only = +process.argv[2];
  console.log('Frozen time', FROZEN_TIME);
  for (const w of only ? [only] : WIDTHS) {
    const r = await run(w);
    const fb = Object.entries(r.dialogs).filter(([, v]) => v !== 'ok');
    const bad = Object.entries(r.screens).filter(([, v]) => v !== 'ok');
    console.log(`${w}px: ${Object.keys(r.screens).length} screens, ${Object.keys(r.dialogs).length} dialogs`);
    bad.forEach(([k, v]) => console.log('  screen', k, v));
    fb.forEach(([k, v]) => console.log('  dialog', k, v));
    console.log('  font loaded:', r.fontLoaded);
    if (r.errors.length) console.log('  page errors:', r.errors);
  }
})();

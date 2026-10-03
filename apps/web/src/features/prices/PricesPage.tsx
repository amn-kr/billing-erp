/**
 * Price manager (#vPrices) as the prototype finally shows it: a read-only Price
 * View (renderPrices with its later patches: no edit pens or ticks, MRP column
 * dropped when MRP is off, sticky second heading row, pmFit height) and
 * "Price Setup", which needs the price PIN.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { rulePrice, type PriceRuleSet } from '@billing/shared';
import { inr2f } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { getP, usePm, usePriceData, type Change, type Field, type PItem } from './model';
import { HistoryDialog } from './HistoryDialog';
import { PinDialog } from './PinDialog';
import { PreviewDialog, type Preview } from './PreviewDialog';
import { PriceSetup } from './PriceSetup';
import { ruleOf } from './BrandRules';

const UNDO = '<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>';
const HIST = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
const UP = '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>';
const DOWN = '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const VIEW = '<path d="M4 5h16v14H4zM4 10h16M10 10v9"/>';
const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';

let nudgeT = 0;
/** prototype nudgeLock(): shake the lock and say how to unlock (at most every 2.5 s) */
export function nudgeLock() {
  if (Date.now() - nudgeT > 2500) {
    nudgeT = Date.now();
    useShell.getState().showToast('Prices are locked. Click the lock to unlock with your PIN');
  }
}

export function PricesPage() {
  const data = usePriceData();
  const settings = useSettings().data;
  const mrpOn = !!settings?.data?.mrp;
  const rules = (settings?.data as { priceRules?: Record<string, PriceRuleSet> } | undefined)?.priceRules ?? {};
  const { showToast } = useShell();
  const { undo, pin, hint } = usePm();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [brand, setBrand] = useState('all');
  const [hist, setHist] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const tabRef = useRef<HTMLTableElement>(null);
  const twRef = useRef<HTMLDivElement>(null);
  const locked = !pin;

  // pmFit: the table fills the window; stickH1: second heading row sticks under the first
  useLayoutEffect(() => {
    const fit = () => {
      const t = twRef.current;
      if (t) t.style.maxHeight = innerWidth <= 860 ? '' : Math.max(260, innerHeight - t.getBoundingClientRect().top - ((document.scrollingElement || document.documentElement).scrollTop || 0) - 18) + 'px';
      const tab = tabRef.current;
      const r = tab?.tHead?.rows[0];
      const c = r && [...r.cells].find((x) => (x.rowSpan || 1) === 1);
      if (tab && c) tab.style.setProperty('--h1', Math.floor(c.getBoundingClientRect().height - 1) + 'px');
    };
    const f = requestAnimationFrame(fit);
    addEventListener('resize', fit);
    const ro = new ResizeObserver(fit);
    if (tabRef.current?.tHead) ro.observe(tabRef.current.tHead);
    return () => { cancelAnimationFrame(f); removeEventListener('resize', fit); ro.disconnect(); };
  });
  useEffect(() => () => usePm.getState().set({ pin: null, hint: 'view' }), []);

  if (!data) return <section id="vPrices"></section>;
  const { IT, plCols, brands } = data;
  const s = q.toLowerCase();
  const L = IT.filter((i) => (cat === 'all' || i.cat === cat) && (brand === 'all' || i.brand === brand) && (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s) || i.grp.toLowerCase() === s));
  const cats = [...new Set(IT.map((i) => i.cat).filter(Boolean))];
  const last = undo[undo.length - 1];

  const cell = (i: PItem, f: Field, cls = '') => {
    const v = getP(i, f);
    const ov = f.startsWith('pl:') && !!i.pl[f.slice(3)]?.own;
    return <td className={`n pmv ${f === 'purch' ? 'fx' : ''} ${ov ? 'povr' : ''} ${cls}`} key={f}>{v ? inr2f(v) : '—'}</td>;
  };
  const th = (lb: string, rs?: boolean) => <th className="n" rowSpan={rs ? 2 : undefined}><span className="thw">{lb}</span></th>;
  const openSetup = () => (locked ? setPinOpen(true) : setSetupOpen(true));
  const showPreview = (changes: Change[], how: string, note: ReactNode, after?: () => void) => setPreview({ changes, how, note, after });
  /** prototype: sale prices follow the saved brand rules when an LP or purchase price changes */
  const follow = (applied: Change[]) => {
    const hit = new Map<string, PItem>();
    for (const c of applied) if (c.f === 'lp' || c.f === 'purch') hit.set(c.i.id, { ...(hit.get(c.i.id) ?? c.i), [c.f]: c.nv ?? 0 });
    if (!hit.size) return;
    const ch: Change[] = [];
    for (const i of hit.values()) {
      const r = ruleOf(rules, i);
      if (!r) continue;
      for (const f of ['sale', ...plCols.map((p) => `pl:${p.id}`)] as Field[]) {
        const x = rulePrice(i, f, r);
        if (!x) continue;
        const ov = getP(i, f);
        if (Math.abs(x.p.toNumber() - ov) > 0.001) ch.push({ i, f, ov, nv: x.p.toNumber() });
      }
    }
    if (ch.length) setTimeout(() => showPreview(ch, `Follow pricing rules (${hit.size} item${hit.size > 1 ? 's' : ''} had new LP / purchase price)`, 'These sale prices follow your saved brand rules. Apply to update them, or close to keep the old prices.'), 250);
  };

  return (
    <section id="vPrices" className={locked ? 'plocked' : undefined}>
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Price manager</h1><span className="pttot" id="pmCount">{L.length} of {IT.length} items</span><div className="sp"></div>
        <button className="btn" id="pmUndo" disabled={locked || !undo.length} title={last ? `Undo: ${last.how}` : 'Nothing to undo'} aria-label="Undo"><RawIcon d={UNDO} />Undo</button>
        <button className="btn" id="pmHist" onClick={() => setHist(true)} title="History" aria-label="History"><RawIcon d={HIST} />History</button>
        <button className="btn" id="pmImport" disabled={locked}><RawIcon d={UP} />Import Excel</button><input type="file" id="pmFile" accept=".xlsx,.csv" hidden />
        <button className="btn" id="pmExport" onClick={() => showToast('Excel export comes with the rate list')}><RawIcon d={DOWN} />Export Excel</button>
        <button className="btn" id="pmNewPl" onClick={() => (locked ? nudgeLock() : showToast('New price list'))}><RawIcon d={PLUS} />New price list</button><button className="btn p" id="pmRate" onClick={() => showToast('Rate list comes next')}><RawIcon d={DOWN} />Download rate list</button></div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><h3 className="pmvt"><RawIcon d={VIEW} />Price View</h3><label className="search" htmlFor="pmQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="pmQ" placeholder="Search item or code" autoComplete="off" value={q} onChange={(e) => { usePm.getState().set({ hint: 'view' }); setQ(e.target.value) }} /></label>
          <select className="fi" id="pmCat" aria-label="Category" value={cat} onChange={(e) => { usePm.getState().set({ hint: 'view' }); setCat(e.target.value) }}><option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select><select className="fi" id="pmBrand" aria-label="Brand" value={brand} onChange={(e) => { usePm.getState().set({ hint: 'view' }); setBrand(e.target.value) }}><option value="all">All brands</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
          <span className="mu" id="pmHint" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{hint === 'locked' ? 'Prices are locked. Click the lock to edit.' : hint === 'unlocked' ? 'Click ✎ next to a column name to edit it. Purchase comes from your purchase bills.' : 'Prices are view-only here. Use Price Setup to change them.'}</span><button type="button" className="btn pssbtn" id="pmLock" aria-label="Price Setup (locked with PIN)" title="Set prices with margin %. Needs your price PIN." onClick={openSetup}><RawIcon d={LOCK} />Price Setup</button></div>
        <div className="pmbulk" id="pmBulk" hidden></div>
        <div className="tw" style={{ margin: 0 }} ref={twRef}><table className="ptt2 pmtab" ref={tabRef}>
          <thead id="pmHead"><tr><th rowSpan={2} style={{ minWidth: 200 }}>Item name</th><th rowSpan={2} style={{ minWidth: 150 }}>Brand | Series</th>{mrpOn && th('MRP', true)}{th('LP', true)}<th rowSpan={2} className="n" title="Comes from your purchase bills">Purchase</th><th colSpan={1 + plCols.length} className="c pmsp">SP <small>· sale price</small></th></tr>
            <tr className="pmh2">{th('Retail')}{plCols.map((p) => <th className="n" key={p.id}><span className="thw">{p.name}</span></th>)}</tr></thead>
          <tbody id="pmRows">
            {L.length ? L.map((i) => (
              <tr className="" key={i.id}>
                <td><b style={{ fontWeight: 600 }}>{i.grp || i.name}</b><small>{i.code}{i.svc ? (i.code ? ' · ' : '') + 'service' : ''}</small></td><td>{i.brand ? <b style={{ fontWeight: 600 }}>{i.brand}</b> : <span className="mu">—</span>}{i.series && <span className="pmser"> | {i.series}</span>}</td>
                {mrpOn && cell(i, 'mrp')}{cell(i, 'lp')}{cell(i, 'purch')}{cell(i, 'sale', i.mrp && i.sale > i.mrp ? 'bad' : '')}{plCols.map((p) => cell(i, `pl:${p.id}`))}
              </tr>
            )) : <tr><td colSpan={6 + plCols.length} className="ptempty">No items match these filters.</td></tr>}
          </tbody></table></div>
      </div>
      <HistoryDialog open={hist} fname={data.fname} onClose={() => setHist(false)} />
      <PinDialog open={pinOpen} onClose={() => setPinOpen(false)} onUnlocked={() => { usePm.getState().set({ hint: 'unlocked' }); setPinOpen(false); setSetupOpen(true); }} />
      <PriceSetup open={setupOpen} data={data} onPreview={showPreview} previewOpen={!!preview} onClose={() => { setSetupOpen(false); usePm.getState().set({ pin: null, hint: 'locked' }); showToast('Price Setup closed · prices locked'); }} />
      <PreviewDialog preview={preview} data={data} mrpOn={mrpOn} onClose={() => setPreview(null)} onApplied={follow} />
    </section>
  );
}

/**
 * Price Setup (#psm) — the prototype's psOpen/psRender with its last patch:
 * "Brand rules" (saved rules per brand / series, see BrandRules) and
 * "Fine-tune items" (LP − %, margin % or price per item). Price changes go
 * through the preview (#ppv); rules and prices need the PIN.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { money, type PriceRuleSet } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { RawIcon } from '../../components/Icon';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { getP, mg, r2, rnd, usePm, type Change, type Field, type PItem, type PriceData } from './model';
import { BrandRules, pickEd, prLabel, ruleChanges, type Ed } from './BrandRules';

const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
type Drafts = Record<string, Partial<Record<Field, number>>>;

export function PriceSetup({ open, data, previewOpen, onPreview, onClose }: {
  open: boolean; data: PriceData; previewOpen: boolean;
  onPreview: (changes: Change[], how: string, note: ReactNode, after?: () => void) => void; onClose: () => void;
}) {
  const settings = useSettings().data;
  const mrpOn = !!settings?.data?.mrp;
  const rules = ((settings?.data as { priceRules?: Record<string, PriceRuleSet> } | undefined)?.priceRules ?? {});
  const qc = useQueryClient();
  const { showToast } = useShell();
  const psu = usePm((s) => s.psu);
  const setPsu = (p: Partial<typeof psu>) => usePm.getState().set({ psu: { ...usePm.getState().psu, ...p } });
  const [dr, setDr] = useState<Drafts>({});
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [sure, setSure] = useState(false);
  const [ed, setEd] = useState<Ed | null>(null);
  const [meta, setMeta] = useState({ inherit: false, noLpGroup: false });
  /**
   * The prototype's fitTables() adds .stk (a 520 px cap) to dialog tables only when the
   * page behind changes — i.e. right after prices are applied — and the next redraw of
   * this dialog drops it again.
   */
  const [fitted, setFitted] = useState(false);
  const sureT = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ovRef);
  const { IT, plCols, brands } = data;
  const F: [Field, string][] = [['sale', 'Retail'], ...plCols.map((p): [Field, string] => [`pl:${p.id}`, p.name])];
  const rule = psu.tab === 'rule';

  /** prototype prPick(): choose a brand / series and load its rule */
  const pick = (g: string, from = rules) => {
    const pr = usePm.getState().pr;
    const b = g.split('|')[0]!;
    usePm.getState().set({ pr: { ...pr, g, open: pr.open.includes(b) ? pr.open : [...pr.open, b] } });
    const x = pickEd(IT, F, from, g);
    setEd(x.ed);
    setMeta({ inherit: x.inherit, noLpGroup: x.noLpGroup });
    setFitted(false);
  };
  useEffect(() => {
    if (!open) return;
    setDr({}); setRaw({}); setSure(false); setFitted(false);
    const g = usePm.getState().pr.g;
    if (g) pick(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const s = psu.q.toLowerCase();
  const L = IT.filter((i) => (psu.cat === 'all' || i.cat === psu.cat) && (psu.brand === 'all' || i.brand === psu.brand) && (!psu.ser || psu.ser === 'all' || i.series === psu.ser) && (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s)));
  const cats = [...new Set(IT.map((i) => i.cat).filter(Boolean))].sort();
  const sers = [...new Set(IT.filter((i) => (psu.brand === 'all' || i.brand === psu.brand) && (psu.cat === 'all' || i.cat === psu.cat)).map((i) => i.series).filter(Boolean))].sort();
  const ser = psu.ser && psu.ser !== 'all' && !sers.includes(psu.ser) ? 'all' : psu.ser;

  /* Fine-tune items: changes from the typed drafts */
  const ch: Change[] = [];
  for (const [id, d] of Object.entries(dr)) {
    const i = IT.find((x) => x.id === id);
    if (!i) continue;
    for (const [f, nv] of Object.entries(d) as [Field, number][]) {
      const ov = getP(i, f);
      if (Math.abs(nv - ov) > 0.001) ch.push({ i, f, ov, nv });
    }
  }
  const g = usePm((st) => st.pr.g);
  const rc = ruleChanges(IT, F, rules, g, ed);

  function close() {
    if (Object.keys(dr).length && !sure) {
      setSure(true);
      clearTimeout(sureT.current);
      sureT.current = window.setTimeout(() => setSure(false), 2500);
      showToast('You have unsaved prices. Press Discard to drop them, or Preview changes to save.');
      return;
    }
    setDr({});
    onClose();
  }
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !previewOpen) { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [open, previewOpen]);

  const rerender = () => { setRaw({}); setFitted(false); };
  async function saveRule(k: string, r: Ed | null) {
    const pin = usePm.getState().pin;
    const res = await api<{ rules: Record<string, PriceRuleSet> }>('/prices/rules', { body: { pin, key: k, rule: r } });
    await qc.invalidateQueries({ queryKey: ['settings'] });
    return res.rules;
  }
  async function go() {
    if (!rule) {
      if (!ch.length) return;
      onPreview(ch, `Price Setup: ${ch.length} item-wise change${ch.length > 1 ? 's' : ''}`, 'Old → new. You can undo after saving.', () => { setDr({}); setRaw({}); setFitted(true); });
      return;
    }
    if (!g || !ed) return;
    if (!F.some(([f]) => ed[f] && ed[f]!.m !== 'none' && ed[f]!.v !== '')) return showToast('Set at least one price: choose a basis and type a %');
    try {
      const saved = await saveRule(g, ed);
      const { ch: rch, fl } = ruleChanges(IT, F, saved, g, ed);
      showToast(`Rule saved for ${prLabel(g)}`);
      if (rch.length) onPreview(rch, `Rule · ${prLabel(g)}`, `${fl ? fl + ' price' + (fl > 1 ? 's are' : ' is') + ' held at the minimum margin. ' : ''}Old → new. You can undo after saving.`, () => { pick(g, saved); setFitted(true); });
      else pick(g, saved);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save the rule.');
    }
  }
  async function removeRule() {
    if (!g) return;
    try {
      const saved = await saveRule(g, null);
      showToast(`Rule removed for ${prLabel(g)}. Prices stay as they are.`);
      pick(g, saved);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not remove the rule.');
    }
  }

  /* Fine-tune items: the prototype's input handler */
  const dv = (i: PItem, f: Field) => dr[i.id]?.[f] ?? getP(i, f);
  function itemInput(i: PItem, kind: 'pf' | 'pm' | 'pd', f: Field, text: string) {
    const r0 = text.replace(/[^\d.]/g, '');
    const d: Partial<Record<Field, number>> = { ...(dr[i.id] ?? {}) };
    const setD = (h: Field, v: number | null) => {
      const ov = getP(i, h);
      if (v === null || Math.abs(v - ov) < 0.001) delete d[h];
      else d[h] = v;
    };
    const curLp = d.lp ?? i.lp;
    if (kind === 'pm') setD(f, r0 === '' ? null : rnd(money(i.purch).times(money(100).plus(r0)).div(100), 0));
    else if (kind === 'pd') setD(f, r0 === '' || !(curLp > 0) ? null : rnd(money(curLp).times(money(100).minus(r0)).div(100), 0));
    else setD(f, r0 === '' ? null : Number(r0));
    const next = { ...dr };
    if (Object.keys(d).length) next[i.id] = d;
    else delete next[i.id];
    setDr(next);
    // the box typed in keeps its text; the boxes it updates show the new figures
    const nr = { ...raw, [`${i.id}:${kind}:${f}`]: text };
    const drop = (h: Field, keep?: string) => (['pf', 'pm', 'pd'] as const).forEach((k) => { if (k !== keep) delete nr[`${i.id}:${k}:${h}`]; });
    if (kind === 'pf' && f === 'lp') F.forEach(([h]) => drop(h));
    else if (!(kind === 'pf' && f === 'mrp')) drop(f, kind);
    setRaw(nr);
    setFitted(false);
  }
  const val = (key: string, v: string) => (key in raw ? raw[key]! : v);
  const warn = (i: PItem, p: number, mrp: number) => (mrpOn && mrp && p > mrp) || (i.purch && p && p < i.purch);
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const t = e.currentTarget;
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const k = t.dataset.pf ? 'pf' : t.dataset.pd ? 'pd' : 'pm';
    const all = [...bodyRef.current!.querySelectorAll<HTMLInputElement>(`[data-${k}="${t.dataset[k]}"]:not([disabled])`)];
    const n = all[all.indexOf(t) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (n) { n.focus(); n.select(); }
  }
  const sel = (e: React.FocusEvent<HTMLInputElement>) => { const t = e.currentTarget; setTimeout(() => t.select(), 0); };

  return (
    <div className={`ov c${rule ? ' prmode' : ''}`} id="psm" ref={ovRef} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'psm') close(); }}>
      <div className="mdl psmd" role="dialog" aria-modal="true" aria-labelledby="psT">
        <div className="dh"><div><h3 id="psT" style={{ margin: 0, fontSize: 18 }}>Price Setup</h3><small className="mu">Set sale prices from List Price (LP − discount %) or purchase price (+ margin %). Prices lock again when you close this.</small></div><button className="ib" type="button" id="psClose" aria-label="Close" onClick={close}><RawIcon d={X} /></button></div>
        <div className="psbar"><div className="seg2 sm" id="psTabs"><button type="button" data-pst="rule" className={rule ? 'on' : ''} onClick={() => { setPsu({ tab: 'rule' }); rerender(); }}>Brand rules</button><button type="button" data-pst="item" className={!rule ? 'on' : ''} onClick={() => { setPsu({ tab: 'item' }); rerender(); }}>Fine-tune items</button></div>
          <label className="search" htmlFor="psQ" style={{ height: 34, maxWidth: 230 }}><RawIcon d={SEARCH} /><input id="psQ" placeholder="Search item or code" autoComplete="off" value={psu.q} onChange={(e) => { setPsu({ q: e.target.value }); rerender(); }} /></label>
          <select className="fi" id="psCat" aria-label="Category" value={psu.cat} onChange={(e) => { setPsu({ cat: e.target.value }); rerender(); }}><option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="fi" id="psBrand" aria-label="Brand" value={psu.brand} onChange={(e) => { setPsu({ brand: e.target.value, ser: 'all' }); rerender(); }}><option value="all">All brands</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="fi" id="psSer" aria-label="Series" value={ser || 'all'} disabled={!sers.length} onChange={(e) => { setPsu({ ser: e.target.value }); rerender(); }}><option value="all">All series</option>{sers.map((x) => <option key={x}>{x}</option>)}</select><span className="mu" id="psN" style={{ fontSize: 12.5 }}>{L.length} item{L.length === 1 ? '' : 's'}</span></div>
        <div id="psBody" ref={bodyRef}>
          {rule ? (
            <BrandRules IT={IT} F={F} rules={rules} ed={ed} setEd={(e) => { setEd(e); setFitted(false); }} meta={meta} fitted={fitted} onPick={(k) => pick(k)} onRemove={removeRule} />
          ) : (
            <div className={`tw pstw${fitted ? ' stk' : ''}`}><table className="ptt2 psit">
              <thead><tr><th rowSpan={2}>Item</th><th rowSpan={2} className="n">Purchase</th>{mrpOn && <th rowSpan={2} className="n">MRP</th>}<th rowSpan={2} className="n">LP</th>{F.map(([f, lb]) => <th colSpan={3} className="c psg" key={f}>{lb}</th>)}</tr>
                <tr>{F.map(([f]) => [<th className="n sub" title="Discount on List Price" key={f + 'd'}>LP − %</th>, <th className="n sub" title="Margin on purchase price" key={f + 'm'}>Margin %</th>, <th className="n sub" key={f + 'p'}>Price</th>])}</tr></thead>
              <tbody>
                {L.length ? L.map((i) => {
                  const d = dr[i.id] ?? {};
                  const mrp = d.mrp ?? i.mrp;
                  const lpv = dv(i, 'lp');
                  return (
                    <tr data-psi={i.id} key={i.id}><td><b>{i.grp || i.name}</b><small>{[i.brand, i.series].filter(Boolean).join(' | ')}{i.code ? ' · ' + i.code : ''}</small></td><td className="n mu">{i.purch ? inr2f(i.purch) : '—'}</td>
                      {(mrpOn ? (['mrp', 'lp'] as const) : (['lp'] as const)).map((k) => (
                        <td className="n" key={k}><input className={`fi n psin ${d[k] !== undefined ? 'chg' : ''}`} data-pf={k} value={val(`${i.id}:pf:${k}`, String(dv(i, k) || ''))} inputMode="decimal" placeholder="—" onChange={(e) => itemInput(i, 'pf', k, e.target.value)} onKeyDown={onKey} onFocus={sel} /></td>
                      ))}
                      {F.map(([f]) => {
                        const p = dv(i, f);
                        const m = mg(p, i.purch);
                        const dl = lpv > 0 && p > 0 ? r2(money(1).minus(money(p).div(lpv)).times(100)) : null;
                        const c = d[f] !== undefined ? 'chg' : '';
                        return [
                          <td className="n" key={f + 'd'}><input className={`fi n psin psm psd ${c}`} data-pd={f} value={val(`${i.id}:pd:${f}`, dl === null ? '' : String(dl))} inputMode="decimal" placeholder={lpv ? '0' : '—'} disabled={!lpv} title={lpv ? undefined : 'No list price'} onChange={(e) => itemInput(i, 'pd', f, e.target.value)} onKeyDown={onKey} onFocus={sel} /></td>,
                          <td className="n" key={f + 'm'}><input className={`fi n psin psm ${c}`} data-pm={f} value={val(`${i.id}:pm:${f}`, m === null ? '' : String(m))} inputMode="decimal" placeholder={i.purch ? '0' : '—'} disabled={!i.purch} title={i.purch ? undefined : 'No purchase price'} onChange={(e) => itemInput(i, 'pm', f, e.target.value)} onKeyDown={onKey} onFocus={sel} /></td>,
                          <td className="n" key={f + 'p'}><input className={`fi n psin ${c} ${warn(i, p, mrp) ? 'bad' : ''}`} data-pf={f} value={val(`${i.id}:pf:${f}`, String(p || ''))} inputMode="decimal" placeholder="—" onChange={(e) => itemInput(i, 'pf', f, e.target.value)} onKeyDown={onKey} onFocus={sel} /></td>,
                        ];
                      })}
                    </tr>
                  );
                }) : <tr><td colSpan={4 + F.length * 2} className="ptempty">No items match.</td></tr>}
              </tbody></table></div>
          )}
        </div>
        <div className="psft"><span className="mu" id="psFt">{rule ? (g ? 'Saved rules re-price items automatically when their LP or purchase price changes.' : '') : ch.length ? <><b>{ch.length} price{ch.length > 1 ? 's' : ''}</b> will change</> : 'Type a margin % or a price. Changed boxes turn amber.'}</span><span style={{ flex: 1 }}></span>
          <button className={`btn${sure ? ' dz' : ''}`} type="button" id="psDiscard" style={rule ? { display: 'none' } : undefined} onClick={() => { setDr({}); setSure(false); rerender(); }}>{sure ? 'Discard unsaved?' : 'Discard'}</button>
          <button className="btn p" type="button" id="psGo" disabled={rule ? !g : !ch.length} onClick={go}>{rule ? (rc.ch.length ? 'Save rule & preview prices' : 'Save rule') : 'Preview changes'}</button></div>
      </div>
    </div>
  );
}

/**
 * Price Setup › Brand rules — the prototype's prRender/prPick: one saved rule per
 * brand (or series) sets the sale prices from List Price or purchase price.
 * Maths: rulePrice() in packages/shared.
 */
import { useEffect, useState } from 'react';
import { money, rulePrice, type PriceRuleSet, type RuleField } from '@billing/shared';
import { inr2f } from '../../lib/format';
import { RawIcon } from '../../components/Icon';
import { getP, mg, r2, usePm, type Change, type Field, type PItem } from './model';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const CAR = '<path d="M9 6l6 6-6 6"/>';
type Sw = { on: boolean; v: string | number };
export type Ed = Record<string, RuleField> & { floor: Sw; noLp: Sw };

export const prKey = (i: PItem) => (i.brand ? `${i.brand}|${i.series}` : `—|cat:${i.cat || 'Other'}`);
const sName = (s: string) => (s.startsWith('cat:') ? s.slice(4) : s || '(no series)');
const split = (g: string) => { const b = g.split('|')[0]!; return [b, g.slice(b.length + 1)] as const; };
export const prLabel = (g: string) => { const [b, s] = split(g); return (b === '—' ? 'No brand' : b) + (s === '*' ? (b === '—' ? ' · all items' : ' · all series') : ' · ' + sName(s)); };
export const groupItems = (IT: PItem[], g: string) => { const [b, s] = split(g); return IT.filter((i) => (i.brand || '—') === b && (s === '*' || prKey(i) === g)); };
/** the rule that prices an item: its series rule, else its brand rule */
export const ruleOf = (rules: Record<string, PriceRuleSet>, i: PItem) => rules[prKey(i)] ?? rules[`${i.brand || '—'}|*`] ?? null;

function groups(IT: PItem[]) {
  const B: Record<string, Map<string, number>> = {};
  for (const i of IT) {
    const b = i.brand || '—';
    const m = (B[b] ??= new Map());
    const s = prKey(i).slice(b.length + 1);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return Object.keys(B).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b))).map((b) => ({ b, series: [...B[b]!].sort((x, y) => x[0].localeCompare(y[0])), n: [...B[b]!.values()].reduce((a, c) => a + c, 0) }));
}
function suggest(items: PItem[], f: Field) {
  const L = items.filter((i) => i.lp > 0 && getP(i, f) > 0);
  if (!L.length) return null;
  const d = L.reduce((a, i) => a.plus(money(1).minus(money(getP(i, f)).div(i.lp)).times(100)), money(0)).div(L.length);
  const M = items.filter((i) => i.purch > 0 && getP(i, f) > 0);
  const m = M.length ? M.reduce((a, i) => a.plus(money(getP(i, f)).div(i.purch).minus(1).times(100)), money(0)).div(M.length) : null;
  return { lp: r2(d), mg: m === null ? null : r2(m) };
}

/** Pick a brand / series: start from its saved rule (or the brand's), else sensible defaults. */
export function pickEd(IT: PItem[], F: [Field, string][], rules: Record<string, PriceRuleSet>, g: string) {
  const r = rules[g] ?? (g.endsWith('|*') ? null : rules[g.split('|')[0] + '|*']);
  const ed = JSON.parse(JSON.stringify(r ?? { floor: { on: true, v: 5 } })) as Ed;
  const hasLp = groupItems(IT, g).some((i) => i.lp > 0);
  for (const [f] of F) if (!ed[f]) ed[f] = { m: hasLp ? 'none' : 'margin', v: '', rd: '1' };
  if (!ed.floor) ed.floor = { on: false, v: 5 };
  if (!ed.noLp) ed.noLp = { on: true, v: 20 };
  return { ed, inherit: !rules[g] && !!r, noLpGroup: !hasLp };
}

export function ruleChanges(IT: PItem[], F: [Field, string][], rules: Record<string, PriceRuleSet>, g: string | null, ed: Ed | null) {
  const ch: Change[] = [];
  let skip = 0;
  let fl = 0;
  if (!g || !ed) return { ch, skip, fl };
  const L = groupItems(IT, g).filter((i) => (g.endsWith('|*') ? !rules[prKey(i)] : true));
  for (const [f] of F) {
    const x = ed[f];
    if (!x || x.m === 'none' || x.v === '') continue;
    for (const i of L) {
      const r = rulePrice(i, f, ed);
      if (!r) { skip++; continue; }
      if (r.floor) fl++;
      const ov = getP(i, f);
      const nv = r.p.toNumber();
      if (Math.abs(nv - ov) > 0.001) ch.push({ i, f, ov, nv });
    }
  }
  return { ch, skip, fl };
}

export function BrandRules({ IT, F, rules, ed, setEd, meta, fitted, onPick, onRemove }: {
  IT: PItem[]; F: [Field, string][]; rules: Record<string, PriceRuleSet>; ed: Ed | null; setEd: (e: Ed) => void; fitted: boolean;
  meta: { inherit: boolean; noLpGroup: boolean }; onPick: (g: string) => void; onRemove: () => void;
}) {
  const pr = usePm((s) => s.pr);
  const setPr = (p: Partial<typeof pr>) => usePm.getState().set({ pr: { ...usePm.getState().pr, ...p } });
  const [, force] = useState(0);
  const G = groups(IT);
  const q = pr.q.toLowerCase();
  useEffect(() => {
    if (!pr.g) {
      const first = G.find((x) => x.b !== '—');
      if (first) onPick(first.b + '|*');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.g]);

  const badge = (r: PriceRuleSet | undefined) => {
    if (!r) return null;
    const t = F.map(([f, lb]) => { const x = r[f] as RuleField | undefined; if (!x || x.m === 'none' || x.v === '') return ''; return `${lb[0]}: ${x.m === 'margin' ? 'P+' : x.m === 'lpup' ? 'LP+' : 'LP−'}${x.v}%`; }).filter(Boolean).join(' · ');
    return t ? <em className="prb">{t}{r.floor?.on ? ` · min ${r.floor.v}%` : ''}</em> : null;
  };
  const toggle = (b: string) => setPr({ open: pr.open.includes(b) ? pr.open.filter((x) => x !== b) : [...pr.open, b] });

  const left = G.filter((x) => !q || (x.b === '—' ? 'no brand' : x.b.toLowerCase()).includes(q) || x.series.some(([s]) => sName(s).toLowerCase().includes(q))).map((x) => {
    const open = pr.open.includes(x.b) || !!q;
    const bk = x.b + '|*';
    return (
      <div className="prb1" key={x.b}>
        <button type="button" className={`prg ${pr.g === bk ? 'on' : ''}`} data-prg={bk} onClick={() => onPick(bk)}><span className="prt"><svg className={`i car2 ${open ? 'op' : ''}`} data-prt={x.b} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: CAR }} onClick={(e) => { e.stopPropagation(); toggle(x.b); }} /><b>{x.b === '—' ? 'No brand' : x.b}</b><small>{x.n}</small></span>{badge(rules[bk])}</button>
        {open && x.series.filter(([s]) => !q || sName(s).toLowerCase().includes(q) || 'no brand'.includes(q) || x.b.toLowerCase().includes(q)).map(([s, n]) => {
          const k = x.b + '|' + s;
          return <button type="button" className={`prg sub ${pr.g === k ? 'on' : ''}`} data-prg={k} key={k} onClick={() => onPick(k)}><span className="prt"><span>{sName(s)}</span><small>{n}</small></span>{rules[k] ? badge(rules[k]) : rules[bk] ? <em className="prb in">brand rule</em> : null}</button>;
        })}
      </div>
    );
  });

  const g = pr.g;
  const items = g ? groupItems(IT, g) : [];
  const isB = !!g && g.endsWith('|*');
  const own = isB ? items.filter((i) => rules[prKey(i)]).length : 0;
  const { ch, skip, fl } = ruleChanges(IT, F, rules, g, ed);
  const byI = new Map<string, Partial<Record<Field, number>>>();
  ch.forEach((c) => { (byI.get(c.i.id) ?? byI.set(c.i.id, {}).get(c.i.id)!)[c.f] = c.nv!; });
  const setF = (f: string, k: keyof RuleField, v: string) => { if (!ed) return; setEd({ ...ed, [f]: { ...ed[f]!, [k]: k === 'v' ? v.replace(/[^\d.]/g, '') : v } } as Ed); force((n) => n + 1); };
  const setSw = (k: 'floor' | 'noLp', p: Partial<Sw>) => ed && setEd({ ...ed, [k]: { ...ed[k], ...p } } as Ed);
  const num = (v: string) => v.replace(/[^\d.]/g, '');

  const fRow = ([f, lb]: [Field, string]) => {
    const x = ed?.[f] ?? { m: 'none', v: '', rd: '1' };
    const sg = suggest(items, f);
    const opts: [string, string][] = meta.noLpGroup ? [['margin', 'Purchase + %'], ['none', 'Don’t auto-price']] : [['lp', 'List Price − %'], ['margin', 'Purchase + %'], ['lpup', 'List Price + %'], ['none', 'Don’t auto-price']];
    return (
      <div className="prrow" data-prf={f} key={f}><b className="prl">{lb}</b>
        <select className="fi" data-k="m" value={x.m} onChange={(e) => setF(f, 'm', e.target.value)}>{opts.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select>
        <span className="pre3 ps3"><input className="fi n" data-k="v" value={x.v} inputMode="decimal" placeholder="0" disabled={x.m === 'none'} onChange={(e) => setF(f, 'v', e.target.value)} /><i>%</i></span>
        <select className="fi prrd" data-k="rd" title="Round up to" value={String(x.rd)} onChange={(e) => setF(f, 'rd', e.target.value)}>{[['0', 'No rounding'], ['1', 'Round to 1'], ['5', 'Round to 5'], ['10', 'Round to 10']].map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select>
        {sg && <button type="button" className="prsg" data-prsg={f} title="Use the current average" onClick={() => { const m = x.m === 'none' || x.m === 'lpup' ? 'lp' : x.m; setEd({ ...ed!, [f]: { ...x, m, v: String(m === 'margin' ? (sg.mg ?? '') : Math.round(sg.lp * 2) / 2) } } as Ed); }}>Now ≈ {x.m === 'margin' ? (sg.mg === null ? '—' : 'P + ' + sg.mg + '%') : 'LP − ' + sg.lp + '%'}</button>}
      </div>
    );
  };

  return (
    <div className="prw">
      <aside className="prleft"><label className="search" htmlFor="prQ" style={{ height: 34, margin: '0 0 8px' }}><RawIcon d={SEARCH} /><input id="prQ" placeholder="Find brand or series" value={pr.q} autoComplete="off" onChange={(e) => setPr({ q: e.target.value })} /></label><div className="prlist">{left}</div></aside>
      <section className="prright">
        {g && ed ? (
          <>
            <div className="prhd"><div><h4>{prLabel(g)}</h4><small className="mu">{items.length} item{items.length === 1 ? '' : 's'}{isB && own ? ` · ${own} with their own series rule (kept)` : ''}{meta.inherit ? ' · using the brand rule — change and save to give this series its own rule' : ''}{rules[g] ? ' · rule saved' : ' · no rule saved yet'}</small></div>{rules[g] && <button type="button" className="btn sm dz" id="prDel" onClick={onRemove}>Remove rule</button>}</div>
            <div className="prrules">{F.map(fRow)}
              {!meta.noLpGroup && F.some(([f]) => ed[f] && (ed[f]!.m === 'lp' || ed[f]!.m === 'lpup')) && items.some((i) => !(i.lp > 0)) && (
                <label className="prfloor cb2"><input type="checkbox" id="prNl" checked={!!ed.noLp?.on} onChange={(e) => setSw('noLp', { on: e.target.checked })} /> Items with no List Price: use purchase + <span className="pre3 ps3"><input className="fi n" id="prNlV" value={String(ed.noLp ? ed.noLp.v : 20)} inputMode="decimal" onChange={(e) => setSw('noLp', { v: num(e.target.value) })} /><i>%</i></span> <small className="mu">{items.filter((i) => !(i.lp > 0)).length} item(s) here have no LP</small></label>
              )}
              <label className="prfloor cb2"><input type="checkbox" id="prFl" checked={!!ed.floor?.on} onChange={(e) => setSw('floor', { on: e.target.checked })} /> Never sell below purchase + <span className="pre3 ps3"><input className="fi n" id="prFlV" value={String(ed.floor ? ed.floor.v : 5)} inputMode="decimal" onChange={(e) => setSw('floor', { v: num(e.target.value) })} /><i>%</i></span> <small className="mu">minimum margin</small></label></div>
            <div className="prsum">{ch.length ? <><b>{ch.length} price{ch.length > 1 ? 's' : ''}</b> will change</> : 'No price changes with this rule'}{fl ? <> · <span className="lowq">{fl} held at the minimum margin</span></> : null}{skip ? <> · <span className="mu">{skip} skipped (no LP / purchase price)</span></> : null}</div>
            <div className={`tw prtw${fitted ? ' stk' : ''}`}><table className="ptt2 prt"><thead><tr><th>Item</th><th className="n">Purchase</th><th className="n">LP</th>{F.map(([f, lb]) => <th className="n" key={f}>{lb}</th>)}</tr></thead>
              <tbody>
                {items.slice(0, 60).map((i) => {
                  const nn = byI.get(i.id) ?? {};
                  const inh = isB && !!rules[prKey(i)];
                  return (
                    <tr className={inh ? 'prskip' : ''} key={i.id}><td><b>{i.grp || i.name}</b><small>{i.brand ? i.series : i.cat}{inh ? ' · has its own series rule' : ''}</small></td><td className="n mu">{i.purch ? inr2f(i.purch) : '—'}</td><td className="n mu">{i.lp ? inr2f(i.lp) : '—'}</td>
                      {F.map(([f]) => {
                        const ov = getP(i, f);
                        const nv = nn[f];
                        const p = nv !== undefined ? nv : ov;
                        const m = mg(p, i.purch);
                        const r = rulePrice(i, f, ed);
                        return <td className="n" key={f}>{nv !== undefined ? <><s className="mu">{inr2f(ov)}</s> <b className={nv > ov ? 'pos' : 'neg'}>{inr2f(nv)}</b></> : <span>{ov ? inr2f(ov) : '—'}</span>}{r?.floor ? <> <i className="prfl" title="Held at the minimum margin">min</i></> : null}{r?.fb ? <> <i className="prfl fb" title="No List Price, priced from purchase">P+</i></> : null}<small className={m !== null && m < 5 ? 'neg' : 'mu'}>{m === null ? '' : m.toFixed(1) + '% margin'}</small></td>;
                      })}
                    </tr>
                  );
                })}
                {items.length > 60 && <tr><td colSpan={3 + F.length} className="mu" style={{ textAlign: 'center' }}>…and {items.length - 60} more</td></tr>}
              </tbody></table></div>
          </>
        ) : <div className="ptempty">Pick a brand or series on the left.</div>}
      </section>
    </div>
  );
}

/**
 * The editor's item grid (#siHead / #siRows / #siFoot) with the rapid-entry row
 * (prototype qeRow), the item and party search lists (showCombo / cbPlace) and
 * the keyboard rules: Enter moves along the row, then to the next row.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { inr, inr2f } from '../../../lib/format';
import { qfmt } from '../../items/ItemsPage';
import { pct } from '../InvoicePreview';
import { usePriceHistory } from './PriceHistory';
import { blankLine, calc, finalRate, frSet, lineFor, r2, useTab, type Ctx, type EItem, type EParty, type Line, type SI } from './state';
import type { EditorData } from './data';

const BOLT = '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>';

/* ---------- search lists (one open at a time, like the prototype's CB) ---------- */
export interface ComboOpt { add?: boolean; html: ReactNode; val: unknown; cls?: string }
export interface ComboState { key: string; opts: ComboOpt[]; i: number; pick: (v: unknown) => void }
export const useCombo = () => {
  const [cb, setCb] = useState<ComboState | null>(null);
  return { cb, setCb, show: (key: string, opts: ComboOpt[], pick: (v: unknown) => void) => setCb({ key, opts, i: opts.findIndex((o) => !!o) , pick }), hide: () => setCb(null) };
};
export type Combo = ReturnType<typeof useCombo>;

/** The list under a search box (prototype .cbl); inside the grid it floats above the page (cbfx). */
export function ComboList({ c, k, id, grid }: { c: Combo; k: string; id?: string; grid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const on = c.cb?.key === k;
  const [st, setSt] = useState<React.CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!on || !grid || !l) return setSt(undefined);
    const place = () => {
      const td = l.closest('td');
      if (!td) return;
      const r = td.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 460), innerWidth - 24);
      const foot = l.closest('section')?.querySelector('.sift') as HTMLElement | null;
      const fh = foot ? foot.offsetHeight : 0;
      const below = innerHeight - fh - r.bottom - 8;
      const above = r.top - 70;
      const h = Math.min(l.scrollHeight || 300, 300);
      if (below < Math.min(h, 200) && above > below) setSt({ width: w, left: Math.max(12, Math.min(r.left, innerWidth - w - 12)), top: 'auto', bottom: innerHeight - r.top + 2, maxHeight: Math.min(300, above) });
      else setSt({ width: w, left: Math.max(12, Math.min(r.left, innerWidth - w - 12)), bottom: 'auto', top: r.bottom + 2, maxHeight: Math.max(160, Math.min(300, below)) });
    };
    place();
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => { removeEventListener('scroll', place, true); removeEventListener('resize', place); };
  }, [on, grid, c.cb?.opts.length]);
  useEffect(() => { if (on) (ref.current?.querySelector('.cbo.on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' }); }, [on, c.cb?.i]);
  return (
    <div className={grid && on && st ? 'cbl cbfx' : 'cbl'} id={id} role={id ? 'listbox' : undefined} hidden={!on} ref={ref} style={grid && on ? st : undefined}
      onMouseDown={(e) => { const o = (e.target as HTMLElement).closest<HTMLElement>('.cbo'); if (o && c.cb) { e.preventDefault(); c.cb.pick(c.cb.opts[Number(o.dataset.k)]!.val); } }}>
      {on ? (c.cb!.opts.length ? c.cb!.opts.map((o, kk) => <div className={`cbo ${kk === c.cb!.i ? 'on' : ''} ${o.add ? 'add' : ''}`} role="option" data-k={kk} key={kk}>{o.html}</div>) : <div className="cbh">No matches</div>) : null}
    </div>
  );
}
/** Arrow keys / Enter / Esc in an open list. Returns true when the key was used. */
export function comboKey(c: Combo, e: React.KeyboardEvent): boolean {
  const cb = c.cb;
  if (!cb) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = Math.max(0, Math.min(cb.opts.length - 1, cb.i + (e.key === 'ArrowDown' ? 1 : -1))); c.setCb({ ...cb, i }); return true; }
  if (e.key === 'Enter' && cb.opts[cb.i]) { e.preventDefault(); cb.pick(cb.opts[cb.i]!.val); return true; }
  if (e.key === 'Escape') { e.stopPropagation(); c.hide(); return true; }
  return false;
}

export function partyOpts(PT: EParty[], q: string): ComboOpt[] {
  const s = q.toLowerCase();
  const L = PT.filter((p) => !s || p.name.toLowerCase().includes(s) || p.phone.includes(s)).sort((a, b) => Number(a.supplier) - Number(b.supplier)).slice(0, 30);
  return [
    { add: true, html: <><Icon name="plus" /><b>Add new party</b>{q ? ` “${q}”` : ''}</>, val: '__add' },
    ...L.map((p) => ({ val: p, html: <><span><b>{p.name}</b><small>{p.phone ? '+91 ' + p.phone : ''}{p.city ? ' · ' + p.city : ''}{p.supplier ? ' · supplier' : ''}</small></span><span className={p.balance > 0 ? 'pos' : p.balance < 0 ? 'neg' : 'mu'}>{inr(Math.abs(p.balance))}</span></> })),
  ];
}
export function itemOpts(d: EditorData, si: SI, q: string, unitPrice: (it: EItem) => number): ComboOpt[] {
  const s = q.toLowerCase();
  const L = d.IT.filter((i) => !s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s) || i.hsn.includes(s)).slice(0, 30);
  return [
    { add: true, html: <><Icon name="plus" /><b>Add new item</b>{q ? ` “${q}”` : ''}</>, val: '__add' },
    ...L.map((i) => ({ val: i, html: <><span><b>{i.name}</b><small>{i.code ? i.code + ' · ' : ''}{i.svc ? 'Service' : `Stock ${qfmt(i.stock ?? 0)} ${i.unit}`}</small></span><span><b>{inr2f(unitPrice(i))}</b>{i.stock !== null && i.stock <= 0 ? <small className="neg">Out of stock</small> : null}</span></> })),
  ];
}

/* ---------- the grid ---------- */
interface Props { d: EditorData; c: Combo; rk: number; full: () => void; toast: (m: string) => void; onAddItem: (q: string, then: (it: EItem) => void) => void }
const ORDER = ['name', 'hsn', 'qty', 'disc', 'damt', 'fr', 'gst'];
export const focusRow = (i: number, f: string) => setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`#siRows tr[data-ln="${i}"] [data-f="${f}"]`); if (el) { el.focus(); el.select?.(); } }, 0);

export function Grid({ d, c, rk, full, toast, onAddItem }: Props) {
  const { si, up } = useTab();
  const ctx: Ctx = d.ctx;
  const [qe, setQe] = useState<{ item: EItem | null; qty: string; fr: string; disc: string; q: string }>({ item: null, qty: '1', fr: '', disc: '', q: '' });
  const [qk, setQk] = useState(0);
  const [hi, setHi] = useState<number | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  // last prices this customer got, under the price when its quantity or price is clicked into
  const ph = usePriceHistory(si, (i, h) => {
    let ok = true;
    up((s) => { ok = frSet(s.lines[i]!, r2(Number(h.price) * (1 - Number(h.discPct) / 100))); s.warnOk = false; s.dirty = true; });
    if (!ok) toast(`Final rate can’t be more than the price-list rate ${inr2f(si?.lines[i]?.price ?? 0)}. Change the price in Price manager.`);
    full(); focusRow(i, 'fr');
  });
  if (!si) return null;
  const G = ctx.mode === 'gst';
  const gstCol = d.gstOn;
  const t = calc(ctx, si);
  const up2 = (fn: (s: SI) => void) => up((s) => { fn(s); s.warnOk = false; s.dirty = true; });
  const pickItem = (i: number, v: unknown) => {
    if (v === '__add') { c.hide(); onAddItem(si.lines[i]?.name ?? '', (it) => { up2((s) => { s.lines[i] = lineFor(ctx, s, it); if (i === s.lines.length - 1) s.lines.push(blankLine()); }); full(); focusRow(i, 'qty'); }); return; }
    up2((s) => { s.lines[i] = lineFor(ctx, s, v as EItem); if (i === s.lines.length - 1) s.lines.push(blankLine()); });
    c.hide(); full(); focusRow(i, 'qty');
  };
  const priceOf = (it: EItem) => lineFor(ctx, si, it).price;

  /* rapid entry (prototype qeRow / qeCommit) */
  const qeLine = (): Line | null => {
    if (!qe.item) return null;
    const L = lineFor(ctx, si, qe.item);
    L.qty = Number(qe.qty) || 1;
    if (qe.disc !== '') L.disc = Math.min(100, Number(qe.disc) || 0);
    else if (qe.fr !== '') frSet(L, Number(qe.fr) || 0);
    return L;
  };
  const qL = qeLine();
  const qr = qL ? calc(ctx, { ...si, lines: [...si.lines, qL] }).rows.at(-1)! : null;
  const qeSet = (it: EItem) => { setQe({ item: it, q: '', fr: '', disc: '', qty: Number(qe.qty) > 0 ? qe.qty : '1' }); c.hide(); setQk((k) => k + 1); setTimeout(() => { const q = document.getElementById('qeQty') as HTMLInputElement | null; q?.focus(); q?.select(); }, 0); };
  const qePick = (v: unknown) => { if (v === '__add') { c.hide(); onAddItem((document.getElementById('qeItem') as HTMLInputElement | null)?.value ?? '', (it) => qeSet(it)); return; } qeSet(v as EItem); };
  const qeCommit = () => {
    if (!qe.item) { document.getElementById('qeItem')?.focus(); return toast('Choose an item first'); }
    const L = qeLine()!;
    if (!(Number(L.qty) > 0)) { document.getElementById('qeQty')?.focus(); return toast('Enter the quantity'); }
    if (qe.fr !== '' && Number(qe.fr) > (L.price || 0) && L.price > 0) toast(`Rate can’t be more than the price-list rate ${inr2f(L.price)} — used the price-list rate`);
    up2((s) => { s.lines.unshift(L); if (!s.lines.length || s.lines[s.lines.length - 1]!.item) s.lines.push(blankLine()); });
    setQe({ item: null, qty: '1', fr: '', disc: '', q: '' }); setQk((k) => k + 1); full();
    setHi(0); setTimeout(() => setHi(null), 1200);
    const w = document.querySelector('#vNewInv .dgw'); if (w) w.scrollTop = 0;
    setTimeout(() => document.getElementById('qeItem')?.focus(), 0);
    toast(`${L.name} added · row 1`);
  };

  // the prototype's renderTotals refreshes the discount amount and final rate cells that are not being typed in
  useEffect(() => {
    tbody.current?.querySelectorAll<HTMLTableRowElement>('tr[data-ln]').forEach((tr) => {
      const i = Number(tr.dataset.ln), l = si.lines[i], r = t.rows[i];
      if (!l || !r) return;
      const da = tr.querySelector<HTMLInputElement>('[data-f="damt"]'), fr = tr.querySelector<HTMLInputElement>('[data-f="fr"]'), dp = tr.querySelector<HTMLInputElement>('[data-f="disc"]');
      if (fr && document.activeElement !== fr) fr.value = l.item || l.price ? finalRate(l).toFixed(2) : '';
      if (da && document.activeElement !== da) da.value = r.disc ? String(r2(r.disc)) : '';
      if (dp && document.activeElement !== dp && dp.dataset.sync === '1') { dp.value = l.disc ? String(r2(l.disc)) : ''; dp.dataset.sync = ''; }
    });
  });

  const onInput = (e: React.FormEvent<HTMLTableSectionElement>) => {
    const tEl = e.target as HTMLInputElement;
    const tr = tEl.closest<HTMLElement>('tr[data-ln]');
    if (!tr) return;
    const i = Number(tr.dataset.ln), f = tEl.dataset.f!;
    if (f === 'name') {
      up2((s) => { const l = s.lines[i]!; l.name = tEl.value; l.item = null; });
      c.show(`row:${i}`, itemOpts(d, si, tEl.value, priceOf), (v) => pickItem(i, v));
      return;
    }
    if (f === 'fr') {
      const raw = tEl.value.replace(/[^\d.]/g, '');
      let ok = true;
      up2((s) => { const l = s.lines[i]!; ok = frSet(l, raw === '' ? l.price || 0 : Number(raw)); });
      tEl.closest('td')!.classList.toggle('bad', !ok);
      tEl.title = ok ? '' : `More than the price-list rate ${inr2f(si.lines[i]!.price)}`;
      const dp = tr.querySelector<HTMLInputElement>('[data-f="disc"]'); if (dp) dp.value = si.lines[i]!.disc ? String(r2(si.lines[i]!.disc)) : '';
      return;
    }
    if (f === 'damt') {
      const l = si.lines[i]!;
      const g = (Number(l.qty) || 0) * (l.price || 0), a = Number(tEl.value.replace(/[^\d.]/g, '')) || 0;
      up2((s) => { s.lines[i]!.disc = g > 0 ? Math.min(100, (a / g) * 100) : 0; });
      const dp = tr.querySelector<HTMLInputElement>('[data-f="disc"]'); if (dp) dp.value = si.lines[i]!.disc ? String(r2(si.lines[i]!.disc)) : '';
      return;
    }
    up2((s) => { const l = s.lines[i]! as unknown as Record<string, unknown>; l[f] = f === 'disc' ? Number(tEl.value) || 0 : tEl.value; });
  };
  const onKey = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (comboKey(c, e)) return;
    const tEl = e.target as HTMLInputElement, tr = tEl.closest<HTMLElement>('tr[data-ln]');
    if (e.key !== 'Enter' || !tr || !tEl.dataset.f) return;
    e.preventDefault();
    const i = Number(tr.dataset.ln), k = ORDER.indexOf(tEl.dataset.f);
    const nx = ORDER.slice(k + 1).find((f) => tr.querySelector(`[data-f="${f}"]`));
    if (nx && nx !== 'hsn') focusRow(i, nx);
    else if (nx === 'hsn') focusRow(i, 'qty');
    else { if (i === si.lines.length - 1) { up2((s) => { s.lines.push(blankLine()); }); full(); } focusRow(i + 1, 'name'); }
  };

  return (
    <>
      <thead id="siHead">
        <tr><th rowSpan={2} className="c">#</th><th rowSpan={2} className="it">Item</th><th rowSpan={2} className="hic">Item code</th><th rowSpan={2} className="hib">Brand</th><th rowSpan={2} className="his">Series</th>{gstCol ? <th rowSpan={2} className="hs">HSN</th> : null}<th rowSpan={2} className="n qt">Qty</th><th rowSpan={2} className="un">Unit</th>
          <th rowSpan={2} className="n pr">Sale Price{G ? <label className="siincl"><input type="checkbox" id="siIncl" checked={si.incl} onChange={(e) => { up2((s) => { s.incl = e.target.checked; }); full(); }} /> incl. GST</label> : null}</th><th colSpan={2} className="c grp">Discount</th><th rowSpan={2} className="n fr">Final rate</th>{G ? <th colSpan={2} className="c grp">Tax</th> : null}<th rowSpan={2} className="n am">Amount</th><th rowSpan={2} className="x"><span className="sr">Remove</span></th></tr>
        <tr><th className="n sub dp">%</th><th className="n sub da">Amount</th>{G ? <><th className="n sub tp">%</th><th className="n sub ta">Amount</th></> : null}</tr>
        <tr className="qe" id="qeRow" key={`qe${rk}-${qk}`}>
          <td className="c qeb" title="Rapid entry"><svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: BOLT }} /></td>
          <td><div className="gic"><div className="combo"><input className="qei" id="qeItem" defaultValue={qe.item ? qe.item.name : qe.q} placeholder="Rapid entry" title="Type item name or code, then Enter" autoComplete="off" aria-label="Rapid entry"
            onInput={(e) => { const v = (e.target as HTMLInputElement).value; setQe({ ...qe, item: null, q: v }); c.show('qe', itemOpts(d, si, v, priceOf), qePick); }}
            onFocus={(e) => { if (!qe.item) { const el = e.target; setTimeout(() => { if (document.activeElement === el) c.show('qe', itemOpts(d, si, el.value, priceOf), qePick); }, 0); } }} /* the box's text when the list opens, not when it got focus: typing may come first */
            onBlur={() => setTimeout(() => { const a = document.activeElement as HTMLElement | null; if (!a?.closest('.cbl') && a?.id !== 'qeItem') c.hide(); }, 150)}
            onKeyDown={(e) => { if (c.cb?.key === 'qe' && comboKey(c, e)) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (qe.item) document.getElementById('qeQty')?.focus(); else c.show('qe', itemOpts(d, si, (e.target as HTMLInputElement).value, priceOf), qePick); } }} /><ComboList c={c} k="qe" grid /></div>
            {qe.item && !qe.item.svc ? <small className={(qe.item.stock ?? 0) - (Number(qe.qty) || 0) < 0 ? 'neg' : 'mu'}>{(qe.item.stock ?? 0) - (Number(qe.qty) || 0) < 0 ? `Only ${qfmt(qe.item.stock ?? 0)}` : `${qfmt(qe.item.stock ?? 0)} ${qe.item.unit}`}</small> : null}</div></td>
          <td className="ro l mono">{qe.item?.code ?? ''}</td><td className="ro l">{qe.item?.brand ?? ''}</td><td className="ro l">{qe.item?.series ?? ''}</td>{gstCol ? <td className="ro l">{qe.item?.hsn ?? ''}</td> : null}
          <QeIn id="qeQty" val={qe.qty} label="Quick add quantity" set={(v) => setQe({ ...qe, qty: v })} onKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || e.metaKey) return qeCommit(); const f = document.getElementById('qeFr') as HTMLInputElement; f.focus(); f.select(); } else if (e.key === 'Escape') { e.stopPropagation(); setQe({ item: null, qty: '1', fr: '', disc: '', q: '' }); setQk((k) => k + 1); setTimeout(() => document.getElementById('qeItem')?.focus(), 0); } }} />
          <td className="ro l">{qe.item?.unit ?? ''}</td><td className="ro" id="qePrice">{qL ? inr2f(qL.price || 0) : ''}</td>
          <QeIn id="qeDisc" val={qe.disc} label="Quick add discount percent" placeholder="0" set={(v) => setQe({ ...qe, disc: v, fr: '' })} onKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); qeCommit(); } }} shown={qe.disc === '' && qe.fr !== '' && qL?.disc ? String(r2(qL.disc)) : undefined} />
          <td className="ro" id="qeDamt">{qr?.disc ? inr2f(qr.disc) : ''}</td>
          <QeIn id="qeFr" cls="fr" val={qe.fr} label="Quick add rate" placeholder="Rate" set={(v) => setQe({ ...qe, fr: v, disc: '' })} onKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); qeCommit(); } }} shown={qe.fr === '' && qL ? finalRate(qL).toFixed(2) : undefined} />
          {G ? <><td className="ro">{qL ? pct(qL.gst) : ''}</td><td className="ro" id="qeTx">{qr ? inr2f(qr.tx) : ''}</td></> : null}
          <td className="ro b" id="qeAmt">{qr ? inr2f(qr.amt) : ''}</td>
          <td className="x"><button type="button" className="qeok" id="qeAdd" aria-label="Add this item" title="Add item (Enter)" disabled={!qe.item} onClick={qeCommit}><Icon name="check" /></button></td></tr>
      </thead>
      <tbody id="siRows" ref={tbody} onInput={onInput} onKeyDown={onKey}
        onFocus={(e) => { const tEl = e.target as unknown as HTMLInputElement; if (tEl.classList.contains('si-item') && !tEl.value) { const i = Number(tEl.closest<HTMLElement>('tr')!.dataset.ln); c.show(`row:${i}`, itemOpts(d, si, '', priceOf), (v) => pickItem(i, v)); } if (tEl.dataset.f === 'fr') setTimeout(() => tEl.select(), 0); }}
        onChange={(e) => { const tEl = e.target as unknown as HTMLSelectElement; const tr = tEl.closest<HTMLElement>('tr[data-ln]'); if (tr && tEl.dataset.f === 'gst') up2((s) => { s.lines[Number(tr.dataset.ln)]!.gst = Number(tEl.value); }); }}
        onBlur={(e) => {
          const tEl = e.target as unknown as HTMLInputElement;
          if (tEl.dataset.f === 'fr') { const tr = tEl.closest<HTMLElement>('tr[data-ln]')!; const l = si.lines[Number(tr.dataset.ln)]; const td = tEl.closest('td')!; if (td.classList.contains('bad')) { td.classList.remove('bad'); toast(`Final rate can’t be more than the price-list rate ${inr2f(l?.price ?? 0)}. Change the price in Price manager.`); } if (l) tEl.value = l.item || l.price ? finalRate(l).toFixed(2) : ''; }
          setTimeout(() => { const a = document.activeElement; if (!(a as HTMLElement | null)?.closest?.('.cbl') && !(a as HTMLElement | null)?.closest?.('#qeItem,.si-item')) c.hide(); }, 150);
        }}>
        {si.lines.map((l, i) => {
          const r = t.rows[i]!;
          const st = l.item && !l.item.svc ? l.item.stock ?? 0 : null;
          const left = st !== null ? st - (Number(l.qty) || 0) : 0;
          return (
            <tr data-ln={i} key={`${rk}-${i}`} className={hi === i ? 'qenew' : undefined}>
              <td className="c">{i + 1}</td>
              <td><div className="gic"><div className="combo"><input className="gi si-item" data-f="name" defaultValue={l.item && l.item.grp && l.item.brand ? l.item.grp : l.name} title={l.name} placeholder={`Search item${d.gstOn ? ', code or HSN' : ' or code'}`} autoComplete="off" aria-label={`Item ${i + 1}`} /><ComboList c={c} k={`row:${i}`} grid /></div>
                {st !== null ? <small title="In stock" className={left < 0 ? 'neg' : 'mu'}>{left < 0 ? `Only ${qfmt(st)}` : `${qfmt(st)} ${l.unit}`}</small> : null}</div></td>
              <td className="ro l mono dgc1">{l.item?.code ?? ''}</td><td className="ro l dgc2">{l.item?.brand ?? ''}</td><td className="ro l dgc2">{l.item?.series ?? ''}</td>
              {gstCol ? <td><input className="gi" data-f="hsn" defaultValue={l.hsn} inputMode="numeric" aria-label="HSN" /></td> : null}
              <td><input className="gi n" data-f="qty" defaultValue={String(l.qty)} inputMode="decimal" aria-label="Quantity" /></td>
              <td className="ro l">{l.unit || '—'}</td>
              <td className="prlk"><input className="gi n" data-f="price" value={String(l.price)} readOnly aria-readonly="true" title={l.item && l.price > 0 ? 'From the price list. Change it in Price manager.' : 'Set the rate in Final rate'} aria-label="Sale price (from price list)" /></td>
              <td><input className="gi n" data-f="disc" defaultValue={l.disc ? String(r2(l.disc)) : ''} placeholder="0" inputMode="decimal" aria-label="Discount percent" /></td>
              <td><input className="gi n" data-f="damt" defaultValue={r.disc ? String(r2(r.disc)) : ''} placeholder="0" inputMode="decimal" aria-label="Discount amount" /></td>
              <td className="frc"><input className="gi n" data-f="fr" defaultValue={l.item || l.price ? finalRate(l).toFixed(2) : ''} placeholder="0.00" inputMode="decimal" aria-label="Final rate" title="Type the selling rate. The discount is worked out from the price-list rate." /></td>
              {G ? <><td><select className="gi" data-f="gst" aria-label="GST rate" defaultValue={String(l.gst)}>{d.gstRates.map((g) => <option value={g} key={g}>{pct(g)}</option>)}</select></td><td className="ro" data-o="tx">{inr2f(r.tx)}</td></> : null}
              <td className="ro b" data-o="amt">{inr2f(r.amt)}</td>
              <td className="x"><button type="button" className="ix" data-del={i} aria-label={`Remove row ${i + 1}`} disabled={si.lines.length === 1} onMouseDown={() => up((s) => { s.dirty = true; })} onClick={() => { up2((s) => { s.lines.splice(i, 1); }); full(); }}><Icon name="x" /></button></td>
            </tr>
          );
        })}
      </tbody>
      {ph.pop}
      <tfoot id="siFoot">
        <tr><td></td><td><div className="dgft"><button type="button" className="btn sm" id="siAddRow" onClick={() => { up2((s) => { s.lines.push(blankLine()); }); full(); focusRow(si.lines.length, 'name'); }}><Icon name="plus" />Add row</button>
          {si.doc === 'sale' ? <button type="button" className="btn sm" id="siImpQ" title="Add items from a saved quotation" data-impq><Icon name="doc" />Import quotation</button> : null}<b>Total</b></div></td>
          <td></td><td></td><td></td>{gstCol ? <td></td> : null}<td className="ro" data-t="qty">{qfmt(si.lines.reduce((a, l) => a + (l.item || l.name ? Number(l.qty) || 0 : 0), 0))}</td><td></td><td></td><td></td>
          <td className="ro" data-t="disc">{inr2f(t.rows.reduce((a, r) => a + (r.disc || 0), 0))}</td><td></td>{G ? <><td></td><td className="ro" data-t="tx">{inr2f(t.rows.reduce((a, r) => a + r.tx, 0))}</td></> : null}<td className="ro b" data-t="amt">{inr2f(t.rows.reduce((a, r) => a + r.amt, 0))}</td><td></td></tr>
      </tfoot>
    </>
  );
}

/** An input of the rapid-entry row: typed text kept as typed; `shown` fills it in when not focused. */
function QeIn({ id, val, label, set, onKey, placeholder, cls, shown }: { id: string; val: string; label: string; set: (v: string) => void; onKey: (e: React.KeyboardEvent<HTMLInputElement>) => void; placeholder?: string; cls?: string; shown?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = ref.current; if (el && document.activeElement !== el && shown !== undefined) el.value = shown; });
  return (
    <td><input className={`qei n${cls ? ' ' + cls : ''}`} id={id} ref={ref} defaultValue={val !== '' ? val : shown ?? ''} placeholder={placeholder} inputMode="decimal" aria-label={label}
      onInput={(e) => { const el = e.target as HTMLInputElement; const v = el.value.replace(/[^\d.]/g, ''); if (el.value !== v) el.value = v; set(v); }}
      onFocus={(e) => { const el = e.target; setTimeout(() => el.select(), 0); }} onKeyDown={onKey} /></td>
  );
}

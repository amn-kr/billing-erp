/**
 * Referral windows in the sale editor: commission on this bill (prototype cmBillView) and
 * Add electrician (prototype elecEdit). Both use the small window (#slm).
 */
import { useEffect, useRef, useState } from 'react';
import type { CommRule } from '@billing/shared';
import { api, ApiError } from '../../../lib/api';
import { inr2f } from '../../../lib/format';
import type { SlModalProps } from '../SlModal';
import { cmApply, lineComm, r2, siRule, useTab, type Ctx, type SI } from './state';

const qfmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const cmLbl = (r: CommRule) => (r.t === 'p' ? `${r.v}%` : r.t === 'f' ? `${inr2f(r.v)} / unit` : 'No commission');

function CmSel({ k, r, def }: { k: 'bk' | 'lk'; r: CommRule | null | undefined; def: string }) {
  return (
    <select className="fi sm" {...{ [`data-${k}`]: 't' }} defaultValue={!r ? 'd' : r.t}>
      <option value="d">{def}</option><option value="n">No commission</option><option value="p">% of sale price</option><option value="f">₹ per unit</option>
    </select>
  );
}

/** Commission on this bill: rules per category for this bill only, or for one item. */
function CmBill({ ctx, up }: { ctx: Ctx; up: (fn: (x: SI) => void) => void }) {
  const { si } = useTab();
  const ref = useRef<HTMLDivElement>(null);
  // like the prototype, a change applies when a box is left or a choice is made (the native change event)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (ev: Event) => {
      const t = ev.target as HTMLElement, row = t.closest<HTMLElement>('[data-bcat],[data-cli]');
      if (!row) return;
      const tS = row.querySelector('select')!, vI = row.querySelector('input')!, tv = tS.value, val = Number(vI.value.replace(/[^\d.]/g, '')) || 0;
      const rule: CommRule | null = tv === 'd' ? null : tv === 'n' ? { t: 'n', v: 0 } : { t: tv as 'p' | 'f', v: val };
      if (t === tS && tv !== 'd' && tv !== 'n' && !val) { vI.disabled = false; vI.focus(); return; }
      up((x) => {
        if (row.dataset.bcat !== undefined) { const ov = { ...(x.crOv ?? {}) }; if (rule) ov[row.dataset.bcat] = rule; else delete ov[row.dataset.bcat]; x.crOv = ov; }
        else { const l = x.lines[Number(row.dataset.cli)]!; if (rule) l.cmO = rule; else delete l.cmO; }
        x.lines.forEach((l) => cmApply(ctx, x, l));
      });
    };
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, [ctx, up]);
  if (!si) return null;
  const incl = si.incl && ctx.mode === 'gst';
  const L = si.lines.map((l, i) => ({ l, i })).filter((x) => x.l.item && Number(x.l.qty) > 0);
  const cats = [...new Set(L.map((x) => x.l.item!.cat || ''))];
  const ov = si.crOv ?? {};
  const total = r2(si.lines.reduce((a, l) => a + lineComm(l, incl), 0));
  return (
    <div ref={ref}>
      <h4 className="cmh">Rules for this bill</h4>
      <div className="cmrl cmbr">{cats.map((c) => {
        const r = ov[c], d = ctx.rules[c] ?? { t: 'n' as const, v: 0 };
        return (
          <div className="cmr" data-bcat={c} key={`${c}${JSON.stringify(r ?? null)}`}><span><b>{c || 'No category'}</b><small className="mu">Usual: {cmLbl(d)}</small></span><CmSel k="bk" r={r} def="Usual rule" />
            <input className="fi sm n" data-bk="v" inputMode="decimal" defaultValue={r && r.t !== 'n' ? r.v : ''} placeholder={r ? '0' : d.t === 'n' ? '—' : String(d.v)} disabled={!r || r.t === 'n'} /></div>
        );
      })}</div>
      <h4 className="cmh">Items <small className="mu">— set a custom rule for a single item</small></h4>
      <div className="tw" style={{ margin: 0, maxHeight: '40vh', overflow: 'auto' }}><table className="ptt2 pyt cmit"><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Sale price</th><th>Rule</th><th className="n"></th><th className="n">Rate on bill</th><th className="n">Commission</th></tr></thead>
        <tbody>{L.map(({ l, i }) => {
          const r = siRule(ctx, si, l), c = lineComm(l, incl);
          return (
            <tr data-cli={i} key={`${i}${JSON.stringify(l.cmO ?? null)}`}><td>{l.name}<small className="mu" style={{ display: 'block' }}>{l.item!.cat || ''}{l.cmO ? <> · <b className="cmcus">custom</b></> : null}</small></td><td className="n">{qfmt(Number(l.qty))}</td>
              <td className="n">{inr2f(l.bp !== undefined ? l.bp : l.price)}</td><td><CmSel k="lk" r={l.cmO} def="Category rule" /></td>
              <td><input className="fi sm n" data-lk="v" style={{ width: 80 }} inputMode="decimal" defaultValue={l.cmO && l.cmO.t !== 'n' ? l.cmO.v : ''} placeholder={r.t === 'n' ? '—' : String(r.v)} disabled={!l.cmO || l.cmO.t === 'n'} /></td>
              <td className="n">{inr2f(l.price)}</td><td className="n"><b>{c ? inr2f(c) : '—'}</b></td></tr>
          );
        })}</tbody></table></div>
      <div className="cntot"><span>Total commission on this bill{incl ? <> <small className="mu">(GST excluded)</small></> : null}</span><b>{inr2f(total)}</b></div>
    </div>
  );
}

export function cmBillModal(o: { ctx: Ctx; name: string; up: (fn: (x: SI) => void) => void; close: () => void }): SlModalProps {
  return {
    title: `Commission on this bill · ${o.name}`, sub: 'Change the rules for this bill only. Your saved category rules stay the same. Not printed on the invoice.',
    wide: 1, ok: 'Done', cancel: 'Close', body: <CmBill ctx={o.ctx} up={o.up} />, onOk: o.close,
  };
}

/** Add electrician: name, mobile, city. */
function ElecForm({ err }: { err: string }) {
  useEffect(() => { setTimeout(() => document.getElementById('elN')?.focus(), 30); }, []);
  return (
    <><label className="fl" htmlFor="elN">Name<input className="fi" id="elN" autoComplete="off" /></label>
      <div className="two"><label className="fl" htmlFor="elP">Mobile<input className="fi" id="elP" inputMode="numeric" autoComplete="off" /></label><label className="fl" htmlFor="elC">City<input className="fi" id="elC" autoComplete="off" /></label></div>
      <div className="msg bad" id="elErr">{err}</div></>
  );
}

export function useElecModal(o: { onSaved: (id: string, name: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const n = v('elN').trim(), ph = v('elP').replace(/\D/g, '');
    if (!n) { setErr('Enter the name.'); return document.getElementById('elN')?.focus(); }
    if (ph && ph.length !== 10) { setErr('Mobile should be 10 digits.'); return document.getElementById('elP')?.focus(); }
    try {
      const r = await api<{ id: string }>('/referrers', { method: 'POST', body: { name: n, phone: ph, city: v('elC').trim() } });
      setErr(null);
      o.onSaved(r.id, n);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the electrician.'); }
  };
  const modal: SlModalProps | null = err === null ? null : { title: 'Add electrician', ok: 'Save', cancel: 'Cancel', body: <ElecForm err={err} />, onOk: () => void save() };
  return { open: () => setErr(''), close: () => setErr(null), modal };
}

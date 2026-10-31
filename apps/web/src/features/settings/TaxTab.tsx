/**
 * Settings › Taxes & GST — the prototype's renderGst / renderTcs / renderTds /
 * renderPv, the "Turn off GST?" question (#cfm) and the tax list (#tl).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GSTIN_RE, STATES } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { inr2, pct, Sw, useS, useSaveS, type Tax } from './model';
import { ui } from '../../styles/uiSize';

const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });
const stName = (c: string) => STATES.find((s) => s[0] === c)?.[1] ?? '';
/** the 7th of next month, e.g. "7 November" (TDS deposit date) */
const depositBy = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 7); return `7 ${d.toLocaleString('en-IN', { month: 'long' })}`; };

export function TaxCards() {
  const { S, gst, ofType } = useS();
  const save = useSaveS();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const b = useMe().data?.business;
  const [gstin, setGstin] = useState(b?.gstin ?? '');
  const [cfm, setCfm] = useState(false);
  useEffect(() => { setGstin(b?.gstin ?? ''); }, [b?.gstin]);
  const state = b?.state ?? '09';
  const commit = (data: Parameters<typeof save>[0]['data'], msg?: string) => { void save({ data }); if (msg) showToast(msg); };

  const saveBiz = async (body: Record<string, string>) => {
    await api('/businesses/current', { method: 'PATCH', body });
    await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['business-current'] })]);
  };
  const ok = GSTIN_RE.test(gstin);
  let msg: { c: string; t: string };
  if (!ok) msg = { c: 'msg bad', t: gstin.length < 15 ? `GSTIN has 15 characters (${gstin.length} entered), like 09ABCPS4821K1Z6.` : 'This doesn’t look like a valid GSTIN. Check the PAN part and the “Z” in position 14.' };
  else if (gstin.slice(0, 2) !== state) msg = { c: 'msg warn', t: `GSTIN starts with ${gstin.slice(0, 2)} (${stName(gstin.slice(0, 2)) || 'unknown'}), but the state is set to ${stName(state)}.` };
  else msg = { c: 'msg good', t: `Valid GSTIN · ${stName(state)}` };

  const onGstin = (raw: string) => {
    const v = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
    setGstin(v);
    if (GSTIN_RE.test(v)) {
      const c = v.slice(0, 2);
      void saveBiz(stName(c) && c !== state ? { gstin: v, state: c } : { gstin: v }).catch((e) => showToast(e instanceof ApiError ? e.message : 'Could not save the GSTIN.'));
    }
  };
  const opt = (id: string, key: 'hsn' | 'pos' | 'rcm' | 'cess' | 'tdsBill' | 'tdsExp', t: string, d: string) => (
    <div className="opt"><div className="tx"><b>{t}</b><small>{d}</small></div><Sw id={id} on={!!S[key]} label={t} onChange={(v) => commit({ [key]: v }, 'Saved')} /></div>
  );
  const sel = (id: string, list: Tax[], cur: string | undefined, key: 'tcsRate' | 'tdsRate', m: string) => (
    <select className="fi" id={id} value={cur} onChange={(e) => commit({ [key]: e.target.value }, m)}>{list.map((t) => <option value={t.id} key={t.id}>{t.name} — {t.note}</option>)}</select>
  );
  const tcsList = ofType('TCS');
  const tdsList = ofType('TDS');
  const tcsRate = tcsList.find((t) => t.id === S.tcsRate) ?? tcsList[0];
  const tdsRate = tdsList.find((t) => t.id === S.tdsRate) ?? tdsList[0];

  return (
    <>
      <section className="card" id="cGst">
        <div className="tgl"><div className="ti" style={T('var(--ac)')}><Icon name="pct" /></div><div className="tx"><b>Enable GST</b><small>Charge CGST and SGST (or IGST) on sales and claim input credit on purchases. Turn it off if your business isn’t registered under GST.</small></div>
          <Sw id="sGst" on={gst} label="Enable GST" onChange={(v) => { if (!v) setCfm(true); else { void save({ gstEnabled: true }); showToast('GST turned on. Tax fields are back on invoices.'); } }} /></div>
        {gst ? (
          <div className="sub">
            <span className="fl">Registration type</span>
            <div className="seg2" role="radiogroup" aria-label="Registration type">
              {(['regular', 'composition'] as const).map((r) => <button role="radio" aria-checked={S.reg === r} className={S.reg === r ? 'on' : ''} data-reg={r} key={r} onClick={() => S.reg !== r && commit({ reg: r }, r === 'regular' ? 'Registration set to Regular' : 'Registration set to Composition')}>{r === 'regular' ? 'Regular' : 'Composition'}</button>)}</div>
            <p className="hint">{S.reg === 'regular' ? 'You charge GST on invoices and claim input tax credit on purchases.' : 'You issue bills of supply without GST, pay a fixed percentage of turnover every quarter (CMP-08), and can’t claim input credit.'}</p>
            <div className="two">
              <label className="fl" htmlFor="sGstin">GSTIN<input className={`fi mono ${ok ? '' : 'bad'}`} id="sGstin" value={gstin} maxLength={15} autoComplete="off" spellCheck={false} onChange={(e) => onGstin(e.target.value)} /></label>
              <label className="fl" htmlFor="sState">State<select className="fi" id="sState" value={state} onChange={(e) => { const c = e.target.value; void saveBiz({ state: c }).then(() => showToast(`State set to ${stName(c)}`), (x) => showToast(x instanceof ApiError ? x.message : 'Could not save the state.')); }}>{STATES.map((s) => <option value={s[0]} key={s[0]}>{s[0]} · {s[1]}</option>)}</select></label>
            </div>
            <div className={msg.c} id="gstinMsg">{msg.t}</div>
            <div className="opts">
              {opt('oHsn', 'hsn', 'Show HSN/SAC code on invoices', 'Required on B2B invoices and in the GSTR-1 HSN summary.')}
              {opt('oPos', 'pos', 'Show place of supply', 'Decides whether CGST + SGST or IGST applies to a sale.')}
              {opt('oRcm', 'rcm', 'Reverse charge on purchases', 'For purchases where you pay the GST instead of the supplier.')}
              {opt('oCess', 'cess', 'Additional cess', 'Adds a cess column to items, for goods such as tobacco or aerated drinks.')}
            </div>
          </div>
        ) : <div className="off"><Icon name="info" /><span>GST is off. Sales are saved as plain bills without tax, and GST cards and reports are hidden.</span></div>}
      </section>
      <section className="card" id="cTcs">
        <div className="tgl"><div className="ti" style={T('var(--blue)')}><Icon name="up" /></div><div className="tx"><b>Enable TCS</b><small>Collect tax at source on top of the invoice total. Only needed for specific goods, such as scrap, or when your CA advises it.</small></div><Sw id="sTcs" on={S.tcs} label="Enable TCS" onChange={(v) => commit({ tcs: v }, `TCS turned ${v ? 'on' : 'off'}`)} /></div>
        {S.tcs && <div className="sub">{tcsList.length ? <><label className="fl" htmlFor="sTcsRate">Default TCS rate{sel('sTcsRate', tcsList, tcsRate?.id, 'tcsRate', 'Default TCS rate saved')}</label><p className="hint">TCS shows as a separate line on sales invoices. You can change it per invoice.</p></> : <p className="hint">No TCS rates yet. Add one in the tax list.</p>}</div>}
      </section>
      <section className="card" id="cTds">
        <div className="tgl"><div className="ti" style={T('var(--violet)')}><Icon name="dn" /></div><div className="tx"><b>Enable TDS</b><small>Deduct tax at source when you pay contractors, professionals, rent or commission, then deposit it by the 7th of the next month.</small></div><Sw id="sTds" on={S.tds} label="Enable TDS" onChange={(v) => commit({ tds: v }, `TDS turned ${v ? 'on' : 'off'}`)} /></div>
        {S.tds && (
          <div className="sub">{tdsList.length ? <label className="fl" htmlFor="sTdsRate">Default TDS section{sel('sTdsRate', tdsList, tdsRate?.id, 'tdsRate', 'Default TDS section saved')}</label> : <p className="hint">No TDS sections yet. Add one in the tax list.</p>}
            <div className="opts">{opt('oTdsBill', 'tdsBill', 'Deduct on purchase bills', 'Shows a TDS field when you record a supplier bill.')}{opt('oTdsExp', 'tdsExp', 'Deduct on expenses', 'Shows a TDS field on rent, professional fees and similar expenses.')}</div></div>
        )}
      </section>
      <ConfirmGstOff open={cfm} onClose={() => setCfm(false)} onYes={() => { setCfm(false); void save({ gstEnabled: false }); showToast('GST turned off. Tax is hidden across the app.'); }} />
    </>
  );
}

/** Live preview (#pv) — the prototype's renderPv. */
export function TaxPreview() {
  const { S, gst, ofType } = useS();
  const [pv, setPv] = useState<{ rate: string | null; inter: boolean }>({ rate: null, inter: false });
  const gl = ofType('GST');
  const rate = gl.find((t) => t.id === pv.rate) ?? gl.find((t) => Number(t.rate) === 18) ?? gl[0];
  const tcsList = ofType('TCS');
  const tdsList = ofType('TDS');
  const tcsRate = tcsList.find((t) => t.id === S.tcsRate) ?? tcsList[0];
  const t = S.tds ? tdsList.find((x) => x.id === S.tdsRate) ?? tdsList[0] : undefined;
  const gstOn = gst && S.reg === 'regular';
  const base = 10000;
  const L: [string, number][] = [];
  let doc: string;
  let note = '';
  let total = base;
  if (!gst) { doc = 'Bill'; note = 'GST is off, so no tax is charged.'; L.push(['Item value', base]); }
  else if (S.reg === 'composition') { doc = 'Bill of supply'; note = 'Composition dealers can’t collect GST from customers.'; L.push(['Item value', base]); }
  else {
    doc = 'Tax invoice';
    const r = rate ? Number(rate.rate) : 0;
    L.push(['Taxable value', base]);
    if (pv.inter) { const g = (base * r) / 100; L.push([`IGST ${pct(r)}`, g]); total += g; }
    else { const g = (base * r) / 200; L.push([`CGST ${pct(r / 2)}`, g], [`SGST ${pct(r / 2)}`, g]); total += 2 * g; }
  }
  if (S.tcs && tcsRate) { const v = (total * Number(tcsRate.rate)) / 100; L.push([`TCS ${pct(tcsRate.rate)}`, v]); total += v; }
  const a = 50000;
  const d = t ? (a * Number(t.rate)) / 100 : 0;
  return (
    <aside className="card pv" id="pv">
      <div className="hd"><h3>Live preview</h3><span className="pill">Updates as you change settings</span></div>
      <div className="doc">{doc}</div><div className="pvsub">Sale of 1 × Copper wire 1.5 sq mm to Mehta Electricals</div>
      {gstOn && (
        <div className="pvc"><select className="fi" id="pvRate" aria-label="GST rate for preview" value={rate?.id} onChange={(e) => setPv({ ...pv, rate: e.target.value })}>{gl.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select>
          <div className="seg2 sm" role="radiogroup" aria-label="Place of supply"><button role="radio" aria-checked={!pv.inter} className={pv.inter ? '' : 'on'} data-pv="0" onClick={() => setPv({ ...pv, inter: false })}>Same state</button><button role="radio" aria-checked={pv.inter} className={pv.inter ? 'on' : ''} data-pv="1" onClick={() => setPv({ ...pv, inter: true })}>Other state</button></div></div>
      )}
      {L.map((l) => <div className="pvl" key={l[0]}><span>{l[0]}</span><b>{inr2(l[1])}</b></div>)}<div className="pvl t"><span>Invoice total</span><b>{inr2(total)}</b></div>
      {note && <p className="hint" style={{ margin: ui.sp('10px 0 0') }}>{note}</p>}
      {t && (
        <>
          <div className="doc" style={{ marginTop: ui.sp(22) }}>Supplier payment</div><div className="pvsub">Electrician’s bill, paid under {t.name.split(' ·')[0]}</div>
          <div className="pvl"><span>Bill amount</span><b>{inr2(a)}</b></div><div className="pvl"><span>TDS {t.name}</span><b className="neg">−{inr2(d)}</b></div><div className="pvl t"><span>Pay supplier</span><b>{inr2(a - d)}</b></div>
          <p className="hint" style={{ margin: ui.sp('10px 0 0') }}>Deposit {inr2(d)} with the government by {depositBy()}.</p>
        </>
      )}
    </aside>
  );
}

function ConfirmGstOff({ open, onClose, onYes }: { open: boolean; onClose: () => void; onYes: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  return (
    <div className="ov c" id="cfm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'cfm') onClose(); }}>
      <div className="mdl" role="alertdialog" aria-modal="true" aria-labelledby="cfmT">
        <div className="ti" style={{ background: 'color-mix(in srgb,var(--red) 14%,transparent)', color: 'var(--red)', marginBottom: ui.sp(12) }}><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg></div>
        <h3 id="cfmT" style={{ margin: ui.sp('0 0 6px'), fontSize: ui.fs(18) }}>Turn off GST?</h3>
        <p style={{ margin: ui.sp('0 0 18px'), color: 'var(--t2)' }}>New sales will be saved as plain bills without tax, and GST cards and reports will be hidden. Your existing invoices keep their GST details.</p>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" id="cfmNo" onClick={onClose}>Keep GST on</button><button className="btn dg" id="cfmYes" onClick={onYes}>Turn off GST</button></div>
      </div>
    </div>
  );
}

/** Tax list (#tl) */
export function TaxList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ofType } = useS();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [tl, setTl] = useState<'GST' | 'TCS' | 'TDS'>('GST');
  const [f, setF] = useState({ name: '', rate: '', note: '' });
  const [m, setM] = useState<{ c: string; t: string }>({ c: 'msg', t: '' });
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    setM({ c: 'msg', t: '' });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const list = ofType(tl);
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings'] });
  async function del(t: Tax) {
    try {
      await api(`/settings/taxes/${t.id}/remove`, { body: {} });
      await refresh();
      showToast(`${t.name} deleted`);
    } catch (e) {
      setM({ c: 'msg bad', t: e instanceof ApiError ? e.message : 'Could not delete the rate.' });
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const n = f.name.trim();
    const r = parseFloat(f.rate);
    if (!n) { setM({ c: 'msg bad', t: 'Enter a name for the tax.' }); return nameRef.current?.focus(); }
    if (isNaN(r) || r < 0 || r > 100) { setM({ c: 'msg bad', t: 'Enter a rate between 0 and 100.' }); return rateRef.current?.focus(); }
    if (list.some((t) => t.name.toLowerCase() === n.toLowerCase())) { setM({ c: 'msg bad', t: `A ${tl} rate named “${n}” already exists.` }); return; }
    try {
      await api('/settings/taxes', { body: { kind: tl, name: n, rate: r, note: f.note.trim() } });
      setF({ name: '', rate: '', note: '' });
      setM({ c: 'msg', t: '' });
      await refresh();
      showToast(`${n} added`);
    } catch (x) {
      setM({ c: 'msg bad', t: x instanceof ApiError ? x.message : 'Could not add the rate.' });
    }
  }
  return (
    <div className="ov c" id="tl" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'tl') onClose(); }}>
      <div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby="tlT">
        <div className="dh"><div><h3 id="tlT" style={{ margin: 0, fontSize: ui.fs(18) }}>Tax list</h3><small style={{ color: 'var(--t2)' }}>Rates you can pick on items, invoices and bills.</small></div><button className="ib" id="tlClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="seg2" role="tablist" id="tlTabs" style={{ margin: ui.sp('16px 0 12px') }}>{(['GST', 'TCS', 'TDS'] as const).map((t) => <button role="tab" aria-selected={t === tl} className={t === tl ? 'on' : ''} data-tl={t} key={t} onClick={() => { setTl(t); setM({ c: 'msg', t: '' }); }}>{t} <span>{ofType(t).length}</span></button>)}</div>
        <div className="tw stk"><table className="tlt"><thead><tr><th>Name</th><th className="n">Rate</th><th>How it applies</th><th className="n">Used in</th><th className="n"><span className="vh">Delete</span></th></tr></thead>
          <tbody id="tlBody">
            {list.length ? list.map((t) => (
              <tr key={t.id}><td><b>{t.name}</b>{t.isOld && <> <span className="st q">Older rate</span></>}<small>{t.note || ''}</small></td><td className="n">{pct(t.rate)}</td>
                <td>{tl === 'GST' ? <small style={{ margin: 0 }}>CGST {pct(Number(t.rate) / 2)} + SGST {pct(Number(t.rate) / 2)}<br />or IGST {pct(t.rate)}</small> : <small style={{ margin: 0 }}>{tl === 'TCS' ? 'Added to sale total' : 'Deducted from payment'}</small>}</td>
                <td className="n">{t.used ? `${t.used} items` : <span style={{ color: 'var(--t2)', fontWeight: 500 }}>Not used</span>}</td>
                <td className="n"><button className="ix" data-del={t.id} aria-label={`Delete ${t.name}`} onClick={() => void del(t)}><Icon name="x" /></button></td></tr>
            )) : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--t2)', padding: ui.sp(28) }}>No {tl} rates yet. Add one below.</td></tr>}
          </tbody></table></div>
        <form className="addf" id="tlForm" noValidate onSubmit={add}>
          <label className="fl" htmlFor="tlName">Name<input className="fi" id="tlName" autoComplete="off" placeholder={tl === 'GST' ? 'e.g. GST 18%' : tl === 'TCS' ? 'e.g. TCS 1%' : 'e.g. 194C · 1%'} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} ref={nameRef} /></label>
          <label className="fl" htmlFor="tlRate">Rate %<input className="fi" id="tlRate" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} ref={rateRef} /></label>
          <label className="fl" htmlFor="tlNote">Used for<input className="fi" id="tlNote" placeholder="Optional" autoComplete="off" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <button className="btn p" type="submit" style={{ marginBottom: ui.sp(8) }}><Icon name="plus" />Add</button>
        </form>
        <div className={m.c} id="tlMsg" aria-live="polite">{m.t}</div>
      </div>
    </div>
  );
}

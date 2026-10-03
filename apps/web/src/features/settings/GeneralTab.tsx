/**
 * Settings › General (#cGen) in the order the prototype finally builds it:
 * Business details, Display (₹, MRP), Payment links, Modules, Backup & restore,
 * Start fresh, Cloud sync. "Restore from file" takes the old app's backup and
 * imports it (Phase 2 import upload). Start fresh never deletes: it starts new books.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { GSTIN_RE, STATES } from '@billing/shared';
import { api, apiWithToken, ApiError } from '../../lib/api';
import { saveFile } from '../../lib/files';
import { today } from '../../lib/time';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { Sw, useS, useSaveS } from './model';

interface Biz { name: string; shortName: string; ownerName: string; phone: string; email: string; address: string; city: string; pin: string; stateCode: string; gstin: string; invoiceNext: number }
const CLOUD = '<path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 8.5a4.75 4.75 0 01-.5 9.5z"/>';
const upiOk = (v: string) => /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test((v || '').trim());
const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });
const when = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const lastBackup = () => { try { return Number(localStorage.getItem('erp--bkp')) || 0; } catch { return 0; } };

type BzForm = { name: string; short: string; owner: string; phone: string; email: string; upi: string; addr: string; city: string; pin: string; state: string; gstin: string; inv: string; cash?: string };
/** the prototype's bzCheck */
function bzCheck(o: BzForm): string | null {
  if (!o.name) return 'Enter the business name.';
  if (o.gstin && !GSTIN_RE.test(o.gstin)) return 'This GSTIN doesn’t look right — it has 15 characters, like 09ABCDE1234F1Z5.';
  if (o.gstin && o.gstin.slice(0, 2) !== o.state) return `GSTIN starts with ${o.gstin.slice(0, 2)}, but the state chosen is ${o.state}. Pick the matching state.`;
  if (o.pin && !/^\d{6}$/.test(o.pin)) return 'PIN code has 6 digits.';
  if (o.inv && !/^\d{1,6}$/.test(o.inv)) return 'Next invoice number should be a number, e.g. 1 or 415.';
  if (o.upi && !/^[\w.\-]{2,}@[a-z]{2,}$/i.test(o.upi)) return 'UPI ID looks like name@bank, e.g. gupta@okhdfcbank.';
  return null;
}
const Field = ({ id, lbl, v, set, ph, im, mono, up }: { id: string; lbl: string; v: string; set: (v: string) => void; ph?: string; im?: 'tel' | 'email' | 'numeric' | 'decimal'; mono?: boolean; up?: boolean }) => (
  <label className="fl" htmlFor={id}>{lbl}<input className={`fi${mono ? ' mono' : ''}`} id={id} value={v} placeholder={ph} inputMode={im} autoComplete="off" style={up ? { textTransform: 'uppercase' } : undefined} onChange={(e) => set(e.target.value)} /></label>
);
const StateSel = ({ id, v, set }: { id: string; v: string; set: (v: string) => void }) => (
  <label className="fl" htmlFor={id}>State<select className="fi" id={id} value={v} onChange={(e) => set(e.target.value)}>{STATES.map((s) => <option value={s[0]} key={s[0]}>{s[0]} · {s[1]}</option>)}</select></label>
);

export function GeneralTab() {
  const { S } = useS();
  const save = useSaveS();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const biz = useQuery({ queryKey: ['business-current'], queryFn: () => api<Biz>('/businesses/current') });
  const [bz, setBz] = useState<BzForm | null>(null);
  const [bzErr, setBzErr] = useState('');
  const [upi, setUpi] = useState(S.upi);
  const [upiN, setUpiN] = useState(S.upiName);
  const [fresh, setFresh] = useState(false);
  const [restore, setRestore] = useState<{ text: string; file: string; d: Record<string, unknown> } | null>(null);
  const [, tick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const b = biz.data;
    if (b) setBz({ name: b.name, short: b.shortName, owner: b.ownerName, phone: b.phone, email: b.email, upi: S.upi, addr: b.address, city: b.city, pin: b.pin, state: b.stateCode || '09', gstin: b.gstin, inv: String(b.invoiceNext) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biz.data]);
  useEffect(() => { setUpi(S.upi); setUpiN(S.upiName); }, [S.upi, S.upiName]);
  const f = (k: keyof BzForm) => (v: string) => setBz((x) => (x ? { ...x, [k]: v } : x));

  async function saveBz() {
    if (!bz) return;
    const o = { ...bz, name: bz.name.trim(), gstin: bz.gstin.trim().toUpperCase(), upi: bz.upi.trim() };
    setBzErr('');
    const e = bzCheck(o);
    if (e) return setBzErr(e);
    try {
      await api('/businesses/current', { method: 'PATCH', body: { name: o.name, short: o.short.trim(), owner: o.owner.trim(), phone: o.phone.trim(), email: o.email.trim(), addr: o.addr.trim(), city: o.city.trim(), pin: o.pin.trim(), state: o.state, gstin: o.gstin, inv: o.inv.trim() } });
      await save({ data: { upi: o.upi, upiName: o.name } });
      await Promise.all(['business-current', 'me'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast('Business details saved');
    } catch (x) {
      setBzErr(x instanceof ApiError ? x.message : 'Could not save the business details.');
    }
  }
  const savePay = (which: 'upi' | 'name') => {
    const v = upi.trim();
    if (which === 'upi' && !upiOk(v)) return;
    void save({ data: { upi: v, upiName: upiN.trim() } });
    showToast('Payment details saved');
  };
  async function download() {
    try {
      const d = await api<unknown>('/backup');
      const t = new Date();
      const name = ((biz.data?.name ?? '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'Books') + '-backup-' + today() + '-' + String(t.getHours()).padStart(2, '0') + String(t.getMinutes()).padStart(2, '0') + '.json';
      saveFile(name, new Blob([JSON.stringify(d)], { type: 'application/json' }));
      try { localStorage.setItem('erp--bkp', String(Date.now())); } catch { /* private window */ }
      tick((n) => n + 1);
      return true;
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not make the backup.');
      return false;
    }
  }
  function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 25 * 1048576) return showToast('That file is too large to be a backup.');
    void file.text().then((text) => {
      let d: Record<string, unknown> | null = null;
      try { d = JSON.parse(text); } catch { /* not JSON */ }
      if (d && d.app === 'billing-erp-cloud') return showToast('Restoring a backup made by this app comes with hosting (Phase 5). To bring in books from the old app, choose its backup file.');
      if (!d || d.app !== 'billing-erp' || typeof d.keys !== 'object') return showToast('This file isn’t a backup from this app.');
      setRestore({ text, file: file.name, d });
    });
  }
  const l = lastBackup();
  const days = l ? Math.floor((Date.now() - l) / 864e5) : null;

  return (
    <section className="card" id="cGen">
      {bz && (
        <div id="bzCard"><h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Business details</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>Printed on every invoice, challan, statement and report, and used in WhatsApp messages.</p>
          <div className="two"><Field id="bzName" lbl="Business name" v={bz.name} set={f('name')} ph="e.g. Gupta Electricals & Hardware" /><Field id="bzShort" lbl="Short name (top bar)" v={bz.short} set={f('short')} ph="e.g. Gupta Electricals" /></div>
          <div className="two"><Field id="bzOwner" lbl="Owner name" v={bz.owner} set={f('owner')} /><Field id="bzPhone" lbl="Phone" v={bz.phone} set={f('phone')} im="tel" ph="+91 " /></div>
          <div className="two"><Field id="bzEmail" lbl="Email" v={bz.email} set={f('email')} im="email" /><Field id="bzUpi" lbl="UPI ID for payments" v={bz.upi} set={f('upi')} ph="yourshop@upi" /></div>
          <Field id="bzAddr" lbl="Address" v={bz.addr} set={f('addr')} ph="Shop no., street, area" />
          <div className="two"><Field id="bzCity" lbl="City" v={bz.city} set={f('city')} /><Field id="bzPin" lbl="PIN code" v={bz.pin} set={f('pin')} im="numeric" /></div>
          <div className="two"><StateSel id="bzSt" v={bz.state} set={f('state')} /><Field id="bzGstin" lbl="GSTIN (leave empty if not registered)" v={bz.gstin} set={f('gstin')} mono up ph="15 characters" /></div>
          <div className="two"><Field id="bzInv" lbl="Next invoice number" v={bz.inv} set={f('inv')} im="numeric" /><span></span></div>
          <div className="msg bad" id="bzErr" role="alert">{bzErr}</div><div style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 4px' }}><button className="btn p" type="button" id="bzSaveBtn" onClick={() => void saveBz()}>Save business details</button></div></div>
      )}
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Display</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>How amounts look across the app, on invoices and in print.</p>
      <div className="tgl" data-keepcur><div className="ti" style={T('var(--ac)')}><b style={{ fontSize: 17 }}>₹</b></div><div className="tx"><b>Show currency symbol</b><small>Show ₹ before amounts, e.g. ₹1,250.00. Turned off, amounts show as plain numbers: 1,250.00.</small></div><Sw id="sCur" on={S.showCurrency} label="Show currency symbol" onChange={(v) => { void save({ data: { showCurrency: v } }); showToast(v ? 'Currency symbol shown' : 'Currency symbol hidden'); }} /></div>
      <div className="tgl" style={{ marginTop: 14 }}><div className="ti" style={T('var(--amber,#d97706)')}><b style={{ fontSize: 12 }}>MRP</b></div><div className="tx"><b>Show MRP</b><small>Show the MRP (maximum retail price) column and fields in Items, Price manager, Price Setup, add-item forms and rate lists. Turned off, MRP is hidden everywhere; saved MRPs are kept.</small></div><Sw id="sMrp" on={S.mrp} label="Show MRP" onChange={(v) => { void save({ data: { mrp: v } }); showToast(v ? 'MRP shown' : 'MRP hidden everywhere'); }} /></div>
      <h3 style={{ margin: '22px 0 4px', fontSize: 16 }}>Payment links</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>Customers pay straight into this UPI ID from the link or the QR on their invoice.</p>
      <div className="two plset"><label className="fl" htmlFor="sUpi">Your UPI ID<input className="fi mono" id="sUpi" value={upi} placeholder="yourshop@okhdfcbank" autoComplete="off" onChange={(e) => setUpi(e.target.value)} onBlur={() => upi !== S.upi && savePay('upi')} /></label><label className="fl" htmlFor="sUpiN">Name shown to the customer<input className="fi" id="sUpiN" value={upiN} autoComplete="off" onChange={(e) => setUpiN(e.target.value)} onBlur={() => upiN !== S.upiName && savePay('name')} /></label></div>
      <p className="xperr" id="sUpiErr" hidden={!upi || upiOk(upi)}>Enter a UPI ID like yourshop@okhdfcbank.</p>
      <div className="tgl"><div className="ti" style={T('var(--blue)')}><Icon name="doc" /></div><div className="tx"><b>Print payment QR on invoices</b><small>Unpaid invoices get a UPI QR for the balance due, beside your UPI ID.</small></div><Sw id="sPayQr" on={S.payQr} label="Print payment QR on invoices" onChange={(v) => { void save({ data: { payQr: v } }); showToast(`Payment QR ${v ? 'on' : 'off'}`); }} /></div>
      <div className="tgl"><div className="ti" style={T('var(--green)')}><Icon name="chat" /></div><div className="tx"><b>Add payment link to WhatsApp messages</b><small>When you share an unpaid invoice on WhatsApp, the message includes your UPI ID and a pay link.</small></div><Sw id="sWaLink" on={S.waLink} label="Add payment link to WhatsApp messages" onChange={(v) => { void save({ data: { waLink: v } }); showToast(`WhatsApp pay link ${v ? 'on' : 'off'}`); }} /></div>
      <h3 style={{ margin: '22px 0 4px', fontSize: 16 }}>Modules</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>Turn off parts of the app you don’t use. Your data is kept.</p>
      <div className="tgl"><div className="ti" style={T('var(--blue,#2563eb)')}><Icon name="book" /></div><div className="tx"><b>Accounting</b><small>Chart of accounts, journal vouchers and day book in the side menu.</small></div><Sw id="sAcct" on={S.acct} label="Accounting" onChange={(v) => { void save({ data: { acct: v } }); showToast(v ? 'Accounting turned on' : 'Accounting turned off'); }} /></div>
      <div id="bkpCard"><h3 style={{ margin: '26px 0 4px', fontSize: 16 }}>Backup &amp; restore</h3><p className="mu" style={{ margin: '0 0 12px', fontSize: 13 }}>Keep a copy of your books outside the app. If entries are lost or deleted by mistake, restore the copy.</p>
        <div className="synccard"><div className="sx"><b>Backup file</b><span id="bkpLastTxt">{l ? `Last downloaded on this device ${when(new Date(l).toISOString())}${days! >= 7 ? ` — ${days} days ago, take a new one` : ''}.` : 'No backup downloaded on this device yet.'}</span></div><button className="btn" type="button" id="bkpRestoreBtn" onClick={() => fileRef.current?.click()}>Restore from file…</button><button className="btn p" type="button" id="bkpDlBtn" onClick={() => void download()}>Download backup</button></div>
        <div className="synccard" id="bkpCloud"><div className="sx"><b>Daily copies in the cloud</b><span id="bkpCloudTxt">Cloud copies start once cloud sync is connected.</span><div id="bkpCloudList" style={{ marginTop: 6 }}></div></div></div>
        <div className="synccard"><div className="sx"><b>Storage on this device</b><span id="bkpUseTxt">Your books are kept on the server, not on this device.</span><div style={{ height: 6, borderRadius: 3, background: 'var(--bd,#e2e8f0)', overflow: 'hidden', marginTop: 6 }}><i id="bkpUseBar" style={{ display: 'block', height: '100%', width: '2%', background: 'var(--ac)' }}></i></div></div></div></div>
      <div id="bzFresh"><h3 style={{ margin: '26px 0 4px', fontSize: 16 }}>Start fresh</h3><p className="mu" style={{ margin: '0 0 12px', fontSize: 13 }}>Begin a new, empty set of books. These books are kept and stay available from the shop menu.</p>
        <div className="synccard" style={{ borderColor: 'color-mix(in srgb,var(--red,#dc2626) 35%,transparent)' }}><div className="sx"><b>Start new books from zero</b><span>Parties, items, invoices, purchases, payments, expenses and bank entries start empty in the new books. Nothing here is deleted.</span></div><button className="btn dz" type="button" id="bzFreshBtn" onClick={() => setFresh(true)}>Start fresh…</button></div></div>
      <h3 style={{ margin: '22px 0 4px', fontSize: 16 }}>Cloud sync</h3><p className="mu" style={{ margin: '0 0 12px', fontSize: 13 }}>One shared set of books for your shop. Open it on any laptop or phone, at any location, and you and your staff see the same invoices, parties and stock. Only people you share the app with as Contributor or Editor can see or change the data.</p>
      <div className="synccard"><span className="ti" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, ...T('#16a34a') }}><RawIcon d={CLOUD} /></span><div className="sx"><b>Status</b><span id="syncSt">Synced — the same books on every device and for all your staff</span></div><button className="btn" type="button" id="syncNow" onClick={() => { void qc.invalidateQueries(); showToast('Synced'); }}>Sync now</button></div><div id="syncWho"></div>
      <input type="file" id="bkpFile" accept=".json,application/json" hidden ref={fileRef} onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; pickFile(x); }} />
      <StartFresh open={fresh} biz={biz.data} cash={S.cashOpen} onClose={() => setFresh(false)} />
      <RestoreBackup src={restore} onClose={() => setRestore(null)} download={download} />
    </section>
  );
}

/** Start fresh (#bzm): new, empty books; the current ones are kept. */
function StartFresh({ open, biz, cash, onClose }: { open: boolean; biz?: Biz; cash?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [o, setO] = useState<BzForm>({ name: '', short: '', owner: '', phone: '', email: '', upi: '', addr: '', city: '', pin: '', state: '09', gstin: '', inv: '1', cash: '' });
  const [keep, setKeep] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    // like the prototype for books that were started fresh: the form starts from the current business
    setO({ name: biz?.name ?? '', short: '', owner: biz?.ownerName ?? '', phone: biz?.phone ?? '', email: biz?.email ?? '', upi: '', addr: biz?.address ?? '', city: biz?.city ?? '', pin: biz?.pin ?? '', state: biz?.stateCode ?? '09', gstin: biz?.gstin ?? '', inv: String(biz?.invoiceNext ?? 1), cash: cash ?? '' });
    setKeep(false); setOk(false); setErr(''); setBusy(false);
    setTimeout(() => document.getElementById('bzfName')?.focus(), 30);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const f = (k: keyof BzForm) => (v: string) => setO((x) => ({ ...x, [k]: v }));
  async function go() {
    const v = { ...o, name: o.name.trim(), gstin: o.gstin.trim().toUpperCase() };
    setErr('');
    const e = bzCheck(v);
    if (e) return setErr(e);
    const cash = (o.cash ?? '').replace(/[^\d.]/g, '');
    setBusy(true);
    try {
      await apiWithToken('/businesses', { name: v.name, owner: v.owner.trim() || v.name, phone: v.phone.trim(), addr: v.addr.trim(), city: v.city.trim(), pin: v.pin.trim(), state: v.state, gstin: v.gstin, inv: v.inv.trim() || '1', keepItems: keep, ...(cash ? { cash } : {}) });
      if (v.email.trim()) await api('/businesses/current', { method: 'PATCH', body: { email: v.email.trim() } });
      await qc.invalidateQueries();
      onClose();
      navigate('/');
      showToast(`Fresh books started for ${v.name}. Add your parties and items to begin.`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not start the new books.');
      setBusy(false);
    }
  }
  return (
    <div className="ov c" id="bzm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'bzm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bzmT" style={{ width: 'min(680px,100%)' }}>
        <div className="dh"><div><h3 id="bzmT" style={{ margin: 0, fontSize: 18 }}>Start fresh with your own business</h3><small className="mu">New books start empty. These books are kept.</small></div><button className="ib" type="button" id="bzmClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div id="bzmBody" style={{ marginTop: 12 }}>
          <div className="two"><Field id="bzfName" lbl="Business name" v={o.name} set={f('name')} ph="e.g. Gupta Electricals & Hardware" /><Field id="bzfOwner" lbl="Owner name" v={o.owner} set={f('owner')} /></div>
          <div className="two"><Field id="bzfPhone" lbl="Phone" v={o.phone} set={f('phone')} im="tel" ph="+91 " /><Field id="bzfEmail" lbl="Email" v={o.email} set={f('email')} im="email" /></div>
          <Field id="bzfAddr" lbl="Address" v={o.addr} set={f('addr')} ph="Shop no., street, area" />
          <div className="two"><Field id="bzfCity" lbl="City" v={o.city} set={f('city')} /><Field id="bzfPin" lbl="PIN code" v={o.pin} set={f('pin')} im="numeric" /></div>
          <div className="two"><StateSel id="bzfSt" v={o.state} set={f('state')} /><Field id="bzfGstin" lbl="GSTIN (leave empty if not registered)" v={o.gstin} set={f('gstin')} mono up ph="15 characters" /></div>
          <div className="two"><Field id="bzfInv" lbl="First invoice number" v={o.inv} set={f('inv')} im="numeric" /><Field id="bzfCash" lbl="Cash in hand today" v={o.cash ?? ''} set={f('cash')} im="decimal" ph="0" /></div>
          <p className="hint" style={{ margin: '0 0 8px' }}>Continuing an existing bill book? Put the next number you would write, e.g. 415. Bank accounts, parties with old balances and opening stock can be added afterwards.</p>
          <label className="cb2"><input type="checkbox" id="bzfKeep" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep my item list (names and prices only, stock set to zero)</label>
          <label className="cb2" style={{ marginTop: 6, alignItems: 'flex-start' }}><input type="checkbox" id="bzfOk" style={{ marginTop: 3 }} checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span><b>I understand</b> new, empty books are started for this business. The current books are kept and can be opened again from the shop menu.</span></label>
        </div>
        <div className="msg bad" id="bzmErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="bzmCancel" onClick={onClose}>Cancel</button><button className="btn dz" type="button" id="bzmGo" disabled={!ok || busy} onClick={() => void go()}>{busy ? 'Starting fresh…' : 'Start new books'}</button></div>
      </div>
    </div>
  );
}

interface ImportResult { dryRun: boolean; counts: Record<string, number>; warnings: string[] }
/** Restore books (#rsm) for the old app's backup file: checked first (dry run), then imported. */
function RestoreBackup({ src, onClose, download }: { src: { text: string; file: string; d: Record<string, unknown> } | null; onClose: () => void; download: () => Promise<boolean> }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [safe, setSafe] = useState(true);
  const [ok, setOk] = useState(false);
  const [sample, setSample] = useState(false);
  const [busy, setBusy] = useState(false);
  useOpenFocus(!!src, ref);
  const fresh = !!(src?.d as { fresh?: boolean } | undefined)?.fresh;
  useEffect(() => {
    if (!src) return;
    setCheck(null); setErr(''); setSafe(true); setOk(false); setSample(false); setBusy(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  useEffect(() => {
    if (!src) return;
    let live = true;
    setCheck(null);
    api<ImportResult>('/imports?dryRun=true', { body: { fileName: src.file, backup: src.text, includeSample: sample } })
      .then((r) => live && setCheck(r), (e) => live && setErr(e instanceof ApiError ? e.message : 'Could not read the backup.'));
    return () => { live = false; };
  }, [src, sample]);
  // the prototype's counts, read from the file itself
  const P = (k: string) => { try { const v = JSON.parse(((src?.d.keys ?? {}) as Record<string, string>)[k] ?? 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const c = { inv: P('erp-invoices').length, par: P('erp-parties').length, itm: P('erp-items').length, pur: P('erp-pdocs').filter((x: { kind?: string }) => x.kind === 'bill').length, rc: P('erp-precv').length, exp: P('erp-exps').length };
  async function go() {
    if (!src) return;
    setBusy(true);
    setErr('');
    try {
      if (safe && !(await download())) { setErr('The backup of the current books wasn’t saved. Untick the first box to restore anyway.'); setBusy(false); return; }
      const r = await api<ImportResult>('/imports', { body: { fileName: src.file, backup: src.text, includeSample: sample } });
      await qc.invalidateQueries();
      onClose();
      showToast(`Books restored to ${when(String(src.d.at ?? ''))}. ${r.counts.parties ?? 0} parties and ${r.counts.items ?? 0} items came in.`);
    } catch (x) {
      setErr('Restore failed: ' + (x instanceof ApiError ? x.message : 'unknown error'));
      setBusy(false);
    }
  }
  return (
    <div className="ov c" id="rsm" ref={ref} hidden={!src} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'rsm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="rsmT" style={{ width: 'min(560px,100%)' }}>
        <div className="dh"><div><h3 id="rsmT" style={{ margin: 0, fontSize: 18 }}>Restore books</h3><small className="mu" id="rsmSub">{src ? 'From file · ' + src.file : ''}</small></div><button className="ib" type="button" id="rsmClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div id="rsmBody" style={{ marginTop: 12 }}>
          {src && (
            <>
              <div className="rcv"><div><span>Business</span><b>{String(src.d.biz ?? '—')}</b></div><div><span>Saved on</span><b>{when(String(src.d.at ?? ''))}</b></div>
                <div><span>Invoices</span><b>{c.inv}</b></div><div><span>Parties added</span><b>{c.par}</b></div><div><span>Items added</span><b>{c.itm}</b></div><div><span>Purchase bills</span><b>{c.pur}</b></div><div><span>Payments received</span><b>{c.rc}</b></div><div><span>Expenses</span><b>{c.exp}</b></div></div>
              <p className="hint" style={{ margin: '10px 0' }}>Parties, items, opening balances and stock, prices, godowns, electricians and settings from this backup come into these books. This works while the books are still empty. Invoices, purchases, payments and expenses come across in the next phase of the new app.</p>
              {check && <p className="hint" id="rsmCheck" style={{ margin: '0 0 10px' }}>Ready: {check.counts.parties ?? 0} parties and {check.counts.items ?? 0} items.{check.warnings.map((w) => ' ' + w).join('')}</p>}
              {!fresh && <label className="cb2" style={{ marginBottom: 6 }}><input type="checkbox" id="rsmSample" checked={sample} onChange={(e) => setSample(e.target.checked)} /> Also bring in the old app’s sample entries</label>}
              <label className="cb2"><input type="checkbox" id="rsmSafe" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> First download a backup of the books as they are now</label>
              <label className="cb2" style={{ marginTop: 6, alignItems: 'flex-start' }}><input type="checkbox" id="rsmOk" style={{ marginTop: 3 }} checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span><b>I understand</b> the entries in this backup are added to these books.</span></label>
            </>
          )}
        </div>
        <div className="msg bad" id="rsmErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="rsmCancel" onClick={onClose}>Cancel</button><button className="btn dz" type="button" id="rsmGo" disabled={!ok || busy || !check} onClick={() => void go()}>{busy ? 'Restoring…' : 'Restore these books'}</button></div>
      </div>
    </div>
  );
}

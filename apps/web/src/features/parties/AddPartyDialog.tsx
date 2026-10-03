/**
 * Add party (#ap) — same markup, tabs, checks and wording as the prototype's
 * renderAP / apSave. Saves through POST /api/parties.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GSTIN_RE, STATES } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { inr } from '../../lib/format';
import { useCur, useSettings } from '../../lib/settings';
import { today } from '../../lib/time';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';

const GEAR = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const GTYPES = ['Unregistered / consumer', 'Registered business – regular', 'Registered business – composition', 'Overseas', 'SEZ'];
const APF: Array<[label: string, onByDefault: boolean, type: string]> = [['Contact person', true, ''], ['Date of birth', false, 'date'], ['Anniversary', false, 'date'], ['Transport / Vehicle no.', false, '']];

interface Aps { groups: boolean; ship: boolean; credit: boolean; extra: boolean }
const loadAps = (): Aps => {
  const d = { groups: true, ship: true, credit: true, extra: true };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem('erp-party-set') ?? 'null') ?? {}) };
  } catch {
    return d;
  }
};

type Tab = 'addr' | 'cred' | 'extra';
interface Form {
  name: string; phone: string; group: string; gstin: string; gtype: string; gtypeTouched: boolean; state: string; email: string;
  billing: string; bLine: string; bCity: string; bPin: string; shipping: string; ob: string; obDate: string; lim: string; days: string;
}
const blank = (): Form => ({
  name: '', phone: '', group: 'General', gstin: '', gtype: GTYPES[0]!, gtypeTouched: false, state: '', email: '',
  billing: '', bLine: '', bCity: '', bPin: '', shipping: '', ob: '', obDate: today(), lim: '', days: '30',
});

export function AddPartyDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const cur = useCur();
  const gstOn = !!useSettings().data?.gstEnabled;
  const qc = useQueryClient();
  const { showToast } = useShell();
  const groups = useQuery({ queryKey: ['party-groups'], queryFn: () => api<{ id: string; name: string }[]>('/party-groups'), enabled: open });
  const [aps, setAps] = useState<Aps>(loadAps);
  const [setOpen, setSetOpen] = useState(false);
  const [f, setF] = useState<Form>(blank);
  const [tab, setTab] = useState<Tab>('addr');
  const [detail, setDetail] = useState(false);
  const [ship, setShip] = useState(false);
  const [same, setSame] = useState(true);
  const [type, setType] = useState<'receive' | 'pay'>('receive');
  const [limit, setLimit] = useState<'none' | 'custom'>('none');
  const [extra, setExtra] = useState(APF.map(([, on]) => ({ on, v: '' })));
  const [err, setErr] = useState<Record<string, string>>({});
  const [newG, setNewG] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setF(blank()); setTab('addr'); setDetail(false); setShip(false); setSame(true); setType('receive'); setLimit('none');
    setExtra(APF.map(([, on]) => ({ on, v: '' }))); setErr({}); setNewG(null);
  };
  useEffect(() => {
    if (!open) return;
    reset();
    setTimeout(() => nameRef.current?.focus(), 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof Form>(k: K) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gtype = f.gtypeTouched ? f.gtype : f.gstin ? GTYPES[1]! : GTYPES[0]!;
  const E = (k: string) => (err[k] ? <div className="aperr">{err[k]}</div> : null);
  const bad = (k: string) => (err[k] ? 'bad' : '');
  const tabs: Array<[Tab, string, boolean?]> = [['addr', gstOn ? 'GST & address' : 'Address'], ...(aps.credit ? [['cred', 'Credit & balance', true] as [Tab, string, boolean]] : []), ...(aps.extra ? [['extra', 'Additional fields'] as [Tab, string]] : [])];
  const curTab = tabs.some((t) => t[0] === tab) ? tab : 'addr';
  const groupNames = groups.data?.map((g) => g.name) ?? ['General'];

  function saveAps(next: Aps) {
    setAps(next);
    try { localStorage.setItem('erp-party-set', JSON.stringify(next)); } catch { /* private mode */ }
  }

  async function addGroup() {
    const n = (newG ?? '').trim();
    if (!n) return;
    try {
      await api('/party-groups', { body: { name: n } });
      await qc.invalidateQueries({ queryKey: ['party-groups'] });
      setF((x) => ({ ...x, group: n }));
      setNewG(null);
      showToast(`Group “${n}” added`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not add the group.');
    }
  }

  async function save(again: boolean) {
    const er: Record<string, string> = {};
    const n = (v: string) => Number(v.replace(/,/g, ''));
    if (!f.name.trim()) er.name = 'Enter the party name.';
    const ph = f.phone.replace(/\s/g, '');
    if (ph && !/^[6-9]\d{9}$/.test(ph)) er.phone = 'Enter a 10-digit mobile number.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) er.email = 'Enter a valid email address.';
    if (f.gstin && !GSTIN_RE.test(f.gstin.toUpperCase())) er.gstin = 'GSTIN has 15 characters, like 09AAJPM7745Q1Z2.';
    if (detail && f.bPin && !/^\d{6}$/.test(f.bPin)) er.pin = 'PIN code has 6 digits.';
    if (f.ob && Number.isNaN(n(f.ob))) er.ob = 'Enter a number.';
    if (limit === 'custom' && (!f.lim || Number.isNaN(n(f.lim)))) er.lim = 'Enter the credit limit amount.';
    setErr(er);
    if (Object.keys(er).length) {
      if (er.ob || er.lim) setTab('cred');
      else if (er.email || er.gstin || er.pin) setTab('addr');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), kind: type === 'pay' ? 'supplier' : 'customer', group: aps.groups ? f.group : 'General', phone: ph,
        email: f.email.trim(), gstin: f.gstin.trim(), gstType: gstOn ? gtype : '', state: gstOn ? f.state : '',
        billing: detail ? { line: f.bLine, city: f.bCity, pin: f.bPin, state: '' } : { line: f.billing.trim(), city: '', pin: '', state: '' },
        shipping: ship && !same ? f.shipping.trim() : '',
        openingBalance: f.ob.trim() || null, openingType: type, openingDate: f.obDate || today(),
        creditLimit: limit === 'custom' ? f.lim : null, creditDays: Number(f.days) || 0,
        contacts: extra.map((x, i) => ({ label: APF[i]![0], value: x.v.trim(), on: x.on })).filter((x) => x.on && x.value).map(({ label, value }) => ({ label, value })),
      };
      const p = await api<{ id: string; name: string }>('/parties', { body });
      await qc.invalidateQueries({ queryKey: ['parties'] });
      const ob = n(f.ob || '0');
      showToast(`${body.name} added to parties` + (ob ? ` · opening balance ${cur(inr(ob))} ${type === 'receive' ? 'to receive' : 'to pay'}` : ''));
      if (again) {
        reset();
        nameRef.current?.focus();
      } else onSaved(p.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr({ name: e.message });
      else if (e instanceof ApiError) setErr({ name: e.message });
      else showToast('Could not save the party.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ov c" id="ap" hidden={!open} onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest('.apset,#apGear')) setSetOpen(false); }}>
      <div className="mdl apm" role="dialog" aria-modal="true" aria-labelledby="apT">
        <div className="aphd">
          <h3 id="apT">Add party</h3>
          <div className="rel">
            <button className="ib" type="button" id="apGear" aria-label="Party settings" title="Party settings" onClick={() => setSetOpen(!setOpen)}><RawIcon d={GEAR} /></button>
            <div className="pop apset" id="apSet" hidden={!setOpen}>
              <b>Party settings</b>
              {([['groups', 'Party groups'], ['ship', 'Shipping address'], ['credit', 'Credit & balance'], ['extra', 'Additional fields']] as const).map(([k, t]) => (
                <label className="cb2" key={k}><input type="checkbox" data-aps={k} checked={aps[k]} onChange={(e) => saveAps({ ...aps, [k]: e.target.checked })} /> {t}</label>
              ))}
            </div>
          </div>
          <button className="ib" type="button" id="apClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button>
        </div>
        <div className="apnewg" id="apNewG" hidden={newG === null}>
          <input className="fi" id="apNewGName" placeholder="New group name, e.g. Electricians" autoComplete="off" value={newG ?? ''} onChange={(e) => setNewG(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGroup()} />
          <button className="btn p" type="button" id="apNewGAdd" onClick={addGroup}>Add group</button>
          <button className="btn" type="button" id="apNewGCancel" onClick={() => setNewG(null)}>Cancel</button>
        </div>
        <div className="apbody" id="apBody">
          <div className="aptop">
            <label className="apf">Party name <span className="req">*</span><input className={`fi ${bad('name')}`} id="apName" data-f="name" value={f.name} onChange={set('name')} placeholder="e.g. Mehta Electricals" autoComplete="off" ref={nameRef} />{E('name')}</label>
            <label className="apf">Phone number<span className="pre2"><span>+91</span><input className={`fi ${bad('phone')}`} data-f="phone" value={f.phone} onChange={set('phone')} placeholder="98765 43210" inputMode="numeric" autoComplete="off" /></span>{E('phone')}</label>
            {aps.groups && (
              <label className="apf">Party group<select className="fi" data-f="group" id="apGroup" value={f.group} onChange={(e) => (e.target.value === '__new' ? setNewG('') : set('group')(e))}>
                {groupNames.map((g) => <option key={g}>{g}</option>)}
                <option value="__new">+ Add new group</option>
              </select></label>
            )}
          </div>
          <div className="aptabs" role="tablist">
            {tabs.map(([k, t, isNew]) => (
              <button type="button" role="tab" aria-selected={curTab === k} className={curTab === k ? 'on' : ''} data-aptab={k} key={k} onClick={() => setTab(k)}>{t}{isNew && <>{' '}<span className="newb">New</span></>}</button>
            ))}
          </div>
          <div className="appane" hidden={curTab !== 'addr'}>
            <div className="apaddr">
              <div className="apcol">
                {gstOn && (
                  <>
                    <label className="apf">GSTIN<input className={`fi mono ${bad('gstin')}`} data-f="gstin" id="apGstin" value={f.gstin} onChange={set('gstin')} maxLength={15} placeholder="09AAJPM7745Q1Z2" autoComplete="off" spellCheck={false} />{E('gstin')}</label>
                    <label className="apf">GST type<select className="fi" data-f="gtype" value={gtype} onChange={(e) => setF((x) => ({ ...x, gtype: e.target.value, gtypeTouched: true }))}>{GTYPES.map((g) => <option key={g}>{g}</option>)}</select></label>
                    <label className="apf">State<select className="fi" data-f="state" id="apState" value={f.state} onChange={set('state')}><option value="">Select state</option>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select><small className="aphint">Same state as you → CGST + SGST. Other state → IGST.</small></label>
                  </>
                )}
                <label className="apf">Email ID<input className={`fi ${bad('email')}`} data-f="email" value={f.email} onChange={set('email')} type="email" placeholder="name@business.com" autoComplete="off" />{E('email')}</label>
              </div>
              <div className="apcol bl">
                <b className="aph">Billing address</b>
                {detail ? (
                  <>
                    <input className="fi" data-f="bLine" value={f.bLine} onChange={set('bLine')} placeholder="Shop no., building, street" />
                    <div className="two"><input className="fi" data-f="bCity" value={f.bCity} onChange={set('bCity')} placeholder="City" /><input className={`fi ${bad('pin')}`} data-f="bPin" value={f.bPin} onChange={set('bPin')} placeholder="PIN code" inputMode="numeric" maxLength={6} /></div>{E('pin')}
                  </>
                ) : (
                  <textarea className="fi ta" data-f="billing" rows={4} placeholder="Shop no., street, city, PIN code" value={f.billing} onChange={set('billing')}></textarea>
                )}
                <button type="button" className="aplink" id="apDetail" onClick={() => {
                  if (!detail) setF((x) => ({ ...x, bLine: x.bLine || x.billing }));
                  else setF((x) => ({ ...x, billing: x.billing || [x.bLine, x.bCity, x.bPin].filter(Boolean).join(', ') }));
                  setDetail(!detail);
                }}>{detail ? 'Show as one box' : 'Show detailed address'}</button>
              </div>
              {aps.ship && (
                <div className="apcol bl">
                  <b className="aph">Shipping address</b>
                  {ship ? (
                    <>
                      <label className="cb2"><input type="checkbox" id="apSame" checked={same} onChange={(e) => setSame(e.target.checked)} /> Same as billing address</label>
                      {same ? <p className="aphint" style={{ margin: '6px 0 0' }}>Goods will be shipped to the billing address.</p> : <textarea className="fi ta" data-f="shipping" rows={4} placeholder="Delivery address" value={f.shipping} onChange={set('shipping')}></textarea>}
                      <button type="button" className="aplink" id="apShipX" onClick={() => setShip(false)}>Remove shipping address</button>
                    </>
                  ) : (
                    <button type="button" className="aplink plus" id="apShip" onClick={() => setShip(true)}><Icon name="plus" />Add shipping address</button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="appane" hidden={curTab !== 'cred'}>
            <div className="apcred">
              <div>
                <b className="aph">Opening balance</b>
                <div className="two">
                  <label className="apf">Amount<span className={cur('₹') ? 'pre2' : 'pre2 ncur'}><span>{cur('₹')}</span><input className={`fi ${bad('ob')}`} data-f="ob" value={f.ob} onChange={set('ob')} inputMode="decimal" placeholder="0" /></span>{E('ob')}</label>
                  <label className="apf">As of date<input className="fi" type="date" data-f="obDate" value={f.obDate} onChange={set('obDate')} /></label>
                </div>
                <div className="rad" role="radiogroup" aria-label="Balance type">
                  <label className={type === 'receive' ? 'on' : ''}><input type="radio" name="obt" value="receive" checked={type === 'receive'} onChange={() => setType('receive')} /> To receive <small>They owe you</small></label>
                  <label className={type === 'pay' ? 'on' : ''}><input type="radio" name="obt" value="pay" checked={type === 'pay'} onChange={() => setType('pay')} /> To pay <small>You owe them</small></label>
                </div>
              </div>
              <div>
                <b className="aph">Credit limit</b>
                <div className="seg2" role="radiogroup" aria-label="Credit limit" style={{ marginBottom: 12 }}>
                  <button type="button" className={limit === 'none' ? 'on' : ''} data-lim="none" onClick={() => setLimit('none')}>No limit</button>
                  <button type="button" className={limit === 'custom' ? 'on' : ''} data-lim="custom" onClick={() => setLimit('custom')}>Custom limit</button>
                </div>
                {limit === 'custom' && (
                  <label className="apf">Limit amount<span className={cur('₹') ? 'pre2' : 'pre2 ncur'}><span>{cur('₹')}</span><input className={`fi ${bad('lim')}`} data-f="lim" value={f.lim} onChange={set('lim')} inputMode="decimal" placeholder="50,000" /></span>{E('lim')}<small className="aphint">We’ll warn you when a new invoice takes them over this limit.</small></label>
                )}
                <label className="apf">Credit period<span className="pre2 post"><input className="fi" data-f="days" value={f.days} onChange={set('days')} inputMode="numeric" maxLength={3} /><span>days</span></span><small className="aphint">Used to set invoice due dates and payment reminders.</small></label>
              </div>
            </div>
          </div>
          <div className="appane" hidden={curTab !== 'extra'}>
            <p className="aphint" style={{ margin: '0 0 12px' }}>Turn on the fields you want to record for this party. They can also be printed on invoices.</p>
            <div className="apx">
              {APF.map(([label, , t], i) => (
                <div className="apxr" key={label}>
                  <label className="cb2"><input type="checkbox" data-xon={i} checked={extra[i]!.on} onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} /> {label}</label>
                  <input className="fi" data-xv={i} type={t || undefined} value={extra[i]!.v} disabled={!extra[i]!.on} placeholder={label} onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="apft">
          <button className="btn" type="button" id="apSaveNew" disabled={busy} onClick={() => save(true)}>Save &amp; new</button>
          <button className="btn p" type="button" id="apSave" disabled={busy} onClick={() => save(false)}>Save</button>
        </div>
      </div>
    </div>
  );
}

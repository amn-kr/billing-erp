/**
 * Add item (#ai) — product or service. Same markup, checks and wording as the
 * prototype's renderAI / saveItem, plus (asked for by the owner):
 * - a Single / Variant switch next to Product / Service (always opens on Product, Single).
 *   Single: everything is in the item name, brand optional. Variant: a parent item
 *   (pick one or add one), a brand and a series that must be new for that parent and brand;
 * - "Assign code" fills the next free own code: the shop's prefix + 3–5 digits (JE001);
 * - a Select unit window: base unit, optional secondary unit and its conversion rate;
 * - adding a brand, category, unit or parent item opens a small popup.
 * Saves through POST /api/items.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { useCur, useSettings } from '../../lib/settings';
import { today } from '../../lib/time';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { qfmt } from './ItemsPage';

const GEAR = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';

interface Unit { code: string; name: string }
interface Rate { unit: string; secondaryUnit: string; rate: string }
interface Catalogue { units: Unit[]; categories: { name: string }[]; brands: { name: string }[]; groups: { name: string }[]; rates: Rate[] }
const F0 = { name: '', group: '', hsn: '', unit: 'PCS', sec: '', rate: '', cat: '', code: '', brand: '', series: '', sale: '', mrp: '', saleTax: 'With tax', disc: '', whole: '', wholeQty: '', purch: '', purchTax: 'With tax', gst: '18', oq: '', op: '', od: '', min: '', loc: '' };
type Form = typeof F0;
const num = (x: string) => Number(String(x).replace(/,/g, ''));
const vname = (g: string, b: string, s: string) => `${g} · ${b}${s ? ' ' + s : ''}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** 90.000 → 90, 2.500 → 2.5 */
const qty = (r: string) => String(Number(r));

type Pop = 'brand' | 'cat' | 'group' | 'unit' | null;
/** Select unit window: base, secondary ('' = None) and the chosen rate ('new' = typed in, else a saved rate). */
interface UnitWin { base: string; sec: string; pick: string; typed: string; err: string; addFor: 'base' | 'sec' }

export function AddItemDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string, svc: boolean, group?: string) => void }) {
  const cur = useCur();
  const settings = useSettings().data;
  const qc = useQueryClient();
  const { showToast } = useShell();
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Catalogue>('/catalogue'), enabled: open });
  const [svc, setSvc] = useState(false);
  const [vary, setVary] = useState(false);
  const [tab, setTab] = useState<'price' | 'stock'>('price');
  const [f, setF] = useState<Form>({ ...F0, od: today() });
  const [err, setErr] = useState<Record<string, string>>({});
  const [pop, setPop] = useState<Pop>(null);
  const [uw, setUw] = useState<UnitWin | null>(null);
  const [extraBrands, setExtraBrands] = useState<string[]>([]);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [extraUnits, setExtraUnits] = useState<Unit[]>([]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement & HTMLSelectElement>(null);
  // Escape closes the top-most window first
  const top = useRef({ pop, uw: !!uw });
  top.current = { pop, uw: !!uw };

  /** Fresh form. "Save & new" on a variant keeps the parent, brand and shared details. */
  const reset = (keep?: Partial<Form>) => {
    setTab('price'); setErr({}); setPop(null); setUw(null);
    setF({ ...F0, od: today(), ...keep });
  };
  useEffect(() => {
    if (!open) return;
    setSvc(false); setVary(false);
    reset();
    setTimeout(() => nameRef.current?.focus(), 0);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (top.current.pop) setPop(null);
      else if (top.current.uw) setUw(null);
      else onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const E = (k: string) => (err[k] ? <div className="aperr">{err[k]}</div> : null);
  const bad = (k: string) => (err[k] ? 'bad' : '');
  const units = [...(cat.data?.units ?? ['PCS', 'BOX', 'KG', 'MTR', 'COIL', 'BAG', 'LTR', 'NOS', 'SET', 'PAIR'].map((code) => ({ code, name: '' }))), ...extraUnits.filter((u) => !cat.data?.units.some((x) => x.code === u.code))];
  const uLabel = (code: string) => { const u = units.find((x) => x.code === code); return u?.name ? `${u.code} (${u.name})` : code; };
  const cats = [...(cat.data?.categories.map((c) => c.name) ?? []), ...extraCats.filter((c) => !cat.data?.categories.some((x) => x.name === c))];
  const brands = [...new Set([...(cat.data?.brands.map((b) => b.name) ?? []), ...extraBrands])].sort((a, b) => a.localeCompare(b));
  const groups = [...new Set([...(cat.data?.groups.map((g) => g.name) ?? []), ...extraGroups])].sort((a, b) => a.localeCompare(b));
  const gstList = (settings?.taxes ?? []).filter((t) => t.kind === 'GST');
  const pre = cur('₹') ? 'pre2' : 'pre2 ncur';
  const s = parseFloat(f.sale), p = parseFloat(f.purch);
  const gstSel = (
    <label className="apf needs-gst">GST rate<select className="fi" data-f="gst" value={f.gst} onChange={set('gst')}>
      {gstList.map((t) => <option key={t.id} value={String(Number(t.rate))}>{t.name}{t.isOld ? ' (older rate)' : ''}</option>)}
    </select></label>
  );

  /** Fills in the next free own code, e.g. JE001 (prefix from Settings › Items). */
  async function assignCode() {
    try {
      const r = await api<{ code: string }>('/items/next-code');
      setF((x) => ({ ...x, code: r.code }));
      setErr(({ code: _, ...x }) => x);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not get the next item code.');
    }
  }

  async function save(again: boolean) {
    const er: Record<string, string> = {};
    const series = f.series.trim(), code = f.code.trim();
    const name = vary ? vname(f.group, f.brand, series) : f.name.trim();
    if (vary) {
      if (!f.group) er.name = 'Choose the parent item.';
      if (!f.brand) er.brand = 'Choose a brand.';
      if (!series) er.series = 'Enter the series or size.';
    } else if (!name) er.name = svc ? 'Enter the service name.' : 'Enter the item name.';
    if (f.hsn && !/^\d{4,8}$/.test(f.hsn)) er.hsn = 'HSN/SAC is 4 to 8 digits.';
    if (f.sale && Number.isNaN(num(f.sale))) er.sale = 'Enter a number.';
    else if (f.mrp && num(f.sale) > num(f.mrp)) er.sale = `Sale price can’t be above MRP (${cur('₹')}${inr2f(num(f.mrp))}).`;
    if (f.purch && Number.isNaN(num(f.purch))) er.purch = 'Enter a number.';
    if (f.oq && Number.isNaN(num(f.oq))) er.oq = 'Enter a number.';
    setErr(er);
    if (Object.keys(er).length) {
      if (er.oq) setTab('stock');
      else if (er.sale || er.purch) setTab('price');
      return;
    }
    const body = {
      name, kind: svc ? 'service' : 'goods', code, hsn: f.hsn, unit: f.unit, secondaryUnit: f.sec, unitRate: f.sec ? f.rate : null, category: f.cat,
      brand: svc ? '' : f.brand, series: vary ? series : '', ...(vary ? { group: f.group } : {}),
      gstRate: Number(f.gst) || 0, sale: f.sale || null, mrp: f.mrp || null, purchase: svc ? null : f.purch || null, wholesale: svc ? null : f.whole || null,
      wholesaleMinQty: svc ? null : f.wholeQty || null, minStock: svc ? null : f.min || null, location: svc ? '' : f.loc,
      ...(!svc && f.oq && num(f.oq) ? { openingQty: f.oq, openingRate: f.op || f.purch || null, openingDate: f.od || today() } : {}),
    };
    setBusy(true);
    try {
      const it = await api<{ id: string; name: string; stock: string | null; unit: string }>('/items', { body });
      await qc.invalidateQueries({ queryKey: ['items'] });
      await qc.invalidateQueries({ queryKey: ['catalogue'] });
      showToast(`${it.name} added${it.stock && num(it.stock) ? ` with ${qfmt(it.stock)} ${it.unit} in stock` : ''}`);
      if (again) {
        reset(vary ? { group: f.group, brand: f.brand, hsn: f.hsn, unit: f.unit, sec: f.sec, rate: f.rate, cat: f.cat, gst: f.gst } : { unit: f.unit, gst: f.gst });
        nameRef.current?.focus();
      } else onSaved(it.id, svc, vary ? f.group : undefined);
    } catch (e) {
      if (e instanceof ApiError) setErr({ [/series/i.test(e.message) ? 'series' : /unit/i.test(e.message) ? 'unit' : /code/i.test(e.message) ? 'code' : 'name']: e.message });
      else showToast('Could not save the item.');
    } finally {
      setBusy(false);
    }
  }

  /** Create in a popup: brand / category / unit are saved at once; a new parent item is saved with its first variant. */
  async function create(kind: Exclude<Pop, null>, name: string, short = ''): Promise<string | void> {
    if (kind === 'group') {
      const n = name.replace(/\s+/g, ' ');
      const hit = groups.find((g) => same(g, n));
      if (!hit) setExtraGroups((x) => [...x, n]);
      setF((x) => ({ ...x, group: hit ?? n }));
      setErr(({ name: _, ...x }) => x);
      setPop(null);
      showToast(hit ? `“${hit}” is already a parent item — picked it` : `Parent item “${n}” will be added when you save`);
      return;
    }
    try {
      if (kind === 'unit') {
        const u = await api<Unit>('/catalogue/units', { body: { code: short, name } });
        setExtraUnits((x) => [...x, u]);
        setUw((w) => (w ? { ...w, [w.addFor]: u.code, ...(w.addFor === 'base' && w.sec === u.code ? { sec: '' } : {}), pick: 'new', err: '' } : w));
        showToast(`Unit “${u.code}” added`);
      } else {
        await api(kind === 'brand' ? '/catalogue/brands' : '/catalogue/categories', { body: { name } });
        if (kind === 'brand') { setExtraBrands((x) => [...x, name]); setF((x) => ({ ...x, brand: name })); setErr(({ brand: _, ...x }) => x); }
        else { setExtraCats((x) => [...x, name]); setF((x) => ({ ...x, cat: name })); }
        showToast(`${kind === 'brand' ? 'Brand' : 'Category'} “${name}” added`);
      }
      setPop(null);
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Could not add it.';
    }
  }

  const unitText = f.sec ? `${f.unit} · 1 ${f.unit} = ${qty(f.rate)} ${f.sec}` : uLabel(f.unit);
  const openUnits = () => setUw({ base: f.unit, sec: f.sec, pick: 'new', typed: f.sec ? qty(f.rate) : '', err: '', addFor: 'base' });
  const saved = uw && uw.sec ? (cat.data?.rates ?? []).filter((r) => r.unit === uw.base && r.secondaryUnit === uw.sec) : [];
  function saveUnits() {
    if (!uw) return;
    if (uw.sec && uw.sec === uw.base) return setUw({ ...uw, err: 'The secondary unit must be different from the base unit.' });
    const rate = uw.pick === 'new' ? uw.typed.trim() : uw.pick;
    if (uw.sec && !(num(rate) > 0)) return setUw({ ...uw, err: `Enter how many ${uw.sec} make 1 ${uw.base}.` });
    setF((x) => ({ ...x, unit: uw.base, sec: uw.sec, rate: uw.sec ? rate : '' }));
    setErr(({ unit: _, ...x }) => x);
    setUw(null);
  }

  return (
    <>
      <div className="ov c" id="ai" hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'ai') onClose(); }}>
        <div className="mdl apm" role="dialog" aria-modal="true" aria-labelledby="aiT">
          <div className="aphd">
            <h3 id="aiT" style={{ flex: 'none' }}>Add item</h3>
            <div className="aisw" id="aiTypeSw">
              <span className={svc ? '' : 'on'}>Product</span>
              <label className="tgs" style={{ margin: 0 }}><input type="checkbox" id="aiSvc" checked={svc} aria-label="Service item" onChange={(e) => { const v = e.target.checked; setSvc(v); if (v) { setVary(false); setTab('price'); } }} /><i></i></label>
              <span className={svc ? 'on' : ''}>Service</span>
            </div>
            {!svc && (
              <div className="aisw" id="aiVarSw">
                <span className={vary ? '' : 'on'}>Single</span>
                <label className="tgs" style={{ margin: 0 }}><input type="checkbox" id="aiVar" checked={vary} aria-label="Variant item" onChange={(e) => { setVary(e.target.checked); setErr({}); }} /><i></i></label>
                <span className={vary ? 'on' : ''}>Variant</span>
              </div>
            )}
            <span style={{ flex: 1 }}></span>
            <button className="ib" type="button" data-soon="Item settings" aria-label="Item settings" title="Item settings" onClick={() => showToast('Item settings screen is coming next')}><RawIcon d={GEAR} /></button>
            <button className="ib" type="button" id="aiClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button>
          </div>
          <div className="apbody" id="aiBody">
            <div className="aitop">
              <div className="aifields">
                {vary ? (
                  <label className="apf" style={{ gridColumn: 'span 2' }}>Parent item <span className="req">*</span><select className={`fi ${bad('name')}`} id="aiName" data-f="group" value={f.group} ref={nameRef} onChange={(e) => (e.target.value === '__new' ? setPop('group') : set('group')(e))}><option value="">Choose parent item</option>{groups.map((g) => <option key={g}>{g}</option>)}<option value="__new">+ Add new parent item</option></select>{E('name')}</label>
                ) : (
                  <label className="apf" style={{ gridColumn: 'span 2' }}>{svc ? 'Service name' : 'Item name'} <span className="req">*</span><input className={`fi ${bad('name')}`} id="aiName" data-f="name" value={f.name} onChange={set('name')} placeholder={svc ? 'e.g. Fan installation' : 'e.g. LED bulb 12W'} autoComplete="off" role="combobox" aria-autocomplete="list" aria-controls="aiSug" aria-expanded={false} ref={nameRef} />{E('name')}<div className="aisug" id="aiSug" hidden role="listbox"></div></label>
                )}
                <label className="apf needs-gst">{svc ? 'SAC' : 'HSN'} code<input className={`fi ${bad('hsn')}`} data-f="hsn" value={f.hsn} onChange={set('hsn')} placeholder={svc ? '995461' : '8536'} inputMode="numeric" maxLength={8} />{E('hsn')}</label>
                <label className="apf">Unit<button type="button" className={`fi ${bad('unit')}`} id="aiUnit" style={{ textAlign: 'left' }} onClick={openUnits}>{unitText}</button>{E('unit')}</label>
                <label className="apf">Category<select className="fi" data-f="cat" id="aiCat" value={f.cat} onChange={(e) => (e.target.value === '__new' ? setPop('cat') : set('cat')(e))}><option value="">No category</option>{cats.map((c) => <option key={c}>{c}</option>)}<option value="__new">+ Add category</option></select></label>
                <label className="apf">Item code<span className="aicode"><input className={`fi ${bad('code')}`} data-f="code" id="aiCode" value={f.code} onChange={set('code')} placeholder="Maker's code" autoComplete="off" /><button type="button" className="btn sm" id="aiGen" onClick={assignCode}>Assign code</button></span>{E('code')}</label>
                {!svc && <label className="apf">Brand{vary && <> <span className="req">*</span></>}<select className={`fi ${bad('brand')}`} data-f="brand" id="aiBrandSel" value={f.brand} onChange={(e) => (e.target.value === '__new' ? setPop('brand') : set('brand')(e))}><option value="">{vary ? 'Choose brand' : 'No brand'}</option>{brands.map((b) => <option key={b}>{b}</option>)}<option value="__new">+ Add new brand</option></select>{E('brand')}</label>}
                {vary && <label className="apf">Series / model <span className="req">*</span><input className={`fi ${bad('series')}`} data-f="series" id="aiSeries" value={f.series} onChange={set('series')} placeholder="A new series, e.g. Coral" autoComplete="off" />{E('series')}</label>}
              </div>
              <label className="aiimg" htmlFor="aiFile" title="Add item image"><Icon name="cam" /><span>Add image</span><small>JPG or PNG</small><input type="file" id="aiFile" accept="image/*" onChange={() => showToast('Item photos come with file storage')} /></label>
            </div>
            <div className="aptabs" role="tablist">
              <button type="button" className={tab === 'price' ? 'on' : ''} data-aitab="price" onClick={() => setTab('price')}>Pricing</button>
              {!svc && <button type="button" className={tab === 'stock' ? 'on' : ''} data-aitab="stock" onClick={() => setTab('stock')}>Stock</button>}
            </div>
            <div className="appane" hidden={tab !== 'price'}>
              <div className="aiprice">
                <div className="aibox">
                  <b className="aph">Sale price</b>
                  <div className="two">
                    <label className="apf">Sale price<span className={pre}><span>{cur('₹')}</span><input className={`fi ${bad('sale')}`} data-f="sale" id="aiSale" value={f.sale} onChange={set('sale')} inputMode="decimal" placeholder="0.00" /></span>{E('sale')}</label>
                    <label className="apf">MRP<span className={pre}><span>{cur('₹')}</span><input className="fi" data-f="mrp" id="aiMrp" value={f.mrp} onChange={set('mrp')} inputMode="decimal" placeholder="Optional" /></span></label>
                  </div>
                  <div className="two">
                    <label className="apf needs-gst">Price is<select className="fi" data-f="saleTax" value={f.saleTax} onChange={set('saleTax')}><option>With tax</option><option>Without tax</option></select></label>
                    <label className="apf">Discount on sale (%)<input className="fi" data-f="disc" value={f.disc} onChange={set('disc')} inputMode="decimal" placeholder="0" /></label>
                  </div>
                  {!svc && (
                    <div className="two">
                      <label className="apf">Wholesale price<span className={pre}><span>{cur('₹')}</span><input className="fi" data-f="whole" value={f.whole} onChange={set('whole')} inputMode="decimal" placeholder="Optional" /></span></label>
                      <label className="apf">Min. wholesale qty<input className="fi" data-f="wholeQty" value={f.wholeQty} onChange={set('wholeQty')} inputMode="numeric" placeholder="e.g. 10" /></label>
                    </div>
                  )}
                </div>
                <div className="aibox">
                  {!svc && (
                    <>
                      <b className="aph">Purchase price</b>
                      <div className="two">
                        <label className="apf">Purchase price<span className={pre}><span>{cur('₹')}</span><input className={`fi ${bad('purch')}`} data-f="purch" id="aiPurch" value={f.purch} onChange={set('purch')} inputMode="decimal" placeholder="0.00" /></span>{E('purch')}</label>
                        <label className="apf needs-gst">Price is<select className="fi" data-f="purchTax" value={f.purchTax} onChange={set('purchTax')}><option>With tax</option><option>Without tax</option></select></label>
                      </div>
                    </>
                  )}
                  <div className="needs-gst"><b className="aph" style={{ marginTop: svc ? 0 : 8 }}>Tax</b>{gstSel}</div>
                  <div className="aimargin" id="aiMargin">{s > 0 && p > 0 && <>Margin per unit: <b className={s - p >= 0 ? 'pos' : 'neg'}>{inr2f(s - p)}</b> ({Math.round(((s - p) / p) * 100)}%)</>}</div>
                </div>
              </div>
            </div>
            <div className="appane" hidden={tab !== 'stock'}>
              <div className="aiprice">
                <div className="aibox">
                  <b className="aph">Opening stock</b>
                  <div className="two">
                    <label className="apf">Opening quantity<input className={`fi ${bad('oq')}`} data-f="oq" value={f.oq} onChange={set('oq')} inputMode="decimal" placeholder="0" />{E('oq')}</label>
                    <label className="apf">At price / unit<span className={pre}><span>{cur('₹')}</span><input className="fi" data-f="op" value={f.op} onChange={set('op')} inputMode="decimal" placeholder="Purchase price" /></span></label>
                  </div>
                  <label className="apf">As of date<input className="fi" type="date" data-f="od" value={f.od} onChange={set('od')} /></label>
                </div>
                <div className="aibox">
                  <b className="aph">Stock alerts</b>
                  <label className="apf">Minimum stock to maintain<input className="fi" data-f="min" value={f.min} onChange={set('min')} inputMode="decimal" placeholder="e.g. 20" /><small className="aphint">You’ll see a low-stock alert when stock falls below this.</small></label>
                  <label className="apf">Location<input className="fi" data-f="loc" value={f.loc} onChange={set('loc')} placeholder="e.g. Rack A1 or Godown" autoComplete="off" /></label>
                </div>
              </div>
            </div>
          </div>
          <div className="apft">
            <button className="btn" type="button" id="aiSaveNew" disabled={busy} onClick={() => save(true)}>Save &amp; new</button>
            <button className="btn p" type="button" id="aiSave" disabled={busy} onClick={() => save(false)}>Save</button>
          </div>
        </div>
      </div>

      {/* Select unit: base unit, secondary unit and conversion rate */}
      <div className="ov c" id="aiUnits" hidden={!open || !uw} onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setUw(null); }}>
        {uw && (
          <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="aiUnitsT">
            <div className="dh" style={{ marginBottom: 14 }}><h3 id="aiUnitsT" style={{ margin: 0, fontSize: 18 }}>Select unit</h3><button className="ib" type="button" aria-label="Close" onClick={() => setUw(null)}><RawIcon d={X} /></button></div>
            <div className="two">
              <label className="fl" htmlFor="aiUBase">Base unit<select className="fi" id="aiUBase" value={uw.base} onChange={(e) => (e.target.value === '__new' ? (setUw({ ...uw, addFor: 'base' }), setPop('unit')) : setUw({ ...uw, base: e.target.value, sec: uw.sec === e.target.value ? '' : uw.sec, pick: 'new', err: '' }))}>
                {units.map((u) => <option key={u.code} value={u.code}>{uLabel(u.code)}</option>)}<option value="__new">+ Add new unit</option></select></label>
              <label className="fl" htmlFor="aiUSec">Secondary unit<select className="fi" id="aiUSec" value={uw.sec} onChange={(e) => (e.target.value === '__new' ? (setUw({ ...uw, addFor: 'sec' }), setPop('unit')) : setUw({ ...uw, sec: e.target.value, pick: 'new', err: '' }))}>
                <option value="">None</option>{units.filter((u) => u.code !== uw.base).map((u) => <option key={u.code} value={u.code}>{uLabel(u.code)}</option>)}<option value="__new">+ Add new unit</option></select></label>
            </div>
            {uw.sec && (
              <>
                <b className="aph">Conversion rates</b>
                <label className="cb2"><input type="radio" name="aiRate" checked={uw.pick === 'new'} onChange={() => setUw({ ...uw, pick: 'new', err: '' })} />1 {uw.base} =<input className="fi" id="aiURate" style={{ width: 90, height: 42, margin: 0 }} value={uw.typed} inputMode="decimal" placeholder="0" aria-label={`${uw.sec} in 1 ${uw.base}`} onFocus={() => setUw({ ...uw, pick: 'new' })} onChange={(e) => setUw({ ...uw, typed: e.target.value, pick: 'new', err: '' })} />{uw.sec}</label>
                {saved.map((r) => (
                  <label className="cb2" key={r.rate}><input type="radio" name="aiRate" checked={uw.pick === r.rate} onChange={() => setUw({ ...uw, pick: r.rate, err: '' })} />1 {uw.base} = {qty(r.rate)} {uw.sec}</label>
                ))}
              </>
            )}
            <div className="msg bad" role="alert" style={{ marginTop: 8 }}>{uw.err}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn p" type="button" id="aiUSave" onClick={saveUnits}>Save</button></div>
          </div>
        )}
      </div>

      <AddPopup kind="group" open={open && pop === 'group'} title="Add parent item" label="Parent item name" ph="e.g., Modular switch 6A" onClose={() => setPop(null)} onCreate={create} />
      <AddPopup kind="brand" open={open && pop === 'brand'} title="Add brand" label="Brand name" ph="e.g., Havells" onClose={() => setPop(null)} onCreate={create} />
      <AddPopup kind="cat" open={open && pop === 'cat'} title="Add category" label="Category name" ph="e.g., Grocery" onClose={() => setPop(null)} onCreate={create} />
      <AddPopup kind="unit" open={open && pop === 'unit'} title="Add unit" label="Unit name" ph="e.g., Coil" onClose={() => setPop(null)} onCreate={create} />
    </>
  );
}

/** Small "add new" popup in the middle of the screen: title, a name (and a short name for units), × and Create. */
function AddPopup({ kind, open, title, label, ph, onClose, onCreate }: {
  kind: Exclude<Pop, null>; open: boolean; title: string; label: string; ph: string; onClose: () => void;
  onCreate: (kind: Exclude<Pop, null>, name: string, short?: string) => Promise<string | void>;
}) {
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setName(''); setShort(''); setErr('');
    setTimeout(() => ref.current?.focus(), 0);
  }, [open]);
  const id = `aiAdd_${kind}`;
  async function go() {
    const n = name.trim(), c = short.trim().toUpperCase();
    if (!n) { setErr(`Enter the ${label.toLowerCase()}.`); return ref.current?.focus(); }
    if (kind === 'unit' && !/^[A-Z0-9]{1,20}$/.test(c)) return setErr('Enter a short name: letters or numbers only, e.g. COIL.');
    setBusy(true);
    const m = await onCreate(kind, n, c);
    setBusy(false);
    if (m) setErr(m);
  }
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && void go();
  return (
    <div className="ov c" id={id} hidden={!open} onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby={id + 'T'}>
        <div className="dh" style={{ marginBottom: 14 }}><h3 id={id + 'T'} style={{ margin: 0, fontSize: 18 }}>{title}</h3><button className="ib" type="button" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <label className="fl" htmlFor={id + 'N'}>{label}<input className="fi" id={id + 'N'} ref={ref} value={name} placeholder={ph} autoComplete="off" onChange={(e) => { setName(e.target.value); setErr(''); }} onKeyDown={enter} /></label>
        {kind === 'unit' && <label className="fl" htmlFor={id + 'S'}>Short name<input className="fi mono" id={id + 'S'} value={short} placeholder="e.g., COIL" maxLength={20} autoComplete="off" onChange={(e) => { setShort(e.target.value.toUpperCase()); setErr(''); }} onKeyDown={enter} /></label>}
        <div className="msg bad" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn p" type="button" id={id + 'Go'} disabled={busy} onClick={() => void go()}>Create</button></div>
      </div>
    </div>
  );
}

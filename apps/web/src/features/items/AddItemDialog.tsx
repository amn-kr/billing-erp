/**
 * Add item (#ai) — product, service, or an item that comes in several brands
 * or sizes (one row each). Same markup, checks and wording as the prototype's
 * renderAI / saveItem. Saves through POST /api/items.
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

interface Catalogue { units: { code: string }[]; categories: { name: string }[]; brands: { name: string }[] }
interface VRow { brand: string; series: string; code: string; mrp: string; purch: string; sale: string; qty: string }
const vrow = (): VRow => ({ brand: '', series: '', code: '', mrp: '', purch: '', sale: '', qty: '' });
const F0 = { name: '', hsn: '', unit: 'PCS', cat: '', code: '', brand: '', series: '', sale: '', mrp: '', saleTax: 'With tax', disc: '', whole: '', wholeQty: '', purch: '', purchTax: 'With tax', gst: '18', oq: '', op: '', od: '', min: '', loc: '' };
type Form = typeof F0;
const num = (x: string) => Number(String(x).replace(/,/g, ''));
const vname = (g: string, b: string, s: string) => `${g} · ${b}${s ? ' ' + s : ''}`;

export function AddItemDialog({ open, service, onClose, onSaved }: { open: boolean; service: boolean; onClose: () => void; onSaved: (id: string, svc: boolean) => void }) {
  const cur = useCur();
  const settings = useSettings().data;
  const qc = useQueryClient();
  const { showToast } = useShell();
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<Catalogue>('/catalogue'), enabled: open });
  const [svc, setSvc] = useState(service);
  const [vary, setVary] = useState(false);
  const [tab, setTab] = useState<'price' | 'stock'>('price');
  const [f, setF] = useState<Form>({ ...F0, od: today() });
  const [rows, setRows] = useState<VRow[]>([vrow(), vrow()]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [newBrand, setNewBrand] = useState<string | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [extraBrands, setExtraBrands] = useState<string[]>([]);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = (s = service) => {
    setSvc(s); setVary(false); setTab('price'); setErr({}); setRows([vrow(), vrow()]); setNewBrand(null); setNewCat(null);
    setF({ ...F0, od: today(), unit: s ? 'NOS' : 'PCS', cat: s ? 'Services' : '' });
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

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const E = (k: string) => (err[k] ? <div className="aperr">{err[k]}</div> : null);
  const bad = (k: string) => (err[k] ? 'bad' : '');
  const units = cat.data?.units.map((u) => u.code) ?? ['PCS', 'BOX', 'KG', 'MTR', 'COIL', 'BAG', 'LTR', 'NOS', 'SET', 'PAIR'];
  const cats = [...(cat.data?.categories.map((c) => c.name) ?? []), ...extraCats.filter((c) => !cat.data?.categories.some((x) => x.name === c))];
  const brands = [...new Set([...(cat.data?.brands.map((b) => b.name) ?? []), ...extraBrands])].sort((a, b) => a.localeCompare(b));
  const gstList = (settings?.taxes ?? []).filter((t) => t.kind === 'GST');
  const mrpOn = !!settings?.data?.mrp;
  const pre = cur('₹') ? 'pre2' : 'pre2 ncur';
  const s = parseFloat(f.sale), p = parseFloat(f.purch);
  const gstSel = (
    <label className="apf needs-gst">GST rate<select className="fi" data-f="gst" value={f.gst} onChange={set('gst')}>
      {gstList.map((t) => <option key={t.id} value={String(Number(t.rate))}>{t.name}{t.isOld ? ' (older rate)' : ''}</option>)}
    </select></label>
  );
  const brandOpts = (
    <>
      <option value="">{vary ? 'Choose brand' : 'No brand'}</option>
      {brands.map((b) => <option key={b}>{b}</option>)}
      <option value="__new">+ Add new brand</option>
    </>
  );

  async function save(again: boolean) {
    const er: Record<string, string> = {};
    const name = f.name.trim();
    if (!name) er.name = vary ? 'Enter the item group name.' : 'Enter the item name.';
    if (f.hsn && !/^\d{4,8}$/.test(f.hsn)) er.hsn = 'HSN/SAC is 4 to 8 digits.';
    let bodies: Record<string, unknown>[] = [];
    if (vary) {
      const used = rows.filter((r) => r.brand || r.series || r.sale);
      const codes = new Set<string>();
      if (!used.length) er.vrows = 'Add at least one brand or size.';
      used.forEach((r, k) => {
        if (er.vrows) return;
        if (!r.brand) er.vrows = `Row ${k + 1}: choose a brand.`;
        else if (!(num(r.sale) > 0)) er.vrows = `Row ${k + 1}: enter the sale price.`;
        else if (num(r.mrp) && num(r.sale) > num(r.mrp)) er.vrows = `Row ${k + 1}: sale price is above MRP.`;
        else if (r.code && codes.has(r.code.toLowerCase())) er.vrows = `Row ${k + 1}: item code ${r.code} is already used.`;
        else if (used.some((x, j) => j < k && x.brand.toLowerCase() === r.brand.toLowerCase() && x.series.trim().toLowerCase() === r.series.trim().toLowerCase())) er.vrows = `Row ${k + 1}: ${r.brand} ${r.series} is entered twice.`;
        if (r.code) codes.add(r.code.toLowerCase());
      });
      bodies = used.map((r) => ({
        name: vname(name, r.brand, r.series.trim()), kind: 'goods', group: name, brand: r.brand, series: r.series.trim(), code: r.code.trim(), hsn: f.hsn, unit: f.unit, category: f.cat,
        gstRate: Number(f.gst) || 0, sale: r.sale, mrp: r.mrp || null, purchase: r.purch || null, minStock: f.min || null, location: f.loc, openingQty: r.qty || null, openingRate: r.purch || null, openingDate: today(),
      }));
    } else {
      if (f.sale && Number.isNaN(num(f.sale))) er.sale = 'Enter a number.';
      else if (f.mrp && num(f.sale) > num(f.mrp)) er.sale = `Sale price can’t be above MRP (${cur('₹')}${inr2f(num(f.mrp))}).`;
      if (f.purch && Number.isNaN(num(f.purch))) er.purch = 'Enter a number.';
      if (f.oq && Number.isNaN(num(f.oq))) er.oq = 'Enter a number.';
      bodies = [{
        name, kind: svc ? 'service' : 'goods', code: f.code.trim(), hsn: f.hsn, unit: f.unit, category: f.cat, brand: svc ? '' : f.brand, series: svc ? '' : f.series.trim(),
        gstRate: Number(f.gst) || 0, sale: f.sale || null, mrp: f.mrp || null, purchase: svc ? null : f.purch || null, wholesale: svc ? null : f.whole || null,
        wholesaleMinQty: svc ? null : f.wholeQty || null, minStock: svc ? null : f.min || null, location: svc ? '' : f.loc,
        ...(!svc && f.oq && num(f.oq) ? { openingQty: f.oq, openingRate: f.op || f.purch || null, openingDate: f.od || today() } : {}),
      }];
    }
    setErr(er);
    if (Object.keys(er).length) {
      if (er.oq) setTab('stock');
      else if (er.sale || er.purch) setTab('price');
      return;
    }
    setBusy(true);
    try {
      const made: { id: string; name: string; stock: string | null; unit: string }[] = [];
      for (const b of bodies) made.push(await api('/items', { body: b }));
      await qc.invalidateQueries({ queryKey: ['items'] });
      await qc.invalidateQueries({ queryKey: ['catalogue'] });
      const it = made[0]!;
      showToast(made.length > 1 ? `${name} added with ${made.length} brands / sizes` : `${it.name} added${it.stock && num(it.stock) ? ` with ${qfmt(it.stock)} ${it.unit} in stock` : ''}`);
      if (again) {
        reset(svc);
        nameRef.current?.focus();
      } else onSaved(vary ? 'g:' + name : it.id, svc);
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message.includes('code') && !vary ? { code: e.message } : vary ? { vrows: e.message } : { name: e.message });
      else showToast('Could not save the item.');
    } finally {
      setBusy(false);
    }
  }

  async function addBrand() {
    const n = (newBrand ?? '').trim();
    if (!n) return;
    try {
      await api('/catalogue/brands', { body: { name: n } });
      setExtraBrands((x) => [...x, n]);
      setF((x) => ({ ...x, brand: n }));
      setNewBrand(null);
      showToast(`Brand “${n}” added`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not add the brand.');
    }
  }
  async function addCat() {
    const n = (newCat ?? '').trim();
    if (!n) return;
    try {
      await api('/catalogue/categories', { body: { name: n } });
      setExtraCats((x) => [...x, n]);
      setF((x) => ({ ...x, cat: n }));
      setNewCat(null);
      showToast(`Category “${n}” added`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not add the category.');
    }
  }
  const setRow = (k: number, key: keyof VRow, v: string) => setRows((r) => r.map((x, j) => (j === k ? { ...x, [key]: v } : x)));

  return (
    <div className="ov c" id="ai" hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'ai') onClose(); }}>
      <div className="mdl apm" role="dialog" aria-modal="true" aria-labelledby="aiT">
        <div className="aphd">
          <h3 id="aiT" style={{ flex: 'none' }}>Add item</h3>
          <div className="aisw" id="aiTypeSw">
            <span className={svc ? '' : 'on'}>Product</span>
            <label className="tgs" style={{ margin: 0 }}><input type="checkbox" id="aiSvc" checked={svc} aria-label="Service item" onChange={(e) => { const v = e.target.checked; setSvc(v); if (v) { setVary(false); setTab('price'); } }} /><i></i></label>
            <span className={svc ? 'on' : ''}>Service</span>
          </div>
          <span style={{ flex: 1 }}></span>
          <button className="ib" type="button" data-soon="Item settings" aria-label="Item settings" title="Item settings" onClick={() => showToast('Item settings screen is coming next')}><RawIcon d={GEAR} /></button>
          <button className="ib" type="button" id="aiClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button>
        </div>
        <div className="apnewg" id="aiNewBrand" hidden={newBrand === null}>
          <input className="fi" id="aiNewBrandName" placeholder="New brand name, e.g. Havells" autoComplete="off" value={newBrand ?? ''} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBrand()} />
          <button className="btn p" type="button" id="aiNewBrandAdd" onClick={addBrand}>Add brand</button>
          <button className="btn" type="button" id="aiNewBrandCancel" onClick={() => setNewBrand(null)}>Cancel</button>
        </div>
        <div className="apnewg" id="aiNewCat" hidden={newCat === null}>
          <input className="fi" id="aiNewCatName" placeholder="New category name" autoComplete="off" value={newCat ?? ''} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCat()} />
          <button className="btn p" type="button" id="aiNewCatAdd" onClick={addCat}>Add category</button>
          <button className="btn" type="button" id="aiNewCatCancel" onClick={() => setNewCat(null)}>Cancel</button>
        </div>
        <div className="apbody" id="aiBody">
          <div className="aitop">
            <div className="aifields">
              <label className="apf" style={{ gridColumn: 'span 2' }}>{vary ? 'Item group name' : svc ? 'Service name' : 'Item name'} <span className="req">*</span><input className={`fi ${bad('name')}`} id="aiName" data-f="name" value={f.name} onChange={set('name')} placeholder={vary ? 'e.g. Modular switch 6A' : svc ? 'e.g. Fan installation' : 'e.g. LED bulb 12W'} autoComplete="off" role="combobox" aria-autocomplete="list" aria-controls="aiSug" aria-expanded={false} ref={nameRef} />{E('name')}<div className="aisug" id="aiSug" hidden role="listbox"></div></label>
              <label className="apf needs-gst">{svc ? 'SAC' : 'HSN'} code<input className={`fi ${bad('hsn')}`} data-f="hsn" value={f.hsn} onChange={set('hsn')} placeholder={svc ? '995461' : '8536'} inputMode="numeric" maxLength={8} />{E('hsn')}</label>
              <label className="apf">Unit<select className="fi" data-f="unit" id="aiUnit" value={f.unit} onChange={set('unit')}>{units.map((u) => <option key={u}>{u}</option>)}</select></label>
              <label className="apf">Category<select className="fi" data-f="cat" id="aiCat" value={f.cat} onChange={(e) => (e.target.value === '__new' ? setNewCat('') : set('cat')(e))}><option value="">No category</option>{cats.map((c) => <option key={c}>{c}</option>)}<option value="__new">+ Add category</option></select></label>
              {!vary && <label className="apf">Item code<span className="aicode"><input className="fi" data-f="code" id="aiCode" value={f.code} onChange={set('code')} placeholder="Barcode or SKU" autoComplete="off" /><button type="button" className="btn sm" id="aiGen" onClick={() => setF((x) => ({ ...x, code: String(Math.floor(1e11 + Math.random() * 9e11)) }))}>Assign code</button></span>{E('code')}</label>}
              {!svc && !vary && (
                <>
                  <label className="apf">Brand<select className="fi" data-f="brand" id="aiBrandSel" value={f.brand} onChange={(e) => (e.target.value === '__new' ? setNewBrand('') : set('brand')(e))}>{brandOpts}</select></label>
                  <label className="apf">Series / model<input className="fi" data-f="series" value={f.series} onChange={set('series')} placeholder="e.g. Coral" autoComplete="off" /></label>
                </>
              )}
            </div>
            <label className="aiimg" htmlFor="aiFile" title="Add item image"><Icon name="cam" /><span>Add image</span><small>JPG or PNG</small><input type="file" id="aiFile" accept="image/*" onChange={() => showToast('Item photos come with file storage')} /></label>
          </div>
          {!svc && (
            <label className="aivar"><input type="checkbox" id="aiVar" checked={vary} onChange={(e) => { setVary(e.target.checked); if (e.target.checked) setRows([{ ...vrow(), brand: f.brand, mrp: f.mrp, purch: f.purch, sale: f.sale, qty: f.oq }, vrow()]); }} /><span><b>This item comes in different brands or sizes</b><small>Add each brand or size once, with its own price, code and stock.</small></span></label>
          )}
          {vary ? (
            <div className="vgrid">
              <div className="tw stk" style={{ margin: 0 }}>
                <table className="ptt2 vgt">
                  <thead><tr><th>Brand *</th><th>Series / size</th><th>Item code</th>{mrpOn && <th className="n">MRP</th>}<th className="n">Purchase</th><th className="n">Sale *</th><th className="n">Opening qty</th><th></th></tr></thead>
                  <tbody>
                    {rows.map((r, k) => (
                      <tr key={k}>
                        <td><select className="fi sm" data-vr={k} data-k="brand" value={r.brand} onChange={(e) => (e.target.value === '__new' ? setNewBrand('') : setRow(k, 'brand', e.target.value))}>{brandOpts}</select></td>
                        <td><input className="fi sm" data-vr={k} data-k="series" value={r.series} onChange={(e) => setRow(k, 'series', e.target.value)} placeholder="e.g. Coral / 1.5 sq mm" /></td>
                        <td><input className="fi sm" data-vr={k} data-k="code" value={r.code} onChange={(e) => setRow(k, 'code', e.target.value)} placeholder="Code" /></td>
                        {((mrpOn ? ['mrp', 'purch', 'sale', 'qty'] : ['purch', 'sale', 'qty']) as Array<'mrp' | 'purch' | 'sale' | 'qty'>).map((key) => (
                          <td key={key}><input className="fi sm n" data-vr={k} data-k={key} value={r[key]} onChange={(e) => setRow(k, key, e.target.value)} inputMode="decimal" placeholder="0" /></td>
                        ))}
                        <td><button type="button" className="ix" data-vdel={k} aria-label="Remove row" disabled={rows.length < 2} onClick={() => setRows((x) => x.filter((_, j) => j !== k))}><Icon name="x" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}><button type="button" className="btn sm" id="aiVAdd" onClick={() => setRows((x) => [...x, vrow()])}><Icon name="plus" />Add brand / size</button>{E('vrows')}</div>
              <div className="vfoot">
                {gstSel}
                <label className="apf">Min. stock (each)<input className="fi" data-f="min" value={f.min} onChange={set('min')} inputMode="decimal" placeholder="e.g. 20" /></label>
                <label className="apf">Location<input className="fi" data-f="loc" value={f.loc} onChange={set('loc')} placeholder="e.g. Rack B1" autoComplete="off" /></label>
                <label className="apf">Prices are<select className="fi" data-f="saleTax" value={f.saleTax} onChange={set('saleTax')}><option>With tax</option><option>Without tax</option></select></label>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
        <div className="apft">
          <button className="btn" type="button" id="aiSaveNew" disabled={busy} onClick={() => save(true)}>Save &amp; new</button>
          <button className="btn p" type="button" id="aiSave" disabled={busy} onClick={() => save(false)}>Save</button>
        </div>
      </div>
    </div>
  );
}

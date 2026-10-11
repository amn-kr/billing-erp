/**
 * Items › Brands & Series (#vBrands): view and add brands and their series, in two tabs.
 * Not in the prototype — built only from its classes (pthd, seg2, ptxc, ptt2, ctxm, ov/mdl).
 * Nothing is deleted: brands and series are made inactive.
 */
import { useEffect, useRef, useState, type FormEvent, type MouseEvent as RMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIst } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { go } from '../../lib/go';
import { dmy, inr2f } from '../../lib/format';
import { useEscape } from '../../lib/useEscape';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { qfmt } from './ItemsPage';

export interface Brand { id: string; name: string; notes: string; series: number; items: number; stock: string; value: string; active: boolean; updatedAt: string }
/** id is null for a series so far typed only on items (it is saved here the first time it is changed) */
export interface Series { id: string | null; brandId: string; brand: string; name: string; size: string; notes: string; items: number; stock: string; value: string; active: boolean; updatedAt: string }

type Dlg =
  | { k: 'addBrand' }
  | { k: 'renameBrand'; b: Brand }
  | { k: 'addSeries'; brandId: string }
  | { k: 'renameSeries'; s: Series }
  | { k: 'moveSeries'; s: Series };
type Menu = { k: 'b'; b: Brand; x: number; y: number } | { k: 's'; s: Series; x: number; y: number };

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const DOTS = '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const updated = (iso: string) => dmy(todayIst(new Date(iso)));
const status = (on: boolean) => <span className={`stt ${on ? 'g' : 'x'}`}>{on ? 'Active' : 'Inactive'}</span>;

/** Change a series: by its id, or (typed only on items) by its brand and name. */
export const patchSeries = (s: Series, body: Record<string, unknown>) =>
  s.id ? api(`/brand-series/${s.id}`, { method: 'PATCH', body }) : api('/brand-series', { method: 'PATCH', body: { ...body, from: { brandId: s.brandId, name: s.name } } });

export function BrandsPage() {
  useFitTables();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'series' ? 's' : 'b';
  const brandF = params.get('brand') ?? 'all';
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<Brand[]>('/brands') });
  const series = useQuery({ queryKey: ['brand-series'], queryFn: () => api<Series[]>('/brand-series') });
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);

  const show = (t: 'b' | 's', brand = 'all') => { setQ(''); setParams(t === 's' ? { tab: 'series', ...(brand !== 'all' && { brand }) } : {}, { replace: true }); };
  const refresh = () => Promise.all(['brands', 'brand-series', 'items', 'item', 'catalogue'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  async function act(p: Promise<unknown>, done: string) {
    try { await p; await refresh(); showToast(done); } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not save the change.'); }
  }
  const openMenu = (m: { k: 'b'; b: Brand } | { k: 's'; s: Series }) => (e: RMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ ...m, x: r.right - 220, y: r.bottom + 4 } as Menu);
  };

  if (!brands.data || !series.data) return <section id="vBrands"></section>;
  const B = brands.data, S = series.data;
  const s = q.trim().toLowerCase();
  const LB = B.filter((b) => !s || b.name.toLowerCase().includes(s) || b.notes.toLowerCase().includes(s));
  const LS = S.filter((x) => (brandF === 'all' || x.brandId === brandF) && (!s || x.name.toLowerCase().includes(s) || x.brand.toLowerCase().includes(s) || x.size.toLowerCase().includes(s)));
  const fb = B.find((b) => b.id === brandF);

  return (
    <section id="vBrands" onClick={() => setMenu(null)}>
      <button className="lnk" id="bsBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/items')}>← Products</button>
      <div className="pthd">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Brands &amp; Series</h1>
        <div className="pttot" id="bsTot"><span>{plural(B.length, 'brand')}</span><span>{S.length} series</span></div>
        <div className="sp"></div>
        {tab === 'b'
          ? <button className="btn p" id="bsAddBrand" onClick={() => setDlg({ k: 'addBrand' })}><Icon name="plus" />Add brand</button>
          : <button className="btn p" id="bsAddSeries" onClick={() => (B.some((b) => b.active) ? setDlg({ k: 'addSeries', brandId: fb?.active ? fb.id : '' }) : showToast('Add a brand first, then its series'))}><Icon name="plus" />Add series</button>}
      </div>
      <div className="seg2" role="tablist" id="bsTabs" style={{ margin: '0 0 14px' }}>
        <button role="tab" aria-selected={tab === 'b'} className={tab === 'b' ? 'on' : ''} data-bst="brands" onClick={() => show('b')}>Brands<span>{B.length}</span></button>
        <button role="tab" aria-selected={tab === 's'} className={tab === 's' ? 'on' : ''} data-bst="series" onClick={() => show('s', brandF)}>Series<span>{S.length}</span></button>
      </div>

      <div className="card ptxc" role="tabpanel">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}>
          <label className="search" htmlFor="bsQ" style={{ height: 34 }}><RawIcon d={SEARCH} /><input id="bsQ" placeholder={tab === 'b' ? 'Search brands' : 'Search series, brand or size'} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {tab === 's' && (
            <select className="fi" id="bsBrand" aria-label="Filter by brand" value={brandF} onChange={(e) => show('s', e.target.value)}>
              <option value="all">All brands</option>
              {B.map((b) => <option value={b.id} key={b.id}>{b.name}{b.active ? '' : ' (inactive)'}</option>)}
            </select>
          )}
        </div>
        <div className="tw" style={{ margin: 0 }}>
          {tab === 'b' ? (
            <table className="ptt2">
              <thead><tr><th>Brand</th><th className="n">Series</th><th className="n">Items</th><th className="n">Total stock</th><th className="n">Stock value</th><th>Last updated</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
              <tbody id="bsRows">
                {LB.length ? LB.map((b) => (
                  <tr key={b.id} tabIndex={0} data-bid={b.id} style={{ cursor: 'pointer' }} title={`Show ${b.name} series`} onClick={() => show('s', b.id)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && show('s', b.id)}>
                    <td><b style={{ fontWeight: 600 }}>{b.name}</b>{b.notes && <><br /><small style={{ color: 'var(--t2)' }}>{b.notes}</small></>}</td>
                    <td className="n">{b.series}</td><td className="n">{b.items}</td><td className="n">{qfmt(b.stock)}</td><td className="n">{inr2f(b.value)}</td>
                    <td>{updated(b.updatedAt)}</td><td>{status(b.active)}</td>
                    <td className="n"><button className="ixs" data-bmenu={b.id} aria-label={`Actions for ${b.name}`} title="Actions" aria-haspopup="menu" onClick={openMenu({ k: 'b', b })}><RawIcon d={DOTS} /></button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="ptempty" id="bsEmpty">{B.length ? 'No brands match.' : <>No brands yet. Add your first brand, e.g. Havells, to keep its series and items together.<br /><button className="lnk" onClick={() => setDlg({ k: 'addBrand' })}>+ Add brand</button></>}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="ptt2">
              <thead><tr><th>Series</th><th>Brand</th><th>Size / variant</th><th className="n">Items</th><th className="n">Total stock</th><th className="n">Stock value</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
              <tbody id="bsRows">
                {LS.length ? LS.map((x) => (
                  <tr key={x.id ?? x.brandId + x.name} data-sid={x.id ?? ''}>
                    <td><b style={{ fontWeight: 600 }}>{x.name}</b>{x.notes && <><br /><small style={{ color: 'var(--t2)' }}>{x.notes}</small></>}</td>
                    <td>{x.brand}</td><td>{x.size || <span style={{ color: 'var(--t2)' }}>—</span>}</td>
                    <td className="n">{x.items}</td><td className="n">{qfmt(x.stock)}</td><td className="n">{inr2f(x.value)}</td><td>{status(x.active)}</td>
                    <td className="n"><button className="ixs" data-smenu={x.brand + ' ' + x.name} aria-label={`Actions for ${x.brand} ${x.name}`} title="Actions" aria-haspopup="menu" onClick={openMenu({ k: 's', s: x })}><RawIcon d={DOTS} /></button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="ptempty" id="bsEmpty">
                    {!B.length ? 'Add a brand first, then its series.'
                      : S.length && (s || brandF === 'all') ? 'No series match.'
                        : <>{fb ? `${fb.name} has no series yet.` : 'No series yet.'} A series is a brand’s range, e.g. Havells Coral.<br /><button className="lnk" onClick={() => setDlg({ k: 'addSeries', brandId: fb?.active ? fb.id : '' })}>+ Add series</button></>}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="ctxm" id="bsMenu" role="menu" hidden={!menu} style={menu ? { left: Math.max(8, menu.x), top: menu.y } : undefined} onClick={(e) => e.stopPropagation()}>
        {menu?.k === 'b' && (() => {
          const b = menu.b;
          return <>
            <div className="cmh"><b>{b.name}</b> · {plural(b.items, 'item')}</div>
            <button role="menuitem" data-bma="rename" onClick={() => { setMenu(null); setDlg({ k: 'renameBrand', b }); }}>Rename</button>
            <button role="menuitem" data-bma="series" onClick={() => { setMenu(null); show('s', b.id); }}>View series</button>
            <button role="menuitem" data-bma="active" onClick={() => { setMenu(null); void act(api(`/brands/${b.id}`, { method: 'PATCH', body: { active: !b.active } }), b.active ? `${b.name} is now inactive — its items keep working` : `${b.name} is active again`); }}>{b.active ? 'Make inactive' : 'Make active'}</button>
            <hr />
            <button role="menuitem" className="dz" data-bma="delete" onClick={() => { setMenu(null); showToast(b.items ? `${b.name} is used by ${plural(b.items, 'item')}, so it can’t be deleted. Make it inactive instead.` : 'Brands are never deleted. Make it inactive instead.'); }}>Delete</button>
          </>;
        })()}
        {menu?.k === 's' && (() => {
          const x = menu.s;
          return <>
            <div className="cmh"><b>{x.brand} {x.name}</b> · {plural(x.items, 'item')}</div>
            <button role="menuitem" data-sma="rename" onClick={() => { setMenu(null); setDlg({ k: 'renameSeries', s: x }); }}>Rename</button>
            <button role="menuitem" data-sma="brand" onClick={() => { setMenu(null); setDlg({ k: 'moveSeries', s: x }); }}>Change brand</button>
            <button role="menuitem" data-sma="active" onClick={() => { setMenu(null); void act(patchSeries(x, { active: !x.active }), x.active ? `${x.brand} ${x.name} is now inactive` : `${x.brand} ${x.name} is active again`); }}>{x.active ? 'Make inactive' : 'Make active'}</button>
          </>;
        })()}
      </div>

      <BrandDialog dlg={dlg} brands={B} onClose={() => setDlg(null)} onSaved={async (t, focus) => { setDlg(null); await refresh(); showToast(t); if (focus) show('s', focus); }} />
    </section>
  );
}

/** Add brand, Rename brand, Add series, Rename series and Change brand (one small window, #bsm). */
function BrandDialog({ dlg, brands, onClose, onSaved }: { dlg: Dlg | null; brands: Brand[]; onClose: () => void; onSaved: (toast: string, showBrand?: string) => void }) {
  const [f, setF] = useState({ name: '', notes: '', size: '', brandId: '' });
  const [err, setErr] = useState('');
  const first = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEscape(!!dlg, onClose);
  useEffect(() => {
    if (!dlg) return;
    const b = dlg.k === 'renameBrand' ? dlg.b : null, s = dlg.k === 'renameSeries' || dlg.k === 'moveSeries' ? dlg.s : null;
    setF({ name: b?.name ?? s?.name ?? '', notes: b?.notes ?? s?.notes ?? '', size: s?.size ?? '', brandId: dlg.k === 'addSeries' ? dlg.brandId : dlg.k === 'moveSeries' ? '' : s?.brandId ?? '' });
    setErr('');
    setTimeout(() => first.current?.focus(), 0);
  }, [dlg]);
  if (!dlg) return <div className="ov c" id="bsm" hidden></div>;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const d = dlg, k = d.k;
  const rb = d.k === 'renameBrand' ? d.b : null;
  const title = { addBrand: 'Add brand', renameBrand: 'Rename brand', addSeries: 'Add series', renameSeries: 'Rename series', moveSeries: 'Change brand' }[k];
  const s = d.k === 'renameSeries' || d.k === 'moveSeries' ? d.s : null;
  const choices = brands.filter((b) => b.active && b.id !== (k === 'moveSeries' ? s!.brandId : ''));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = f.name.trim();
    if ((k === 'addSeries' || k === 'moveSeries') && !f.brandId) { setErr('Choose a brand.'); return first.current?.focus(); }
    if (k !== 'moveSeries' && !name) { setErr(k.includes('Brand') ? 'Enter the brand name.' : 'Enter the series name.'); return; }
    try {
      if (k === 'addBrand') { await api('/brands', { body: { name, notes: f.notes } }); return onSaved(`${name} added`); }
      if (rb) { await api(`/brands/${rb.id}`, { method: 'PATCH', body: { name, notes: f.notes } }); return onSaved(name === rb.name ? `${name} saved` : `${rb.name} renamed to ${name}`); }
      const to = brands.find((b) => b.id === f.brandId)?.name ?? '';
      if (k === 'addSeries') { await api('/brand-series', { body: { brandId: f.brandId, name, size: f.size, notes: f.notes } }); return onSaved(`${to} ${name} added`, f.brandId); }
      if (k === 'renameSeries') { await patchSeries(s!, { name, size: f.size, notes: f.notes }); return onSaved(name === s!.name ? `${s!.brand} ${name} saved` : `${s!.brand} ${s!.name} renamed to ${name}`); }
      await patchSeries(s!, { brandId: f.brandId });
      return onSaved(`${s!.name} moved to ${to}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save.');
    }
  }

  const items = s && s.items ? plural(s.items, 'item') : '';
  return (
    <div className="ov c" id="bsm" onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'bsm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bsT">
        <h3 id="bsT" style={{ margin: '0 0 14px', fontSize: 18 }}>{title}</h3>
        <form id="bsForm" noValidate onSubmit={submit}>
          {(k === 'addSeries' || k === 'moveSeries') && (
            <label className="fl" htmlFor="bsfBrand">{k === 'moveSeries' ? `Move ${s!.brand} ${s!.name} to` : 'Brand'}
              <select className="fi" id="bsfBrand" value={f.brandId} onChange={set('brandId')} ref={first}>
                <option value="">Choose a brand</option>
                {choices.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          {k !== 'moveSeries' && (
            <label className="fl" htmlFor="bsfName">{k.includes('Brand') ? 'Brand name' : 'Series name'}
              <input className="fi" id="bsfName" autoComplete="off" placeholder={k.includes('Brand') ? 'e.g. Havells' : 'e.g. Coral'} value={f.name} onChange={set('name')} ref={k === 'addSeries' ? undefined : first} />
            </label>
          )}
          {(k === 'addSeries' || k === 'renameSeries') && (
            <label className="fl" htmlFor="bsfSize">Size or variant (optional)<input className="fi" id="bsfSize" autoComplete="off" placeholder="e.g. 6A, 1.5 sq mm, White" value={f.size} onChange={set('size')} /></label>
          )}
          {k !== 'moveSeries' && (
            <label className="fl" htmlFor="bsfNotes">Notes (optional)<input className="fi" id="bsfNotes" autoComplete="off" value={f.notes} onChange={set('notes')} /></label>
          )}
          {items && k === 'renameSeries' && <div className="hint" style={{ margin: '-2px 0 8px' }}>The {items} in this series {s!.items === 1 ? 'moves' : 'move'} to the new name too.</div>}
          {k === 'moveSeries' && <div className="hint" style={{ margin: '-2px 0 8px' }}>{items ? `The ${items} in this series ${s!.items === 1 ? 'moves' : 'move'} to the new brand too.` : 'No items use this series yet.'}</div>}
          {rb && rb.items > 0 && <div className="hint" style={{ margin: '-2px 0 8px' }}>Its {plural(rb.items, 'item')} {rb.items === 1 ? 'keeps' : 'keep'} this brand under the new name.</div>}
          <div className="msg bad" id="bsErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" type="button" id="bsCancel" onClick={onClose}>Cancel</button>
            <button className="btn p" type="submit">{k.startsWith('add') ? title : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

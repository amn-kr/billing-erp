/** Quotation page windows: Saved quotations (#qlm), Convert to sale invoice (#qcm), Add range / row / item (#qam). */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { qSerName, type QuoteRow, type QuoteSeries } from '@billing/shared';
import { RawIcon } from '../../components/Icon';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';
import { dmy, inr2f } from '../../lib/format';
import { useEscape } from '../../lib/useEscape';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { qfmt } from '../items/ItemsPage';
import type { SaleRow } from '../sales/model';
import type { QTotal } from './model';

const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const QL_ACT: RowAction[] = [['edit', 'Edit'], ['open', 'Open'], ['conv', 'Convert to invoice']];

/** a button that asks once more before acting (prototype confirmTwice) */
function SureBtn({ label, ask, title, onSure, ...rest }: { label: string; ask: string; title: string; onSure: () => void; 'data-qdl': string; 'aria-label': string }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 2500); return () => clearTimeout(t); }, [sure]);
  return <button className={`btn sm qdl${sure ? ' sure' : ''}`} title={title} {...rest} onClick={() => { if (sure) onSure(); else setSure(true); }}>{sure ? ask : label}</button>;
}

export function SavedList({ open, rows, onClose, onOpen, onConvert, onCancel }: { open: boolean; rows: SaleRow[]; onClose: () => void; onOpen: (r: SaleRow) => void; onConvert: (r: SaleRow) => void; onCancel: (r: SaleRow) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<RowMenuAt<SaleRow> | null>(null);
  useOpenFocus(open, ref);
  useEscape(open && !menu, onClose);
  useEffect(() => { if (!open) setMenu(null); }, [open]);
  const rm = rowMenuHandlers('tr[data-qno]', (tr) => rows.find((q) => q.number === tr.dataset.qno), setMenu);
  const m = menu?.row;
  const done = m?.status === 'converted' ? `Already turned into invoice ${m.invoiceNo}. Edit the invoice instead.` : '';
  return (
    <div className="ov c" id="qlm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'qlm') onClose(); }}>
      <div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby="qlT" style={{ width: 'min(880px,100%)' }}>
        <div className="dh"><div><h3 id="qlT" style={{ margin: 0, fontSize: 18 }}>Saved quotations</h3><small className="mu">Open one to continue, or convert it to a sale invoice.</small></div><button className="ib" type="button" id="qlClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="tw stk" style={{ marginTop: 14 }}><table className="ptt2" style={{ minWidth: 720 }}><thead><tr><th>Quote</th><th>Date</th><th>Customer</th><th className="n">Items</th><th>Lowest</th><th>Status</th><th className="n"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="qlRows" onContextMenu={rm.onContextMenu} onKeyDown={(e) => void rm.menuKey(e)}>{rows.length ? rows.map((q) => {
            const low = q.qtype === 'brand' ? q.brandQuote?.low ?? null : { name: 'Item-wise', total: Number(q.total) };
            return (
              <tr key={q.id} data-qno={q.number} className={menu?.row.id === q.id ? 'ctxon' : undefined}><td className="mono"><b>{q.number}</b>{q.qtype === 'items' ? <> <span className="st b" style={{ fontSize: 10, padding: '1px 6px' }}>Item-wise</span></> : null}</td><td>{dmy(q.date)}</td><td>{q.partyName || '—'}</td><td className="n">{q.items} · {qfmt(Number(q.qty))} pcs</td>
                <td>{low ? <>{low.name}<small className="mu" style={{ display: 'block' }}>₹{inr2f(low.total)}</small></> : '—'}</td>
                <td>{q.status === 'converted' ? <><span className="st g">Converted</span><small className="mu" style={{ display: 'block' }}>{q.invoiceNo} · {q.qtype === 'items' ? 'Item-wise' : q.invoiceBrand}</small></> : <span className="st b">Open</span>}</td>
                <td className="n" style={{ whiteSpace: 'nowrap' }}><button className="btn sm" data-qopen={q.number} onClick={() => onOpen(q)}>Open</button> {q.status === 'converted' ? null : <><button className="btn p sm" data-qconv={q.number} onClick={() => onConvert(q)}>Convert</button> </>}
                  {/* quotations are cancelled, never deleted: it leaves this list and is kept in the books */}
                  <SureBtn label="×" ask="Cancel?" title="Cancel quotation" data-qdl={q.number} aria-label={`Cancel ${q.number}`} onSure={() => onCancel(q)} /> <RowMenuButton no={q.number} label={`Actions for ${q.number}`} onOpen={(b) => setMenu({ row: q, ...atButton(b), tr: b.closest('tr') })} /></td></tr>
            );
          }) : <tr><td colSpan={7}><div className="ptempty">No saved quotations yet. Enter quantities and press Save.</div></td></tr>}</tbody></table></div>
      </div>
      <RowMenu id="qlCtx" label="Quotation actions" rows="#qlRows tr[data-qno]" menu={menu} head={m ? <><b>{m.number}</b> · {m.partyName || '—'}</> : null} actions={QL_ACT}
        off={{ edit: done, conv: done ? 'Already converted' : '' }} onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }}
        onPick={(a) => { const q = menu?.row; setMenu(null); if (!q) return; if (a === 'conv') onConvert(q); else onOpen(q); }} />
    </div>
  );
}

export function ConvertDialog({ open, no, cust, n, ranked, onGo, onClose }: { open: boolean; no: string; cust: string; n: number; ranked: QTotal[]; onGo: (s: QuoteSeries) => string | void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useOpenFocus(open, ref);
  useEscape(open, onClose);
  useEffect(() => { if (open) { setSel((ranked.find((t) => !t.miss) ?? ranked[0])?.s.id ?? null); setErr(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  return (
    <div className="ov c" id="qcm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'qcm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="qcT" style={{ width: 'min(560px,100%)' }}>
        <h3 id="qcT" style={{ margin: '0 0 4px', fontSize: 18 }}>Convert to sale invoice</h3>
        <p className="mu" id="qcSub" style={{ margin: '0 0 14px', fontSize: 13 }}>{no}{cust ? <> for <b>{cust}</b></> : null} · {n} item{n > 1 ? 's' : ''}. Which brand should go on the sale invoice?</p>
        <div className="qcl" id="qcList" role="radiogroup" aria-label="Brand to use">{ranked.map((t, k) => (
          <label className={`qco ${t.miss ? 'warn' : ''}`} key={t.s.id}><input type="radio" name="qcb" value={t.s.id} checked={t.s.id === sel} onChange={() => setSel(t.s.id)} /><span className="qct"><b>{qSerName(t.s)}</b><small>{t.miss ? `${t.miss} item${t.miss > 1 ? 's' : ''} not available — they’ll be left out` : `All ${n} items available`}</small></span><span className="qcv">₹{inr2f(t.total)}{k === 0 && !t.miss ? <i>Lowest</i> : null}</span></label>
        ))}</div>
        <div className="msg bad" id="qcErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" type="button" id="qcCancel" onClick={onClose}>Cancel</button>
          <button className="btn p" type="button" id="qcGo" onClick={() => { const s = ranked.find((t) => t.s.id === sel)?.s; if (!s) return setErr('Choose a brand.'); const e = onGo(s); if (e) setErr(e); }}>Create sale invoice</button></div>
      </div>
    </div>
  );
}

export type AddMode = { k: 'ser' } | { k: 'row' } | { k: 'item'; s: QuoteSeries; row: QuoteRow; grp: string; series: string };
export function AddDialog({ mode, brands, gstOn, onClose, onSer, onRow, onItem }: {
  mode: AddMode | null; brands: string[]; gstOn: boolean; onClose: () => void;
  onSer: (b: string, r: string, f: string, newBrand: boolean) => Promise<string | void>; onRow: (n: string, c: 'acc' | 'plate') => Promise<string | void>; onItem: (mrp: number, pur: number, sale: number) => Promise<string | void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const [brand, setBrand] = useState('');
  const picked = useRef(false);
  const open = !!mode;
  useEscape(open, onClose);
  useEffect(() => {
    if (!mode) return;
    setErr(''); setBrand(brands[0] ?? '__new'); picked.current = false;
    setTimeout(() => document.getElementById(mode.k === 'ser' ? 'qaRange' : mode.k === 'row' ? 'qaName' : 'qaMrp')?.focus(), 30);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mode]);
  // the brand list can arrive after the window opens: take its first brand unless one was chosen
  useEffect(() => { if (mode && !picked.current) setBrand(brands[0] ?? '__new'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [brands.join('|')]);
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  const num = (id: string) => Number(v(id).replace(/[^\d.]/g, '')) || 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    let r: string | void;
    if (mode.k === 'ser') {
      let b = brand;
      const nb = b === '__new';
      if (nb) { b = v('qaNewB').trim(); if (!b) { setErr('Enter the brand name.'); return document.getElementById('qaNewB')?.focus(); } }
      const rg = v('qaRange').trim();
      if (!rg) { setErr('Enter the range name, for example Coral.'); return document.getElementById('qaRange')?.focus(); }
      r = await onSer(b, rg, v('qaFin').trim(), nb);
    } else if (mode.k === 'item') {
      const mrp = num('qaMrp'), pur = num('qaPur'), sale = num('qaSale');
      if (!(sale > 0)) { setErr('Enter the sale price.'); return document.getElementById('qaSale')?.focus(); }
      if (mrp && sale > mrp) { setErr('Sale price is above MRP.'); return document.getElementById('qaSale')?.focus(); }
      r = await onItem(mrp, pur, sale);
    } else {
      const n = v('qaName').trim();
      if (!n) { setErr('Enter the item name.'); return document.getElementById('qaName')?.focus(); }
      r = await onRow(n, v('qaSec') === 'plate' ? 'plate' : 'acc');
    }
    if (r) setErr(r);
  };
  const k = mode?.k;
  return (
    <div className="ov c" id="qam" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'qam') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="qaT" style={{ width: 'min(440px,100%)' }}>
        <h3 id="qaT" style={{ margin: '0 0 14px', fontSize: 18 }}>{k === 'item' ? 'Add item' : k === 'row' ? 'Add item row' : 'Add brand range'}</h3>
        <form id="qaForm" noValidate onSubmit={(e) => void submit(e)} key={JSON.stringify(mode)}><input type="hidden" id="qaMode" value={k ?? 'ser'} />
          <div id="qaSer" hidden={k !== 'ser'}><label className="fl" htmlFor="qaBrand">Brand<select className="fi" id="qaBrand" value={brand} onChange={(e) => { picked.current = true; setBrand(e.target.value); if (e.target.value === '__new') setTimeout(() => document.getElementById('qaNewB')?.focus(), 0); }}>{brands.map((b) => <option key={b}>{b}</option>)}<option value="__new">+ New brand</option></select></label>
            {/* only for "+ New brand": the prototype's .fi{display:block} overrides the hidden attribute */}
            {brand === '__new' && <input className="fi" id="qaNewB" placeholder="New brand name" autoComplete="off" style={{ marginTop: -6, marginBottom: 12 }} />}
            <div className="two"><label className="fl" htmlFor="qaRange">Range<input className="fi" id="qaRange" placeholder="e.g. Coral" autoComplete="off" /></label><label className="fl" htmlFor="qaFin">Finish / colour<input className="fi" id="qaFin" placeholder="e.g. White" autoComplete="off" defaultValue="White" /></label></div></div>
          <div id="qaItem" hidden={k !== 'item'}><p className="mu" id="qaItemTx" style={{ margin: '0 0 12px', fontSize: 13 }}>{mode?.k === 'item' ? <><b>{mode.grp} · {mode.s.b} {mode.series}</b> will be added to Items &amp; stock. Its rate then comes from Price manager.</> : null}</p>
            <div className="two"><label className="fl" htmlFor="qaMrp">MRP<input className="fi" id="qaMrp" inputMode="decimal" /></label><label className="fl" htmlFor="qaPur">Purchase price<input className="fi" id="qaPur" inputMode="decimal" /></label></div>
            <label className="fl" htmlFor="qaSale">Sale price (Retail<span className="needs-gst">{gstOn ? ', incl. GST' : ''}</span>)<input className="fi" id="qaSale" inputMode="decimal" /></label></div>
          <div id="qaRow" hidden={k !== 'row'}><label className="fl" htmlFor="qaName">Item<input className="fi" id="qaName" placeholder="e.g. 20A socket" autoComplete="off" /></label>
            <label className="fl" htmlFor="qaSec">Section<select className="fi" id="qaSec" defaultValue="acc"><option value="acc">Switches &amp; accessories</option><option value="plate">Plates</option></select></label></div>
          <div className="msg bad" id="qaErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn" type="button" id="qaCancel" onClick={onClose}>Cancel</button><button className="btn p" type="submit">Add</button></div>
        </form>
      </div>
    </div>
  );
}

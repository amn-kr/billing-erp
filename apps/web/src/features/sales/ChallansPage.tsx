/**
 * Delivery challans (#vDcs) and New delivery challan (#dcm) — the prototype's
 * renderDcs / dcOpen / dcSave / dcPrint. A challan changes neither stock nor dues;
 * "Convert to invoice" opens the invoice editor filled in.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { dmy } from '../../lib/format';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useDiscardGuard } from '../../components/Discard';
import { useShell } from '../shell/store';
import type { Party } from '../parties/PartiesPage';
import { qfmt, type Item } from '../items/ItemsPage';
import { useSale, useSales, type SaleDoc, type SaleRow } from './model';
import { InvoicePreview } from './InvoicePreview';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const ST: Record<string, { t: string; c: string }> = { open: { t: 'Open', c: 'b' }, invoiced: { t: 'Invoiced', c: 'g' }, cancelled: { t: 'Cancelled', c: 'x' } };

export function ChallansPage() {
  useFitTables();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useShell();
  const list = useSales('challan');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const [open, setOpen] = useState(false);
  const [print, setPrint] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => { if (params.get('new')) { setOpen(true); setParams({}, { replace: true }); } }, [params, setParams]);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(null), 2500); return () => clearTimeout(t); }, [sure]);
  if (!list.data) return <section id="vDcs"></section>;
  const A = list.data;
  const openL = A.filter((d) => d.status === 'open');
  const s = q.toLowerCase();
  const L = A.filter((d) => (st === 'all' || d.status === st) && (!s || d.number.toLowerCase().includes(s) || d.partyName.toLowerCase().includes(s) || d.lineNames.some((n) => n.toLowerCase().includes(s))));
  const cancel = async (d: SaleRow) => {
    if (sure !== d.id) return setSure(d.id);
    try {
      await api(`/sales/${d.id}/cancel`, { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: ['sales', 'challan'] });
      showToast(`${d.number} cancelled`);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not cancel the challan.'); }
    setSure(null);
  };
  return (
    <section id="vDcs">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Delivery challans</h1><span className="pttot">Goods sent before billing</span><div className="sp"></div><button className="btn p" id="dcNew" onClick={() => setOpen(true)}><RawIcon d={PLUS} />New delivery challan</button></div>
      <div className="card ptxc"><div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="dcQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="dcQ" placeholder="Search challan, party or item" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="sumrow sumin" id="dcSum"><div><small>Open challans</small><b>{openL.length}</b></div><div><small>Qty out (not billed)</small><b>{qfmt(openL.reduce((a, d) => a + Number(d.qty), 0))}</b></div><div><small>Invoiced</small><b className="pos">{A.filter((d) => d.status === 'invoiced').length}</b></div><div><small>Total challans</small><b>{A.length}</b></div></div>
        <select className="fi" id="dcSt" aria-label="Status" style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)}><option value="all">All challans</option><option value="open">Open (not billed)</option><option value="invoiced">Invoiced</option><option value="cancelled">Cancelled</option></select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Challan no.</th><th>Party</th><th>Items</th><th className="n">Qty</th><th>Transport</th><th>Status</th><th className="n"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="dcRows" onKeyDown={(e) => { const r = (e.target as HTMLElement).closest<HTMLElement>('tr[data-dcno]'); if (r && e.key === 'Enter' && e.target === r) { e.preventDefault(); r.click(); } }}>
            {L.length ? L.map((d) => (
              <tr tabIndex={0} data-dcno={d.number} key={d.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setPrint(d.id); }}><td>{dmy(d.date)}</td><td className="mono">{d.number}</td><td><b style={{ fontWeight: 600 }}>{d.partyName}</b></td>
                <td>{d.lineNames.slice(0, 2).map((n) => n.split(' · ')[0]).join(', ')}{d.items > 2 ? <> <small className="mu">+{d.items - 2} more</small></> : null}</td><td className="n">{qfmt(d.qty)}</td><td>{[d.transport, d.vehicle].filter(Boolean).join(' · ') || '—'}</td>
                <td><span className={`stt ${ST[d.status]?.c ?? 'b'}`}>{ST[d.status]?.t ?? d.status}</span>{d.invoiceNo ? <small className="mu" style={{ display: 'block' }}>{d.invoiceNo}</small> : null}</td>
                <td className="n" style={{ whiteSpace: 'nowrap' }}><button className="btn sm" data-dcprint={d.number} onClick={() => setPrint(d.id)}>Print</button>{d.status === 'open' ? <> <button className="btn p sm" data-dcconv={d.number} onClick={() => navigate(`/sales/new?challan=${d.id}`)}>Convert to invoice</button> <button className="btn sm" data-dccan={d.number} onClick={() => void cancel(d)}>{sure === d.id ? 'Click again to cancel' : 'Cancel'}</button></> : null}</td></tr>
            )) : <tr><td colSpan={8}><div className="ptempty pue"><b>No delivery challans</b><span>Send goods with a challan when the bill comes later. Convert it to an invoice in one click.</span><button className="btn p sm" id="dcNew2" onClick={() => setOpen(true)}>New delivery challan</button></div></td></tr>}
          </tbody></table></div></div>
      <ChallanDialog open={open} onClose={() => setOpen(false)} onSaved={(id, pr) => { if (pr) setPrint(id); }} />
      <ChallanPrint id={print} onClose={() => setPrint(null)} />
    </section>
  );
}

/** Challan print view (prototype dcPrint): the invoice preview window with the shared renderer. */
function ChallanPrint({ id, onClose }: { id: string | null; onClose: () => void }) {
  const d = useSale(id).data;
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items'), enabled: !!id });
  const v: SaleDoc | null = d && d.id === id ? d : null;
  const hsn = (itemId: string | null) => (items.data ?? []).find((i) => i.id === itemId)?.hsn ?? '';
  return <InvoicePreview doc={v} hsnOf={hsn} onClose={onClose} onNew={() => undefined} onLink={() => undefined} />;
}

function ChallanDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string, print: boolean) => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), enabled: open });
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items'), enabled: open });
  const no = useQuery({ queryKey: ['next-number', 'challan'], queryFn: () => api<{ number: string }>('/sales/next-number?kind=challan'), enabled: open });
  const [party, setParty] = useState('');
  const [lines, setLines] = useState<{ id: string; name: string; qty: string; unit: string }[]>([]);
  const [date, setDate] = useState(today());
  const [f, setF] = useState({ tr: '', veh: '', note: '', name: '', phone: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useOpenFocus(open, ref);
  const close = useDiscardGuard(open, ref, 'delivery challan', onClose);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    setParty(''); setLines([]); setDate(today()); setF({ tr: '', veh: '', note: '', name: '', phone: '' }); setErr('');
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.getElementById('dcf')?.hidden !== false) closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const goods = (items.data ?? []).filter((i) => i.kind === 'goods');
  const save = async (print: boolean) => {
    const L = lines.filter((l) => Number(l.qty) > 0);
    if (!party) { setErr('Choose who the goods are going to.'); return document.getElementById('dcParty')?.focus(); }
    if (party === '__walk' && !f.name.trim()) { setErr('Enter the name.'); return document.getElementById('dcName')?.focus(); }
    if (!L.length) return setErr('Add at least one item with a quantity.');
    setBusy(true);
    try {
      const r = await api<{ id: string; number: string; partyName: string; items: number }>('/challans', {
        method: 'POST', body: { partyId: party === '__walk' ? null : party, cashName: f.name, cashPhone: f.phone, date, lines: L.map((l) => ({ itemId: l.id, qty: l.qty })), transport: f.tr.trim(), vehicle: f.veh.trim(), note: f.note.trim() },
      });
      onClose();
      await Promise.all(['sales', 'next-number'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${r.number} saved · ${r.items} item${r.items > 1 ? 's' : ''} sent to ${r.partyName}`);
      onSaved(r.id, print);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the challan.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ov c" id="dcm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'dcm') close(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="dcT" style={{ width: 'min(760px,100%)' }}>
        <div className="dh"><div><h3 id="dcT" style={{ margin: 0, fontSize: 18 }}>New delivery challan</h3><small className="mu mono" id="dcNo">{no.data?.number ?? ''}</small></div><button className="ib" type="button" id="dcClose" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
        <div className="two" style={{ marginTop: 14 }}><label className="fl" htmlFor="dcParty">Deliver to<select className="fi" id="dcParty" value={party} onChange={(e) => { setParty(e.target.value); if (e.target.value === '__walk') setTimeout(() => document.getElementById('dcName')?.focus(), 0); }}>
          <option value="">Choose customer</option><option value="__walk">Walk-in / new customer</option>{(parties.data ?? []).filter((p) => p.kind !== 'supplier').map((p) => <option value={p.id} key={p.id}>{p.name}{p.billing?.city ? ' · ' + p.billing.city : ''}</option>)}</select></label>
          <label className="fl" htmlFor="dcDate">Date<input className="fi" type="date" id="dcDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="two" id="dcWalkW" hidden={party !== '__walk'}><label className="fl" htmlFor="dcName">Name<input className="fi" id="dcName" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label className="fl" htmlFor="dcPhone">Mobile<input className="fi" id="dcPhone" inputMode="numeric" autoComplete="off" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label></div>
        <div className="tw" style={{ margin: '4px 0 0' }}><table className="ptt2 pyt spt"><thead><tr><th>Item</th><th className="n">In stock</th><th className="n">Qty</th><th>Unit</th><th></th></tr></thead>
          <tbody id="dcRowsI">{lines.length ? lines.map((l, k) => {
            const stock = Number(goods.find((i) => i.id === l.id)?.stock ?? 0);
            return <tr data-dck={k} key={k}><td><b style={{ fontWeight: 600 }}>{l.name}</b></td><td className={`n ${stock < (Number(l.qty) || 0) ? 'neg' : 'mu'}`}>{qfmt(stock)}</td><td className="n"><input className="fi sm n" data-dcq value={l.qty} inputMode="decimal" style={{ width: 80 }} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setLines((x) => x.map((y, i) => (i === k ? { ...y, qty: v } : y))); }} /></td><td>{l.unit}</td>
              <td><button type="button" className="ix" data-dcdel={k} aria-label="Remove" onClick={() => setLines((x) => x.filter((_, i) => i !== k))}><Icon name="x" /></button></td></tr>;
          }) : <tr><td colSpan={5} className="ptempty">Add the items you are sending.</td></tr>}</tbody></table></div>
        <div className="cnadd"><input className="fi" id="dcAddI" list="dcItemsL" placeholder="+ Add an item (type to search)" autoComplete="off" onChange={(e) => {
          const it = goods.find((i) => i.name === e.target.value);
          if (!it) return;
          setLines((x) => (x.some((l) => l.id === it.id) ? x.map((l) => (l.id === it.id ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)) : [...x, { id: it.id, name: it.name, qty: '1', unit: it.unit }]));
          e.target.value = '';
          setTimeout(() => { const qs = document.querySelectorAll<HTMLInputElement>('#dcRowsI [data-dcq]'); const last = qs[qs.length - 1]; last?.focus(); last?.select(); }, 0);
        }} /><datalist id="dcItemsL">{goods.map((i) => <option value={i.name} key={i.id} />)}</datalist></div>
        <div className="two"><label className="fl" htmlFor="dcTr">Transport<input className="fi" id="dcTr" autoComplete="off" placeholder="Transporter / self" value={f.tr} onChange={(e) => setF({ ...f, tr: e.target.value })} /></label><label className="fl" htmlFor="dcVeh">Vehicle no.<input className="fi" id="dcVeh" autoComplete="off" placeholder="UP32 AB 1234" value={f.veh} onChange={(e) => setF({ ...f, veh: e.target.value })} /></label></div>
        <label className="fl" htmlFor="dcNote">Note<input className="fi" id="dcNote" autoComplete="off" placeholder="e.g. Goods on approval. Bill to follow." value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <p className="hint" style={{ margin: 0 }}>A challan doesn’t change stock or the party’s balance. Stock and dues update when you convert it to an invoice.</p>
        <div className="msg bad" id="dcErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="dcCancel" onClick={close}>Cancel</button><button className="btn" type="button" id="dcSavePrint" disabled={busy} onClick={() => void save(true)}>Save &amp; print</button><button className="btn p" type="button" id="dcSave" disabled={busy} onClick={() => void save(false)}>Save challan</button></div>
      </div>
    </div>
  );
}

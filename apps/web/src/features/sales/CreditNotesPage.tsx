/**
 * Credit notes (#vCns) and New credit note (#cnm) — the prototype's renderCns /
 * cnOpen / cnSave. Goods come back into stock; the invoice due goes down (or the
 * money is refunded); the same goods can't be returned twice.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CN_REASONS, money } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useSettings } from '../../lib/settings';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useDiscardGuard } from '../../components/Discard';
import { useShell } from '../shell/store';
import { toastSaveFailed, toastSaved } from '../shell/saved';
import type { Party } from '../parties/PartiesPage';
import { qfmt, type Item } from '../items/ItemsPage';
import { useSales, type SaleRow } from './model';
import { SlModal, type SlModalProps } from './SlModal';
import { editAsk, withPasscode } from '../settings/passcode';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';

interface CreditNote {
  id: string; number: string; date: string; party: { id: string; name: string } | null; partyName: string; reason: string; settle: 'adjust' | 'refund'; refundMode: string;
  against: string[]; qty: string; total: string; unused: string; cancelled: boolean;
  lines: { name: string; qty: string; unit: string; price: string; amount: string; invoice: string }[];
}
interface CnDoc {
  id: string; number: string; date: string; partyId: string | null; reason: string; settle: 'adjust' | 'refund'; refundMode: string; cancelled: boolean;
  lines: { invoiceId: string | null; itemId: string; name: string; unit: string; qty: string; price: string; gstRate: string }[];
}
interface Returnable { itemId: string; name: string; unit: string; sold: string; max: string; price: string; gstRate: string }
interface CnLine { inv: string; invNo: string; id: string; name: string; sold?: number; max?: number; qty: number; unit: string; price: number; gst: number; amt: number }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const r2 = (n: number) => Math.round(n * 100) / 100;
const CN_ACT: RowAction[] = [['edit', 'Edit'], ['view', 'View']];

export function CreditNotesPage() {
  useFitTables();
  const [params, setParams] = useSearchParams();
  // from a party statement: open that document (prototype rcView / cnView)
  const loc = useLocation(), nav = useNavigate();
  const [want, setWant] = useState<string | null>((loc.state as { view?: string } | null)?.view ?? null);
  useEffect(() => { if ((loc.state as { view?: string } | null)?.view) nav('.', { replace: true, state: null }); }, [loc.state, nav]);
  const list = useQuery({ queryKey: ['credit-notes'], queryFn: () => api<CreditNote[]>('/credit-notes') });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ invoice?: string; edit?: string } | null>(null);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  const [menu, setMenu] = useState<RowMenuAt<CreditNote> | null>(null);
  useEffect(() => {
    const inv = params.get('invoice');
    if (inv) { setOpen({ invoice: inv }); setParams({}, { replace: true }); }
  }, [params, setParams]);
  if (!list.data) return <section id="vCns"></section>;
  const A = list.data;
  const tot = A.reduce((a, c) => a.plus(c.total), money(0));
  const cr = A.reduce((a, c) => a.plus(c.unused), money(0));
  const s = q.toLowerCase();
  const L = A.filter((c) => !s || c.number.toLowerCase().includes(s) || c.partyName.toLowerCase().includes(s) || c.against.join(', ').toLowerCase().includes(s));
  const view = (c: CreditNote) => {
    const multi = c.against.length > 1;
    setModal({
      title: `Credit note ${c.number}`, sub: `${c.partyName} · ${dmy(c.date)}${c.against.length ? ' · against ' + c.against.join(', ') : ''}`,
      body: <><div className="tw" style={{ margin: 0 }}><table className="ptt2 slht"><thead><tr><th>Item</th>{multi ? <th>Invoice</th> : null}<th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th></tr></thead><tbody>{c.lines.map((l, k) => <tr key={k}><td>{l.name}</td>{multi ? <td className="mono">{l.invoice || '—'}</td> : null}<td className="n">{qfmt(l.qty)} {l.unit}</td><td className="n">{inr2f(l.price)}</td><td className="n">{inr2f(l.amount)}</td></tr>)}</tbody></table></div>
        <div className="slhs"><span>Reason: <b>{c.reason}</b></span><span>Total <b>{inr2f(c.total)}</b> · {c.settle === 'refund' ? 'Refunded by ' + c.refundMode : 'Adjusted in balance'}</span></div></>,
    });
  };
  if (want) { const x = list.data.find((y) => y.number === want); setWant(null); if (x) queueMicrotask(() => view(x)); }
  const rm = rowMenuHandlers('tr[data-cnno]', (tr) => A.find((c) => c.number === tr.dataset.cnno), setMenu);
  const m = menu?.row;

  return (
    <section id="vCns">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Credit notes</h1><span className="pttot">Goods returned by customers</span><div className="sp"></div><button className="btn p" id="cnNew" onClick={() => setOpen({})}><RawIcon d={PLUS} />New credit note</button></div>
      <div className="card ptxc"><div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="cnQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="cnQ" placeholder="Search credit note, party or invoice" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="sumrow sumin" id="cnSum"><div><small>Returns value</small><b>{inr(tot.toFixed(2))}</b></div><div><small>Credit notes</small><b>{A.length}</b></div><div><small>Items returned</small><b>{qfmt(A.reduce((a, c) => a + Number(c.qty), 0))}</b></div><div><small>Unused credit</small><b>{inr(cr.toFixed(2))}</b></div></div></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Credit note</th><th>Party</th><th>Against invoice</th><th>Reason</th><th className="n">Qty</th><th className="n">Amount</th><th>Settled as</th><th className="slact"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="cnRows" onContextMenu={rm.onContextMenu} onKeyDown={(e) => { if (rm.menuKey(e)) return; const r = (e.target as HTMLElement).closest<HTMLElement>('tr[data-cnno]'); if (r && e.key === 'Enter') { e.preventDefault(); r.click(); } }}>
            {L.length ? L.map((c) => (
              <tr tabIndex={0} data-cnno={c.number} key={c.id} className={menu?.row.id === c.id ? 'ctxon' : undefined} onClick={() => view(c)}><td>{dmy(c.date)}</td><td className="mono">{c.number}</td><td><b style={{ fontWeight: 600 }}>{c.partyName}</b></td>
                <td className="mono">{c.against.length ? <>{c.against[0]}{c.against.length > 1 ? <> <small className="mu" title={c.against.join(', ')}>+{c.against.length - 1} more</small></> : null}</> : '—'}</td><td>{c.reason}</td><td className="n">{qfmt(c.qty)}</td><td className="n"><b>{inr2f(c.total)}</b></td>
                <td>{c.settle === 'refund' ? <span className="stt b">Refunded · {c.refundMode}</span> : Number(c.unused) > 0 ? <span className="stt a">Credit {inr2f(c.unused)}</span> : <span className="stt g">Adjusted</span>}</td>
                <td className="slact"><RowMenuButton no={c.number} label={`Actions for ${c.number}`} onOpen={(b) => setMenu({ row: c, ...atButton(b), tr: b.closest('tr') })} /></td></tr>
            )) : <tr><td colSpan={9}><div className="ptempty pue"><b>No credit notes yet</b><span>When a customer returns goods, record a credit note. Stock goes back up and their invoice due is reduced.</span><button className="btn p sm" id="cnNew2" onClick={() => setOpen({})}>New credit note</button></div></td></tr>}
          </tbody></table></div></div>
      <RowMenu id="cnCtx" label="Credit note actions" rows="#cnRows tr[data-cnno]" menu={menu} head={m ? <><b>{m.number}</b> · {m.partyName}</> : null} actions={CN_ACT}
        off={{ edit: m?.cancelled ? 'Cancelled document' : '' }} onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }}
        onPick={(a) => { const c = menu?.row; setMenu(null); if (!c) return; if (a === 'edit') setOpen({ edit: c.id }); else view(c); }} />
      <CreditNoteDialog open={open} onClose={() => setOpen(null)} />
      <SlModal m={modal} onClose={() => setModal(null)} />
    </section>
  );
}

/** New credit note (#cnm). `open.invoice` starts with that invoice ticked; `open.edit` edits a saved one (same number, passcode when it is on). */
export function CreditNoteDialog({ open, onClose }: { open: { invoice?: string; edit?: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const gst = !!useSettings().data?.gstEnabled;
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = !!open;
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), enabled: isOpen });
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items'), enabled: isOpen });
  const sales = useSales('invoice');
  const editId = open?.edit ?? null;
  const no = useQuery({ queryKey: ['next-number', 'credit_note'], queryFn: () => api<{ number: string }>('/sales/next-number?kind=credit_note'), enabled: isOpen && !editId });
  const [editNo, setEditNo] = useState('');
  const [party, setParty] = useState('');
  const [invs, setInvs] = useState<string[]>([]);
  const [lines, setLines] = useState<CnLine[]>([]);
  const [iq, setIq] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState<string>(CN_REASONS[0]);
  const [settle, setSettle] = useState<'adjust' | 'refund'>('adjust');
  const [refMode, setRefMode] = useState('Cash');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // the prototype redraws the GST note only on a full redraw (cnRender), not while a quantity is typed
  const [redraws, setRedraws] = useState(0);
  const redraw = () => setRedraws((n) => n + 1);
  const [gstNote, setGstNote] = useState(0);
  useOpenFocus(isOpen, ref);
  const close = useDiscardGuard(isOpen, ref, 'credit note', onClose);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.getElementById('dcf')?.hidden !== false) closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen]);

  const all = sales.data ?? [];
  const partyInvs = (p: string) => all.filter((s) => !s.cancelled && (p === '__cash' ? !s.party : s.party?.id === p));
  const toggle = async (s: SaleRow, on: boolean) => {
    if (on) {
      if (invs.includes(s.id)) return;
      // editing: what this credit note returned can be returned again
      const ret = await qc.fetchQuery({ queryKey: ['returnable', s.id, editId], queryFn: () => api<Returnable[]>(`/sales/${s.id}/returnable${editId ? `?except=${editId}` : ''}`), staleTime: 0 });
      setInvs((x) => [...x, s.id]);
      setLines((x) => [...x, ...ret.map((l) => ({ inv: s.id, invNo: s.number, id: l.itemId, name: l.name, sold: Number(l.sold), max: Number(l.max), qty: 0, unit: l.unit, price: Number(l.price), gst: Number(l.gstRate), amt: 0 }))]);
    } else {
      setInvs((x) => x.filter((i) => i !== s.id));
      setLines((x) => x.filter((l) => l.inv !== s.id));
    }
    redraw();
  };
  useEffect(() => {
    if (!open) return;
    setInvs([]); setLines([]); setIq(''); setDate(today()); setReason(CN_REASONS[0]); setSettle('adjust'); setRefMode('Cash'); setErr(''); setEditNo('');
    if (open.edit) { void loadSaved(open.edit); return; }
    const s = open.invoice ? all.find((x) => x.id === open.invoice) : undefined;
    const p = s ? s.party?.id ?? '__cash' : '';
    setParty(p);
    if (p === '__cash') setSettle('refund');
    if (s) void toggle(s, true);
    setTimeout(() => (document.querySelector(p ? '#cnInvs input' : '#cnParty') as HTMLElement | null)?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Editing: the saved credit note fills the window — its invoices ticked, with what can be returned leaving out this note. */
  async function loadSaved(id: string) {
    try {
      const d = await qc.fetchQuery({ queryKey: ['credit-note', id], queryFn: () => api<CnDoc>(`/credit-notes/${id}`), staleTime: 0 });
      setEditNo(d.number); setParty(d.partyId ?? '__cash'); setDate(d.date); setReason(d.reason); setSettle(d.settle); setRefMode(d.refundMode);
      const ids = [...new Set(d.lines.flatMap((l) => (l.invoiceId ? [l.invoiceId] : [])))];
      const out: CnLine[] = [];
      for (const inv of ids) {
        const ret = await qc.fetchQuery({ queryKey: ['returnable', inv, id], queryFn: () => api<Returnable[]>(`/sales/${inv}/returnable?except=${id}`), staleTime: 0 });
        const invNo = all.find((x) => x.id === inv)?.number ?? '';
        for (const l of ret) {
          const mine = d.lines.find((x) => x.invoiceId === inv && x.itemId === l.itemId);
          const qty = mine ? Number(mine.qty) : 0;
          const price = mine ? Number(mine.price) : Number(l.price);
          out.push({ inv, invNo, id: l.itemId, name: l.name, sold: Number(l.sold), max: Number(l.max), qty, unit: l.unit, price, gst: Number(l.gstRate), amt: r2(qty * price) });
        }
      }
      for (const l of d.lines.filter((x) => !x.invoiceId)) out.push({ inv: '', invNo: '', id: l.itemId, name: l.name, qty: Number(l.qty), unit: l.unit, price: Number(l.price), gst: Number(l.gstRate), amt: r2(Number(l.qty) * Number(l.price)) });
      setInvs(ids); setLines(out); redraw();
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not open the credit note.'); onClose(); }
  }

  const calc = () => { let tot = 0, tax = 0; for (const l of lines) { const a = r2(l.qty * l.price); tot += a; tax += a - a / (1 + l.gst / 100); } return { tot: r2(tot), tax: r2(tax) }; };
  const c = calc();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setGstNote(c.tax), [redraws]);
  const multi = invs.length > 1;
  const P = partyInvs(party);
  const shownInvs = P.filter((s) => invs.includes(s.id) || !iq || s.number.toLowerCase().includes(iq.toLowerCase()) || dmy(s.date).includes(iq.toLowerCase()));
  const groups: [string, string, [CnLine, number][]][] = [...invs.map((id) => [id, P.find((s) => s.id === id)?.number ?? '', lines.map((l, k) => [l, k] as [CnLine, number]).filter(([l]) => l.inv === id)] as [string, string, [CnLine, number][]]), ['', '', lines.map((l, k) => [l, k] as [CnLine, number]).filter(([l]) => !l.inv)] as [string, string, [CnLine, number][]]].filter(([, , a]) => a.length);
  const cols = gst ? 7 : 6;
  const setLine = (k: number, f: Partial<CnLine>) => setLines((x) => x.map((l, i) => (i === k ? { ...l, ...f } : l)));
  const save = async () => {
    const fail = (m: string) => { setErr(m); toastSaveFailed(m); };
    const L = lines.filter((l) => l.qty > 0);
    if (!party) { fail('Choose the customer.'); return document.getElementById('cnParty')?.focus(); }
    if (!L.length) return fail('Enter the quantity returned for at least one item.');
    if (party === '__cash' && settle !== 'refund') return fail('Counter sales have no customer account. Choose “Refund now”.');
    setBusy(true);
    try {
      const body = { partyId: party === '__cash' ? null : party, date, reason, settle, refundMode: refMode, lines: L.map((l) => ({ invoiceId: l.inv || null, itemId: l.id, qty: String(l.qty), price: String(l.price), gstRate: String(l.gst) })) };
      if (editId) { if (!(await withPasscode(qc, editAsk(editNo), (h) => api(`/credit-notes/${editId}`, { method: 'PUT', body, headers: h })))) return; }
      else await api('/credit-notes', { method: 'POST', body });
      onClose();
      await Promise.all(['credit-notes', 'credit-note', 'sales', 'parties', 'items', 'next-number', 'sale', 'returnable', 'dues'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toastSaved('credit_note');
    } catch (e) { fail(e instanceof ApiError ? e.message : 'Could not save the credit note.'); }
    finally { setBusy(false); }
  };
  const row = ([l, k]: [CnLine, number]) => (
    <tr data-cnk={k} className={l.qty > 0 ? 'cnon' : ''} key={k}><td><b>{l.name}</b></td><td className="n mu">{l.max !== undefined ? <>{qfmt(l.max)} {l.unit}{l.max < (l.sold ?? 0) ? <small style={{ display: 'block' }}>of {qfmt(l.sold ?? 0)} sold</small> : null}</> : '—'}</td>
      <td className="n"><input className="fi sm n" data-cnq value={l.qty || ''} placeholder="0" inputMode="decimal" style={{ width: 72 }} disabled={l.max === 0} title={l.max === 0 ? 'Already returned' : undefined}
        onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, '')) || 0; if (l.max !== undefined && v > l.max) { setLine(k, { qty: l.max, amt: r2(l.max * l.price) }); showToast(`Only ${qfmt(l.max)} can be returned on ${l.invNo}`); } else setLine(k, { qty: v, amt: r2(v * l.price) }); }} /></td>
      <td className="n"><input className="fi sm n" data-cnp value={l.price || ''} inputMode="decimal" style={{ width: 88 }} onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, '')) || 0; setLine(k, { price: v, amt: r2(l.qty * v) }); }} /></td>
      {gst ? <td className="n mu">{l.gst}%</td> : null}<td className="n"><b>{inr2f(r2(l.qty * l.price))}</b></td>
      <td>{l.inv ? null : <button type="button" className="ix" data-cndel={k} aria-label="Remove" onClick={() => { setLines((x) => x.filter((_, i) => i !== k)); redraw(); }}><Icon name="x" /></button>}</td></tr>
  );
  return (
    <div className="ov c" id="cnm" hidden={!isOpen} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'cnm') close(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="cnT" style={{ width: 'min(820px,100%)' }}>
        <div className="dh"><div><h3 id="cnT" style={{ margin: 0, fontSize: 18 }}>{editId ? 'Edit credit note' : 'New credit note'}</h3><small className="mu mono" id="cnNo">{editId ? editNo : (no.data?.number ?? '')}</small></div><button className="ib" type="button" id="cnClose" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
        <div className="cnhd" style={{ marginTop: 14 }}><label className="fl" htmlFor="cnParty">Customer<select className="fi" id="cnParty" value={party} onChange={(e) => { setParty(e.target.value); setInvs([]); setLines([]); setIq(''); if (e.target.value === '__cash') setSettle('refund'); redraw(); }}>
          <option value="">Choose customer</option>{(parties.data ?? []).filter((p) => p.kind !== 'supplier').map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}<option value="__cash">Counter sales (no account)</option></select></label>
          <label className="fl" htmlFor="cnDate">Date<input className="fi" type="date" id="cnDate" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="fl" htmlFor="cnReason">Reason<select className="fi" id="cnReason" value={reason} onChange={(e) => setReason(e.target.value)}>{CN_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label></div>
        <div className="cnil"><b>Against invoices</b><small className="mu" id="cnInvHint">{invs.length ? `${invs.length} selected` : 'Tick one or more invoices of this customer'}</small><span className="sp"></span><label className="search cnis" htmlFor="cnInvQ" hidden={!party || P.length < 7} id="cnInvQW"><input id="cnInvQ" placeholder="Find invoice" autoComplete="off" value={iq} onChange={(e) => setIq(e.target.value)} /></label></div>
        <div className="cninv" id="cnInvs" role="group" aria-label="Invoices">{!party ? <p className="mu" style={{ margin: 0, fontSize: 13 }}>Choose the customer to see their invoices.</p> : shownInvs.length ? shownInvs.map((s) => {
          const on = invs.includes(s.id);
          return <label className={`cnic${on ? ' on' : ''}`} key={s.id}><input type="checkbox" data-cninv={s.number} checked={on} onChange={(e) => void toggle(s, e.target.checked)} /><span><b className="mono">{s.number}</b><small>{dmy(s.date)} · {inr2f(s.total)}{Number(s.balance) > 0 ? <> · <span className="neg">due {inr2f(s.balance)}</span></> : ' · paid'}</small></span></label>;
        }) : <p className="mu" style={{ margin: 0, fontSize: 13 }}>{P.length ? 'No invoice matches.' : 'No invoices for this customer. You can still add items below.'}</p>}</div>
        <div className="tw" style={{ margin: '4px 0 0' }}><table className="ptt2 pyt spt"><thead><tr><th>Item</th><th id="cnInvTh" style={{ display: 'none' }}>Invoice</th><th className="n">Can return</th><th className="n">Return qty</th><th className="n">Rate</th>{gst ? <th className="n">GST</th> : null}<th className="n">Amount</th><th></th></tr></thead>
          <tbody id="cnRowsI">{groups.length ? groups.map(([id, number, a]) => (
            <GroupRows key={id || 'other'} head={multi || (!id && invs.length > 0) ? <tr className="cngh"><td colSpan={cols}>{id ? <><b className="mono">{number}</b> <button type="button" className="lnk" data-cnall={number} onClick={() => { setLines((x) => x.map((l) => (l.inv === id ? { ...l, qty: l.max ?? l.qty, amt: r2((l.max ?? l.qty) * l.price) } : l))); redraw(); }}>Return all</button></> : <b>Other items</b>}</td></tr> : null} rows={a.map(row)} />
          )) : <tr><td colSpan={cols} className="ptempty">{party ? 'Tick an invoice above, or add items below.' : 'Choose the customer first.'}</td></tr>}</tbody></table></div>
        <div className="cnadd" id="cnAddW"><input className="fi" id="cnAddI" list="cnItemsL" placeholder="+ Add an item (type to search)" autoComplete="off" onChange={(e) => {
          const it = (items.data ?? []).find((i) => i.name === e.target.value);
          if (!it) return;
          setLines((x) => [...x, { inv: '', invNo: '', id: it.id, name: it.name, qty: 1, unit: it.unit ?? '', price: Number(it.sale) || 0, gst: gst ? Number(it.gstRate) || 0 : 0, amt: Number(it.sale) || 0 }]);
          e.target.value = '';
          redraw();
        }} /><datalist id="cnItemsL">{(items.data ?? []).map((i) => <option value={i.name} key={i.id} />)}</datalist></div>
        <div className="cnset"><b>Settle as</b><label className="cb2"><input type="radio" name="cnS" value="adjust" checked={settle === 'adjust'} onChange={() => setSettle('adjust')} /> Adjust in customer’s balance <small className="mu">(reduces the invoice due, rest kept as credit)</small></label>
          <label className="cb2"><input type="radio" name="cnS" value="refund" checked={settle === 'refund'} onChange={() => setSettle('refund')} /> Refund now by <select className="fi sm" id="cnRefMode" style={{ width: 'auto', height: 30, margin: '0 0 0 4px' }} value={refMode} onChange={(e) => setRefMode(e.target.value)}><option>Cash</option><option>UPI</option><option>Bank transfer</option></select></label></div>
        <div className="cntot" id="cnTot"><span>Return value{gst && gstNote ? <> <small className="mu">incl. GST {inr2f(gstNote)}</small></> : null}{invs.length > 1 ? <> <small className="mu">· {invs.length} invoices</small></> : null}</span><b>{inr2f(c.tot)}</b></div>
        <div className="msg bad" id="cnErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="cnCancel" onClick={close}>Cancel</button><button className="btn p" type="button" id="cnSave" disabled={busy} onClick={() => void save()}>Save credit note</button></div>
      </div>
    </div>
  );
}

const GroupRows = ({ head, rows }: { head: React.ReactNode; rows: React.ReactNode[] }) => <>{head}{rows}</>;

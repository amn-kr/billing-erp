/** Godowns (#vGds) with Add godown (#gdm) and Transfer stock (#trm) — same markup as the prototype's renderGds. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useCur } from '../../lib/settings';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { qfmt, type Item } from '../items/ItemsPage';
import { availableForTransfer } from '@billing/shared';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';
import { editAsk, withPasscode } from '../settings/passcode';

export interface Godown { id: string; name: string; address: string; manager: string; phone: string; isDefault: boolean; items: number; value: string }
interface GodownRow { itemId: string; name: string; category: string; unit: string; inGodown: string; total: string; value: string }
interface Transfer { id: string; number: string; date: string; itemId: string; item: string; unit: string; qty: string; fromId: string; from: string; toId: string; to: string; note: string }
const TR_ACT: RowAction[] = [['edit', 'Edit']];

const SWAP = '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>';
const addr = (g: Godown) => g.address || 'Address not added';

export function GodownsPage() {
  useFitTables();
  const cur = useCur();
  const { showToast } = useShell();
  const gds = useQuery({ queryKey: ['godowns'], queryFn: () => api<Godown[]>('/godowns') });
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const trf = useQuery({ queryKey: ['stock-transfers'], queryFn: () => api<Transfer[]>('/stock-transfers') });
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ itemId?: string; edit?: Transfer } | null>(null);
  const [menu, setMenu] = useState<RowMenuAt<Transfer> | null>(null);

  const GD = gds.data ?? [];
  const g = GD.find((x) => x.id === sel) ?? GD[0];
  const rows = useQuery({ queryKey: ['godown-items', g?.id], queryFn: () => api<GodownRow[]>(`/godowns/${g!.id}/items`), enabled: !!g });

  if (!gds.data || !g) return <section id="vGds"></section>;
  const prods = (items.data ?? []).filter((i) => i.kind === 'goods');

  const recent = trf.data?.slice(0, 6) ?? [];
  const rm = rowMenuHandlers('div[data-trno]', (el) => recent.find((t) => t.number === el.dataset.trno), setMenu);
  const m = menu?.row;
  /** Edit: Transfer stock with the saved transfer (its item still listed even if it is no longer active). */
  const editTr = (t: Transfer) => {
    if (!prods.some((i) => i.id === t.itemId)) return showToast('This item is no longer active. Make it active again to change this transfer.');
    if (!GD.some((x) => x.id === t.fromId) || !GD.some((x) => x.id === t.toId)) return showToast('One of its godowns was removed, so this transfer can’t be changed.');
    setMoving({ itemId: t.itemId, edit: t });
  };
  const openTr = (itemId?: string) => {
    if (!prods.length) return showToast('Add an item first — Items & stock › Add item');
    if (GD.length < 2) return showToast('Add a second godown first, then move stock between them');
    setMoving({ itemId });
  };

  return (
    <section id="vGds">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Godowns</h1><span className="pttot">Where your stock is kept</span><div className="sp"></div><button className="btn p" id="trBtn" onClick={() => openTr()}><RawIcon d={SWAP} />Transfer stock</button></div>
      <div className="gdg" id="gdCards">
        {GD.map((x) => (
          <button className={`gdc ${x.id === g.id ? 'on' : ''}`} data-gd={x.id} key={x.id} onClick={() => setSel(x.id)}>
            <span className="gdt"><b>{x.name}</b>{x.isDefault && <span className="st g">Default</span>}</span><small>{addr(x)}</small>
            <span className="gdn"><span><small>Items</small><b>{x.items}</b></span><span><small>Stock value</small><b>{cur(inr(x.value))}</b></span></span>
          </button>
        ))}
        <button className="gdc add" id="gdAdd" onClick={() => setAdding(true)}><Icon name="plus" /><b>Add godown</b><small>Shop, warehouse or store room</small></button>
      </div>
      <div className="gdlay">
        <div className="card ptxc"><div className="hd" id="gdHead" style={{ margin: 0, padding: '14px 16px' }}>
          <div><h3 style={{ margin: 0 }}>{g.name}</h3><small style={{ color: 'var(--t2)' }}>{addr(g)} · In charge: {g.manager || '—'}{g.phone ? ` · +91 ${g.phone.slice(0, 5)} ${g.phone.slice(5)}` : ''}</small></div>
        </div>
          <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Item</th><th>Category</th><th className="n">In this godown</th><th className="n">Total stock</th><th className="n">Value</th><th><span className="vh">Actions</span></th></tr></thead>
            <tbody id="gdRows">
              {rows.data?.length ? rows.data.map((r) => (
                <tr key={r.itemId}><td><b style={{ fontWeight: 600 }}>{r.name}</b></td><td>{r.category}</td><td className="n">{qfmt(r.inGodown)} {r.unit}</td><td className="n">{qfmt(r.total)} {r.unit}</td><td className="n">{inr2f(r.value)}</td>
                  <td className="n"><button className="btn sm" data-tri={r.itemId} onClick={() => openTr(r.itemId)}><Icon name="swap" />Transfer</button></td></tr>
              )) : rows.data ? <tr><td colSpan={6} className="ptempty">No stock in {g.name} yet. Use “Transfer stock” to move items here.</td></tr> : null}
            </tbody></table></div></div>
        <div className="card"><div className="hd"><h3>Recent transfers</h3></div><div id="trRows" onContextMenu={rm.onContextMenu} onKeyDown={(e) => { rm.menuKey(e); }}>
          {recent.length ? recent.map((t) => (
            <div className="trr" key={t.id} tabIndex={0} data-trno={t.number}><span>{dmy(t.date)}</span><b>{t.item}</b><span>{qfmt(t.qty)} {t.unit} <RowMenuButton no={t.number} label={`Actions for ${t.number}`} onOpen={(b) => setMenu({ row: t, ...atButton(b), tr: b.closest('[data-trno]') })} /></span><span className="trp">{t.from} → {t.to}</span></div>
          )) : trf.data ? <div className="ptempty">No transfers yet.</div> : null}
        </div></div>
        <RowMenu id="trCtx" label="Transfer actions" rows="#trRows div[data-trno]" menu={menu} head={m ? <><b>{m.number}</b> · {m.item}</> : null} actions={TR_ACT}
          onClose={() => { const el = menu?.tr; setMenu(null); return el; }} onPick={() => { const t = menu?.row; setMenu(null); if (t) editTr(t); }} />
      </div>
      <AddGodownDialog open={adding} onClose={() => setAdding(false)} onAdded={(id) => setSel(id)} />
      <TransferDialog open={moving} godowns={GD} items={prods} from={g.id} onClose={() => setMoving(null)} />
    </section>
  );
}

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
}

function AddGodownDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [f, setF] = useState({ name: '', address: '', manager: '', phone: '' });
  const [err, setErr] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const phRef = useRef<HTMLInputElement>(null);
  useEsc(open, onClose);
  useEffect(() => {
    if (!open) return;
    setF({ name: '', address: '', manager: '', phone: '' });
    setErr('');
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = f.name.trim();
    const phone = f.phone.replace(/\s/g, '');
    const list = qc.getQueryData<Godown[]>(['godowns']) ?? [];
    if (!name) { setErr('Enter the godown name.'); return nameRef.current?.focus(); }
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) { setErr('A godown with this name already exists.'); return nameRef.current?.focus(); }
    if (phone && !/^[6-9]\d{9}$/.test(phone)) { setErr('Enter a 10-digit mobile number or leave it empty.'); return phRef.current?.focus(); }
    try {
      const g = await api<{ id: string }>('/godowns', { body: { name, address: f.address.trim(), manager: f.manager.trim(), phone } });
      await qc.invalidateQueries({ queryKey: ['godowns'] });
      onAdded(g.id);
      onClose();
      showToast(`${name} added`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not add the godown.');
    }
  }

  return (
    <div className="ov c" id="gdm" hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'gdm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="gdT">
        <h3 id="gdT" style={{ margin: '0 0 14px', fontSize: 18 }}>Add godown</h3>
        <form id="gdForm" noValidate onSubmit={submit}>
          <label className="fl" htmlFor="gdName">Godown name<input className="fi" id="gdName" placeholder="e.g. Chowk store room" autoComplete="off" value={f.name} onChange={set('name')} ref={nameRef} /></label>
          <label className="fl" htmlFor="gdAddr">Address<input className="fi" id="gdAddr" placeholder="Street, area, city, PIN code" autoComplete="off" value={f.address} onChange={set('address')} /></label>
          <div className="two"><label className="fl" htmlFor="gdMgr">Person in charge<input className="fi" id="gdMgr" autoComplete="off" value={f.manager} onChange={set('manager')} /></label><label className="fl" htmlFor="gdPh">Mobile<input className="fi" id="gdPh" inputMode="numeric" autoComplete="off" value={f.phone} onChange={set('phone')} ref={phRef} /></label></div>
          <div className="msg bad" id="gdErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn" type="button" id="gdCancel" onClick={onClose}>Cancel</button><button className="btn p" type="submit">Add godown</button></div>
        </form>
      </div>
    </div>
  );
}

/** `open.edit`: the saved transfer fills the window; saving changes it (same number and date, passcode when it is on). */
function TransferDialog({ open, godowns, items, from: start, onClose }: { open: { itemId?: string; edit?: Transfer } | null; godowns: Godown[]; items: Item[]; from: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [err, setErr] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  useEsc(!!open, onClose);
  useEffect(() => {
    if (!open) return;
    const x = open.edit;
    setItemId(open.itemId ?? items[0]?.id ?? '');
    setFrom(x?.fromId ?? start);
    setTo(x?.toId ?? godowns.find((g) => g.id !== start)?.id ?? '');
    setQty(x ? String(Number(x.qty)) : '');
    setErr('');
    setTimeout(() => qtyRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const here = useQuery({ queryKey: ['godown-items', from], queryFn: () => api<GodownRow[]>(`/godowns/${from}/items`), enabled: !!open && !!from });
  const item = items.find((i) => i.id === itemId);
  const fromG = godowns.find((x) => x.id === from);
  const x = open?.edit;
  // editing: what the saved transfer took out of (or brought into) this godown counts as given back
  const av = availableForTransfer(here.data?.find((r) => r.itemId === itemId)?.inGodown ?? 0, x ? { itemId: x.itemId, fromId: x.fromId, toId: x.toId, qty: x.qty } : null, itemId, from).toNumber();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item || !fromG) return;
    const q = Number(qty);
    if (from === to) return setErr('Choose two different godowns.');
    if (!(q > 0)) { setErr('Enter a quantity more than 0.'); return qtyRef.current?.focus(); }
    if (q > av) { setErr(`Only ${qfmt(av)} ${item.unit} available in ${fromG.name}.`); return qtyRef.current?.focus(); }
    try {
      const body = { itemId, fromGodownId: from, toGodownId: to, qty: q, date: x?.date ?? today(), note: x?.note ?? '', ...(x && { number: x.number }) };
      const call = (h?: Record<string, string>) => api(x ? `/stock-transfers/${x.id}` : '/stock-transfers', { method: x ? 'PUT' : 'POST', body, headers: h });
      if (!(x ? await withPasscode(qc, editAsk(x.number), call) : { value: await call() })) return;
      await Promise.all(['godowns', 'godown-items', 'stock-transfers', 'items', 'item'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
      showToast(x ? `${x.number} saved` : `Moved ${qfmt(q)} ${item.unit} of ${item.name} to ${godowns.find((g) => g.id === to)?.name ?? ''}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not move the stock.');
    }
  }

  return (
    <div className="ov c" id="trm" hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'trm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="trT">
        <h3 id="trT" style={{ margin: '0 0 14px', fontSize: 18 }}>{x ? `Edit ${x.number}` : 'Transfer stock'}</h3>
        <form id="trForm" noValidate onSubmit={submit}>
          <label className="fl" htmlFor="trItem">Item<select className="fi" id="trItem" value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.map((i) => <option value={i.id} key={i.id}>{i.name}</option>)}</select></label>
          <div className="two">
            <label className="fl" htmlFor="trFrom">From<select className="fi" id="trFrom" value={from} onChange={(e) => setFrom(e.target.value)}>{godowns.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
            <label className="fl" htmlFor="trTo">To<select className="fi" id="trTo" value={to} onChange={(e) => setTo(e.target.value)}>{godowns.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
          </div>
          <label className="fl" htmlFor="trQty">Quantity<input className="fi" id="trQty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} ref={qtyRef} /></label>
          <div className="hint" id="trAv" style={{ margin: '-4px 0 8px' }}>{item && fromG && here.data ? `Available in ${fromG.name}: ${qfmt(av)} ${item.unit}` : ''}</div><div className="msg bad" id="trErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn" type="button" id="trCancel" onClick={onClose}>Cancel</button><button className="btn p" type="submit">Transfer</button></div>
        </form>
      </div>
    </div>
  );
}

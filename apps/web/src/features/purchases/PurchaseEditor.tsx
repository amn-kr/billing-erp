/**
 * Purchase bill / order / debit note editor (#vPEd) — the prototype's openPDoc /
 * renderPE / renderPETotals / savePE with the shared editor parts it uses
 * (footer tools, payment-made pop-up, dues button, last purchase rates).
 * Routes: /purchases/new?kind=bill|order|debit_note, &order=<id> (convert an
 * order), &against=<bill id> (return goods), &party=<id>; /purchases/new?edit=<id>
 * opens a saved one in the same screen (same number, passcode when it is on).
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DN_REASONS, PU_MODES, amountInWords, batchDateText, isBankMode, parseBatchDate, purchaseTotals, type PurchaseInput } from '@billing/shared';
import { bankFor, bankOf, useBankPick } from '../banking/BankPick';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { Icon, RawIcon } from '../../components/Icon';
import { useDcf } from '../../components/Discard';
import { useShell } from '../shell/store';
import { toastSaveFailed, toastSaved } from '../shell/saved';
import { EntryClose, useFullscreen } from '../shell/EntryFrame';
import { AddPartyDialog } from '../parties/AddPartyDialog';
import { AddItemDialog } from '../items/AddItemDialog';
import { qfmt } from '../items/ItemsPage';
import type { Party } from '../parties/PartiesPage';
import { pct } from '../sales/InvoicePreview';
import { useEditorData, type EditorData } from '../sales/editor/data';
import { ComboList, comboKey, useCombo, type ComboOpt } from '../sales/editor/Grid';
import { useEditorLayout } from '../sales/editor/layout';
import { PhDrop, type PH } from '../sales/editor/PriceHistory';
import { DGACC, DGIMG } from '../sales/editor/ToolsPop';
import { DG_TERMS, addDaysIso, daysDiff, partyState, r2, type EItem, type EParty } from '../sales/editor/state';
import { PE_T, PU_KEYS, usePurchases, type PKind, type PurchaseDoc } from './model';
import { editAsk, withPasscode } from '../settings/passcode';
import { useFeature } from '../../lib/features';
import { BatchRowCells, type LineBatch } from './BatchRow';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { ui } from '../../styles/uiSize';

const BACK = '<path d="M15 6l-6 6 6 6"/>';
const WALLET = '<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14.5h1"/>';
const TOOLS: [Tool, string, string][] = [['tr', '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 'Transport details'], ['te', '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>', 'Notes'], ['de', '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>', 'Description'], ['at', '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>', 'Attachments']];
type Tool = 'tr' | 'te' | 'de' | 'at';
const KBD = { background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' };
const fmtPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const LIST: Record<PKind, string> = { bill: '/purchase-bills', order: '/purchase-orders', debit_note: '/debit-notes' };
const NO_LBL: Record<PKind, string> = { bill: 'Bill no.', order: 'Order no.', debit_note: 'Debit note no.' };

interface PLine extends Partial<LineBatch> { id: string; name: string; hsn: string; qty: string | number; unit: string; rate: string | number; disc: string | number; gst: number }
/** acct: the bank account picked for UPI / bank transfer ('' = the default bank) */
interface PPay { mode: string; amt: string | number; ref: string; acct?: string }
interface PE {
  kind: PKind; no: string; autoNo: boolean; ref: string; date: string; due: string; exp: string; party: EParty | null;
  against: string; reason: string; incl: boolean; roundOff: boolean; pays: PPay[]; updPrice: boolean; fromOrderId: string | null; notes: string;
  lines: PLine[]; bdisc: string | number; bdiscP: string; chTr: string | number; chLab: string | number;
  ewb: string; transport: string; vehicle: string; delivDate: string; desc: string; attach: string[]; err: string;
  /** editing a saved one: its id, the quantity of each item it had (already in stock), what payments made and
   * debit notes settle on it, and what it still owed when opened (in the supplier's balance) */
  editId: string | null; was: Record<string, number>; settled: number; owedWas: number;
}
const peLine = (): PLine => ({ id: '', name: '', hsn: '', qty: 1, unit: '', rate: 0, disc: 0, gst: 18 });
const n = (v: string | number | undefined) => Number(v) || 0;

function newPE(kind: PKind, no: string): PE {
  const d = today();
  return {
    kind, no, autoNo: true, ref: '', date: d, due: d, exp: addDaysIso(d, 5), party: null, against: '', reason: 'Damaged goods', incl: false, roundOff: true,
    pays: [{ mode: 'Bank transfer', amt: 0, ref: '' }], updPrice: kind === 'bill', fromOrderId: null, notes: kind === 'order' ? 'Please deliver within the expected date.' : '',
    lines: [peLine()], bdisc: 0, bdiscP: '', chTr: 0, chLab: 0, ewb: '', transport: '', vehicle: '', delivDate: '', desc: '', attach: [], err: '',
    editId: null, was: {}, settled: 0, owedWas: 0,
  };
}

/** A saved bill, order or debit note in the editor, as it was saved. */
function savedPE(d: EditorData, v: PurchaseDoc): PE {
  const s = newPE(v.kind, v.number);
  const p = d.PT.find((x) => x.id === v.party.id);
  // a supplier archived since is still shown
  s.party = p ?? { id: v.party.id, name: v.party.name, phone: v.party.phone, gstin: v.party.gstin, city: '', state: '', group: '', days: 0, limit: 0, supplier: true, balance: 0 };
  Object.assign(s, {
    autoNo: false, editId: v.id, ref: v.supplierRef, date: v.date, incl: v.pricesInclTax, roundOff: v.roundOff, notes: v.notes, updPrice: false,
    bdiscP: v.billDiscPct ? String(Number(v.billDiscPct)) : '', bdisc: v.billDiscAmt ? Number(v.billDiscAmt) : 0, chTr: Number(v.transport) || 0, chLab: Number(v.labour) || 0,
    settled: Number(v.settledElsewhere) || 0, owedWas: v.kind === 'bill' ? Number(v.balance) || 0 : 0,
  });
  if (v.kind === 'bill') s.due = v.dueDate ?? v.date;
  if (v.kind === 'order') s.exp = v.dueDate ?? s.exp;
  if (v.kind === 'debit_note') { s.against = v.sourceId ?? ''; s.reason = v.reason || s.reason; }
  s.lines = [...v.lines.map((l) => ({ id: l.itemId, name: l.name, hsn: l.hsn, qty: Number(l.qty), unit: l.unit, rate: Number(l.rate), disc: Number(l.discPct) || 0, gst: Number(l.gstRate), batchNo: l.batchNo ?? '', mfg: batchDateText(l.mfg, 'mfg'), expiry: batchDateText(l.expiry, 'expiry'), batchId: l.batchId ?? '' })), peLine()];
  for (const l of v.lines) s.was[l.itemId] = r2((s.was[l.itemId] ?? 0) + Number(l.qty));
  const paid = v.settlements.filter((x) => x.atBill);
  if (paid.length) s.pays = paid.map((x) => ({ mode: x.mode, amt: Number(x.amount), ref: x.ref, acct: x.accountId ?? '' }));
  return s;
}

export function PurchaseEditor() {
  useFullscreen();
  const d = useEditorData();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pe, setPe] = useState<PE | null>(null);
  const key = params.toString();
  // a new document each time the address changes (Alt+P inside the editor starts another)
  useEffect(() => {
    if (!d) return;
    let live = true;
    void (async () => {
      const edit = params.get('edit');
      if (edit) {
        try {
          const v = await qc.fetchQuery({ queryKey: ['purchase', edit], queryFn: () => api<PurchaseDoc>(`/purchases/${edit}`), staleTime: 0 });
          if (v.locked) { useShell.getState().showToast(v.locked); navigate(LIST[v.kind], { replace: true }); return; }
          if (live) setPe(savedPE(d, v));
        } catch (e) { useShell.getState().showToast(e instanceof ApiError ? e.message : 'Could not open the document.'); navigate(-1); }
        return;
      }
      const k = (['bill', 'order', 'debit_note'].includes(params.get('kind') ?? '') ? params.get('kind') : 'bill') as PKind;
      const no = (await qc.fetchQuery({ queryKey: ['next-number', 'purchase', k], queryFn: () => api<{ number: string }>(`/purchases/next-number?kind=${k}`), staleTime: 0 })).number;
      const s = newPE(k, no);
      const pickP = (id: string) => { const p = d.PT.find((x) => x.id === id); if (p) { s.party = p; s.due = addDaysIso(s.date, p.days || 0); } };
      if (params.get('party')) pickP(params.get('party')!);
      const src = params.get('order') ?? params.get('against');
      if (src) {
        const v = await qc.fetchQuery({ queryKey: ['purchase', src], queryFn: () => api<PurchaseDoc>(`/purchases/${src}`) });
        pickP(v.party.id);
        const lines = v.lines.map((l) => ({ id: l.itemId, name: l.name, hsn: l.hsn, qty: params.get('order') ? Number(l.qty) : 1, unit: l.unit, rate: Number(l.rate), disc: Number(l.discPct) || 0, gst: Number(l.gstRate) }));
        s.lines = [...lines, peLine()];
        if (params.get('order')) { s.fromOrderId = v.id; s.notes = `Against order ${v.number}.`; useShell.getState().showToast(`Lines copied from ${v.number}. Check rates and quantities received.`); }
        else s.against = v.id;
      }
      if (live) setPe(s);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!d, key]);
  if (!d || !pe) return <section id="vPEd"></section>;
  return <Editor key={key} d={d} init={pe} />;
}

function Editor({ d, init }: { d: EditorData; init: PE }) {
  const bp = useBankPick();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [s, setS] = useState<PE>(init);
  const up = (fn: (x: PE) => void) => setS((p) => { const x: PE = { ...p, lines: p.lines.map((l) => ({ ...l })), pays: p.pays.map((q) => ({ ...q })), attach: [...p.attach] }; fn(x); return x; });
  const c = useCombo();
  const ref = useRef<HTMLElement>(null);
  const [pop, setPop] = useState<'pay' | Tool | null>(null);
  const [addParty, setAddParty] = useState<string | null>(null);
  const [addItem, setAddItem] = useState<{ q: string; i: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ph, setPh] = useState<{ i: number; H: PH[]; who: string; anchor: HTMLElement } | null>(null);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  useEditorLayout(ref);
  const k = s.kind;
  const G = d.ctx.mode === 'gst';
  const gstOn = d.gstOn;
  const p = s.party;
  const inter = G && !!p && partyState(d.ctx, p) !== d.ctx.state;
  const t = purchaseTotals({ mode: d.ctx.mode, incl: s.incl, inter, roundOff: s.roundOff, bdiscP: s.bdiscP || null, bdisc: s.bdiscP ? null : n(s.bdisc), chTr: n(s.chTr), chLab: n(s.chLab), lines: s.lines.map((l) => ({ qty: n(l.qty), price: n(l.rate), disc: n(l.disc), gst: G ? l.gst : 0 })) });
  const total = Number(t.total);
  const bills = usePurchases('bill');
  const partyBills = p ? (bills.data ?? []).filter((b) => b.party.id === p.id && !b.cancelled) : [];
  const item = (l: PLine) => (l.id ? d.IT.find((x) => x.id === l.id) : undefined);

  // the number shown is only a preview until the document is saved
  const nn = useQuery({ queryKey: ['next-number', 'purchase', k], queryFn: () => api<{ number: string }>(`/purchases/next-number?kind=${k}`), enabled: s.autoNo });
  useEffect(() => { const v = nn.data?.number; if (s.autoNo && v && v !== s.no) up((x) => { x.no = v; }); }, [nn.data]); // eslint-disable-line react-hooks/exhaustive-deps

  /* first focus: the supplier, or the first item when the supplier is set */
  useEffect(() => { setTimeout(() => (document.querySelector<HTMLElement>(init.party ? '#peRows .pe-item' : '#peParty'))?.focus(), 30); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const [ptxt, setPtxt] = useState(init.party?.name ?? '');
  const pickParty = (q: EParty) => { setPtxt(q.name); up((x) => { x.party = q; x.due = addDaysIso(x.date, q.days || 0); }); };
  const partyPick = (v: unknown) => {
    if (v === '__add') { c.hide(); setAddParty((document.getElementById('peParty') as HTMLInputElement | null)?.value ?? ''); return; }
    pickParty(v as EParty); c.hide();
    setTimeout(() => document.querySelector<HTMLElement>('#peRows .pe-item')?.focus(), 0);
  };
  const supOpts = (q: string): ComboOpt[] => {
    const ql = q.toLowerCase();
    const L = d.PT.filter((x) => !ql || x.name.toLowerCase().includes(ql) || x.phone.includes(ql)).sort((a, b) => Number(!a.supplier) - Number(!b.supplier)).slice(0, 30);
    return [{ add: true, html: <><Icon name="plus" /><b>Add new supplier</b>{q ? ` “${q}”` : ''}</>, val: '__add' },
      ...L.map((x) => ({ val: x, html: <><span><b>{x.name}</b><small>{x.phone ? '+91 ' + x.phone : ''}{x.city ? ' · ' + x.city : ''}{x.supplier ? ' · supplier' : ' · customer'}</small></span><span className={x.balance < 0 ? 'neg' : 'mu'}>{inr(Math.abs(x.balance))}</span></> }))];
  };
  const itemOpts = (q: string): ComboOpt[] => {
    const ql = q.toLowerCase();
    const L = d.IT.filter((i) => !i.svc && (!ql || i.name.toLowerCase().includes(ql) || i.code.toLowerCase().includes(ql) || i.brand.toLowerCase().includes(ql) || i.hsn.includes(ql))).slice(0, 40);
    return [{ add: true, html: <><Icon name="plus" /><b>Add new item</b>{q ? ` “${q}”` : ''}</>, val: '__add' },
      ...L.map((i) => ({ val: i, html: <><span><b>{i.name}</b><small>{i.code ? i.code + ' · ' : ''}Stock {qfmt(i.stock ?? 0)} {i.unit}</small></span><span><b>{inr2f(i.purch || 0)}</b><small>last purchase</small></span></> }))];
  };
  const pickItem = (i: number, v: unknown) => {
    if (v === '__add') { c.hide(); setAddItem({ q: s.lines[i]?.name ?? '', i }); return; }
    const it = v as EItem;
    up((x) => { Object.assign(x.lines[i]!, { id: it.id, name: it.name, hsn: it.hsn || '', unit: it.unit, rate: it.purch || 0, gst: G ? it.gst || 0 : 0, batchNo: '', mfg: '', expiry: '', batchId: '' }); if (i === x.lines.length - 1) x.lines.push(peLine()); });
    c.hide();
    setTimeout(() => { const q = document.querySelector<HTMLInputElement>(`#peRows tr[data-ln="${i}"] [data-pf="qty"]`); q?.focus(); q?.select(); }, 0);
  };
  const stockTxt = (l: PLine) => {
    const it = item(l);
    if (!it || it.svc) return null;
    // editing: the stock without this document's own quantity
    const st = stockBefore(it), diff = k === 'bill' && n(l.rate) && Math.abs(n(l.rate) - (it.purch || 0)) > 0.009;
    return <>Stock {qfmt(st)} {l.unit}{k === 'bill' ? ` → ${qfmt(st + n(l.qty))}` : k === 'debit_note' ? ` → ${qfmt(st - n(l.qty))}` : ''}{diff ? <> · <span className="pech">last ₹{inr2f(it.purch || 0)}</span></> : null}</>;
  };
  function stockBefore(it: EItem) { const w = s.was[it.id] ?? 0; return r2((it.stock ?? 0) - (k === 'bill' ? w : k === 'debit_note' ? -w : 0)); }
  // items whose purchase price this bill would change (net rate per unit)
  const changes = k === 'bill' ? s.lines.flatMap((l, i) => { const it = item(l); if (!it || !(n(l.qty) > 0)) return []; const nv = r2(Number(t.rows[i]!.tv) / n(l.qty)); return Math.abs(nv - (it.purch || 0)) > 0.009 ? [{ it, ov: it.purch || 0, nv }] : []; }) : [];

  /* payment made with the bill (prototype payRender / payTotals 'pe') */
  const paid = r2(s.pays.reduce((a, q) => a + n(q.amt), 0));
  // editing: payments made and debit notes already settle part of the bill, and what it still owed is in the supplier's balance
  const bal = r2(total - paid - s.settled);
  const pre = p ? r2(-p.balance - (p.id === init.party?.id ? s.owedWas : 0)) : null;

  /* last purchase rates from this supplier (prototype phPur) */
  useEffect(() => {
    const SEL = '#peRows [data-pf="rate"], #peRows [data-pf="qty"]';
    const fin = async (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.matches?.(SEL)) { if (!el.closest?.('#phPop')) setPh(null); return; }
      const tr = el.closest<HTMLElement>('tr[data-ln]');
      const x = cur.current;
      if (!tr || x.kind === 'debit_note' || !x.party) return setPh(null);
      const i = Number(tr.dataset.ln), l = x.lines[i];
      if (!l?.id) return setPh(null);
      const q = new URLSearchParams({ item: l.id, party: x.party.id });
      const H = await qc.fetchQuery({ queryKey: ['purchase-price-history', q.toString()], queryFn: () => api<PH[]>(`/purchases/price-history?${q}`), staleTime: 30_000 });
      if (document.activeElement !== el) return;
      setPh(H.length ? { i, H, who: x.party.name, anchor: tr.querySelector<HTMLElement>('[data-pf="rate"]')!.closest('td')! } : null);
    };
    const fout = (e: FocusEvent) => { if (!(e.target as HTMLElement).matches?.(SEL)) return; setTimeout(() => { if (!(document.activeElement as HTMLElement | null)?.matches?.(SEL)) setPh(null); }, 120); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPh((v) => { if (v) e.stopPropagation(); return null; }); };
    document.addEventListener('focusin', fin);
    document.addEventListener('focusout', fout);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('focusin', fin); document.removeEventListener('focusout', fout); document.removeEventListener('keydown', esc, true); };
  }, [qc]);
  const cur = useRef(s);
  cur.current = s;
  // Features › batch_expiry: bills and debit notes ask for a tracked item's batch; orders move no stock
  const batchOn = useFeature('batch_expiry');
  const tracked = (l: PLine) => batchOn && k !== 'order' && !!l.id && !!d.IT.find((x) => x.id === l.id)?.track;

  /* ---------- save (prototype savePE) ---------- */
  const save = async (sure = false) => {
    const err = (m: string, focus?: () => void) => { up((x) => { x.err = m; }); toastSaveFailed(m); focus?.(); };
    const lines = s.lines.filter((l) => l.id || l.name.trim());
    if (!p) return err('Choose the supplier.', () => document.getElementById('peParty')?.focus());
    if (!lines.length) return err('Add at least one item.');
    const unk = lines.find((l) => !l.id);
    if (unk) return err(`“${unk.name}” isn’t in your items. Pick it from the list or add it as a new item.`);
    const bad = lines.find((l) => !(n(l.qty) > 0));
    if (bad) return err(`Enter a quantity for “${bad.name}”.`);
    if (k !== 'order' && lines.find((l) => !(n(l.rate) > 0))) return err('Enter a rate for every item.');
    if (!s.autoNo && !s.no) return err(`Number ${s.no} is already used.`);
    if (k === 'bill') {
      const at = (l: PLine, f: string) => () => document.querySelector<HTMLInputElement>(`#peRows tr[data-bx="${s.lines.indexOf(l)}"] [data-bf="${f}"]`)?.focus();
      const noBatch = lines.find((l) => tracked(l) && !l.batchNo?.trim());
      if (noBatch) return err(`Enter the batch no. for “${noBatch.name}”.`, at(noBatch, 'batchNo'));
      const badMfg = lines.find((l) => tracked(l) && parseBatchDate(l.mfg, 'mfg') === undefined);
      if (badMfg) return err(`“${badMfg.mfg}” isn’t a date. Type the mfg date like 01/26.`, at(badMfg, 'mfg'));
      const badExp = lines.find((l) => tracked(l) && parseBatchDate(l.expiry, 'expiry') === undefined);
      if (badExp) return err(`“${badExp.expiry}” isn’t a date. Type the expiry like 03/27.`, at(badExp, 'expiry'));
    }
    up((x) => { x.err = ''; });
    // editing a bill: goods already sold can take stock below zero, as cancelling it would; say so first
    const short = s.editId && k === 'bill' ? [...new Set(lines.map((l) => l.id))].flatMap((id) => {
      const it = d.IT.find((x) => x.id === id);
      if (!it || it.svc) return [];
      const now = it.stock ?? 0, after = r2(stockBefore(it) + lines.filter((l) => l.id === id).reduce((a, l) => a + n(l.qty), 0));
      return after < 0 && after < now ? [{ it, after }] : [];
    }) : [];
    if (short.length && !sure) {
      setModal({
        title: 'Stock will go below zero', sub: 'Some of these goods were already sold.', ok: 'Save anyway', cancel: 'Go back',
        body: <ul className="slcl">{short.map((x) => <li key={x.it.id}><b>{x.it.name}</b>: stock becomes {qfmt(x.after)} {x.it.unit}.</li>)}<li>Cancelling the bill would do the same. Check the quantities, or save and correct the stock later.</li></ul>,
        onOk: () => { setModal(null); void saveRef.current(true); },
      });
      return;
    }
    let left = r2(total - s.settled);
    const pays = k === 'bill' ? s.pays.filter((q) => n(q.amt) > 0).flatMap((q) => { const a = Math.min(n(q.amt), left); if (!(a > 0)) return []; left = r2(left - a); return [{ mode: q.mode as PurchaseInput['payments'][number]['mode'], amount: String(r2(a)), ref: q.ref, accountId: bankFor(bp, q.mode, q.acct) }]; }) : [];
    const body: PurchaseInput = {
      kind: k, number: s.autoNo && !s.editId ? '' : s.no, supplierRef: s.ref.trim(), date: s.date, dueDate: k === 'bill' ? s.due : k === 'order' ? s.exp : null, partyId: p.id,
      pricesInclTax: s.incl, roundOff: s.roundOff, billDiscPct: s.bdiscP || null, billDiscAmt: s.bdiscP ? null : n(s.bdisc) ? String(s.bdisc) : null, transport: String(n(s.chTr)), labour: String(n(s.chLab)),
      lines: lines.map((l) => ({ itemId: l.id, name: l.name, hsn: l.hsn, unit: l.unit, qty: String(n(l.qty)), rate: String(n(l.rate)), discPct: String(n(l.disc)), gstRate: String(G ? l.gst : 0), ...(tracked(l) && (k === 'bill' ? { batchNo: l.batchNo ?? '', mfg: l.mfg ?? '', expiry: l.expiry ?? '' } : { batchId: l.batchId || null })) })),
      payments: pays, updatePrices: k === 'bill' && s.updPrice, againstId: k === 'debit_note' && s.against ? s.against : null, reason: s.reason as PurchaseInput['reason'], fromOrderId: s.editId ? null : s.fromOrderId,
      notes: s.notes, extra: { ewb: s.ewb, transport: s.transport, vehicle: s.vehicle, deliveryDate: s.delivDate, description: s.desc, attachments: s.attach },
    };
    setBusy(true);
    try {
      if (s.editId) { const id = s.editId; if (!(await withPasscode(qc, editAsk(s.no), (h) => api(`/purchases/${id}`, { method: 'PUT', body, headers: h })))) return; }
      else await api('/purchases', { method: 'POST', body });
      await Promise.all(PU_KEYS.map((x) => qc.invalidateQueries({ queryKey: [x] })));
      toastSaved(k);
      navigate(LIST[k]);
    } catch (e) { err(e instanceof ApiError ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  /* back: asks first when something was entered (prototype peDirty + askDiscard) */
  const entered = (x: PE) => !!x.party || x.lines.some((l) => l.id || l.name.trim());
  const back = () => {
    const x = cur.current;
    const go = () => navigate(LIST[x.kind]);
    if (entered(x)) useDcf.getState().ask(x.kind === 'order' ? 'purchase order' : x.kind === 'debit_note' ? 'debit note' : 'purchase bill', go);
    else go();
  };
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const modal = [...document.querySelectorAll<HTMLElement>('.ov')].some((o) => !o.hidden);
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !modal) { e.preventDefault(); void saveRef.current(); return; }
      if (e.key === 'Escape' && !modal) setPop((v) => { if (v) { e.stopPropagation(); setTimeout(() => (v === 'pay' ? document.getElementById('pePayBtn') : document.querySelector<HTMLElement>(`#peTools [data-dgt="pe:${v}"]`))?.focus(), 0); } return null; });
    };
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      setPop((v) => {
        if (v === 'pay' && !el.closest('#pePayPop') && !el.closest('#pePayBtn')) return null;
        if (v && v !== 'pay' && !el.closest('.dgpop') && !el.closest('[data-dgt]') && !el.closest('.dgtools')) return null;
        return v;
      });
    };
    document.addEventListener('keydown', kd, true);
    document.addEventListener('mousedown', down, true);
    return () => { document.removeEventListener('keydown', kd, true); document.removeEventListener('mousedown', down, true); };
  }, []);
  // pop-ups sit above their footer button, 12px inside the window (prototype payPopOpen / dgPopOpen)
  useLayoutEffect(() => {
    if (!pop) return;
    const place = () => {
      const pp = document.getElementById(pop === 'pay' ? 'pePayPop' : 'pePop');
      const b = pop === 'pay' ? document.getElementById('pePayBtn') : document.querySelector(`#peTools [data-dgt="pe:${pop}"]`) ?? document.getElementById('peTools');
      const foot = document.querySelector('#vPEd .sift');
      if (!pp || !b || !foot) return;
      const r = b.getBoundingClientRect();
      pp.style.left = Math.max(12, Math.min(r.left, innerWidth - pp.offsetWidth - 12)) + 'px';
      pp.style.bottom = innerHeight - foot.getBoundingClientRect().top + 8 + 'px';
    };
    place();
    if (pop === 'pay') return;
    const tm = setTimeout(() => document.querySelector<HTMLElement>('#pePop textarea, #pePop input:not([type=file]), #pePop select')?.focus(), 20);
    addEventListener('resize', place);
    return () => { clearTimeout(tm); removeEventListener('resize', place); };
  }, [pop]);
  const addFiles = (names: string[]) => up((x) => { x.attach = [...x.attach, ...names]; });
  const st = { tr: !!(s.transport || s.vehicle || s.delivDate), te: !!s.notes.trim(), de: !!s.desc.trim(), at: s.attach.length };
  const notesLbl = k === 'order' ? 'Notes for supplier' : 'Notes';
  const termsD = daysDiff(s.date, s.due);
  const hit = DG_TERMS.find((x) => x[0] === termsD);
  const enterNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const ins = [...document.querySelectorAll<HTMLInputElement>('#peRows input,#peRows select')], nx = ins[ins.indexOf(e.currentTarget) + 1];
    if (nx) { nx.focus(); nx.select?.(); }
  };
  const setLine = (i: number, f: keyof PLine, v: string) => up((x) => { (x.lines[i] as unknown as Record<string, unknown>)[f] = v; x.err = ''; });
  const num = (v: string) => v.replace(/[^\d.]/g, '');

  return (
    <section id="vPEd" ref={ref}>
      <div className="sitop"><button className="ib" type="button" id="peBack" aria-label="Back" title="Back" onClick={back}><RawIcon d={BACK} /></button><h1 id="peTitle">{PE_T[k]}</h1><span className={`st ${k === 'bill' ? 'g' : k === 'debit_note' ? 'r' : ''}`} id="peKindTag">{k === 'bill' ? 'Stock in' : k === 'debit_note' ? 'Stock out' : 'No stock change'}</span><div className="sp"></div>
        <div className="tnd" id="peND"><label className="tndf"><span>{NO_LBL[k]}</span><input className="fi mono" id="peNo" value={s.no} autoComplete="off" aria-label={NO_LBL[k]} readOnly={!!s.editId} title={s.editId ? 'The number of a saved document can’t be changed' : undefined} onChange={(e) => up((x) => { x.no = e.target.value.trim(); x.autoNo = false; })} /></label>
          <label className="tndf"><span>Date</span><input className="fi" type="date" id="peDate" value={s.date} aria-label="Date" onChange={(e) => up((x) => { x.date = e.target.value; if (x.party) x.due = addDaysIso(x.date, x.party.days || 0); })} /></label></div>
        <EntryClose onBack={back} onLeave={() => navigate(LIST[cur.current.kind])} dirty={entered(s)} label={`Cancel ${PE_T[k].toLowerCase()} entry`} /></div>

      <div className="card dgh">
        <div className="dgc" id="peParty_"><div className="ff"><div className="combo"><input className="fi" id="peParty" value={ptxt} placeholder=" " autoComplete="off" role="combobox" aria-expanded={c.cb?.key === 'party'} aria-label="Supplier"
          onChange={(e) => { setPtxt(e.target.value); up((x) => { x.party = null; }); c.show('party', supOpts(e.target.value), partyPick); }}
          onFocus={(e) => { if (!s.party) c.show('party', supOpts(e.target.value), partyPick); }}
          onKeyDown={(e) => { if (c.cb?.key === 'party') comboKey(c, e); }}
          onBlur={() => setTimeout(() => { const a = document.activeElement as HTMLElement | null; if (!a?.closest('.combo')) c.hide(); }, 120)} /><ComboList c={c} k="party" /></div><span>Search supplier by name / phone <b className="req">*</b></span></div>
          {p ? <div className="sipi"><div>{p.phone ? <span><Icon name="phone" />{fmtPhone(p.phone)}</span> : null}{p.gstin ? <span className="mono needs-gst">GSTIN {p.gstin}</span> : <span className="needs-gst">Unregistered</span>}{p.city ? <span>{p.city}</span> : null}</div>
            <div><span>Balance: <b className={p.balance < 0 ? 'neg' : p.balance > 0 ? 'pos' : ''}>{inr(Math.abs(p.balance))} {p.balance < 0 ? 'to pay' : p.balance > 0 ? 'advance' : ''}</b></span>{p.days ? <span>{p.days}-day credit</span> : null}</div></div> : null}</div>
        <div className="dgc" id="peMid">
          {k === 'bill' ? <div className="dg2"><label className="ff"><input className="fi mono" id="peRef" value={s.ref} placeholder=" " autoComplete="off" onChange={(e) => up((x) => { x.ref = e.target.value; })} /><span>Supplier’s bill no.</span></label>{gstOn ? <label className="ff"><input className="fi" id="peEwb" value={s.ewb} placeholder=" " autoComplete="off" onChange={(e) => up((x) => { x.ewb = e.target.value; })} /><span>E-way bill no.</span></label> : null}</div>
            : k === 'order' ? <div className="dg2"><label className="ff"><input className="fi" id="peRef" value={s.ref} placeholder=" " autoComplete="off" onChange={(e) => up((x) => { x.ref = e.target.value; })} /><span>Supplier quotation ref. (optional)</span></label></div>
            : <div className="dg2"><label className="ff on"><select className="fi" id="peAgainst" value={s.against} onChange={(e) => up((x) => { x.against = e.target.value; })}><option value="">Not linked to a bill</option>{partyBills.map((b) => <option value={b.id} key={b.id}>{b.number} · {dmy(b.date)} · ₹{inr2f(b.total)}</option>)}</select><span>Against bill</span></label>
              <label className="ff on"><select className="fi" id="peReason" value={s.reason} onChange={(e) => up((x) => { x.reason = e.target.value; })}>{DN_REASONS.map((r) => <option key={r}>{r}</option>)}</select><span>Reason</span></label></div>}</div>
        <div className="dgc dgr" id="peMeta">
          {k === 'bill' ? <div className="dg2"><label className="ff on"><select className="fi" id="peTerms" value={hit ? String(hit[0]) : 'c'} onChange={(e) => { if (e.target.value !== 'c') { const v = Number(e.target.value); up((x) => { x.due = addDaysIso(x.date, v); }); } }}>{DG_TERMS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}<option value="c">Custom{hit || isNaN(termsD) ? '' : ` (${termsD} days)`}</option></select><span>Payment terms</span></label>
            <label className="ff on"><input className="fi" id="peDue" value={s.due} placeholder=" " autoComplete="off" type="date" onChange={(e) => up((x) => { x.due = e.target.value; })} /><span>Due date</span></label></div> : null}
          {k === 'order' ? <div className="dg2"><label className="ff on"><input className="fi" id="peExp" value={s.exp} placeholder=" " autoComplete="off" type="date" onChange={(e) => up((x) => { x.exp = e.target.value; })} /><span>Expected delivery</span></label><span></span></div> : null}</div>
      </div>

      <div className="card dggrid"><div className="tw dgw"><table className="dgt">
        <thead id="peHead"><tr><th rowSpan={2} className="c">#</th><th rowSpan={2} className="it">Item</th><th rowSpan={2} className="hic">Item code</th><th rowSpan={2} className="hib">Brand</th><th rowSpan={2} className="his">Series</th>{gstOn ? <th rowSpan={2} className="hs">HSN</th> : null}<th rowSpan={2} className="n qt">Qty</th><th rowSpan={2} className="un">Unit</th>
          <th rowSpan={2} className="n pr">Rate{G ? <label className="siincl"><input type="checkbox" id="peIncl" checked={s.incl} onChange={(e) => up((x) => { x.incl = e.target.checked; })} /> incl. GST</label> : null}</th><th colSpan={2} className="c grp">Discount</th><th rowSpan={2} className="n fr">Final rate</th>{G ? <th colSpan={2} className="c grp">Tax</th> : null}<th rowSpan={2} className="n am">Amount</th><th rowSpan={2} className="x"><span className="sr">Remove</span></th></tr>
          <tr><th className="n sub dp">%</th><th className="n sub da">Amount</th>{G ? <><th className="n sub tp">%</th><th className="n sub ta">Amount</th></> : null}</tr></thead>
        <tbody id="peRows">{s.lines.map((l, i) => {
          const it = item(l), r = t.rows[i]!, sk = `item${i}`, stx = stockTxt(l);
          return (
            <Fragment key={i}><tr data-ln={i}><td className="c">{i + 1}</td>
              <td><div className="gic"><div className="combo"><input className="gi pe-item" data-pf="name" value={it && it.grp && it.brand ? it.grp : l.name} title={l.name} placeholder="Search item, brand or code" autoComplete="off" aria-label={`Item ${i + 1}`}
                onChange={(e) => { const v = e.target.value; up((x) => { Object.assign(x.lines[i]!, { name: v, id: '' }); }); c.show(sk, itemOpts(v), (o) => pickItem(i, o)); }}
                onFocus={(e) => { if (!l.id) c.show(sk, itemOpts(e.target.value), (o) => pickItem(i, o)); }}
                onKeyDown={(e) => { if (c.cb?.key === sk && comboKey(c, e)) return; enterNext(e); }}
                onBlur={() => setTimeout(() => { const a = document.activeElement as HTMLElement | null; if (!a?.closest('.combo')) c.hide(); }, 120)} /><ComboList c={c} k={sk} grid /></div>{stx ? <small className="mu">{stx}</small> : null}</div></td>
              <td className="ro l mono dgc1">{it?.code ?? ''}</td><td className="ro l dgc2">{it?.brand ?? ''}</td><td className="ro l dgc2">{it?.series ?? ''}</td>
              {gstOn ? <td><input className="gi" data-pf="hsn" value={l.hsn} inputMode="numeric" aria-label="HSN" onChange={(e) => setLine(i, 'hsn', e.target.value)} onKeyDown={enterNext} /></td> : null}
              <td><input className="gi n" data-pf="qty" value={l.qty} inputMode="decimal" aria-label="Quantity" onChange={(e) => setLine(i, 'qty', e.target.value)} onKeyDown={enterNext} /></td><td className="ro l">{l.unit || '—'}</td>
              <td><input className="gi n" data-pf="rate" value={l.rate} inputMode="decimal" aria-label="Rate" onChange={(e) => setLine(i, 'rate', e.target.value)} onKeyDown={enterNext} /></td>
              <td><input className="gi n" data-pf="disc" value={typeof l.disc === 'string' ? l.disc : l.disc ? r2(l.disc) : ''} placeholder="0" inputMode="decimal" aria-label="Discount percent" onChange={(e) => setLine(i, 'disc', e.target.value)} onKeyDown={enterNext} /></td>
              <td><DiscAmt value={Number(r.disc)} onSet={(a) => up((x) => { const L = x.lines[i]!; const g = n(L.qty) * n(L.rate); L.disc = g > 0 ? Math.min(100, (a / g) * 100) : 0; })} onKeyDown={enterNext} /></td>
              <td className="ro b" data-o="fr">{inr2f(r2(n(l.rate) * (1 - n(l.disc) / 100)))}</td>
              {G ? <><td><select className="gi" data-pf="gst" aria-label="GST rate" value={String(l.gst)} onKeyDown={tracked(l) ? (e) => enterNext(e as unknown as React.KeyboardEvent<HTMLInputElement>) : undefined} onChange={(e) => up((x) => { x.lines[i]!.gst = Number(e.target.value); })}>{d.gstRates.map((g) => <option value={String(g)} key={g}>{pct(g)}</option>)}</select></td><td className="ro" data-o="tx">{inr2f(r.tx.toString())}</td></> : null}
              <td className="ro b" data-o="amt">{inr2f(r.amt.toString())}</td><td className="x"><button type="button" className="ix" data-pdel={i} aria-label={`Remove row ${i + 1}`} disabled={s.lines.length === 1} onClick={() => up((x) => { x.lines.splice(i, 1); if (!x.lines.length) x.lines.push(peLine()); })}><Icon name="x" /></button></td></tr>
            {tracked(l) && k !== 'order' ? <BatchRowCells i={i} cols={4 + (gstOn ? 1 : 0) + 6 + (G ? 2 : 0) + 2} kind={k} itemId={l.id} against={!!s.against} b={{ batchNo: l.batchNo ?? '', mfg: l.mfg ?? '', expiry: l.expiry ?? '', batchId: l.batchId ?? '' }} onChange={(f, v) => setLine(i, f, v)} onKeyDown={enterNext} /> : null}</Fragment>
          );
        })}</tbody>
        <tfoot id="peFoot"><tr><td></td><td><div className="dgft"><button type="button" className="btn sm" id="peAddRow" onClick={() => { up((x) => { x.lines.push(peLine()); }); setTimeout(() => [...document.querySelectorAll<HTMLElement>('#peRows .pe-item')].pop()?.focus(), 0); }}><Icon name="plus" />Add row</button><b>Total</b></div></td><td></td><td></td><td></td>{gstOn ? <td></td> : null}
          <td className="ro" data-t="qty">{qfmt(s.lines.reduce((a, l) => a + (l.id || l.name ? n(l.qty) : 0), 0))}</td><td></td><td></td><td></td><td className="ro" data-t="disc">{inr2f(t.rows.reduce((a, r) => a + Number(r.disc), 0))}</td><td></td>{G ? <><td></td><td className="ro" data-t="tx">{inr2f(t.rows.reduce((a, r) => a + Number(r.tx), 0))}</td></> : null}<td className="ro b" data-t="amt">{inr2f(t.rows.reduce((a, r) => a + Number(r.amt), 0))}</td><td></td></tr></tfoot>
      </table></div></div>

      <div className="dgb">
        <div className="dgbl2"><div className="dgx" id="peExtra" aria-label="Added details">
          {st.tr ? <button type="button" className="dgxc" data-dgt="pe:tr" onClick={() => setPop('tr')}><RawIcon d={TOOLS[0]![1]} /><span>{[s.transport, s.vehicle, s.delivDate ? dmy(s.delivDate) : ''].filter(Boolean).join(' · ')}</span></button> : null}
          {st.de ? <button type="button" className="dgxc" data-dgt="pe:de" onClick={() => setPop('de')}><RawIcon d={TOOLS[2]![1]} /><span>{s.desc.trim().split('\n')[0]!.slice(0, 40)}</span></button> : null}
          {st.at ? (() => { const phc = s.attach.filter((x) => DGIMG.test(x)).length, dc = s.attach.length - phc; return <button type="button" className="dgxc" data-dgt="pe:at" onClick={() => setPop('at')}><RawIcon d={TOOLS[3]![1]} /><span>{[phc ? `${phc} photo${phc > 1 ? 's' : ''}` : '', dc ? `${dc} document${dc > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span></button>; })() : null}
        </div></div>
        <div className="card sitot dgtot"><div id="peAdj"><div className="adr"><span>Discount</span><span className="pre3"><input className="fi n" id="peBdP" value={s.bdiscP} placeholder="0" inputMode="decimal" aria-label="Discount percent" onChange={(e) => { let v = num(e.target.value); if (Number(v) > 100) v = '100'; up((x) => { x.bdiscP = v; x.bdisc = 0; }); }} /><i>%</i></span>
          <span className="pre3"><i>₹</i><input className="fi n" id="peBd" value={s.bdiscP ? (Number(t.bdisc) ? String(Number(t.bdisc)) : '') : n(s.bdisc) || s.bdisc === '' ? String(s.bdisc) : ''} placeholder="0" inputMode="decimal" aria-label="Discount amount" onChange={(e) => { const v = num(e.target.value); up((x) => { x.bdisc = v; x.bdiscP = ''; }); }} /></span></div>
          {([['Transport charge', 'ChTr', 'chTr'], ['Labour charge', 'ChLab', 'chLab']] as const).map(([lbl, id, f]) => <div className="adr" key={id}><span>{lbl}</span><span className="pre3 wide"><i>₹</i><input className="fi n" id={`pe${id}`} value={n(s[f]) || s[f] === '' ? String(s[f]) : ''} placeholder="0" inputMode="decimal" onChange={(e) => { const v = num(e.target.value); up((x) => { x[f] = v; }); }} /></span></div>)}</div>
          <div id="peTot"><div className="tl"><span>Items total</span><b>{inr2f(t.items.toString())}</b></div>
            {Number(t.bdisc) ? <div className="tl"><span>Discount{s.bdiscP ? ` (${s.bdiscP}%)` : ''}</span><b className="neg">−{inr2f(t.bdisc.toString())}</b></div> : null}
            {G ? <><div className="tl"><span>Taxable value</span><b>{inr2f(t.taxable.toString())}</b></div>{t.inter ? <div className="tl"><span>IGST (input)</span><b>{inr2f(t.igst.toString())}</b></div> : <><div className="tl"><span>CGST (input)</span><b>{inr2f(r2(Number(t.tax) / 2))}</b></div><div className="tl"><span>SGST (input)</span><b>{inr2f(r2(Number(t.tax) / 2))}</b></div></>}</> : null}
            {Number(t.chTr) ? <div className="tl"><span>Transport charge</span><b>+{inr2f(t.chTr.toString())}</b></div> : null}{Number(t.chLab) ? <div className="tl"><span>Labour charge</span><b>+{inr2f(t.chLab.toString())}</b></div> : null}
            <div className="tl"><label className="cb2" style={{ padding: 0 }}><input type="checkbox" id="peRound" checked={s.roundOff} onChange={(e) => up((x) => { x.roundOff = e.target.checked; })} /> Round off</label><b>{Number(t.round) >= 0 ? '+' : '−'}{inr2f(Math.abs(Number(t.round)))}</b></div>
            <div className="tl tt"><span>Total</span><b>₹{inr2f(total)}</b></div><div className="siw">{amountInWords(String(total))}</div>
            {k === 'bill' ? <><label className="cb2 peupd"><input type="checkbox" id="peUpd" checked={s.updPrice} onChange={(e) => up((x) => { x.updPrice = e.target.checked; })} /> Update purchase price in Items{changes.length ? <> <b>({changes.length} change{changes.length > 1 ? 's' : ''})</b></> : null}</label>
              {changes.length && s.updPrice ? <div className="pechl">{changes.slice(0, 4).map((x) => <span key={x.it.id}>{x.it.name}: ₹{inr2f(x.ov)} → <b>₹{inr2f(x.nv)}</b></span>)}{changes.length > 4 ? <span>…and {changes.length - 4} more</span> : null}</div> : null}</> : null}
            {k === 'debit_note' ? <p className="aphint" style={{ margin: ui.sp('8px 0 0') }}>{s.against ? `Reduces what you owe on ${partyBills.find((b) => b.id === s.against)?.number ?? ''}.` : 'Kept as credit with this supplier.'} Stock goes down by the returned quantity.</p> : null}
            {k === 'order' ? <p className="aphint" style={{ margin: ui.sp('8px 0 0') }}>An order doesn’t change stock. Convert it to a bill when the goods arrive.</p> : null}
          </div></div>
      </div>

      {/* payment made with the bill (prototype payRender 'pe') */}
      <div className="dgpop dgpaypop" id="pePayPop" role="dialog" aria-label="Payment made" hidden={pop !== 'pay' || k !== 'bill'}>
        <div className="dgpay" id="pePayC" hidden={k !== 'bill'}>
          <div className="dgpyh"><b>Payment made</b><label className="cb2"><input type="checkbox" id="pePFull" checked={total - s.settled > 0 && Math.abs(bal) < 0.005} onChange={(e) => { const on = e.target.checked; up((x) => { const others = x.pays.slice(1).reduce((a, q) => a + n(q.amt), 0); x.pays[0]!.amt = on ? Math.max(0, r2(total - x.settled - others)) : 0; if (!on) x.pays.forEach((q) => (q.amt = 0)); }); }} /> Fully paid</label></div>
          <div className="dgpyr dgpyl"><span>Payment type</span><span>Amount</span><span>Reference</span><span></span></div>
          {s.pays.map((q, i) => (<Fragment key={i}>
            <div className="dgpyr" data-pay={i}><select className="fi" data-pk="mode" aria-label={`Payment type ${i + 1}`} value={q.mode} onChange={(e) => up((x) => { x.pays[i]!.mode = e.target.value; if (e.target.value === 'Cash') x.pays[i]!.ref = ''; })}>{PU_MODES.map((m) => <option key={m}>{m}</option>)}</select>
              <span className="pre3"><i>₹</i><input className="fi n" data-pk="amt" value={n(q.amt) || q.amt === '' ? String(q.amt) : ''} placeholder="0" inputMode="decimal" aria-label={`Amount ${i + 1}`} onChange={(e) => { const v = num(e.target.value); up((x) => { x.pays[i]!.amt = v; }); }} /></span>
              <input className="fi" data-pk="ref" value={q.ref} placeholder={q.mode === 'Cash' ? '—' : q.mode === 'Cheque' ? 'Cheque no.' : 'Ref / UTR no.'} autoComplete="off" aria-label={`Reference ${i + 1}`} disabled={q.mode === 'Cash'} onChange={(e) => up((x) => { x.pays[i]!.ref = e.target.value; })} />
              <button type="button" className="ix" data-payrm={i} aria-label={`Remove payment ${i + 1}`} disabled={s.pays.length === 1} onClick={() => up((x) => { x.pays.splice(i, 1); })}><Icon name="x" /></button></div>
            {bp.show && isBankMode(q.mode) ? <div className="dgpyr" data-payacct={i}><select className="fi" data-pk="acct" aria-label={`Paid from ${i + 1}`} style={{ gridColumn: '1 / 3' }} value={bankOf(bp, q.acct)} onChange={(e) => up((x) => { x.pays[i]!.acct = e.target.value; })}>{bp.banks.map((a) => <option value={a.id} key={a.id}>Paid from {a.name}</option>)}</select></div> : null}
          </Fragment>))}
          <button type="button" className="btn sm dgpyadd" data-payadd="pe" onClick={() => { up((x) => { const used = x.pays.map((q) => q.mode); const m = PU_MODES.find((y) => !used.includes(y)) ?? PU_MODES[0]; const left = Math.max(0, r2(total - x.settled - x.pays.reduce((a, q) => a + n(q.amt), 0))); x.pays.push({ mode: m, amt: left || '', ref: '' }); }); setTimeout(() => { const ins = [...document.querySelectorAll<HTMLInputElement>('#pePayC [data-pk="amt"]')].pop(); ins?.focus(); ins?.select(); }, 0); }}><Icon name="plus" />Add payment type</button>
          <div className="dgpys"><div><span>Paid now</span><b id="pePRecv">₹{inr2f(paid)}</b></div><div><span>Balance to pay</span><b id="pePBal" className={bal > 0 ? 'neg' : bal < 0 ? 'warn' : 'pos'}>{bal < 0 ? `₹${inr2f(-bal)} extra` : '₹' + inr2f(bal)}</b></div></div>
        </div><div className="dgpf"><button type="button" className="btn p sm" data-paydone="pe" onClick={() => setPop(null)}>Done</button></div></div>
      <div className="dgpop" id="pePop" role="dialog" aria-label="Document details" hidden={!pop || pop === 'pay'}>
        {pop && pop !== 'pay' ? <><ToolBody k={pop} s={s} notesLbl={notesLbl} up={up} onFiles={(names) => { addFiles(names); showToast(`${names.length} file${names.length > 1 ? 's' : ''} attached`); }} />
          <div className="dgpf"><button type="button" className="btn p sm" data-dgdone onClick={() => setPop(null)}>Done</button></div></> : null}
      </div>

      <div className="sift"><div className="dgtools" id="peTools" role="toolbar" aria-label="Document extras">
        {TOOLS.map(([tk, ic, lbl0]) => {
          const v = st[tk], cnt = typeof v === 'number' ? v : 0, lbl = tk === 'te' ? notesLbl : lbl0;
          if (tk === 'at' && !cnt) return <label className="dgtb" title="Attach photo or document" aria-label="Attach photo or document" key={tk}><RawIcon d={ic} /><input type="file" hidden data-dgfile="pe" accept={DGACC} multiple onChange={(e) => { const f = e.target.files; if (f?.length) { const names = [...f].map((x) => x.name); addFiles(names); showToast(`${names.length} file${names.length > 1 ? 's' : ''} attached`); e.target.value = ''; } }} /></label>;
          const open = pop === tk;
          return <button type="button" className={`dgtb ${v ? 'on' : ''} ${open ? 'open' : ''}`} data-dgt={`pe:${tk}`} title={`${lbl}${cnt ? ` (${cnt})` : v ? ' · added' : ''}`} aria-label={lbl} aria-expanded={open} key={tk} onClick={() => setPop((x) => (x === tk ? null : tk))}><RawIcon d={ic} />{cnt ? <em>{cnt}</em> : null}</button>;
        })}</div>
        <span className="dgcnt" id="peCount">{s.lines.filter((l) => l.id).length} items</span>
        <button type="button" className="dgpaybtn" id="pePayBtn" aria-haspopup="dialog" aria-expanded={pop === 'pay'} hidden={k !== 'bill'} title={`${pre !== null ? `Previous dues: ₹${inr2f(pre)}${pre < 0 ? ' (advance)' : ''}. ` : ''}Click to add or change payment`}
          onClick={() => { if (pop === 'pay') setPop(null); else { setPop('pay'); setTimeout(() => { const a = document.querySelector<HTMLInputElement>('#pePayPop [data-pk="amt"]'); a?.focus(); a?.select(); }, 20); } }}>
          <RawIcon d={WALLET} /><span id="pePayBtnTx"><small>Inv Amt</small><b>₹{inr2f(total)}</b><i></i><small>Paid</small><b className="pos">₹{inr2f(paid)}</b><i></i><small>Inv Dues</small><b className={Math.max(0, bal) > 0 ? 'neg' : ''}>₹{inr2f(Math.max(0, bal))}</b>
            {pre !== null ? <><i></i><small>Pre. Dues</small><b className={pre > 0 ? 'neg' : pre < 0 ? 'pos' : ''}>{pre < 0 ? '−' : ''}₹{inr2f(Math.abs(pre))}</b><i></i><small>Total Dues</small><b className={`${r2(pre + bal) > 0 ? 'neg' : r2(pre + bal) < 0 ? 'pos' : ''} dgtd`}>{r2(pre + bal) < 0 ? '−' : ''}₹{inr2f(Math.abs(r2(pre + bal)))}</b></> : null}</span></button>
        <div className="msg bad" id="peErr" role="alert" style={{ margin: 0, flex: 1 }}>{s.err}</div>
        <button className="btn" type="button" onClick={back}>Cancel</button><button className="btn p" type="button" id="peSave" disabled={busy} onClick={() => void save()}>Save <kbd className="kh" style={KBD}>Ctrl+S</kbd></button></div>

      {ph ? <PhDrop st={ph} label="Purchase rates" onPick={(h) => { const i = ph.i; setPh(null); up((x) => { x.lines[i]!.rate = Number(h.price); x.lines[i]!.disc = Number(h.discPct) || 0; }); setTimeout(() => { const q = document.querySelector<HTMLInputElement>(`#peRows tr[data-ln="${i}"] [data-pf="rate"]`); q?.focus(); q?.select(); }, 0); }} /> : null}
      <AddPartyDialog open={addParty !== null} onClose={() => setAddParty(null)} onSaved={async (id) => {
        setAddParty(null);
        const L = await qc.fetchQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), staleTime: 0 });
        const np = L.find((x) => x.id === id);
        if (np) pickParty({ id: np.id, name: np.name, phone: np.phone, gstin: np.gstin, city: np.billing?.city ?? '', state: np.state, group: np.group, days: np.creditDays ?? 0, limit: Number(np.creditLimit ?? 0), supplier: np.kind === 'supplier', balance: Number(np.balance) });
      }} />
      <AddItemDialog open={!!addItem} onClose={() => setAddItem(null)} onSaved={async (id) => {
        const at = addItem?.i ?? 0; setAddItem(null);
        await qc.refetchQueries({ queryKey: ['items'] });
        setTimeout(() => { const it = latestItems.IT?.find((x) => x.id === id); if (it) pickItem(at, it); }, 50);
      }} />
      <Prefill d={d} text={addParty ?? addItem?.q ?? null} kind={addParty !== null ? 'party' : addItem ? 'item' : null} />
      <SlModal m={modal} onClose={() => setModal(null)} />
    </section>
  );
}

/** Discount amount box: shows the line's discount unless it is being typed in (prototype damt). */
function DiscAmt({ value, onSet, onKeyDown }: { value: number; onSet: (a: number) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return <input className="gi n" data-pf="damt" value={typing ?? (value ? String(r2(value)) : '')} placeholder="0" inputMode="decimal" aria-label="Discount amount"
    onFocus={() => setTyping(value ? String(r2(value)) : '')} onBlur={() => setTyping(null)} onKeyDown={onKeyDown}
    onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setTyping(v); onSet(Number(v) || 0); }} />;
}

/** The footer tools' pop-up bodies for purchases (prototype dgPopBody 'pe'). */
function ToolBody({ k, s, notesLbl, up, onFiles }: { k: Tool; s: PE; notesLbl: string; up: (fn: (x: PE) => void) => void; onFiles: (names: string[]) => void }) {
  if (k === 'tr') return <><div className="dgph"><b>Transport details</b></div><div className="dgpl">
    <label className="ff"><input className="fi" id="peTrans" value={s.transport} placeholder=" " autoComplete="off" onChange={(e) => up((x) => { x.transport = e.target.value; })} /><span>Transport name</span></label>
    <label className="ff"><input className="fi" id="peVeh" value={s.vehicle} placeholder=" " autoComplete="off" onChange={(e) => up((x) => { x.vehicle = e.target.value; })} /><span>Vehicle / bilty no.</span></label>
    <label className="ff on"><input className="fi" id="peDeliv" value={s.delivDate} placeholder=" " autoComplete="off" type="date" onChange={(e) => up((x) => { x.delivDate = e.target.value; })} /><span>Received on</span></label></div></>;
  if (k === 'te') return <><div className="dgph"><b>{notesLbl}</b></div><textarea className="fi ta" id="peNotes" rows={5} aria-label="Notes" value={s.notes} onChange={(e) => up((x) => { x.notes = e.target.value; })} /></>;
  if (k === 'de') return <><div className="dgph"><b>Description</b></div><textarea className="fi ta" id="peDesc" rows={5} placeholder="Shown on the document under the items" value={s.desc} onChange={(e) => up((x) => { x.desc = e.target.value; })} /></>;
  return <><div className="dgph"><b>Attachments</b><small className="mu">Photos and documents</small></div><div className="dgfl">{s.attach.length ? s.attach.map((nm, i) => <span key={i}><Icon name={DGIMG.test(nm) ? 'cam' : 'doc'} /><i>{nm}</i><button type="button" data-dgrm={`pe:${i}`} aria-label={`Remove ${nm}`} onClick={() => up((x) => { x.attach.splice(i, 1); })}>×</button></span>) : <small className="mu">Nothing attached yet.</small>}</div>
    <label className="btn sm dgadd1"><Icon name="plus" />Add photo or document<input type="file" hidden data-dgfile="pe" accept={DGACC} multiple onChange={(e) => { const f = e.target.files; if (f?.length) { onFiles([...f].map((x) => x.name)); e.target.value = ''; } }} /></label></>;
}

/** Latest items after a refetch, and the name typed before "Add new …" put into the new window. */
const latestItems: { IT: EItem[] | null } = { IT: null };
function Prefill({ d, text, kind }: { d: EditorData; text: string | null; kind: 'party' | 'item' | null }) {
  latestItems.IT = d.IT;
  useEffect(() => {
    if (!kind || !text) return;
    const tm = setTimeout(() => { const el = document.getElementById(kind === 'party' ? 'apName' : 'aiName') as HTMLInputElement | null; if (el && !el.value) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); } }, 0);
    return () => clearTimeout(tm);
  }, [kind, text]);
  return null;
}

/**
 * Sale / quotation editor (#vNewInv) — the prototype's openInvoice / renderSI /
 * renderTotals / saveSI with their later changes: discount & charges in a footer
 * pop-up that must be checked once, payment split across modes in a pop-up,
 * the footer dues button, credit-limit warning, edit / duplicate / from challan.
 * Routes: /sales/new, ?edit=<id>, ?copy=<id>, ?challan=<id>.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { STATES, amountInWords, type SaleInput } from '@billing/shared';
import { api, ApiError } from '../../../lib/api';
import { inr, inr2f } from '../../../lib/format';
import { today } from '../../../lib/time';
import { Icon, RawIcon } from '../../../components/Icon';
import { useDcf } from '../../../components/Discard';
import { useShell } from '../../shell/store';
import { EntryClose, useFullscreen } from '../../shell/EntryFrame';
import { AddPartyDialog } from '../../parties/AddPartyDialog';
import { AddItemDialog } from '../../items/AddItemDialog';
import type { Party } from '../../parties/PartiesPage';
import { useSale, type SaleDoc } from '../model';
import { InvoicePreview } from '../InvoicePreview';
import { useEditorData, type EditorData } from './data';
import { ComboList, Grid, comboKey, focusRow, partyOpts, useCombo } from './Grid';
import { useEditorLayout } from './layout';
import { DGACC, DGIMG, ToolBody, type ToolKey } from './ToolsPop';
import { cmBillModal, useElecModal } from './Referral';
import { ImportQuote, QuoteRefs, qrefRemoveModal } from './ImportQuote';
import type { SlModalProps } from '../SlModal';
import { SlModal } from '../SlModal';
import { printNow } from '../../print/printer';
import { editAsk, withPasscode } from '../../settings/passcode';
import {
  DG_TERMS, SI_MODES, SI_TT, addDaysIso, blankLine, calc, cmApply, daysDiff, hasContent, lineComm, lineFor, newSI, partyState, paySum, priceListFor, r2, unitPrice, useSI, useTab, TabCtx, isDirty,
  type EItem, type EParty, type Line, type SI,
} from './state';

const BACK = '<path d="M15 6l-6 6 6 6"/>';
const CHG = '<path d="M19 5L5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const TOOLS: [string, string, string][] = [['tr', '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 'Transport details'], ['te', '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>', 'Terms & conditions'], ['de', '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>', 'Description'], ['at', '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>', 'Attachments'], ['pl', '<path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-3"/>', 'Profit & loss on this bill']];
const fmtPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

const nextNo = (doc: SI['doc'], date: string) => ({
  queryKey: ['next-number', doc, date],
  queryFn: () => api<{ number: string }>(`/sales/next-number?kind=${doc === 'quote' ? 'quotation' : 'invoice'}&date=${date}`),
});
/** An untouched new bill (nothing entered): reused instead of opening another. */
const blank = (x: SI) => !hasContent(x) && !x.editOf && x.autoNo && !x.fromChallanId;

export function SaleEditor() {
  useFullscreen();
  const d = useEditorData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { tabs, active, open, activate } = useSI();
  const key = params.toString();
  const started = useRef<string | null>(null);
  // a saved bill shown over the editor while other bills are still open
  const [shown, setShown] = useState<string | null>(null);
  const shownDoc = useSale(shown);

  /** A new, empty bill in a tab of its own. Its number is only a preview until it is saved. */
  const fresh = useCallback(async (doc: SI['doc']) => {
    const date = today();
    const no = (await qc.fetchQuery(nextNo(doc, date))).number;
    return newSI(d!.ctx, { no, date, doc });
  }, [d, qc]);
  const newTab = useCallback(async (doc: SI['doc']) => {
    const e = useSI.getState().tabs.find((t) => t.si.doc === doc && blank(t.si));
    if (e) activate(e.id);
    else open(await fresh(doc));
  }, [activate, open, fresh]);

  // open the bill this address asks for, once the data is in
  useEffect(() => {
    if (!d || started.current === key) return;
    started.current = key;
    void (async () => {
      // a bill already put in a tab (Quick sale › Open full invoice): just show it
      if (params.get('keep') !== null && useSI.getState().active) return;
      const doc = params.get('quote') !== null ? 'quote' : 'sale';
      const edit = params.get('edit');
      const same = edit && useSI.getState().tabs.find((t) => t.si.editId === edit);
      if (same) return activate(same.id);
      const pp = params.get('party') ? d.PT.find((x) => x.id === params.get('party')) : undefined;
      const pi = params.get('item') ? d.IT.find((x) => x.id === params.get('item')) : undefined;
      const src = edit ?? params.get('copy') ?? params.get('challan');
      if (!pp && !pi && !src) return newTab(doc);
      const s = await fresh(doc);
      // from a party or an item (prototype openInvoice({party}) / ({item}))
      if (pp) { s.party = pp; s.pos = partyState(d.ctx, pp); s.due = addDaysIso(s.date, pp.days || 0); }
      if (pi) s.lines = [lineFor(d.ctx, s, pi)];
      if (src) {
        const v = await qc.fetchQuery({ queryKey: ['sale', src], queryFn: () => api<SaleDoc>(`/sales/${src}`) });
        const how = edit ? 'edit' : params.get('copy') ? 'copy' : 'challan';
        fillFrom(d, s, v, how);
        const n = s.lines.filter((l) => l.item).length;
        if (how === 'copy') useShell.getState().showToast(`Copied ${n} item${n > 1 ? 's' : ''} from ${v.number} into a new invoice`);
        if (how === 'challan') useShell.getState().showToast(`${n} items from ${v.number}. Check prices and save the invoice.`);
      }
      open(s);
    })();
  }, [d, key, params, qc, open, activate, fresh, newTab]);

  const tab = tabs.find((t) => t.id === active);
  // printing a saved bill shown here ("Save & print" with other bills open)
  const printNext = useRef(false);
  useEffect(() => { if (shownDoc.data && printNext.current) { printNext.current = false; setTimeout(() => printNow(), 500); } }, [shownDoc.data]);
  if (!d || !tab) return <section id="vNewInv"></section>;
  const ops: TabOps = {
    newTab: () => void newTab(tab.si.doc),
    close: (id, ask = true) => {
      const t = useSI.getState().tabs.find((x) => x.id === id);
      if (!t) return;
      const list = t.si.doc === 'quote' ? '/quotations' : '/sales';
      // the last bill closes the editor; no new bill is started and no number is used
      const go = () => { if (!useSI.getState().close(id)) navigate(list); };
      if (ask && isDirty(t.si)) useDcf.getState().ask(t.si.doc === 'quote' ? 'quotation' : 'bill', go);
      else go();
    },
    saved: async (id, r, how) => {
      const st = useSI.getState();
      const at = st.tabs.findIndex((t) => t.id === id);
      const doc = st.tabs[at]?.si.doc ?? 'sale';
      if (how === 'again') { const s2 = await fresh(doc); useSI.getState().close(id); open(s2, at); return; }
      if (useSI.getState().close(id)) { printNext.current = how === 'print'; setShown(r.id); return; }
      navigate(doc === 'quote' ? '/quotations' : '/sales', { state: { preview: r.id, print: how === 'print' } });
    },
  };
  return (
    <>
      <TabCtx.Provider value={tab.id}><Editor key={tab.id} d={d} ops={ops} /></TabCtx.Provider>
      <InvoicePreview doc={shown && shownDoc.data?.id === shown ? shownDoc.data : null} onClose={() => setShown(null)} onNew={() => { setShown(null); ops.newTab(); }} onLink={() => useShell.getState().showToast('Payment link is coming next')} />
    </>
  );
}
interface TabOps {
  newTab: () => void;
  /** ask = false leaves without the discard question (the full-screen × was double-clicked) */
  close: (id: string, ask?: boolean) => void;
  saved: (id: string, r: { id: string }, how: 'again' | 'print' | 'save') => Promise<void>;
}

/** Open bills (owner's request: several bills at once). Uses the prototype's bill-tab styles. */
function Tabs({ ops }: { ops: TabOps }) {
  const { tabs, active, activate } = useSI();
  return (
    <div className="bttabs sitabs" id="siTabs" role="tablist" aria-label="Open bills">
      {tabs.map((t) => {
        const x = t.si, on = t.id === active;
        const label = x.party?.name || x.cashName.trim() || (x.editOf ? `Edit ${x.editOf}` : x.doc === 'quote' ? 'New quotation' : 'New bill');
        return (
          <div className={`bttab${on ? ' on' : ''}${isDirty(x) ? ' has' : ''}`} key={t.id} data-tab={t.id}>
            <button className="sitb" type="button" role="tab" aria-selected={on} title={label} onClick={() => { if (!on) activate(t.id); }}><Icon name="doc" /><span>{label}</span></button>
            <button className="sitx" type="button" aria-label={`Close ${label}`} title="Close" onClick={() => ops.close(t.id)}><Icon name="x" /></button>
          </div>
        );
      })}
      <button className="sitnew" type="button" id="siTabNew" aria-label="New bill" title="New bill" onClick={ops.newTab}><Icon name="plus" /></button>
    </div>
  );
}

/** Fills a new sale from a saved document (prototype slEdit / slDup / dcConvert). */
function fillFrom(d: EditorData, s: SI, v: SaleDoc, how: 'edit' | 'copy' | 'challan') {
  const party = v.party ? d.PT.find((p) => p.id === v.party!.id) ?? null : null;
  if (party) { s.party = party; s.pos = partyState(d.ctx, party); }
  else if (v.mode === 'cash' || how !== 'challan') { s.mode = 'cash'; s.cashName = v.cashName; s.cashPhone = v.cashPhone; }
  else { s.mode = 'cash'; s.cashName = v.partyName; s.cashPhone = v.cashPhone; }
  s.ref = how === 'challan' ? '' : v.referrerId ?? '';
  const lines: Line[] = [];
  for (const l of v.lines) {
    const it = d.IT.find((i) => i.id === l.itemId);
    if (!it) continue;
    const L = lineFor(d.ctx, s, it);
    L.qty = Number(l.qty);
    if (how !== 'challan') {
      L.price = Number(l.price); L.disc = Number(l.discPct) || 0; L.gst = Number(l.gstRate);
      if (l.basePrice !== null && s.ref) { L.bp = Number(l.basePrice); L.cmT = l.commType === 'f' ? 'f' : 'p'; L.cmV = Number(l.commValue); } else { delete L.bp; delete L.cmT; delete L.cmV; }
      if (l.commOverride) L.cmO = { t: l.commOverride.t as 'n' | 'p' | 'f', v: l.commOverride.v };
    }
    lines.push(L);
  }
  s.lines = [...lines, blankLine()];
  const x = v.extra as Record<string, string & unknown>;
  if (how === 'challan') { s.transport = x.transport ?? ''; s.vehicle = x.vehicle ?? ''; s.challan = v.number; s.fromChallanId = v.id; return; }
  s.notes = v.notes || s.notes;
  if (how === 'copy') return;
  s.no = v.number; s.autoNo = false; s.date = v.date; s.due = v.dueDate ?? v.date; s.dueTouched = true; s.incl = v.pricesInclTax; s.pos = v.placeOfSupply || s.pos; s.billName = v.billName; s.roundOff = v.roundOff;
  s.pays = v.payment ? v.payment.splits.map((p) => ({ mode: p.mode, amt: Number(p.amount), ref: p.ref })) : [{ mode: 'UPI', amt: 0, ref: '' }];
  s.recvTouched = true;
  s.challan = x.challanNo ?? ''; s.poNo = x.poNo ?? ''; s.poDate = x.poDate ?? ''; s.ewb = x.ewb ?? ''; s.transport = x.transport ?? ''; s.vehicle = x.vehicle ?? ''; s.delivDate = x.deliveryDate ?? '';
  s.desc = x.description ?? ''; s.showDesc = !!x.description; s.attach = [...((x.attachments as unknown as string[]) ?? [])];
  s.qrefs = ((x.quoteRefs as unknown as SI['qrefs']) ?? []).map((q) => ({ ...q }));
  s.bdisc = Number(v.billDiscount) || 0; s.bdiscP = ''; s.chTr = Number(v.transport) || 0; s.chLab = Number(v.labour) || 0; s.chBank = Number(v.bankCharge) || 0;
  s.crOv = (x.commByCategory as unknown as SI['crOv']) ?? null;
  s.editId = v.id; s.editOf = v.number; s.editBal = Number(v.balance) || 0;
  if (s.doc === 'quote') s.valid = v.dueDate ?? s.valid;
}

function Editor({ d, ops }: { d: EditorData; ops: TabOps }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const { id: tabId, si, up } = useTab();
  const cur = () => useSI.getState().tabs.find((x) => x.id === tabId)!.si;
  const ctx = d.ctx;
  const c = useCombo();
  const ref = useRef<HTMLElement>(null);
  const [rk, setRk] = useState(0);
  const full = useCallback(() => setRk((k) => k + 1), []);
  const [pop, setPop] = useState<'pay' | 'chg' | 'cm' | ToolKey | null>(null);
  const [chgMsg, setChgMsg] = useState('');
  const pending = useRef<{ again: boolean; print: boolean } | null>(null);
  const [addParty, setAddParty] = useState<string | null>(null);
  const [addItem, setAddItem] = useState<{ q: string; then: (it: EItem) => void } | null>(null);
  const [busy, setBusy] = useState(false);
  // referral windows: commission on this bill, add electrician
  const [cmView, setCmView] = useState(false);
  const [iq, setIq] = useState(false);
  const [slm, setSlm] = useState<SlModalProps | null>(null);
  const setRef = (id: string) => { up2((x) => { x.ref = id; x.lines.forEach((l) => cmApply(ctx, x, l)); }); full(); };
  const elec = useElecModal({ onSaved: (id) => { void qc.invalidateQueries({ queryKey: ['referrers'] }); void qc.invalidateQueries({ queryKey: ['parties'] }); setRef(id); toast('Referral set · rates updated'); } });
  useEditorLayout(ref);
  const s = si!;
  const G = ctx.mode === 'gst';
  const cash = s.mode === 'cash';
  const quote = s.doc === 'quote';
  const t = calc(ctx, s);
  const up2 = (fn: (x: SI) => void) => up((x) => { fn(x); x.warnOk = false; x.dirty = true; });

  // payment parts follow the bill until someone types in them (prototype payInit + renderTotals)
  if (!s.pays.length) s.pays = [{ mode: cash ? 'Cash' : 'UPI', amt: 0, ref: '' }];
  if (!s.recvTouched) { s.pays[0]!.amt = cash ? t.total : 0; s.pays.slice(1).forEach((p) => (p.amt = 0)); }
  if (quote) s.pays.forEach((p) => (p.amt = 0));
  useEffect(() => {
    if (s.recvTouched) return;
    const a0 = document.querySelector<HTMLInputElement>('#siPayC [data-pay="0"] [data-pk="amt"]');
    if (a0 && document.activeElement !== a0) a0.value = Number(s.pays[0]?.amt) ? String(s.pays[0]!.amt) : '';
  });
  // an untouched number follows the series (another bill may be saved first); it is only used on saving
  const nn = useQuery({ ...nextNo(s.doc, s.date), enabled: s.autoNo && !s.editOf });
  useEffect(() => {
    const n = nn.data?.number;
    if (!s.autoNo || !n || n === s.no) return;
    up((x) => { x.no = n; });
    const el = document.getElementById('siNo') as HTMLInputElement | null;
    if (el && document.activeElement !== el) el.value = n;
  }, [nn.data, s.autoNo, s.no, up]);
  const rec = paySum(s);
  const bal = r2(t.total - rec);
  const pre = s.party ? r2(s.party.balance - (s.editOf ? editBalance(s) : 0)) : null;

  const pickParty = (p: EParty) => up2((x) => {
    // Settings › Transactions › Billing name of parties: the bill keeps its own copy
    if (ctx.txn?.billName && (!x.billName || x.billName === x.party?.billingName)) x.billName = p.billingName ?? '';
    x.party = p; x.pos = partyState(ctx, p);
    if (!x.dueTouched) x.due = addDaysIso(x.date, p.days || 0);
    x.lines.forEach((l) => { if (l.item) { const b = unitPrice(ctx, l.item, p); if (l.bp !== undefined) l.bp = b; else l.price = b; cmApply(ctx, x, l); } });
  });
  const partyPick = (v: unknown) => {
    if (v === '__add') { c.hide(); setAddParty((document.getElementById('siParty') as HTMLInputElement | null)?.value ?? ''); return; }
    pickParty(v as EParty); c.hide(); full();
    setTimeout(() => (document.getElementById('qeItem') as HTMLElement | null)?.focus(), 0);
  };
  const toast = (m: string) => showToast(m);

  /* first focus: the party, or the rapid entry when a party is already chosen */
  // (not while a window is open over the editor, e.g. the bill just saved in another tab)
  useEffect(() => { setTimeout(() => { if ([...document.querySelectorAll<HTMLElement>('.ov')].some((o) => !o.hidden)) return; (document.getElementById(s.party || cash ? 'qeItem' : 'siParty') as HTMLElement | null)?.focus(); }, 60); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* ---------- save (prototype saveSI) ---------- */
  const save = async (again: boolean, print = false) => {
    if (!s.chgOk && !quote) { pending.current = { again, print }; setChgMsg('Please check the discount and charges once before saving.'); setPop('chg'); return; }
    const err = (m: string, focus?: () => void) => { up((x) => { x.err = m; }); focus?.(); };
    up((x) => { x.err = ''; });
    const lines = s.lines.filter((l) => l.item || l.name.trim());
    if (!cash && !s.party) return err(quote ? 'Choose the party, or switch to Walk-in and type a name.' : 'Choose who this bill is for. For a counter sale, switch to Cash.', () => document.getElementById('siParty')?.focus());
    if (!lines.length) return err('Add at least one item.', () => focusRow(0, 'name'));
    const bad = lines.find((l) => !(Number(l.qty) > 0));
    const unknown = lines.find((l) => !l.item);
    if (!quote && bad) return err(`Enter a quantity for “${bad.name}”.`);
    if (unknown) return err(`“${unknown.name}” isn’t in your items. Pick it from the list or add it as a new item.`);
    if (quote && bad) return err(`Enter a quantity for “${bad.name}”.`);
    if (!s.autoNo && !s.no) return err(quote ? 'Enter a quotation number.' : 'Enter an invoice number.');
    const body: SaleInput = {
      kind: quote ? 'quotation' : 'invoice', number: s.autoNo ? '' : s.no, date: s.date, dueDate: cash ? s.date : s.due, mode: s.mode, partyId: s.party?.id ?? null,
      cashName: s.cashName, cashPhone: s.cashPhone, billName: s.billName, placeOfSupply: s.pos, pricesInclTax: s.incl, roundOff: s.roundOff,
      billDiscPct: s.bdiscP || null, billDiscAmt: s.bdiscP ? null : s.bdisc ? String(s.bdisc) : null, transport: String(s.chTr || 0), labour: String(s.chLab || 0), bankCharge: String(s.chBank || 0),
      lines: lines.map((l) => ({ itemId: l.item!.id, name: l.name, hsn: l.hsn, qty: String(l.qty), unit: l.unit, price: String(l.price), discPct: String(l.disc || 0), gstRate: String(l.gst || 0), basePrice: l.bp !== undefined ? String(l.bp) : null, commOverride: l.cmO ?? null })),
      payments: quote ? [] : s.pays.filter((p) => Number(p.amt) > 0).map((p) => ({ mode: p.mode as SaleInput['payments'][number]['mode'], amount: String(p.amt), ref: p.ref })),
      notes: s.notes,
      extra: { challanNo: s.challan, poNo: s.poNo, poDate: s.poDate, ewb: s.ewb, transport: s.transport, vehicle: s.vehicle, deliveryDate: s.delivDate, description: s.desc, attachments: s.attach, quoteRefs: s.qrefs.map((q) => ({ no: q.no, date: q.date, cust: q.cust, brand: q.brand })), validTill: quote ? s.valid : '', commByCategory: s.crOv ?? {} },
      referrerId: s.ref || null, fromQuotationIds: s.qrefs.flatMap((q) => (q.id ? [q.id] : [])), fromChallanId: s.fromChallanId, confirmOverLimit: s.warnOk,
    };
    setBusy(true);
    try {
      const call = (h?: Record<string, string>) => api<{ id: string; number: string; total: string; balance: string; settledOld: string; advance: string; change: string }>(s.editId ? `/sales/${s.editId}` : '/sales', { method: s.editId ? 'PUT' : 'POST', body, headers: h });
      // a saved bill: the passcode is asked now, after editing (when it's switched on)
      const res = s.editId ? await withPasscode(qc, editAsk(s.no), call) : { value: await call() };
      if (!res) return;
      const r = res.value;
      await Promise.all(['sales', 'parties', 'items', 'receipts', 'sale', 'next-number', 'dues'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      const due = Number(r.balance);
      if (quote) toast(`${r.number} saved · ₹${inr2f(r.total)}${s.party ? ' for ' + s.party.name : ''}`);
      else toast(`${r.number} saved · ₹${inr2f(r.total)}${due > 0 ? ` · ₹${inr2f(due)} due` : ' · fully paid'}${Number(r.settledOld) > 0 ? ` · ₹${inr2f(r.settledOld)} adjusted in old dues` : ''}${Number(r.advance) > 0 ? ` · ₹${inr2f(r.advance)} saved as advance` : ''}${Number(r.change) > 0 ? ` · return change ₹${inr2f(r.change)}` : ''}`);
      await ops.saved(tabId, r, again ? 'again' : print ? 'print' : 'save');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'over_credit_limit') { up((x) => { x.warnOk = true; x.err = e.message; }); return; }
      err(e instanceof ApiError ? e.message : 'Could not save the invoice.');
    } finally { setBusy(false); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /* back closes this bill, asking first when something was entered (prototype siDirty + askDiscard) */
  const back = () => ops.close(tabId);
  /* Ctrl+S / Ctrl+Shift+S, Escape closes pop-ups */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const modal = [...document.querySelectorAll<HTMLElement>('.ov')].some((o) => !o.hidden);
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !modal) { e.preventDefault(); void saveRef.current(e.shiftKey); return; }
      if (e.key === 'Escape' && !modal) setPop((p) => { if (p) { e.stopPropagation(); setTimeout(() => (p === 'pay' || p === 'chg' || p === 'cm' ? document.getElementById(p === 'pay' ? 'siPayBtn' : p === 'chg' ? 'siChgBtn' : 'siCmBtn') : document.querySelector<HTMLElement>(`#siTools [data-dgt="si:${p}"]`))?.focus(), 0); } return null; });
    };
    document.addEventListener('keydown', k, true);
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      setPop((p) => {
        if (p === 'pay' && !el.closest('#siPayPop') && !el.closest('#siPayBtn')) return null;
        if (p === 'chg' && !el.closest('#siChgPop') && !el.closest('#siChgBtn')) { pending.current = null; return null; }
        // the extras pop-up stays open for clicks in it and on the tool buttons (prototype dgPopClose)
        if (p && p !== 'pay' && p !== 'chg' && p !== 'cm' && !el.closest('.dgpop') && !el.closest('[data-dgt]') && !el.closest('.dgtools')) return null;
        if (p === 'cm' && !el.closest('#siCmPop') && !el.closest('#siCmBtn') && !el.closest('#slm') && !el.closest('#ai')) return null;
        return p;
      });
    };
    document.addEventListener('mousedown', down, true);
    return () => { document.removeEventListener('keydown', k, true); document.removeEventListener('mousedown', down, true); };
  }, []);

  // place the open pop-up above its footer button, kept 12px inside the window (prototype payPopOpen / chgOpen / cmPopOpen / dgPopOpen)
  useLayoutEffect(() => {
    if (!pop) return;
    const tool = pop !== 'pay' && pop !== 'chg' && pop !== 'cm';
    const place = () => {
      const pp = document.getElementById(tool ? 'siPop' : pop === 'pay' ? 'siPayPop' : pop === 'chg' ? 'siChgPop' : 'siCmPop');
      const b = tool ? document.querySelector(`#siTools [data-dgt="si:${pop}"]`) ?? document.getElementById('siTools') : document.getElementById(pop === 'pay' ? 'siPayBtn' : pop === 'chg' ? 'siChgBtn' : 'siCmBtn');
      const foot = document.querySelector('#vNewInv .sift');
      if (!pp || !b || !foot) return;
      const r = b.getBoundingClientRect();
      pp.style.left = Math.max(12, Math.min(r.left, innerWidth - pp.offsetWidth - 12)) + 'px';
      pp.style.bottom = innerHeight - foot.getBoundingClientRect().top + 8 + 'px';
    };
    place();
    if (!tool) return;
    // the extras pop-up follows a window resize and focuses its first box (prototype dgPopOpen)
    const t = setTimeout(() => document.querySelector<HTMLElement>('#siPop textarea, #siPop input:not([type=file]), #siPop select')?.focus(), 20);
    addEventListener('resize', place);
    return () => { clearTimeout(t); removeEventListener('resize', place); };
  }, [pop]);
  const tool = (k: ToolKey) => setPop((p) => (p === k ? null : k));
  const addFiles = (names: string[]) => up2((x) => { x.attach = [...x.attach, ...names]; });

  const title = quote ? (s.editOf ? 'Edit quotation' : 'Quotation') : s.editOf ? `Edit sale · ${s.editOf}` : 'Sale';
  const kind = quote ? 'Item-wise' : G ? 'Tax invoice' : ctx.mode === 'bos' ? 'Bill of supply' : 'Bill';
  const p = s.party;
  const plist = priceListFor(ctx, p);
  const newBal = p ? r2(p.balance - (s.editOf ? editBalance(s) : 0) + bal) : 0;
  const over = !quote && s.mode === 'credit' && p && p.limit && newBal > p.limit;
  const disc = t.bdisc || Number(s.bdisc) || 0;
  const ch = (Number(s.chTr) || 0) + (Number(s.chLab) || 0) + (Number(s.chBank) || 0);
  const termsD = daysDiff(s.date, s.due);
  const hit = DG_TERMS.find((x) => x[0] === termsD);
  const st = { tr: !!(s.transport || s.vehicle || s.delivDate), te: !!s.notes.trim(), de: !!s.desc.trim(), at: s.attach.length };
  const comm = s.ref ? r2(s.lines.reduce((a, l) => a + lineComm(l, s.incl && G), 0)) : 0;
  const modes = [...new Set(s.pays.filter((x) => Number(x.amt) > 0).map((x) => x.mode))];
  const xp = !quote && rec > t.total ? r2(rec - t.total) : 0;

  return (
    <>
    <section id="vNewInv" ref={ref} onClick={(e) => { if (!quote && (e.target as HTMLElement).closest('#siImpQ')) setIq(true); }}>
      <div className="sitop"><Tabs ops={ops} /><button className="ib" type="button" id="siCancel" aria-label="Back to sales" title="Back to sales" onClick={back}><RawIcon d={BACK} /></button><h1 id="siTitle">{title}</h1><span className="dgtag" id="siKind">{kind}</span>
        <div className="dgsw" id="siMode" role="group" aria-label="Sale type"><span className={cash ? '' : 'on'}>{quote ? 'Party' : 'Credit'}</span><button type="button" className={`dgtg ${cash ? 'on' : ''}`} role="switch" aria-checked={cash} aria-label="Cash sale" data-simode={cash ? 'credit' : 'cash'}
          onClick={() => { up2((x) => { x.mode = cash ? 'credit' : 'cash'; x.recvTouched = quote; if (x.mode === 'cash') { x.party = null; x.pos = ctx.state; } x.pays = []; }); full(); }}><i></i></button><span className={cash ? 'on' : ''}>{quote ? 'Walk-in' : 'Cash'}</span></div>
        <div className="sp"></div>
        <div className="tnd" id="siND" key={`nd${rk}`}>{ctx.txn?.showNo !== false && <label className="tndf"><span>{quote ? 'Quotation no.' : 'Invoice no.'}</span><input className="fi mono" id="siNo" defaultValue={s.no} autoComplete="off" aria-label={quote ? 'Quotation no.' : 'Invoice no.'} onInput={(e) => up2((x) => { x.no = (e.target as HTMLInputElement).value.trim(); x.autoNo = false; })} /></label>}
          <label className="tndf"><span>Date</span><input className="fi" type="date" id="siDate" defaultValue={s.date} aria-label="Date" onChange={(e) => { up2((x) => { x.date = e.target.value; if (!x.dueTouched && x.party) x.due = addDaysIso(x.date, x.party.days || 0); }); full(); }} /></label></div>
        <EntryClose onBack={back} onLeave={() => ops.close(tabId, false)} dirty={isDirty(s)} label={quote ? 'Cancel quotation entry' : 'Cancel bill entry'} /></div>

      <div className="card dgh">
        <div className="dgc" id="siParty_" key={`pt${rk}`}>
          {cash ? (
            <><div className="dg2"><label className="ff"><input className="fi" id="siCashName" defaultValue={s.cashName} placeholder=" " autoComplete="off" onInput={(e) => up2((x) => { x.cashName = (e.target as HTMLInputElement).value; })} /><span>Customer name (optional)</span></label>
              <label className="ff"><input className="fi" id="siCashPhone" defaultValue={s.cashPhone} placeholder=" " autoComplete="off" inputMode="numeric" onInput={(e) => up2((x) => { x.cashPhone = (e.target as HTMLInputElement).value; })} /><span>Mobile (optional)</span></label></div>
              {quote ? null : <small className="mu dgnote">Counter sale — the full amount is received now.</small>}</>
          ) : (
            <><div className="dg2"><div className="ff"><div className="combo"><input className="fi" id="siParty" defaultValue={p ? p.name : ''} placeholder=" " autoComplete="off" role="combobox" aria-expanded={c.cb?.key === 'party'} aria-controls="siPartyList" aria-label="Party"
              onInput={(e) => { up2((x) => { x.party = null; }); c.show('party', partyOpts(d.PT, (e.target as HTMLInputElement).value), partyPick); }}
              onFocus={(e) => { if (!s.party) c.show('party', partyOpts(d.PT, e.target.value), partyPick); }}
              onKeyDown={(e) => { if (c.cb?.key === 'party') comboKey(c, e); }}
              onBlur={() => setTimeout(() => { const a = document.activeElement as HTMLElement | null; if (!a?.closest('.cbl')) c.hide(); }, 150)} /><ComboList c={c} k="party" id="siPartyList" /></div><span>Search by name / phone <b className="req">*</b></span></div>
              <label className="ff"><input className="fi" id="siBill" defaultValue={s.billName} placeholder=" " autoComplete="off" onInput={(e) => up((x) => { x.billName = (e.target as HTMLInputElement).value; })} /><span>Billing name (optional)</span></label></div>
              {p ? <div className="sipi"><div>{p.phone ? <span><Icon name="phone" />{fmtPhone(p.phone)}</span> : null}{p.gstin ? <span className="mono needs-gst">GSTIN {p.gstin}</span> : <span className="needs-gst">Unregistered</span>}{p.city ? <span>{p.city}</span> : null}<span>{p.group}</span></div>
                <div><span>Balance: <b className={p.balance > 0 ? 'pos' : p.balance < 0 ? 'neg' : ''}>{inr(Math.abs(p.balance))} {p.balance > 0 ? 'to receive' : p.balance < 0 ? 'to pay' : ''}</b></span>{p.limit ? <span>Credit limit {inr(p.limit)}</span> : null}{plist && plist !== ctx.defaultList ? <span className="st b">{ctx.listName[plist]} prices</span> : null}</div></div> : null}</>
          )}
        </div>
        <div className="dgc" id="siMid"><QuoteRefs s={s} onRemove={(no) => setSlm(qrefRemoveModal(s, no, { up: up2, close: () => setSlm(null), toast, full }))} />{quote ? <div className="dg2"><label className="ff"><input className="fi" id="siPo" defaultValue={s.poNo} placeholder=" " autoComplete="off" onInput={(e) => up((x) => { x.poNo = (e.target as HTMLInputElement).value; })} /><span>Enquiry / reference no.</span></label><span></span></div> : null}</div>
        <div className="dgc dgr" id="siMeta" key={`mt${rk}`}>
          {quote ? <div className="dg2"><label className="ff on"><input className="fi" id="siValid" defaultValue={s.valid} placeholder=" " autoComplete="off" type="date" onChange={(e) => up((x) => { x.valid = e.target.value; })} /><span>Valid till</span></label><span></span></div>
            : cash ? null : <div className="dg2"><label className="ff on"><select className="fi" id="siTerms" defaultValue={hit ? String(hit[0]) : 'c'} onChange={(e) => { if (e.target.value === 'c') return; up2((x) => { x.due = addDaysIso(x.date, Number(e.target.value)); x.dueTouched = true; }); full(); }}>{DG_TERMS.map(([n, l]) => <option value={n} key={n}>{l}</option>)}<option value="c">Custom{hit || isNaN(termsD) ? '' : ` (${termsD} days)`}</option></select><span>Payment terms</span></label>
              <label className="ff on"><input className="fi" id="siDue" defaultValue={s.due} placeholder=" " autoComplete="off" type="date" onChange={(e) => { up2((x) => { x.due = e.target.value; x.dueTouched = true; }); full(); }} /><span>Due date</span></label></div>}
          {G ? <label className="ff on needs-gst"><select className="fi" id="siPos" defaultValue={s.pos} onChange={(e) => { up2((x) => { x.pos = e.target.value; }); full(); }}>{STATES.map((x) => <option value={x[0]} key={x[0]}>{x[0]} · {x[1]}</option>)}</select><span>Place of supply · {s.pos === ctx.state ? 'same state: CGST + SGST' : 'other state: IGST'}</span></label> : null}
        </div>
      </div>

      <div className="card dggrid"><div className="tw dgw"><table className="dgt"><Grid d={d} c={c} rk={rk} full={full} toast={toast} onAddItem={(q, then) => setAddItem({ q, then })} /></table></div></div>
      <div className="dgb"><div className="dgbl2"><div className="dgx" id="siExtra" aria-label="Added details">
        {st.tr ? <button type="button" className="dgxc" data-dgt="si:tr" onClick={() => tool('tr')}><RawIcon d={TOOLS[0]![1]} /><span>{[s.transport, s.vehicle, s.delivDate ? s.delivDate.split('-').reverse().join('/') : ''].filter(Boolean).join(' · ')}</span></button> : null}
        {st.de ? <button type="button" className="dgxc" data-dgt="si:de" onClick={() => tool('de')}><RawIcon d={TOOLS[2]![1]} /><span>{s.desc.trim().split('\n')[0]!.slice(0, 40)}</span></button> : null}
        {st.at ? (() => { const ph = s.attach.filter((n) => DGIMG.test(n)).length, dc = s.attach.length - ph; return <button type="button" className="dgxc" data-dgt="si:at" onClick={() => tool('at')}><RawIcon d={TOOLS[3]![1]} /><span>{[ph ? `${ph} photo${ph > 1 ? 's' : ''}` : '', dc ? `${dc} document${dc > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span></button>; })() : null}
      </div></div><div className="card sitot dgtot" hidden style={{ display: 'none' }}></div></div>

      {/* payment received (prototype payRender) */}
      <div className="dgpop dgpaypop" id="siPayPop" role="dialog" aria-label="Payment received" hidden={pop !== 'pay' || quote}>
        <div className="dgpay" id="siPayC" hidden={quote} key={`py${rk}`}>
          <div className="dgpyh"><b>Payment received</b><label className="cb2"><input type="checkbox" id="siPFull" checked={t.total > 0 && Math.abs(bal) < 0.005} onChange={(e) => { const on = e.target.checked; up2((x) => { x.recvTouched = true; const others = x.pays.slice(1).reduce((a, q) => a + (Number(q.amt) || 0), 0); x.pays[0]!.amt = on ? Math.max(0, r2(t.total - others)) : 0; if (!on) x.pays.forEach((q) => (q.amt = 0)); }); full(); }} /> Fully received</label></div>
          <div className="dgpyr dgpyl"><span>Payment type</span><span>Amount</span><span>Reference</span><span></span></div>
          {s.pays.map((q, i) => (
            <div className="dgpyr" data-pay={i} key={i}><select className="fi" data-pk="mode" aria-label={`Payment type ${i + 1}`} defaultValue={q.mode} onChange={(e) => { up2((x) => { x.pays[i]!.mode = e.target.value; if (e.target.value === 'Cash') x.pays[i]!.ref = ''; }); full(); }}>{SI_MODES.map((m) => <option key={m}>{m}</option>)}</select>
              <span className="pre3"><i>₹</i><input className="fi n" data-pk="amt" defaultValue={Number(q.amt) ? String(q.amt) : ''} placeholder="0" inputMode="decimal" aria-label={`Amount ${i + 1}`} onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''); up2((x) => { x.pays[i]!.amt = v; x.recvTouched = true; }); }} /></span>
              <input className="fi" data-pk="ref" defaultValue={q.ref} placeholder={q.mode === 'Cash' ? '—' : q.mode === 'Cheque' ? 'Cheque no.' : 'Ref / UTR no.'} autoComplete="off" aria-label={`Reference ${i + 1}`} disabled={q.mode === 'Cash'} onInput={(e) => up((x) => { x.pays[i]!.ref = (e.target as HTMLInputElement).value; })} />
              <button type="button" className="ix" data-payrm={i} aria-label={`Remove payment ${i + 1}`} disabled={s.pays.length === 1} onClick={() => { up2((x) => { x.pays.splice(i, 1); x.recvTouched = true; }); full(); }}><Icon name="x" /></button></div>
          ))}
          <button type="button" className="btn sm dgpyadd" data-payadd="si" onClick={() => { up2((x) => { const used = x.pays.map((q) => q.mode); const m = SI_MODES.find((y) => !used.includes(y)) ?? SI_MODES[0]!; const left = Math.max(0, r2(t.total - paySum(x))); x.pays.push({ mode: m, amt: left || '', ref: '' }); x.recvTouched = true; }); full(); setTimeout(() => { const ins = [...document.querySelectorAll<HTMLInputElement>('#siPayC [data-pk="amt"]')].pop(); ins?.focus(); ins?.select(); }, 0); }}><Icon name="plus" />Add payment type</button>
          <div className="dgpys"><div><span>Received</span><b id="siPRecv">₹{inr2f(rec)}</b></div><div><span>Balance due</span><b id="siPBal" className={xp ? 'warn' : bal > 0 ? 'neg' : bal < 0 ? 'warn' : 'pos'}>{xp ? `${inr2f(xp)} extra` : bal < 0 ? `₹${inr2f(-bal)} extra` : '₹' + inr2f(bal)}</b></div></div>
          {xp ? <div id="siPXtra" className="xpnote"><Icon name="dn" /><span>{!p ? <>Walk-in sale: return <b>₹{inr2f(xp)}</b> change to the customer. Only the invoice total is recorded as received.</> : (() => { const pd = Math.max(0, pre ?? 0), set2 = r2(Math.min(xp, pd)), adv = r2(xp - set2); return <>Extra <b>₹{inr2f(xp)}</b> from {p.name}: {set2 > 0 ? <><b>₹{inr2f(set2)}</b> clears previous dues (oldest bill first)</> : null}{set2 > 0 && adv > 0 ? ' and ' : ''}{adv > 0 ? <><b>₹{inr2f(adv)}</b> is saved as advance payment</> : null}.</>; })()}</span></div> : null}
        </div><div className="dgpf"><button type="button" className="btn p sm" data-paydone="si" onClick={() => setPop(null)}>Done</button></div></div>
      <div className={`dgpop${pop === 'pl' ? ' dgpl2' : ''}`} id="siPop" role="dialog" aria-label="Invoice details" hidden={!pop || pop === 'pay' || pop === 'chg' || pop === 'cm'}>
        {pop && pop !== 'pay' && pop !== 'chg' && pop !== 'cm' ? <><ToolBody key={pop} k={pop} s={s} ctx={ctx} up={up2} onFiles={addFiles} toast={toast} />
          <div className="dgpf"><button type="button" className="btn p sm" data-dgdone onClick={() => setPop(null)}>Done</button></div></> : null}
      </div>
      {/* discount & charges (prototype chgOpen), checked once before the first save */}
      <div className="dgpop dgchgpop" id="siChgPop" role="dialog" aria-labelledby="siChgT" hidden={pop !== 'chg'}>
        <div className="dgchgh"><b id="siChgT">Discount &amp; charges</b><small className="mu">Check these before saving the invoice</small></div>
        <div className="dgchgb sitot" id="siChgBody">
          <div id="siAdj" key={`adj${rk}`}><div className="adr"><span>Discount</span><span className="pre3"><input className="fi n" id="siBdP" defaultValue={s.bdiscP || ''} placeholder="0" inputMode="decimal" aria-label="Discount percent" onInput={(e) => { const el = e.target as HTMLInputElement; let v = el.value.replace(/[^\d.]/g, ''); if (Number(v) > 100) v = '100'; up2((x) => { x.bdiscP = v; x.bdisc = 0; }); setTimeout(() => { const bd = document.getElementById('siBd') as HTMLInputElement | null; if (bd && document.activeElement !== bd) bd.value = v ? String(calc(ctx, cur()).bdisc || '') : ''; }, 0); }} /><i>%</i></span>
            <span className="pre3"><i>₹</i><input className="fi n" id="siBd" defaultValue={s.bdiscP ? '' : s.bdisc ? String(s.bdisc) : ''} placeholder="0" inputMode="decimal" aria-label="Discount amount" onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''); up2((x) => { x.bdisc = v; x.bdiscP = ''; }); const pp = document.getElementById('siBdP') as HTMLInputElement | null; if (pp) pp.value = ''; }} /></span></div>
            {([['Transport charge', 'ChTr', 'chTr'], ['Labour charge', 'ChLab', 'chLab'], ['Bank comm.', 'ChBank', 'chBank']] as const).map(([lbl, id, f]) => (
              <div className="adr" key={id}><span>{lbl}</span><span className="pre3 wide"><i>₹</i><input className="fi n" id={`si${id}`} defaultValue={s[f] ? String(s[f]) : ''} placeholder="0" inputMode="decimal" onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''); up2((x) => { x[f] = v; }); }} /></span></div>
            ))}</div>
          <div id="siTot">
            <div className="tl"><span>Items total</span><b>{inr2f(t.items)}</b></div>
            {t.bdisc ? <div className="tl"><span>Discount{s.bdiscP ? ` (${s.bdiscP}%)` : ''}</span><b className="neg">−{inr2f(t.bdisc)}</b></div> : null}
            {G ? <><div className="tl"><span>Taxable value</span><b>{inr2f(t.taxable)}</b></div>{t.inter ? <div className="tl"><span>IGST</span><b>{inr2f(t.igst)}</b></div> : <><div className="tl"><span>CGST</span><b>{inr2f(t.cgst)}</b></div><div className="tl"><span>SGST</span><b>{inr2f(t.sgst)}</b></div></>}</> : null}
            {t.tcs ? <div className="tl"><span>TCS {ctx.tcsRate}%</span><b>{inr2f(t.tcs)}</b></div> : null}
            {t.chTr ? <div className="tl"><span>Transport charge</span><b>+{inr2f(t.chTr)}</b></div> : null}{t.chLab ? <div className="tl"><span>Labour charge</span><b>+{inr2f(t.chLab)}</b></div> : null}{t.chBank ? <div className="tl"><span>Bank comm.</span><b>+{inr2f(t.chBank)}</b></div> : null}
            <div className="tl"><label className="cb2" style={{ padding: 0 }}><input type="checkbox" id="siRound" checked={s.roundOff} onChange={(e) => up2((x) => { x.roundOff = e.target.checked; })} /> Round off</label><b>{t.round >= 0 ? '+' : '−'}{inr2f(Math.abs(t.round))}</b></div>
            <div className="tl tt"><span>Total</span><b>₹{inr2f(t.total)}</b></div>
            <div className="siw">{amountInWords(String(t.total))}</div>
            {over ? <div className="siwarn"><Icon name="alert" /><span>This takes {p!.name} to {inr(newBal)}, above their credit limit of {inr(p!.limit)}.</span></div> : null}
          </div></div>
        <div className={`msg${chgMsg ? ' warn' : ''}`} id="siChgMsg" role="status">{chgMsg}</div>
        <div className="dgpf"><button type="button" className="btn p sm" id="siChgDone" onClick={() => { up((x) => { x.chgOk = true; }); setPop(null); const pd = pending.current; pending.current = null; if (pd) void save(pd.again, pd.print); else document.getElementById('siChgBtn')?.focus(); }}>{pending.current ? (pending.current.print ? 'Checked — save & print' : 'Checked — save') : 'Checked'}</button></div></div>

      <div className="sift"><div className="dgtools" id="siTools" role="toolbar" aria-label="Invoice extras">
        {TOOLS.map(([k, ic, lbl]) => {
          const v = st[k as keyof typeof st];
          const n = typeof v === 'number' ? v : 0;
          if (k === 'at' && !n) return <label className="dgtb" title="Attach photo or document" aria-label="Attach photo or document" key={k}><RawIcon d={ic} /><input type="file" hidden data-dgfile="si" accept={DGACC} multiple onChange={(e) => { const f = e.target.files; if (f?.length) { const names = [...f].map((x) => x.name); addFiles(names); toast(`${names.length} file${names.length > 1 ? 's' : ''} attached`); e.target.value = ''; } }} /></label>;
          const open = pop === k;
          return <button type="button" className={`dgtb ${v ? 'on' : ''} ${open ? 'open' : ''}`} data-dgt={`si:${k}`} title={`${lbl}${n ? ` (${n})` : v ? ' · added' : ''}`} aria-label={lbl} aria-expanded={open} key={k} onClick={() => tool(k as ToolKey)}><RawIcon d={ic} />{n ? <em>{n}</em> : null}</button>;
        })}</div>
        <button type="button" className={`dgtb cmfb${s.ref ? ' on' : ''}`} id="siCmBtn" title="Referral" aria-label="Referral" aria-haspopup="dialog" aria-expanded={pop === 'cm'} onClick={() => setPop(pop === 'cm' ? null : 'cm')}><Icon name="users" /><i className="cmdot" hidden={!s.ref}></i></button>
        <span className="dgcnt" id="siCount">{t.count} item{t.count === 1 ? '' : 's'}</span>
        <button type="button" className={`dgchgbtn${s.chgOk ? '' : ' todo'}`} id="siChgBtn" aria-haspopup="dialog" aria-expanded={pop === 'chg'} aria-label="Discount and charges" title={s.chgOk ? 'Discount & charges checked' : 'Check discount & charges before saving'} onClick={() => { if (pop === 'chg') setPop(null); else { pending.current = null; setChgMsg(''); setPop('chg'); setTimeout(() => (document.getElementById('siBdP') as HTMLElement | null)?.focus(), 20); } }}>
          <RawIcon d={CHG} /><span className="chgl"><small>Discount &amp; charges</small><b id="siChgSum">{disc || ch ? (disc ? '−' + inr2f(disc) : '') + (disc && ch ? ' ' : '') + (ch ? '+' + inr2f(ch) : '') : 'None'}</b></span><em className="chgdot" id="siChgDot" aria-hidden="true" hidden={s.chgOk}>!</em></button>
        <button type="button" className="dgpaybtn" id="siPayBtn" aria-haspopup="dialog" aria-expanded={pop === 'pay'} hidden={quote} title={`${pre !== null ? `Previous dues: ₹${inr2f(pre)}${pre < 0 ? ' (advance)' : ''}. ` : ''}Click to add or change payment`}
          onClick={() => { if (pop === 'pay') setPop(null); else { setPop('pay'); setTimeout(() => { const a = document.querySelector<HTMLInputElement>('#siPayPop [data-pk="amt"]'); a?.focus(); a?.select(); }, 20); } }}>
          <svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: '<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14.5h1"/>' }} />
          <span id="siPayBtnTx"><small>Inv Amt</small><b>₹{inr2f(t.total)}</b><i></i><small>Received</small><b className="pos">₹{inr2f(rec)}</b><i></i><small>Inv Dues</small><b className={Math.max(0, bal) > 0 ? 'neg' : ''}>₹{inr2f(Math.max(0, bal))}</b>
            {pre !== null ? <><i></i><small>Pre. Dues</small><b className={pre > 0 ? 'neg' : pre < 0 ? 'pos' : ''}>{pre < 0 ? '−' : ''}₹{inr2f(Math.abs(pre))}</b><i></i><small>Total Dues</small><b className={`${r2(pre + bal) > 0 ? 'neg' : r2(pre + bal) < 0 ? 'pos' : ''} dgtd`}>{r2(pre + bal) < 0 ? '−' : ''}₹{inr2f(Math.abs(r2(pre + bal)))}</b></> : null}</span></button>
        <div className="msg bad" id="siErr" role="alert" style={{ margin: 0, flex: 1 }}>{s.err}</div>
        <button className="btn" type="button" id="siSaveNew" disabled={busy} onClick={() => void save(true)}>Save &amp; new <kbd className="kh">Ctrl+Shift+S</kbd></button>
        <button className="btn" type="button" id="siSavePrint" title="Save & print" disabled={busy} onClick={() => void save(false, true)}><RawIcon d={PRINT} /><span className="sftx">{quote ? 'Save & print' : 'Save & print'}</span></button>
        <button className="btn p" type="button" id="siSave" disabled={busy} onClick={() => void save(false)}>{quote ? 'Save quotation ' : 'Save '}<kbd className="kh" style={{ background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' }}>Ctrl+S</kbd></button></div>
      <div className="dgpop cmpop" id="siCmPop" role="dialog" aria-label="Referral" hidden={pop !== 'cm'}><b style={{ fontSize: 14 }}>Referral</b>
        <div id="siCmBody"><div className="cmref"><label className="ff on"><select className="fi" id="siRef" value={s.ref} onChange={(e) => { const v = e.target.value; if (v === '__new') { e.target.value = s.ref; elec.open(); return; } setRef(v); toast(v ? 'Referral set · rates updated' : 'Referral removed · rates updated'); }}>
          <option value="">No electrician</option>{d.refs.map((r) => <option value={r.id} key={r.id}>{r.name}{r.city ? ' · ' + r.city : ''}</option>)}<option value="__new">+ Add electrician…</option></select><span>Referred by</span></label>
          {s.ref ? <button type="button" className="cmchip" id="siCmChip" title="Added to the rates · not printed on the invoice" onClick={() => setCmView(true)}><Icon name="pct" /><span>Commission</span><b id="siCmAmt">{inr2f(comm)}</b><em className="cmed">Edit ›</em></button> : null}</div></div>
        <div className="dgpf"><button type="button" className="btn p sm" id="siCmDone" onClick={() => { setPop(null); document.getElementById('siCmBtn')?.focus(); }}>Done</button></div></div>

      <AddPartyDialog open={addParty !== null} onClose={() => setAddParty(null)} onSaved={async (id) => {
        setAddParty(null);
        const L = await qc.fetchQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), staleTime: 0 });
        const np = L.find((x) => x.id === id);
        if (np) { pickParty({ id: np.id, name: np.name, phone: np.phone, gstin: np.gstin, city: np.billing?.city ?? '', state: np.state, group: np.group, days: np.creditDays ?? 0, limit: Number(np.creditLimit ?? 0), supplier: np.kind === 'supplier', balance: Number(np.balance) }); full(); }
      }} />
      <AddItemDialog open={!!addItem} onClose={() => setAddItem(null)} onSaved={async (id) => {
        const then = addItem?.then; setAddItem(null);
        await qc.refetchQueries({ queryKey: ['items'] }); await qc.refetchQueries({ queryKey: ['prices'] });
        setTimeout(() => { const it = useEditorDataSnapshot.IT?.find((x) => x.id === id); if (it && then) then(it); }, 50);
      }} />
      <SnapshotKeeper d={d} prefill={addParty ?? addItem?.q ?? null} kind={addParty !== null ? 'party' : addItem ? 'item' : null} />
    </section>
      {/* outside the editor, like the prototype's #slm (the editor turns off sticky table headings) */}
      <SlModal m={elec.modal ?? slm ?? (cmView ? cmBillModal({ ctx, name: d.refs.find((r) => r.id === s.ref)?.name ?? '', up: up2, close: () => setCmView(false) }) : null)} onClose={() => { elec.close(); setCmView(false); setSlm(null); }} />
      <ImportQuote open={iq} onClose={() => setIq(false)} d={d} s={s} up={(fn) => { up2(fn); full(); }} toast={toast} />
    </>
  );
}

/** The editing invoice's own balance (so "previous dues" leaves it out). */
function editBalance(s: SI) { return s.editBal; }

/** Latest editor data for callbacks that run after a refetch, and the name typed before "Add new …". */
const useEditorDataSnapshot: { IT: EItem[] | null } = { IT: null };
function SnapshotKeeper({ d, prefill, kind }: { d: EditorData; prefill: string | null; kind: 'party' | 'item' | null }) {
  useEditorDataSnapshot.IT = d.IT;
  useEffect(() => {
    if (!kind || !prefill) return;
    const t = setTimeout(() => { const el = document.getElementById(kind === 'party' ? 'apName' : 'aiName') as HTMLInputElement | null; if (el && !el.value) { el.value = prefill; el.dispatchEvent(new Event('input', { bubbles: true })); } }, 0);
    return () => clearTimeout(t);
  }, [kind, prefill]);
  return null;
}

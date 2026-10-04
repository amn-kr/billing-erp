/**
 * Quotation page (prototype #vQuo): a brand-wise quotation — item rows against brand ranges, every
 * rate from Price manager, totals for every brand — with saved quotations, convert to invoice,
 * referral, share (WhatsApp / PDF / Excel), and adding ranges, rows and items. It always opens on a
 * fresh quotation; one left with quantities is kept in Saved (prototype go('quo')).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qGrp, qSerName, qSeries, type QuoteGrid } from '@billing/shared';
import { Icon, RawIcon } from '../../components/Icon';
import { api, ApiError } from '../../lib/api';
import { dmy, inr2f } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { today } from '../../lib/time';
import { useShell } from '../shell/store';
import { qfmt } from '../items/ItemsPage';
import { usePm, type PriceList } from '../prices/model';
import { PinDialog } from '../prices/PinDialog';
import { InvoicePreview, useBiz } from '../sales/InvoicePreview';
import { useSale, useSales, type SaleDoc, type SaleRow } from '../sales/model';
import { useEditorData } from '../sales/editor/data';
import { useElecModal } from '../sales/editor/Referral';
import { SlModal } from '../sales/SlModal';
import { addDaysIso, blankLine, lineFor, newSI, partyState, useSI, type Line } from '../sales/editor/state';
import { qComm, qCols, qRanked, qRate, qTotals, type QCtx, type QDraft } from './model';
import { quoteExcel, quotePdf, quoteWhatsApp, qUsed } from './exports';
import { AddDialog, ConvertDialog, SavedList, type AddMode } from './QuoteDialogs';

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.3 2.3 3.5 5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.9l7.6-4.3M8.2 13.1l7.6 4.3"/>',
  wa: '<path d="M4 5h16v11H9l-5 4z"/>', down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', saved: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  conv: '<path d="M5 12h12M13 6l6 6-6 6"/>', chev: '<path d="M6 9l6 6 6-6"/>', save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const fresh = (g: QuoteGrid, no: string): QDraft => ({ id: null, no, cust: '', disc: 0, pl: '', sel: g.ser.map((s) => s.id), qty: {}, ref: '', status: 'draft', inv: '', brand: '' });

export function QuotationsPage() {
  const d = useEditorData();
  const grid = useQuery({ queryKey: ['quote-grid'], queryFn: () => api<QuoteGrid>('/quote-grid') });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api<PriceList[]>('/price-lists') });
  const date = today();
  const nn = useQuery({ queryKey: ['next-number', 'quote', date], queryFn: () => api<{ number: string }>(`/sales/next-number?kind=quotation&date=${date}`) });
  if (!d || !grid.data || !lists.data || !nn.data) return <section id="vQuo"></section>;
  return <Quotation d={d} g={grid.data} lists={lists.data} firstNo={nn.data.number} />;
}

function Quotation({ d, g, lists, firstNo }: { d: NonNullable<ReturnType<typeof useEditorData>>; g: QuoteGrid; lists: PriceList[]; firstNo: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useShell((s) => s.showToast);
  const settings = useSettings();
  const biz = useBiz();
  const saved = useSales('quotation');
  const date = today();
  const [q, setQ] = useState<QDraft>(() => fresh(g, firstNo));
  const [pop, setPop] = useState<'ser' | 'ref' | 'share' | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [conv, setConv] = useState(false);
  const [add, setAdd] = useState<AddMode | null>(null);
  const [pin, setPin] = useState(false);
  const [clearSure, setClearSure] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const shown = useSale(preview);
  const tw = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLTableSectionElement>(null);
  /* what was last saved, so leaving with changes keeps them in Saved */
  const savedAs = useRef<string>('');
  const ro = q.status === 'converted';
  const active = lists.filter((l) => l.active);
  const def = lists.find((l) => l.isDefault)!;
  const pl = active.find((l) => l.id === q.pl) ?? def;
  const c: QCtx = { IT: d.IT, pl: { id: pl.id, name: pl.name, isDefault: pl.isDefault }, ref: q.ref, rules: d.ctx.rules };
  const cols = qCols(g, q);
  const T = qTotals(c, g, q);
  const tq = g.rows.reduce((a, r) => a + (q.qty[r.id] || 0), 0);
  const ok = T.filter((t) => !t.miss && t.total > 0);
  const best = ok.length ? Math.min(...ok.map((t) => t.total)) : null;
  const rows = (saved.data ?? []).filter((x) => !x.cancelled);
  const gstOn = !!settings.data?.gstEnabled;
  const has = Object.keys(q.qty).length > 0;
  const up = (patch: Partial<QDraft>) => setQ((x) => ({ ...x, ...patch }));

  /* ---------- save (prototype qSnapshot / qSave) ---------- */
  const snapshot = (x: QDraft) => {
    const t = qTotals(c, g, x).filter((t2) => !t2.miss && t2.total > 0).sort((a, b) => a.total - b.total)[0];
    return { number: x.no, date, cust: x.cust, priceListId: x.pl || null, disc: x.disc, sel: x.sel, qty: x.qty, referrerId: x.ref || null, items: Object.keys(x.qty).length, pcs: Object.values(x.qty).reduce((a, b) => a + b, 0), low: t ? { name: qSerName(t.s), total: r2(t.total) } : null };
  };
  const save = useCallback(async (x: QDraft, silent: boolean): Promise<QDraft | null> => {
    if (x.status === 'converted') { if (!silent) toast('This quotation is converted and locked'); return null; }
    if (!Object.keys(x.qty).length) { if (!silent) toast('Enter at least one quantity first'); return null; }
    try {
      const body = snapshot(x);
      const r = await api<{ id: string; number: string }>(x.id ? `/quotations/brand/${x.id}` : '/quotations/brand', { method: x.id ? 'PUT' : 'POST', body });
      void qc.invalidateQueries({ queryKey: ['sales', 'quotation'] });
      void qc.invalidateQueries({ queryKey: ['next-number'] });
      const nx = { ...x, id: r.id, no: r.number, status: 'open' as const };
      savedAs.current = JSON.stringify(nx);
      if (!silent) toast(`${r.number} saved${x.cust ? ' for ' + x.cust : ''}`);
      return nx;
    } catch (e) { if (!silent) toast(e instanceof ApiError ? e.message : 'Could not save the quotation.'); return null; }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [qc, toast, date, d, g, pl.id]);
  // leaving the page with new quantities keeps the quotation in Saved
  const latest = useRef(q);
  latest.current = q;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { const x = latest.current; if (Object.keys(x.qty).length && x.status !== 'converted' && JSON.stringify(x) !== savedAs.current) void saveRef.current(x, true); }, []);
  const nextNo = async () => (await qc.fetchQuery({ queryKey: ['next-number', 'quote', date], queryFn: () => api<{ number: string }>(`/sales/next-number?kind=quotation&date=${date}`), staleTime: 0 })).number;

  const newQuote = async () => {
    if (has && !ro) await save(q, true);
    const no = await nextNo();
    setQ((x) => ({ ...fresh(g, no), pl: x.pl, sel: x.sel }));
    savedAs.current = '';
    toast(`New quotation ${no}`);
    document.getElementById('qCust')?.focus();
  };
  const load = async (r: SaleRow) => {
    if (has && q.no !== r.number && !ro) await save(q, true);
    const b = r.brandQuote!;
    const sel = g.ser.map((s) => s.id).filter((id) => b.sel.includes(id));
    const x: QDraft = { id: r.id, no: r.number, cust: b.cust, disc: b.disc, pl: b.priceListId ?? '', sel: sel.length ? sel : g.ser.map((s) => s.id), qty: { ...b.qty }, ref: r.referrerId ?? '', status: r.status === 'converted' ? 'converted' : 'open', inv: r.invoiceNo, brand: r.invoiceBrand ?? '' };
    savedAs.current = JSON.stringify(x);
    setQ(x);
  };

  /* ---------- convert (prototype openConvert / qcGo, qdConvert for item-wise) ---------- */
  const openConvert = async () => {
    if (ro) return toast('Already converted to an invoice');
    if (!has) return toast('Enter at least one quantity first');
    const nx = await save(q, true);
    if (nx) setQ(nx);
    setConv(true);
  };
  const openTab = (lines: Line[], party: string, cust: string, phone: string, extra: (s: ReturnType<typeof newSI>) => void) => {
    const s = newSI(d.ctx, { no: '', date });
    const p = d.PT.find((x) => x.id === party) ?? d.PT.find((x) => cust && x.name.trim().toLowerCase() === cust.trim().toLowerCase());
    if (p) { s.party = p; s.pos = partyState(d.ctx, p); s.due = addDaysIso(s.date, p.days || 0); }
    else if (cust) { s.mode = 'cash'; s.cashName = cust; s.cashPhone = phone; s.pays = []; }
    s.lines = [...lines, blankLine()];
    extra(s);
    useSI.getState().open(s);
    navigate(`/sales/new?keep=${Date.now()}`);
  };
  const convertBrand = (sr: (typeof g.ser)[number]): string | void => {
    const L = g.rows.filter((r) => q.qty[r.id]).flatMap((r) => { const o = qRate(c, r, sr); return o.it && o.v !== null ? [{ it: o.it, qty: q.qty[r.id]!, price: o.v }] : []; });
    if (!L.length) return 'None of these items are available in this brand.';
    setConv(false);
    const tmp = newSI(d.ctx, { no: '', date });
    const brand = qSerName(sr);
    const lines = L.map((x) => {
      const l = lineFor(d.ctx, tmp, x.it);
      l.qty = x.qty; l.price = x.price; l.disc = q.disc || 0; l.fromQ = q.no;
      // a rate with commission loaded keeps its base, so the invoice knows the commission in it (prototype cmFromLoaded)
      const rule = d.ctx.rules[x.it.cat];
      if (q.ref && rule && rule.t !== 'n' && rule.v > 0) { l.bp = rule.t === 'p' ? r2(x.price / (1 + rule.v / 100)) : r2(x.price - rule.v); l.cmT = rule.t; l.cmV = rule.v; }
      return l;
    });
    openTab(lines, '', q.cust, '', (s) => { s.ref = q.ref; s.qrefs = [{ no: q.no, date: dmy(date), cust: q.cust, brand, id: q.id ?? undefined }]; s.notes = `As per quotation ${q.no} (${brand}).`; });
    toast(`${L.length} items from ${q.no} · ${brand}. Check and save the invoice.`);
  };
  const convertItems = async (id: string) => {
    const v = await qc.fetchQuery({ queryKey: ['sale', id], queryFn: () => api<SaleDoc>(`/sales/${id}`) });
    if (v.status === 'converted') return toast(`${v.number} is already converted to ${(v.extra as { invoiceNo?: string }).invoiceNo ?? ''}`);
    const tmp = newSI(d.ctx, { no: '', date });
    const lines = v.lines.flatMap((l) => { const it = d.IT.find((i) => i.id === l.itemId); if (!it) return []; const L = lineFor(d.ctx, tmp, it); L.qty = Number(l.qty); L.price = Number(l.price); L.disc = Number(l.discPct) || 0; L.gst = Number(l.gstRate); L.fromQ = v.number; return [L]; });
    const x = v.extra as Record<string, string>;
    openTab(lines, v.party?.id ?? '', v.partyName, v.cashPhone, (s) => {
      s.bdisc = Number(v.billDiscount) || 0; s.chTr = Number(v.transport) || 0; s.chLab = Number(v.labour) || 0; s.chBank = Number(v.bankCharge) || 0;
      s.transport = x.transport ?? ''; s.vehicle = x.vehicle ?? ''; s.desc = x.description ?? ''; s.showDesc = !!x.description;
      s.qrefs = [{ no: v.number, date: dmy(v.date), cust: v.partyName, brand: 'Item-wise', id: v.id }]; s.notes = `As per quotation ${v.number}.`;
    });
    toast(`${v.lines.length} items from ${v.number}. Check and save the invoice.`);
  };

  /* ---------- saved list ---------- */
  const onOpen = (r: SaleRow) => {
    setSavedOpen(false);
    if (r.qtype === 'items') { if (r.status === 'converted') setPreview(r.id); else navigate(`/sales/new?quote&edit=${r.id}`); return; }
    void load(r).then(() => toast(`${r.number} opened`));
  };
  const onConvertRow = (r: SaleRow) => {
    setSavedOpen(false);
    if (r.qtype === 'items') { void convertItems(r.id); return; }
    void load(r).then(() => setConv(true));
  };
  const onCancel = async (r: SaleRow) => {
    try {
      await api(`/sales/${r.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled from Saved quotations' } });
      await qc.invalidateQueries({ queryKey: ['sales', 'quotation'] });
      if (q.id === r.id) { const no = await nextNo(); setQ((x) => ({ ...fresh(g, no), pl: x.pl, sel: x.sel })); }
      toast(`${r.number} cancelled`);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not cancel the quotation.'); }
  };

  /* ---------- the grid: ranges, rows, items ---------- */
  const putGrid = async (ng: QuoteGrid) => { await api('/quote-grid', { method: 'PUT', body: ng }); qc.setQueryData(['quote-grid'], ng); };
  const onSer = async (b: string, r: string, f: string, nb: boolean) => {
    if (g.ser.some((s) => s.b.toLowerCase() === b.toLowerCase() && s.r.toLowerCase() === r.toLowerCase() && (s.f || '').toLowerCase() === f.toLowerCase())) return 'This range is already in the quotation.';
    if (nb) await api('/catalogue/brands', { method: 'POST', body: { name: b } }).catch(() => undefined);
    const s = { id: 's' + Date.now(), b, r, f };
    await putGrid({ ...g, ser: [...g.ser, s] });
    up({ sel: [...q.sel, s.id] });
    setAdd(null);
    requestAnimationFrame(() => { const t = tw.current; if (t) { t.scrollLeft = t.scrollWidth; t.scrollTop = 0; } });
    toast(`${qSerName(s)} added. Use “+ Add item” to add its prices.`);
  };
  const onRow = async (n: string, sec: 'acc' | 'plate') => {
    if (g.rows.some((r) => r.n.toLowerCase() === n.toLowerCase())) return 'This item is already in the list.';
    const r = { id: 'x' + Date.now(), n, c: sec }, list = [...g.rows], last = sec === 'plate' ? list.length : list.findIndex((x) => x.c === 'plate');
    list.splice(last < 0 ? list.length : last, 0, r);
    await putGrid({ ...g, rows: list });
    setAdd(null);
    toast(`${n} added`);
  };
  const onItem = async (mrp: number, pur: number, sale: number) => {
    if (add?.k !== 'item') return;
    const name = `${add.grp} · ${add.s.b} ${add.series}`;
    try {
      await api('/items', { method: 'POST', body: { name, group: add.grp, brand: add.s.b, series: add.series, hsn: add.row.c === 'plate' ? '8538' : '8536', unit: 'PCS', category: 'Switches & MCBs', gstRate: 18, mrp: mrp || '', purchase: pur || '', sale } });
    } catch (e) { return e instanceof ApiError ? e.message : 'Could not add the item.'; }
    await Promise.all(['items', 'prices'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    setAdd(null);
    toast(`${name} added to Items & stock`);
  };

  /* ---------- the rest ---------- */
  const elec = useElecModal({ onSaved: (id) => { void qc.invalidateQueries({ queryKey: ['referrers'] }); up({ ref: id }); toast('Referral set · rates updated'); } });
  // a quotation saved in the invoice editor (item-wise) is shown here, as the prototype does
  useEffect(() => {
    const st = location.state as { preview?: string; print?: boolean } | null;
    if (!st?.preview) return;
    setPreview(st.preview);
    navigate('.', { replace: true, state: null });
    if (st.print) setTimeout(() => window.print(), 500);
  }, [location.state, navigate]);
  useEffect(() => { if (!clearSure) return; const t = setTimeout(() => setClearSure(false), 2500); return () => clearTimeout(t); }, [clearSure]);
  // pop-ups close on a click outside and on Escape
  useEffect(() => {
    if (!pop) return;
    const out = (e: MouseEvent) => { const t = e.target as HTMLElement; if (pop === 'ser' && t.closest('#qSerW')) return; if (pop === 'ref' && (t.closest('#qRefPop') || t.closest('#qRefBtn') || t.closest('#slm'))) return; if (pop === 'share' && t.closest('#qSharePop,#qShare')) return; setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPop(null); document.getElementById(pop === 'ser' ? 'qSerBtn' : pop === 'ref' ? 'qRefBtn' : 'qShare')?.focus(); } };
    document.addEventListener('mousedown', out, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', esc, true); };
  }, [pop]);
  // the totals stay at the bottom of the table and the table fills the window (prototype qFit)
  useLayoutEffect(() => {
    const fit = () => {
      const t = tw.current, f = foot.current;
      if (!t || !f) return;
      let b = 0;
      [...f.rows].reverse().forEach((r) => { [...r.cells].forEach((cl) => (cl.style.bottom = b + 'px')); b += r.offsetHeight; });
      if (innerWidth <= 860) { t.style.maxHeight = ''; return; }
      t.style.maxHeight = Math.max(280, innerHeight - t.getBoundingClientRect().top - (document.scrollingElement || document.documentElement).scrollTop - 18) + 'px';
    };
    const id = requestAnimationFrame(fit);
    addEventListener('resize', fit);
    return () => { cancelAnimationFrame(id); removeEventListener('resize', fit); };
  });
  const ex = { c, g, d: q, biz: biz.data, gst: gstOn, gstin: biz.data?.gstin ?? '', plName: pl.name };
  const share = (k: 'wa' | 'pdf' | 'xls') => {
    setPop(null);
    if (!qUsed(g, q).length) return toast('Enter at least one quantity first');
    if (k === 'wa') quoteWhatsApp(ex); else if (k === 'pdf') void quotePdf(ex); else void quoteExcel(ex);
  };
  const qtyKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...document.querySelectorAll<HTMLInputElement>('#qBody [data-qq]')];
    const n = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (n) { n.focus(); n.select(); }
  };
  const brands = [...new Set(d.IT.map((i) => i.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sv = rows.find((x) => x.id === q.id);
  const sec = (label: string) => <tr className="qsec"><td className="qsk" dangerouslySetInnerHTML={{ __html: label }}></td><td className="qsk2"></td>{cols.map((s) => <td key={s.id}></td>)}</tr>;
  const row = (r: (typeof g.rows)[number]) => {
    const n = q.qty[r.id] || 0;
    return (
      <tr className={n ? 'has' : ''} key={r.id}><td className="qsk"><b>{r.n}</b></td>
        <td className="qsk2"><input className="fi qq" data-qq={r.id} value={n || ''} inputMode="numeric" placeholder="0" aria-label={`Quantity of ${r.n}`} readOnly={ro} tabIndex={ro ? -1 : 0}
          onFocus={(e) => { if (ro) { e.target.blur(); toast('This quotation is converted to an invoice and can’t be edited'); } }}
          onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); const x = Number(v) || 0; setQ((o) => { const qty = { ...o.qty }; if (x) qty[r.id] = x; else delete qty[r.id]; return { ...o, qty }; }); }} onKeyDown={qtyKey} /></td>
        {cols.map((s) => {
          const { v, it } = qRate(c, r, s);
          if (v === null || !it) return !ro ? <td className="n" key={s.id}><button className="qadd" data-qadd={`${s.id}|${r.id}`} title={`Add ${r.n} for ${qSerName(s)} to your items`}
            onClick={() => { if (usePm.getState().pin === null) { toast('Unlock prices with your PIN to add items'); setPin(true); return; } setAdd({ k: 'item', s, row: r, grp: qGrp(r), series: qSeries(s) }); }}>{n ? 'n/a · ' : ''}+ Add</button></td>
            : <td className={`n ${n ? 'qna' : 'qnil'}`} key={s.id}>{n ? 'n/a' : '—'}</td>;
          const stq = it.stock ?? 0, un = (it.unit || '').charAt(0) + (it.unit || '').slice(1).toLowerCase(), short = n > stq;
          const sk = <span className={`qsk3 ${stq <= 0 ? 'out' : short ? 'short' : ''}`} title={short ? `Only ${qfmt(stq)} in stock for ${qfmt(n)} needed` : 'Current stock'}>{qfmt(stq)} {un}</span>;
          return <td className="n" key={s.id} title={`${it.name} · ${pl.name} rate from Price manager · stock ${qfmt(stq)} ${un}`}>{n ? <><b>{inr2f(n * v)}</b><small>@ {inr2f(v)} | {sk}</small></> : <span className="qrt">@ {inr2f(v)} | {sk}</span>}</td>;
        })}</tr>
    );
  };

  return (
    <section id="vQuo" className={ro ? 'qlocked' : undefined}>
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Quotation</h1><span className="pttot mono" id="qNo">{q.no}</span>
        <span id="qState">{sv ? (sv.status === 'converted' ? <span className="st g">Converted · {sv.invoiceNo}</span> : <span className="st b">Saved</span>) : <span className="st qdr">Draft</span>}</span>
        <button className="btn" style={{ marginLeft: 6 }} id="qNew" title="New brand-wise quotation" onClick={() => void newQuote()}><RawIcon d={P.plus} />New brand-wise</button>
        <button className="btn p" id="qNewItems" title="Make a quotation item by item, like an invoice" onClick={() => navigate(`/sales/new?quote&n=${Date.now()}`)}><RawIcon d={P.plus} />Item-wise quotation</button><div className="sp"></div>
        <div className="rel"><button className={`btn ibq cmfb${q.ref ? ' on' : ''}`} id="qRefBtn" title="Referral" aria-label="Referral" aria-haspopup="dialog" aria-expanded={pop === 'ref'} onClick={() => { const o = pop !== 'ref'; setPop(o ? 'ref' : null); if (o) setTimeout(() => document.getElementById('qRef')?.focus(), 20); }}><RawIcon d={P.users} /><i className="cmdot" hidden={!q.ref}></i></button>
          <div className="pop cmqpop" id="qRefPop" hidden={pop !== 'ref'} role="dialog" aria-label="Referral"><h4>Referral</h4><div id="qRefBody">
            <label className="ff on"><select className="fi" id="qRef" value={q.ref} onChange={(e) => { const v = e.target.value; if (v === '__new') { setPop(null); elec.open(); return; } up({ ref: v }); toast(v ? 'Referral set · rates updated' : 'Referral removed · rates updated'); }}>
              <option value="">No electrician</option>{d.refs.map((r) => <option value={r.id} key={r.id}>{r.name}{r.city ? ' · ' + r.city : ''}</option>)}<option value="__new">+ Add electrician…</option></select><span>Referred by</span></label>
            {q.ref ? <><div className="cmql">{cols.map((s) => <div key={s.id}><span>{qSerName(s)}</span><b>{inr2f(qComm(c, g, q, s))}</b></div>)}</div><p className="hint" style={{ margin: '6px 0 0' }}>Commission per brand on this quotation. Added to the rates · not shown to the customer.</p></>
              : <p className="hint" style={{ margin: '6px 0 0' }}>Pick the electrician who referred this customer. His commission is added to the rates by category.</p>}</div></div></div>
        <div className="rel"><button className="btn ibq" id="qShare" title="Share & download" aria-label="Share and download" aria-haspopup="true" aria-expanded={pop === 'share'} onClick={() => setPop(pop === 'share' ? null : 'share')}><RawIcon d={P.share} /></button>
          <div className="pop qshp" id="qSharePop" hidden={pop !== 'share'} role="menu"><h4>Share &amp; download</h4>
            <button role="menuitem" id="qWa" onClick={() => share('wa')}><RawIcon d={P.wa} /><span>WhatsApp<small>Send brand totals to the customer</small></span></button>
            <button role="menuitem" id="qPdf" onClick={() => share('pdf')}><RawIcon d={P.down} /><span>Download PDF<small>Landscape quotation with all ranges</small></span></button>
            <button role="menuitem" id="qXls" onClick={() => share('xls')}><RawIcon d={P.down} /><span>Download Excel<small>Same table as a spreadsheet</small></span></button></div></div>
        <button className="btn" id="qSaved" onClick={() => setSavedOpen(true)}><RawIcon d={P.saved} />Saved <span className="cnt" id="qSavedN" style={rows.length ? undefined : { display: 'none' }}>{rows.length}</span></button>
        <button className="btn p" id="qConv" disabled={ro} onClick={() => void openConvert()}><RawIcon d={P.conv} />Convert to invoice</button></div>
      <div className="card ptxc">
        <div className="ptfil qfil">
          <label className="qlab" htmlFor="qCust"><span>Customer</span><input className="fi" id="qCust" placeholder="Customer name" autoComplete="off" list="qCustL" value={q.cust} disabled={ro} onChange={(e) => up({ cust: e.target.value })} />
            <datalist id="qCustL">{d.PT.filter((p) => !p.supplier).map((p) => <option value={p.name} key={p.id} />)}</datalist></label>
          <label className="qlab" htmlFor="qPl"><span>Rates</span><select className="fi" id="qPl" value={pl.id} disabled={ro} onChange={(e) => up({ pl: e.target.value })}>{active.map((l) => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
          <label className="qlab" htmlFor="qDisc"><span>Discount %</span><input className="fi" id="qDisc" inputMode="decimal" placeholder="0" style={{ width: 80 }} value={q.disc || ''} disabled={ro} onChange={(e) => up({ disc: Math.min(100, Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)) })} /></label>
          <div className="msel" id="qSerW"><button type="button" className="fi mselb" id="qSerBtn" aria-haspopup="true" aria-expanded={pop === 'ser'} onClick={() => setPop(pop === 'ser' ? null : 'ser')}><span id="qSerTxt">{cols.length === g.ser.length ? `All ranges (${cols.length})` : `${cols.length} of ${g.ser.length} ranges`}</span><RawIcon d={P.chev} /></button>
            <div className="mselp" id="qSerPop" hidden={pop !== 'ser'} role="group" aria-label="Brand ranges" style={{ width: 280 }}>
              <div className="mselo" id="qSerOpts">
                <label className="mselr all"><input type="checkbox" data-qs="*" checked={q.sel.length === g.ser.length} onChange={(e) => up({ sel: e.target.checked ? g.ser.map((s) => s.id) : [] })} /><span>All ranges</span><i>{g.ser.length}</i></label>
                {g.ser.map((s) => <label className="mselr" key={s.id}><input type="checkbox" data-qs={s.id} checked={q.sel.includes(s.id)} onChange={(e) => { const on = e.target.checked; up({ sel: g.ser.map((x) => x.id).filter((id) => (id === s.id ? on : q.sel.includes(id))) }); }} /><span>{qSerName(s)}</span></label>)}</div>
              <div className="qserx"><button type="button" className="lnk" id="qAddSer" hidden={ro} onClick={() => { setPop(null); setAdd({ k: 'ser' }); }}>+ Add brand range</button><button type="button" className="lnk" id="qAddRow" hidden={ro} onClick={() => { setPop(null); setAdd({ k: 'row' }); }}>+ Add item row</button></div>
              <div className="mself"><span className="mu" style={{ fontSize: '11.5px' }}>Untick ranges you don’t need</span><button type="button" className="btn p sm" id="qSerDone" onClick={() => setPop(null)}>Done</button></div></div></div>
          <span style={{ flex: 1 }}></span>
          <button className="btn sm" id="qClear" disabled={ro} onClick={() => { if (!has) return toast('No quantities to clear'); if (!clearSure) return setClearSure(true); setClearSure(false); up({ qty: {} }); toast('Quantities cleared'); }}>{clearSure ? 'Click again to clear' : 'Clear quantities'}</button>
          <button className="btn sm p" id="qSave" disabled={ro} onClick={() => void save(q, false).then((x) => { if (x) setQ(x); })}><RawIcon d={P.save} />Save</button>
        </div>
        <div className="qro" id="qRo" hidden={!ro}>{ro ? <><Icon name="lock" /><span><b>Converted to {q.inv}</b> ({q.brand}). This quotation is locked and can’t be edited.</span>
          <button className="btn sm" id="qDup" onClick={() => void nextNo().then((no) => { setQ((x) => ({ ...x, id: null, no, status: 'draft', inv: '', brand: '' })); savedAs.current = ''; toast(`Copied as ${no}. You can edit and convert it.`); document.getElementById('qCust')?.focus(); })}>Copy as new quotation</button></> : null}</div>
        <p className="mu qhint" id="qHint" hidden>{ro ? `@ rates come from Price manager (${pl.name}). Read only.` : `@ rates come from Price manager (${pl.name})${q.disc ? `, less ${q.disc}% discount` : ''}. Type quantities; totals update for every brand.`}</p>
        <div className="qtw" ref={tw}><table className="qtab">
          <thead id="qHead"><tr><th className="qsk">Item</th><th className="qsk2 n">Qty</th>{cols.map((s) => <th className="n qch" key={s.id}><b>{s.b}</b><span>{s.r}{s.f ? ' ' + s.f : ''}</span></th>)}</tr></thead>
          <tbody id="qBody">{sec('Switches &amp; accessories')}{g.rows.filter((r) => r.c !== 'plate').map(row)}{sec('Plates')}{g.rows.filter((r) => r.c === 'plate').map(row)}</tbody>
          <tfoot id="qFoot" ref={foot}>
            <tr className="qtq"><td className="qsk">Total qty</td><td className="qsk2 n"><b>{qfmt(tq)}</b></td>{cols.map((s) => <td key={s.id}></td>)}</tr>
            <tr><td className="qsk">Switches &amp; accessories</td><td className="qsk2"></td>{T.map((t) => <td className="n" key={t.s.id}>{inr2f(t.acc)}</td>)}</tr>
            <tr><td className="qsk">Plates</td><td className="qsk2"></td>{T.map((t) => <td className="n" key={t.s.id}>{inr2f(t.plate)}</td>)}</tr>
            {q.disc ? <tr><td className="qsk">Discount {q.disc}%</td><td className="qsk2"></td>{T.map((t) => <td className="n" key={t.s.id}>−{inr2f(t.dis)}</td>)}</tr> : null}
            <tr className="qgt"><td className="qsk">Total</td><td className="qsk2"></td>{T.map((t) => <td className="n" key={t.s.id}><b>{inr2f(t.total)}</b>{t.miss ? <small className="qmiss">{t.miss} item{t.miss > 1 ? 's' : ''} not available</small> : best !== null && t.total === best && ok.length > 1 ? <small className="qbest">Lowest</small> : null}</td>)}</tr>
          </tfoot></table></div>
      </div>
      <SavedList open={savedOpen} rows={rows} onClose={() => setSavedOpen(false)} onOpen={onOpen} onConvert={onConvertRow} onCancel={(r) => void onCancel(r)} />
      <ConvertDialog open={conv} no={q.no} cust={q.cust} n={Object.keys(q.qty).length} ranked={qRanked(T)} onGo={convertBrand} onClose={() => setConv(false)} />
      <AddDialog mode={add} brands={brands} gstOn={gstOn} onClose={() => setAdd(null)} onSer={onSer} onRow={onRow} onItem={onItem} />
      <PinDialog open={pin} onClose={() => setPin(false)} onUnlocked={() => setPin(false)} />
      <SlModal m={elec.modal} onClose={elec.close} />
      <InvoicePreview doc={preview && shown.data?.id === preview ? shown.data : null} onClose={() => setPreview(null)} onNew={() => { const id = preview; setPreview(null); if (id && shown.data?.status !== 'converted') void convertItems(id); else navigate('/sales/new'); }} onLink={() => toast('Payment link is coming next')} />
    </section>
  );
}

/**
 * Settings › Print & invoice (Regular printer; Thermal shows "Coming soon").
 * Choices save on their own into the shop settings (data.print) and drive the one
 * shared renderer (features/print/Paper): this preview, every preview window, Print and PDF.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { STATES } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { inr2f } from '../../lib/format';
import type { ShopSettings } from '../../lib/settings';
import { useSettings } from '../../lib/settings';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { useBiz } from '../sales/InvoicePreview';
import { useSale, useSales } from '../sales/model';
import { Paper, PaperFit, columns, copiesOf, fromSale } from '../print/Paper';
import { sampleDoc } from '../print/sample';
import { usePrintStyles } from '../print/printer';
import { BOT, COLDEF, COLORS, COLS0, NAMES, PRINT_DEF, TOP, usePrintOpts, type ColSet, type PrintOpts } from '../print/opts';
import { Sw } from './model';

export const PRINT_ICON = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const UP = '<path d="M6 15l6-6 6 6"/>';
const DN = '<path d="M6 9l6 6 6-6"/>';
const RT = '<path d="M9 6l6 6-6 6"/>';
const DEF = PRINT_DEF;

type Dlg = null | 'cols' | 'names';
type Sample = 'plain' | 'gst' | 'last';
export const usePrint = create<{ printer: 'regular' | 'thermal'; dlg: Dlg; sample: Sample; setPrinter: (p: 'regular' | 'thermal') => void; open: (d: Dlg) => void; setSample: (s: Sample) => void }>((set) => ({
  printer: 'regular', dlg: null, sample: 'plain', setPrinter: (printer) => set({ printer }), open: (dlg) => set({ dlg }), setSample: (sample) => set({ sample }),
}));

let timer: ReturnType<typeof setTimeout> | undefined;
/** The shop's print choices and a setter: the screen (and every open preview) changes at once, the server is told half a second later. */
function useEdit() {
  const o = usePrintOpts();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const set = (p: Partial<PrintOpts>) => {
    const n = { ...o, ...p };
    qc.setQueriesData<ShopSettings>({ queryKey: ['settings'] }, (x) => (x ? { ...x, data: { ...x.data, print: n } } : x));
    clearTimeout(timer);
    timer = setTimeout(() => {
      api('/settings', { method: 'PATCH', body: { data: { print: n } } })
        .catch((e) => showToast(e instanceof ApiError ? e.message : 'Could not save the print settings.'))
        .finally(() => void qc.invalidateQueries({ queryKey: ['settings'] }));
    }, 500);
  };
  return { o, set };
}

/** The "Regular printer / Thermal printer" switch at the top of the page (the Tax list's .seg2 tabs). */
export function PrinterTabs() {
  const { printer, setPrinter } = usePrint();
  return (
    <div className="seg2" role="tablist" id="prTabs" aria-label="Printer type">
      {(['regular', 'thermal'] as const).map((p) => <button role="tab" aria-selected={printer === p} className={printer === p ? 'on' : ''} key={p} onClick={() => setPrinter(p)}>{p === 'regular' ? 'Regular printer' : 'Thermal printer'}</button>)}
    </div>
  );
}

export function ThermalSoon() {
  return (
    <section className="card" id="cThermal">
      <div className="tgl"><div className="ti" style={T('var(--ac)')}><RawIcon d={PRINT_ICON} /></div><div className="tx"><b>Thermal printer</b><small>Small roll printers (2 inch and 3 inch) used at the billing counter.</small></div></div>
      <div className="off"><Icon name="clock" /><span><b>Coming soon.</b> Thermal printing isn’t ready yet. Use Regular printer for now; it works with any A4 or A5 printer.</span></div>
    </section>
  );
}

const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });
const H = ({ t, d, first }: { t: string; d: string; first?: boolean }) => <><h3 style={{ margin: `${first ? 0 : 22}px 0 4px`, fontSize: 16 }}>{t}</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>{d}</p></>;
const Seg = <V extends string>({ lbl, v, list, ch }: { lbl: string; v: V; list: [V, string][]; ch: (v: V) => void }) => (
  <div className="fl">{lbl}<div className="seg2 sm" role="radiogroup" aria-label={lbl} style={{ display: 'flex', marginTop: 6 }}>{list.map(([k, t]) => <button type="button" role="radio" aria-checked={v === k} className={v === k ? 'on' : ''} key={k} style={{ flex: 1 }} onClick={() => ch(k)}>{t}</button>)}</div></div>
);
const Opt = ({ id, on, t, d, ch, extra }: { id: string; on: boolean; t: string; d: string; ch: (v: boolean) => void; extra?: React.ReactNode }) => <div className="opt"><div className="tx"><b>{t}</b><small>{d}</small></div>{extra}<Sw id={id} on={on} label={t} onChange={ch} /></div>;

/** Left column: the option cards. */
export function PrintCards() {
  const { o, set } = useEdit();
  const open = usePrint((x) => x.open);
  const move = (k: 'top' | 'bot', i: number, d: -1 | 1) => { const a = [...o[k]] as string[]; const j = i + d; const t = a[i]!; a[i] = a[j]!; a[j] = t; set({ [k]: a } as Partial<PrintOpts>); };
  const hid = (k: string, v: boolean) => set({ hide: v ? o.hide.filter((x) => x !== k) : [...o.hide, k] });
  const blocks = <K extends 'top' | 'bot'>(k: K, lbl: Record<string, readonly [string, string]>) => (o[k] as string[]).map((b, i, a) => (
    <Opt key={b} id={`pB_${b}`} on={!o.hide.includes(b)} t={lbl[b]![0]} d={lbl[b]![1]} ch={(v) => hid(b, v)}
      extra={<span style={{ display: 'flex', gap: 6, marginTop: 2 }}><button type="button" className="ix" aria-label={`Move ${lbl[b]![0]} up`} disabled={!i} onClick={() => move(k, i, -1)}><RawIcon d={UP} /></button><button type="button" className="ix" aria-label={`Move ${lbl[b]![0]} down`} disabled={i === a.length - 1} onClick={() => move(k, i, 1)}><RawIcon d={DN} /></button></span>} />
  ));
  return (
    <>
      <section className="card" id="cPrLayout">
        <H first t="Layout" d="The design of your printed invoice." />
        <div className="two" role="radiogroup" aria-label="Invoice layout">
          {([['classic', 'Classic boxed', 'Everything in one box with grid lines, like your sample bill. Items get the most space.'], ['simple', 'Simple', 'Clean lines, like the invoice you print today.']] as const).map(([k, t, d]) => (
            <button className="po" type="button" role="radio" aria-checked={o.theme === k} key={k} onClick={() => set({ theme: k })}><span><b>{t}{k === 'classic' && <span className="rec g">Default</span>}</b><small>{d}</small></span></button>
          ))}
        </div>
        <div className="fl" style={{ marginTop: 14 }}>Colour of lines and headings</div>
        <div className="two" role="radiogroup" aria-label="Invoice colour" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
          {COLORS.map(([n, c]) => <button className="po" type="button" role="radio" aria-checked={o.color === c} key={c} onClick={() => set({ color: c })}><span className="sw"><i style={{ background: c }}></i></span><span><b>{n}</b></span></button>)}
        </div>
        <button type="button" className="aplink" id="pNamesBtn" style={{ marginTop: 12 }} onClick={() => open('names')}>Change transaction names<RawIcon d={RT} /></button>
      </section>

      <section className="card" id="cPrPage">
        <H first t="Page layout" d="Show, hide and order the parts of the invoice. The item table always prints and sits in the middle." />
        <div className="fl" style={{ margin: '0 0 2px' }}>Top of the page</div>
        <div className="opts">{blocks('top', TOP)}</div>
        <div className="fl" style={{ margin: '14px 0 2px' }}>Under the items</div>
        <div className="opts">
          <Opt id="pB_words" on={!o.hide.includes('words')} t="Amount in words" d="Left of the totals box." ch={(v) => hid('words', v)} />
          <Opt id="pB_amts" on={!o.hide.includes('amts')} t="Amounts box" d="Sub total, taxes, total, received and balance." ch={(v) => hid('amts', v)} />
        </div>
        <div className="fl" style={{ margin: '14px 0 2px' }}>Bottom row (three boxes side by side)</div>
        <div className="opts">{blocks('bot', BOT)}</div>
        <div className="sub"><div style={{ maxWidth: 440 }}>
          <Seg lbl="Item area" v={o.area} list={[['auto', 'Auto'], ['fill', 'Fill page'], ['min', 'Minimum rows']]} ch={(v) => set({ area: v })} />
          {o.area === 'min' ? <label className="fl" htmlFor="pMinRows">Minimum rows<input className="fi" id="pMinRows" type="number" min="1" max="40" inputMode="numeric" value={o.minRows} onChange={(e) => set({ minRows: e.target.value })} /></label> : null}
          <Seg lbl="Page margins" v={o.margin} list={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]} ch={(v) => set({ margin: v })} />
        </div>
          <p className="hint" style={{ margin: '0 0 14px' }}>Auto: the table is as tall as the items. Fill page: the empty part of the table stretches down so the bottom row sits at the foot of the page. Minimum rows: the table always has at least this many rows. Long bills continue on the next page with the table headings repeated.</p>
          <button type="button" className="btn" id="pReset" onClick={() => set({ top: DEF.top, bot: DEF.bot, hide: [], margin: DEF.margin, area: DEF.area, minRows: DEF.minRows, nameSize: DEF.nameSize, textSize: DEF.textSize })}>Reset to default layout</button>
        </div>
      </section>

      <section className="card" id="cPrHead">
        <H first t="Header" d="Your business details at the top of the invoice. They come from Settings › General › Business details." />
        <div className="opts">
          <Opt id="pName" on={o.showName} t="Company name" d="Your business name in large letters." ch={(v) => set({ showName: v })} />
          <Opt id="pAddr" on={o.showAddr} t="Address" d="Shop address, city and PIN code." ch={(v) => set({ showAddr: v })} />
          <Opt id="pEmail" on={o.showEmail} t="Email" d="Your business email." ch={(v) => set({ showEmail: v })} />
          <Opt id="pPhone" on={o.showPhone} t="Phone number" d="Your business phone number." ch={(v) => set({ showPhone: v })} />
        </div>
        <div className="sub"><div className="two">
          <label className="fl" htmlFor="pFirm">Firm name (optional)<input className="fi" id="pFirm" value={o.firm} placeholder="e.g. ABC Enterprises" autoComplete="off" onChange={(e) => set({ firm: e.target.value })} /></label><span></span>
          <Seg lbl="Paper size" v={o.paper} list={[['A4', 'A4'], ['A5', 'A5']]} ch={(v) => set({ paper: v })} />
          <Seg lbl="Orientation" v={o.landscape ? 'l' : 'p'} list={[['p', 'Portrait'], ['l', 'Landscape']]} ch={(v) => set({ landscape: v === 'l' })} />
          <label className="fl" htmlFor="pNameSize">Company name size<select className="fi" id="pNameSize" value={o.nameSize} onChange={(e) => set({ nameSize: e.target.value as PrintOpts['nameSize'] })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option><option value="xl">Extra large</option></select></label>
          <label className="fl" htmlFor="pTextSize">Invoice text size<select className="fi" id="pTextSize" value={o.textSize} onChange={(e) => set({ textSize: e.target.value as PrintOpts['textSize'] })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></label>
        </div></div>
      </section>

      <section className="card" id="cPrTable">
        <H first t="Item table" d="Choose which columns print and what their headings say." />
        <p className="pvsub" style={{ margin: '0 0 6px' }}>Printing now: {COLDEF.filter(([, k]) => o.cols[k].on).map(([, k]) => o.cols[k].label).join(' · ')}</p>
        <button type="button" className="aplink" id="pColsBtn" onClick={() => open('cols')}>Item table customisation<RawIcon d={RT} /></button>
      </section>

      <section className="card" id="cPrTot">
        <H first t="Totals & taxes" d="What prints in the amounts box under the items." />
        <div className="opts">
          <Opt id="pTq" on={o.totalQty} t="Total quantity" d="The Total row at the bottom of the item table." ch={(v) => set({ totalQty: v })} />
          <Opt id="pRecv" on={o.received} t="Received amount" d="Money taken with this invoice." ch={(v) => set({ received: v })} />
          <Opt id="pBal" on={o.balance} t="Balance due" d="What the customer still owes on this invoice." ch={(v) => set({ balance: v })} />
          <Opt id="pPBal" on={o.partyBal} t="Party’s current balance" d="Everything the customer owes you, including this invoice." ch={(v) => set({ partyBal: v })} />
          <Opt id="pTax" on={o.taxTable} t="Tax details" d="The GST table by rate (CGST, SGST or IGST). GST invoices only." ch={(v) => set({ taxTable: v })} />
          <Opt id="pSaved" on={o.saved} t="“You saved”" d="How much less than MRP the customer paid." ch={(v) => set({ saved: v })} />
          <Opt id="pWords" on={o.words} t="Amount in words" d="Indian style, in lakh and crore." ch={(v) => set({ words: v })} />
          <Opt id="pGroup" on={o.grouping} t="Amounts with commas" d="Indian grouping, e.g. 1,25,000.00. Turned off: 125000.00." ch={(v) => set({ grouping: v })} />
        </div>
      </section>

      <section className="card" id="cPrFoot">
        <H first t="Footer" d="The bottom row of the invoice." />
        <div className="opts">
          <Opt id="pDesc" on={o.description} t="Description" d="The invoice’s description, when you add one in the sale." ch={(v) => set({ description: v })} />
          <Opt id="pMode" on={o.payMode} t="Payment mode" d="Cash, UPI, card or bank next to the received amount." ch={(v) => set({ payMode: v })} />
        </div>
        <div className="sub">
          <label className="fl" htmlFor="pTerms">Terms and conditions<textarea className="fi ta" id="pTerms" rows={4} placeholder="e.g. Goods once sold will not be taken back." value={o.terms} onChange={(e) => set({ terms: e.target.value })} /></label>
          <div className="two"><label className="fl" htmlFor="pSign">Signature text<input className="fi" id="pSign" value={o.sign} placeholder="Authorized Signatory" autoComplete="off" onChange={(e) => set({ sign: e.target.value })} /></label><span></span></div>
        </div>
        <H t="Copies" d="Each copy prints on its own page with its label at the top." />
        <div className="opts">
          <Opt id="pOrig" on={o.copies.orig} t="Original for recipient" d="For the customer." ch={(v) => set({ copies: { ...o.copies, orig: v } })} />
          <Opt id="pDup" on={o.copies.dup} t="Duplicate for transporter" d="Travels with the goods." ch={(v) => set({ copies: { ...o.copies, dup: v } })} />
          <Opt id="pTrip" on={o.copies.trip} t="Triplicate for supplier" d="Kept in your file." ch={(v) => set({ copies: { ...o.copies, trip: v } })} />
        </div>
      </section>
      <ColsDialog />
      <NamesDialog />
    </>
  );
}

/** the prototype's dialog frame (.ov.c > .mdl.wide, .dh header, buttons bottom right) */
function Dialog({ id, title, sub, onClose, children, foot }: { id: string; title: string; sub: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="ov c" id={id} onClick={(e) => { if ((e.target as HTMLElement).id === id) onClose(); }}>
      <div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby={id + 'T'}>
        <div className="dh"><div><h3 id={id + 'T'} style={{ margin: 0, fontSize: 18 }}>{title}</h3><small className="mu">{sub}</small></div><button className="ib" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        {children}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 18 }}>{foot}</div>
      </div>
    </div>
  );
}

function ColsDialog() {
  const { o, set } = useEdit();
  const { dlg, open } = usePrint();
  const [c, setC] = useState<ColSet>(o.cols);
  // fresh copy each time the dialog opens (not on every change while it is open)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (dlg === 'cols') setC(o.cols); }, [dlg]);
  if (dlg !== 'cols') return null;
  const close = () => open(null);
  const pcols = columns(sampleDoc(false), { ...o, cols: c }, (v) => inr2f(String(v)));
  const row = ([, k, , , x]: (typeof COLDEF)[number]) => (
    <div className="mselr" key={k} style={{ padding: '4px 0' }}><input type="checkbox" checked={c[k]!.on} disabled={x?.lock} aria-label={`Print ${COLS0[k]!.label}`} onChange={(e) => setC({ ...c, [k]: { ...c[k]!, on: e.target.checked } })} />
      <input className="fi" style={{ margin: 0, height: 36, flex: 1, minWidth: 0 }} value={c[k]!.label} aria-label={`Heading for ${COLS0[k]!.label}`} placeholder={COLS0[k]!.label} onChange={(e) => setC({ ...c, [k]: { ...c[k]!, label: e.target.value } })} /></div>
  );
  const grp = (g: 1 | 2 | 3, t: string, d: string) => <div><h4 style={{ margin: '0 0 2px', fontSize: 14 }}>{t}</h4><p className="mu" style={{ margin: '0 0 8px', fontSize: 12 }}>{d}</p>{COLDEF.filter((x) => x[0] === g).map(row)}</div>;
  return (
    <Dialog id="ictm" title="Item table customisation" sub="Tick the columns to print. Type to change a heading, e.g. “Billed Qty”." onClose={close}
      foot={<><button className="btn" type="button" onClick={() => setC(COLS0)}>Reset columns</button><button className="btn p" type="button" id="ictmDone" onClick={() => { set({ cols: c }); close(); }}>Done</button></>}>
      <div className="tw" style={{ margin: '14px 0 16px', background: '#fff', borderRadius: 10, border: '1px solid var(--bd)' }}>
        <table className="ivtab" style={{ margin: 0 }}><thead><tr>{pcols.map((x) => <th key={x.key} className={x.n ? 'n' : undefined}>{x.label}</th>)}</tr></thead>
          <tbody><tr>{pcols.map((x) => <td key={x.key} className={x.n ? 'n' : undefined}>{x.v(sampleDoc(false).lines[0]!, 0)}</td>)}</tr></tbody></table></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 18, maxHeight: 'calc(100vh - 360px)', overflow: 'auto' }}>
        {grp(1, 'Item columns', 'Item Name always prints.')}
        {grp(2, 'Additional columns', 'From the item’s details.')}
        {grp(3, 'Amounts & taxes', 'Amount always prints.')}
      </div>
    </Dialog>
  );
}

function NamesDialog() {
  const { o, set } = useEdit();
  const { dlg, open } = usePrint();
  const [n, setN] = useState(o.names);
  const [bos, setBos] = useState(o.bos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (dlg === 'names') { setN(o.names); setBos(o.bos); } }, [dlg]);
  if (dlg !== 'names') return null;
  const close = () => open(null);
  return (
    <Dialog id="tnm" title="Change transaction names" sub="The name printed at the top of each document. Your entries keep their numbers." onClose={close}
      foot={<><button className="btn" type="button" onClick={close}>Cancel</button><button className="btn p" type="button" id="tnmSave" onClick={() => { set({ names: n, bos }); close(); }}>Save</button></>}>
      <div className="two" style={{ marginTop: 16 }}>
        {NAMES.map(([k, l, d], i) => (
          <div key={k}>
            <label className="fl" htmlFor={`tn_${k}`}>{l}<input className="fi" id={`tn_${k}`} value={n[k]} placeholder={d} autoComplete="off" onChange={(e) => setN({ ...n, [k]: e.target.value })} /></label>
            {i === 0 ? <label className="mselr" style={{ padding: '0 0 6px' }}><input type="checkbox" checked={bos} onChange={(e) => setBos(e.target.checked)} /><span>Bill of Supply for sales without tax</span></label> : null}
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>Not listed because the app doesn’t have them yet: Other Income, Sale Order, Proforma Invoice.</p>
    </Dialog>
  );
}

/** Right column: the live preview, drawn by the shared renderer exactly as it prints. */
export function PrintPreview() {
  usePrintStyles();
  const o = usePrintOpts();
  const { sample, setSample } = usePrint();
  const biz = useBiz().data;
  const upi = ((useSettings().data?.data ?? {}) as { upi?: string }).upi ?? '';
  const last = useSales('invoice').data?.[0]?.id ?? null;
  const doc = useSale(sample === 'last' ? last : null).data;
  const d = sample === 'last' && doc ? fromSale(doc, { upi }) : sampleDoc(sample === 'gst', biz?.stateCode || '09');
  const copies = copiesOf(o);
  const opts: [Sample, string][] = [['plain', 'Bill without tax'], ['gst', 'GST bill'], ...(last ? [['last', 'Last invoice'] as [Sample, string]] : [])];
  return (
    <aside className="card pv" id="pv">
      <div className="hd"><h3>Live preview</h3><span className="pill">{o.paper} {o.landscape ? 'landscape' : 'portrait'}</span></div>
      <div className="pvc"><div className="seg2 sm" role="radiogroup" aria-label="Preview with">{opts.map(([k, t]) => <button role="radio" aria-checked={sample === k} className={sample === k ? 'on' : ''} key={k} data-pvs={k} onClick={() => setSample(k)}>{t}</button>)}</div></div>
      <div className="ppframe" id="pvPaper"><PaperFit o={o}><Paper d={d} o={o} biz={biz} states={STATES} /></PaperFit></div>
      <p className="pvsub" style={{ margin: '10px 0 0' }}>{copies.length ? `Prints ${copies.length === 1 ? '1 copy' : copies.length + ' copies'}: ${copies.map((c) => c.split(' ')[0]).join(', ')}.` : 'No copy chosen: turn on at least one copy in Footer.'}</p>
    </aside>
  );
}

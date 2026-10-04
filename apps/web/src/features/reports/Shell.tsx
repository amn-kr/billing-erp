/**
 * The frame every rebuilt report shares (prototype rpShell, rpPrint, rpXls, rpPdf): heading with
 * the list toggle and Print / PDF / Excel (and WhatsApp where the report has it), filters and
 * period, summary boxes, the table with its total row, and a note. Same markup and class names.
 */
import { useRef, type ReactNode } from 'react';
import { Icon, RawIcon } from '../../components/Icon';
import { saveFile, xlsxBlob } from '../../lib/files';
import { dmy } from '../../lib/format';
import { today } from '../../lib/time';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useEscape } from '../../lib/useEscape';
import { bzLine, bzName, useBiz, type Biz } from '../sales/InvoicePreview';
import { perOpts, range, rangeTxt, choosePer, type PeriodState } from './periods';

export interface Col { h: string; n?: boolean; int?: boolean; cls?: string; w?: number }
export interface Row { k?: string; c: (string | number)[]; h?: Record<number, ReactNode> }
export interface RpDef {
  title: string; group: string; sub?: string;
  filters?: ReactNode; period?: false;
  kpis?: [label: ReactNode, value: ReactNode, cls?: string, sub?: string][];
  cols: Col[]; rows: Row[]; foot?: (string | number)[];
  note?: ReactNode; empty?: string;
  wa?: () => void; click?: (k: string) => void;
}

const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';

/** Period picker (prototype rpPeriod). */
export function PeriodFields({ p, set, ids = ['rpPer', 'rpFrom', 'rpTo'] }: { p: PeriodState; set: (p: PeriodState) => void; ids?: [string, string, string] }) {
  const [f, t] = range(p);
  return (
    <>
      <label className="fl" htmlFor={ids[0]}>Period<select className="fi" id={ids[0]} value={p.per} onChange={(e) => set(choosePer(e.target.value as PeriodState['per']))}>{perOpts().map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label>
      <label className="fl" htmlFor={ids[1]}>From<input className="fi" type="date" id={ids[1]} value={f} disabled={p.per !== 'custom'} onChange={(e) => set({ ...p, from: e.target.value })} /></label>
      <label className="fl" htmlFor={ids[2]}>To<input className="fi" type="date" id={ids[2]} value={t} disabled={p.per !== 'custom'} onChange={(e) => set({ ...p, to: e.target.value })} /></label>
    </>
  );
}

/** A select filter (prototype rpSel). */
export function Sel({ id, label, opts, value, onChange }: { id: string; label: string; opts: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <label className="fl" htmlFor={id}>{label}<select className="fi" id={id} value={value} onChange={(e) => onChange(e.target.value)}>{opts.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></label>;
}

export function ListToggle({ onToggle }: { onToggle: () => void }) {
  return <button type="button" className="ib rptg" id="rpTg" title="Show / hide report list" aria-label="Show or hide report list" onClick={onToggle}><Icon name="menu" /></button>;
}

export function RpShell({ o, p, setP, onToggle, onPrint }: { o: RpDef; p: PeriodState; setP: (p: PeriodState) => void; onToggle: () => void; onPrint: () => void }) {
  const biz = useBiz().data;
  const C = o.cols;
  const cls = (c: Col) => `${c.n ? 'n' : ''} ${c.cls || ''}`;
  return (
    <>
      <div className="psh"><ListToggle onToggle={onToggle} /><div><small className="mu">{o.group}</small><h2>{o.title}</h2></div>
        <div className="psa">{o.wa ? <button className="btn sm" id="rpWa" onClick={o.wa}><Icon name="chat" />WhatsApp</button> : null}<button className="btn sm" id="rpPrint" onClick={onPrint}><Icon name="doc" />Print</button><button className="btn sm" id="rpPdf" onClick={() => void rpPdf(o, p, biz)}>PDF</button><button className="btn sm" id="rpXls" onClick={() => void rpXls(o, p, biz)}>Excel</button></div></div>
      <div className="psf">{o.filters}{o.period === false ? null : <PeriodFields p={p} set={setP} />}</div>
      {o.kpis ? <div className="psk rpk">{o.kpis.map((k, i) => <div className={k[2] || ''} key={i}><small>{k[0]}</small><b>{k[1]}</b>{k[3] ? <em>{k[3]}</em> : null}</div>)}</div> : null}
      <div className="tw pst rpt"><table className="ptt2"><thead><tr>{C.map((c, i) => <th className={c.n ? 'n' : ''} key={i}>{c.h}</th>)}</tr></thead><tbody>
        {o.rows.length ? o.rows.map((r, ri) => (
          <tr key={ri} {...(r.k ? { className: 'psclk', 'data-rpk': r.k, tabIndex: 0, onClick: () => o.click?.(r.k!), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') o.click?.(r.k!); } } : {})}>
            {C.map((c, i) => <td className={cls(c)} key={i}>{r.h && r.h[i] !== undefined ? r.h[i] : String(r.c[i] ?? '')}</td>)}
          </tr>
        )) : <tr><td colSpan={C.length} className="ptempty">{o.empty || 'Nothing to show for this period.'}</td></tr>}
      </tbody>{o.foot ? <tfoot><tr>{C.map((c, i) => <td className={c.n ? 'n' : ''} key={i}><b>{String(o.foot![i] ?? '')}</b></td>)}</tr></tfoot> : null}</table></div>
      {o.note ? <p className="hint" style={{ margin: '10px 0 0' }}>{o.note}</p> : null}
    </>
  );
}

/** Print view of a report in the preview window (prototype rpPrint). */
export function RpPrint({ o, p, onClose }: { o: RpDef | null; p: PeriodState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const biz = useBiz().data;
  useOpenFocus(!!o, ref);
  useEscape(!!o, onClose);
  if (!o) return <div className="ov c" id="ipv" hidden ref={ref}><div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle"></div></div>;
  return (
    <div className="ov c" id="ipv" ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'ipv') onClose(); }}>
      <div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle">
        <div className="ipvbar"><h3 id="ipvTitle" style={{ margin: 0, fontSize: 16, flex: 1 }}>{o.title}</h3>
          <button className="btn sm" type="button" id="ipvLink" hidden style={{ display: 'none' }}><Icon name="phone" />Payment link</button>
          <a className="btn sm" id="ipvWa" href="#" target="_blank" rel="noopener" style={{ textDecoration: 'none', display: 'none' }}><svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: '<path d="M4 5h16v11H9l-5 4z"/>' }} />Share on WhatsApp</a>
          <button className="btn sm" type="button" id="ipvPrint" onClick={() => window.print()}><RawIcon d={PRINT} />Print</button>
          <button className="btn p sm" type="button" id="ipvNew" style={{ display: 'none' }}><Icon name="plus" />New invoice</button>
          <button className="ib" type="button" id="ipvClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="ivsheet" id="ipvSheet"><div className="dch"><div className="dchh"><div><b>{bzName(biz)}</b><small>{bzLine(biz)}</small></div><div className="dcht"><span>{o.title.toUpperCase()}</span><small>{o.period === false ? 'As on ' + dmy(today()) : rangeTxt(p)}</small>{o.sub ? <small>{o.sub}</small> : null}</div></div>
          <table className="ivtab"><thead><tr>{o.cols.map((c, i) => <th className={c.n ? 'n' : ''} key={i}>{c.h}</th>)}</tr></thead><tbody>{o.rows.map((r, ri) => <tr key={ri}>{r.c.map((v, i) => <td className={o.cols[i]!.n ? 'n' : ''} key={i}>{String(v ?? '')}</td>)}</tr>)}
            {o.foot ? <tr className="dchtot">{o.foot.map((v, i) => <td className={o.cols[i]!.n ? 'n' : ''} key={i}>{String(v ?? '')}</td>)}</tr> : null}</tbody></table></div></div>
      </div>
    </div>
  );
}

/* ---------- Excel and PDF (prototype rpXls / rpPdf) ---------- */
const fileOf = (o: RpDef, ext: string) => `${o.title.replace(/[^\w]+/g, '-')}${o.sub ? '-' + o.sub.replace(/[^\w]+/g, '-') : ''}.${ext}`;
const numOf = (v: string | number) => { const s = String(v ?? '').replace(/,/g, '').replace(/%$/, ''); return /^-?\d+(\.\d+)?$/.test(s) ? +s : v; };
const when = (o: RpDef, p: PeriodState) => (o.period === false ? 'As on ' + dmy(today()) : rangeTxt(p));

export async function rpXls(o: RpDef, p: PeriodState, biz?: Biz) {
  const rows: (string | number)[][] = [[bzName(biz)], [`${o.title}${o.sub ? ' · ' + o.sub : ''} · ${when(o, p)}`], [], o.cols.map((c) => c.h)];
  o.rows.forEach((r) => rows.push(r.c.map((v, i) => (o.cols[i]!.n ? numOf(v) : v))));
  if (o.foot) { rows.push([]); rows.push(o.foot.map((v, i) => (o.cols[i]!.n ? numOf(v) : v))); }
  const money = o.cols.map((c, i) => (c.n && !c.int ? i : -1)).filter((i) => i >= 0);
  saveFile(fileOf(o, 'xlsx'), await xlsxBlob([{ name: o.title.slice(0, 30), rows, widths: o.cols.map((c) => c.w || (c.n ? 14 : 20)), freeze: 4, styles: { 0: 3, 3: 1, ...(o.foot ? { [rows.length - 1]: 1 as const } : {}) }, money }]));
}

export async function rpPdf(o: RpDef, p: PeriodState, biz?: Biz) {
  const { jsPDF } = await import('jspdf');
  const land = o.cols.length > 6;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: land ? 'landscape' : 'portrait' });
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), L = 34, R = PW - 34, W = R - L;
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
  const text = (x: number, y: number, s: string, t: { size: number; bold?: boolean; color?: string; align?: 'right'; max?: number }) => {
    doc.setFont('helvetica', t.bold ? 'bold' : 'normal'); doc.setFontSize(t.size); doc.setTextColor(...hex(t.color ?? '#151b2e'));
    let v = s;
    if (t.max) while (v.length > 1 && doc.getTextWidth(v) > t.max) v = v.slice(0, -2) + '…';
    doc.text(v, x, y, t.align ? { align: t.align } : undefined);
  };
  const tw = o.cols.reduce((a, c) => a + (c.w || (c.n ? 14 : 20)), 0);
  const XS: [number, number][] = [];
  let x = L;
  o.cols.forEach((c) => { const w = (W * (c.w || (c.n ? 14 : 20))) / tw; XS.push([x, w]); x += w; });
  let y = 46, pg = 1;
  const addr = [biz?.address, [biz?.city, biz?.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const head = () => {
    text(L, y, bzName(biz), { size: 13, bold: true }); text(R, y, o.title, { size: 12, bold: true, align: 'right' }); y += 14;
    text(L, y, addr, { size: 8.5, color: '#5b6478' }); text(R, y, (o.sub ? o.sub + '  |  ' : '') + when(o, p), { size: 8.5, color: '#5b6478', align: 'right' }); y += 12;
    doc.setFillColor(...hex('#0f766e')); doc.rect(L, y, W, 20, 'F');
    o.cols.forEach((c, i) => { const [cx, cw] = XS[i]!; if (c.n) text(cx + cw - 4, y + 13, c.h, { size: 8, bold: true, color: '#ffffff', align: 'right', max: cw - 6 }); else text(cx + 4, y + 13, c.h, { size: 8, bold: true, color: '#ffffff', max: cw - 6 }); });
    y += 20;
  };
  const row = (cells: (string | number)[], b?: boolean) => {
    if (y > PH - 50) { text(R, PH - 24, `Page ${pg}`, { size: 7.5, color: '#5b6478', align: 'right' }); doc.addPage(); pg++; y = 46; head(); }
    y += 14;
    cells.forEach((v, i) => { const [cx, cw] = XS[i]!, t = String(v ?? ''); if (o.cols[i]!.n) text(cx + cw - 4, y, t, { size: 8.5, bold: b, align: 'right', max: cw - 6 }); else text(cx + 4, y, t, { size: 8.5, bold: b, max: cw - 6 }); });
    doc.setDrawColor(...hex('#e3e6ee')); doc.setLineWidth(0.4); doc.line(L, y + 5, R, y + 5);
  };
  head();
  o.rows.forEach((r) => row(r.c));
  if (o.foot) row(o.foot, true);
  text(R, PH - 24, `Page ${pg}`, { size: 7.5, color: '#5b6478', align: 'right' });
  saveFile(fileOf(o, 'pdf'), doc.output('blob'));
}

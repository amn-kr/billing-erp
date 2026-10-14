/**
 * Download rate list (#rlm) — the prototype's openRateList / rlPreview and its
 * Excel, PDF, WhatsApp and Print outputs, with the same layout and file names.
 */
import { useEffect, useRef } from 'react';
import { printNow, usePrintSource } from '../print/printer';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { money, round2 } from '@billing/shared';
import { api } from '../../lib/api';
import { fmtD, inr2f } from '../../lib/format';
import { saveFile, xlsxBlob } from '../../lib/files';
import { useSettings } from '../../lib/settings';
import { today } from '../../lib/time';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { RawIcon } from '../../components/Icon';
import type { PItem, PriceData } from './model';

const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const CHAT = '<path d="M4 5h16v11H9l-5 4z"/>';
const DOWN = '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>';

interface Biz { name: string; address: string | null; city: string | null; pin: string | null; phone: string | null }
type Cols = { mrp: boolean; hsn: boolean; unit: boolean; gst: boolean; brand: boolean };
interface RlState {
  pl: string; cats: string[] | null; brand: string; brands: string[] | null; group: 'cat' | 'brand'; brPage: boolean; pick: string[] | null; stock: boolean;
  cols: Cols; tax: 'incl' | 'excl'; title: string; valid: string;
  set: (p: Partial<Omit<RlState, 'set'>>) => void;
}
/** end of the current month (the prototype's "valid till" default) */
const monthEnd = () => { const [y, m] = today().split('-').map(Number); const d = new Date(Date.UTC(y!, m!, 0)); return d.toISOString().slice(0, 10); };
export const useRl = create<RlState>((set) => ({
  pl: '', cats: null, brand: 'all', brands: null, group: 'cat', brPage: false, pick: null, stock: true,
  cols: { mrp: true, hsn: false, unit: true, gst: false, brand: true }, tax: 'incl', title: '', valid: monthEnd(),
  set: (p) => set(p),
}));

const vlabel = (i: PItem) => `${i.brand || ''}${i.series ? ' ' + i.series : ''}`.trim() || i.name;

export function RateList({ open, data, onClose }: { open: boolean; data: PriceData; onClose: () => void }) {
  const RL = useRl();
  const settings = useSettings().data;
  const gstOn = !!settings?.gstEnabled;
  const mrpOn = !!settings?.data?.mrp;
  const biz = useQuery({ queryKey: ['business-current'], queryFn: () => api<Biz>('/businesses/current'), enabled: open });
  const ovRef = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ovRef);
  // the prototype's printing-rl rules, on a copy of the window at the end of <body>
  usePrintSource(open, { el: () => ovRef.current, title: 'Rate list', cls: 'printing-rl' });
  const { IT, PLS, brands } = data;
  const PLA = PLS.filter((p) => p.isDefault || p.active);
  const allCats = [...new Set(IT.map((i) => i.cat || 'Other'))];

  // openRateList(): first time all categories; a list that is off falls back to the default; MRP off hides its column
  useEffect(() => {
    if (!open) return;
    const st = useRl.getState();
    st.set({
      cats: st.cats ?? allCats,
      pl: st.pl && PLA.some((p) => p.id === st.pl) ? st.pl : (PLS.find((p) => p.isDefault) ?? PLS[0])!.id,
      ...(mrpOn ? {} : { cols: { ...st.cols, mrp: false } }),
    });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cats = new Set(RL.cats ?? allCats);
  const pl = PLS.find((p) => p.id === RL.pl) ?? PLS.find((p) => p.isDefault)!;
  const price = (i: PItem) => (pl.isDefault ? i.sale : i.pl[pl.id]?.p ?? i.sale);
  const key = (i: PItem) => (RL.group === 'brand' ? i.brand || 'Other brands' : i.cat || 'Other');
  const showBrand = RL.cols.brand && RL.group !== 'brand';
  const c: Cols = { ...RL.cols, brand: showBrand, ...(gstOn ? {} : { hsn: false, gst: false }) };
  const R = IT.filter((i) => (!RL.pick || RL.pick.includes(i.id)) && cats.has(i.cat || 'Other') && (RL.brand === 'all' || i.brand === RL.brand) && (!RL.brands || RL.brands.includes(i.brand || 'none')) && (RL.stock || i.svc || i.stock > 0))
    .map((i) => {
      let p = money(price(i));
      if (gstOn && RL.tax === 'excl' && i.gst) p = p.div(money(1).plus(money(i.gst).div(100)));
      return { i, p: round2(p).toNumber() };
    })
    .sort((a, b) => (RL.group === 'brand' ? (a.i.brand ? 0 : 1) - (b.i.brand ? 0 : 1) || (a.i.brand || '').localeCompare(b.i.brand || '') : 0) || (a.i.cat || '').localeCompare(b.i.cat || '') || (a.i.grp || a.i.name).localeCompare(b.i.grp || b.i.name) || (a.i.brand || '').localeCompare(b.i.brand || ''));
  const bzName = biz.data?.name || 'My Business';
  const bzLine = (sep = ' · ') => [[biz.data?.address, [biz.data?.city, biz.data?.pin].filter(Boolean).join(' ')].filter(Boolean).join(', '), biz.data?.phone].filter(Boolean).join(sep);
  const title = RL.title.trim() || `${RL.brand !== 'all' ? RL.brand + ' · ' : RL.brands && RL.brands.length <= 3 && !RL.brands.includes('none') ? [...RL.brands].sort().join(', ') + ' · ' : ''}${pl?.name || 'Retail'} rate list`;
  const file = (ext: string) => `${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()}-${today()}.${ext}`;
  const rateHead = gstOn ? (RL.tax === 'incl' ? ' (incl. GST)' : ' (excl. GST)') : '';

  /* preview rows with category / brand headings */
  const rows: JSX.Element[] = [];
  {
    let cat: string | null = null;
    let k = 0;
    R.forEach(({ i, p }) => {
      if (key(i) !== cat) {
        cat = key(i);
        if (RL.group === 'brand') k = 0;
        rows.push(<tr className="rlc" key={'h' + cat}><td colSpan={9}>{cat || 'Other'}</td></tr>);
      }
      k++;
      rows.push(
        <tr key={i.id}><td>{k}</td><td>{i.grp || i.name}{i.grp && !c.brand ? <> <small>{vlabel(i)}</small></> : i.grp && i.series ? <> <small>{i.series}</small></> : null}</td>{c.brand && <td>{i.brand || ''}</td>}{c.hsn && <td>{i.hsn || ''}</td>}{c.unit && <td>{i.unit}</td>}{c.gst && <td className="n">{i.gst}%</td>}{c.mrp && <td className="n">{i.mrp ? inr2f(i.mrp) : ''}</td>}<td className="n"><b>{inr2f(p)}</b></td></tr>,
      );
    });
  }

  function excel() {
    const head = ['#', 'Item', ...(c.brand ? ['Brand'] : []), ...(c.hsn ? ['HSN'] : []), ...(c.unit ? ['Unit'] : []), ...(c.gst ? ['GST %'] : []), ...(c.mrp ? ['MRP'] : []), gstOn ? `Rate (${RL.tax === 'incl' ? 'incl.' : 'excl.'} GST)` : 'Rate'];
    const out: (string | number)[][] = [[bzName], [`${title} · ${fmtD(today())}${RL.valid ? ' · valid till ' + fmtD(RL.valid) : ''}`], [], head];
    const styles: Record<number, 1 | 3 | 4> = { 0: 3, 3: 1 };
    let cat: string | null = null;
    let k = 0;
    R.forEach(({ i, p }) => {
      if (key(i) !== cat) { cat = key(i); if (RL.group === 'brand') k = 0; styles[out.length] = 4; out.push([cat || 'Other']); }
      k++;
      out.push([k, i.grp ? `${i.grp}${c.brand ? (i.series ? ' ' + i.series : '') : ' · ' + vlabel(i)}` : i.name, ...(c.brand ? [i.brand || ''] : []), ...(c.hsn ? [i.hsn || ''] : []), ...(c.unit ? [i.unit] : []), ...(c.gst ? [i.gst] : []), ...(c.mrp ? [i.mrp || ''] : []), p]);
    });
    const n = head.length;
    void xlsxBlob([{ name: 'Rate list', rows: out, widths: [5, 42, ...Array(n - 2).fill(13)], freeze: 4, styles, money: [n - 1, ...(c.mrp ? [n - 2] : [])] }]).then((b) => saveFile(file('xlsx'), b));
  }

  async function pdf() {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const L = 40, Rt = 555, W = Rt - L;
    const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
    const text = (x: number, y: number, s: string, o: { size: number; bold?: boolean; color?: string; align?: 'right'; max?: number }) => {
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
      doc.setFontSize(o.size);
      doc.setTextColor(...hex(o.color ?? '#151b2e'));
      let t = s;
      if (o.max) while (t.length > 1 && doc.getTextWidth(t) > o.max) t = t.slice(0, -2) + '…';
      doc.text(t, x, y, o.align ? { align: o.align } : undefined);
    };
    const rect = (x: number, y: number, w: number, h: number, fill: string) => { doc.setFillColor(...hex(fill)); doc.rect(x, y, w, h, 'F'); };
    const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => { doc.setDrawColor(...hex(color)); doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
    const cols: { k: string; w: number; r?: boolean; x?: number }[] = [{ k: '#', w: 24 }, { k: 'Item', w: 0 }, ...(c.brand ? [{ k: 'Brand', w: 80 }] : []), ...(c.hsn ? [{ k: 'HSN', w: 48 }] : []), ...(c.unit ? [{ k: 'Unit', w: 38 }] : []), ...(c.gst ? [{ k: 'GST', w: 34, r: true }] : []), ...(c.mrp ? [{ k: 'MRP', w: 60, r: true }] : []), { k: !gstOn ? 'Rate' : RL.tax === 'incl' ? 'Rate (incl. GST)' : 'Rate (excl. GST)', w: 86, r: true }];
    cols[1]!.w = W - cols.reduce((a, x) => a + x.w, 0);
    let x = L;
    cols.forEach((cl) => { cl.x = x; x += cl.w; });
    let y = 0;
    let page = 0;
    const head = () => {
      page++;
      if (page > 1) doc.addPage();
      text(L, 52, bzName, { size: 15, bold: true });
      text(L, 67, bzLine('  |  '), { size: 8.5, color: '#5b6478' });
      text(Rt, 52, title, { size: 12, bold: true, align: 'right' });
      text(Rt, 67, `${fmtD(today())}${RL.valid ? '  |  valid till ' + fmtD(RL.valid) : ''}`, { size: 8.5, color: '#5b6478', align: 'right' });
      line(L, 78, Rt, 78, 1.2, '#151b2e');
      rect(L, 88, W, 18, '#0f766e');
      cols.forEach((cl) => text(cl.r ? cl.x! + cl.w - 5 : cl.x! + 5, 100, cl.k, { size: 8.5, bold: true, color: '#ffffff', align: cl.r ? 'right' : undefined, max: cl.w - 8 }));
      y = 118;
    };
    head();
    let cat: string | null = null;
    let k = 0;
    R.forEach(({ i, p }) => {
      if (key(i) !== cat) {
        if (y > 790 || (RL.group === 'brand' && RL.brPage && cat !== null)) head();
        cat = key(i);
        if (RL.group === 'brand') k = 0;
        rect(L, y - 10, W, 16, '#e3f3f0');
        text(L + 5, y + 1, (cat || 'Other').toUpperCase(), { size: 8.5, bold: true, color: '#0f766e' });
        y += 18;
      }
      if (y > 800) head();
      k++;
      const name = i.grp ? `${i.grp}${c.brand ? (i.series ? '  ' + i.series : '') : '  -  ' + vlabel(i)}` : i.name;
      const vals = [String(k), name, ...(c.brand ? [i.brand || ''] : []), ...(c.hsn ? [i.hsn || ''] : []), ...(c.unit ? [i.unit] : []), ...(c.gst ? [i.gst + '%'] : []), ...(c.mrp ? [i.mrp ? inr2f(i.mrp) : ''] : []), inr2f(p)];
      cols.forEach((cl, j) => text(cl.r ? cl.x! + cl.w - 5 : cl.x! + 5, y, vals[j]!, { size: 9, bold: j === cols.length - 1, max: cl.w - 8, align: cl.r ? 'right' : undefined, color: j === 0 ? '#5b6478' : '#151b2e' }));
      line(L, y + 5, Rt, y + 5, 0.4, '#e3e6ee');
      y += 16;
    });
    const n = doc.getNumberOfPages();
    for (let ix = 1; ix <= n; ix++) {
      doc.setPage(ix);
      text(L, 822, 'Prices in Rs. Subject to change without notice. GST as applicable.', { size: 7.5, color: '#5b6478' });
      text(Rt, 822, `Page ${ix} of ${n}`, { size: 7.5, color: '#5b6478', align: 'right' });
    }
    saveFile(file('pdf'), doc.output('blob'));
  }

  function whatsapp() {
    let cat: string | null = null;
    const lines = [`*${bzName}*`, `*${title}* · ${fmtD(today())}`, ''];
    R.slice(0, 60).forEach(({ i, p }) => {
      if (key(i) !== cat) { cat = key(i); lines.push(`*${cat || 'Other'}*`); }
      lines.push(`${i.grp ? i.grp + ' ' + vlabel(i) : i.name}${RL.cols.mrp && i.mrp ? ` (MRP ${inr2f(i.mrp)})` : ''} — ₹${inr2f(p)}`);
    });
    if (R.length > 60) lines.push('', '…and more. Ask us for the full list.');
    const a = document.createElement('a');
    a.href = 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'));
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function print() {
    printNow();
  }
  const set = RL.set;
  const togCat = (k: string, on: boolean) => set({ cats: on ? [...cats, k] : [...cats].filter((x) => x !== k) });

  return (
    <div className="ov c" id="rlm" ref={ovRef} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'rlm') onClose(); }}>
      <div className="mdl rlm" role="dialog" aria-modal="true" aria-labelledby="rlT">
        <div className="dh" style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)' }}><div><h3 id="rlT" style={{ margin: 0, fontSize: 18 }}>Download rate list</h3><small className="mu" id="rlCount">{R.length} item{R.length === 1 ? '' : 's'}</small></div><button className="ib" type="button" id="rlClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="rlg">
          <div className="rlopt">
            <label className="apf" htmlFor="rlTitle">Title<input className="fi" id="rlTitle" placeholder="e.g. Wholesale rate list" autoComplete="off" value={RL.title} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className="apf" htmlFor="rlPl">Prices from<select className="fi" id="rlPl" value={pl?.id} onChange={(e) => set({ pl: e.target.value })}>{PLA.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
            <div className="two"><label className="apf needs-gst" htmlFor="rlTax">Show rates<select className="fi" id="rlTax" value={RL.tax} onChange={(e) => set({ tax: e.target.value as 'incl' | 'excl' })}><option value="incl">Incl. GST</option><option value="excl">Excl. GST</option></select></label><label className="apf" htmlFor="rlValid">Valid till<input className="fi" type="date" id="rlValid" value={RL.valid} onChange={(e) => set({ valid: e.target.value })} /></label></div>
            <label className="apf" htmlFor="rlBrand">Brand<select className="fi" id="rlBrand" value={RL.brand} onChange={(e) => set({ brand: e.target.value, brands: null })}><option value="all">{RL.brands ? RL.brands.map((b) => (b === 'none' ? 'No brand' : b)).join(', ') : 'All brands'}</option>{brands.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="apf" htmlFor="rlGroup">Group items by<select className="fi" id="rlGroup" value={RL.group} onChange={(e) => set({ group: e.target.value as 'cat' | 'brand' })}><option value="cat">Category</option><option value="brand">Brand</option></select></label>
            <label className="cb2" id="rlBrPageW" hidden={RL.group !== 'brand'}><input type="checkbox" id="rlBrPage" checked={RL.brPage} onChange={(e) => set({ brPage: e.target.checked })} /> Start each brand on a new PDF page</label>
            <div className="rlpick" id="rlPickW" hidden={!RL.pick}><span id="rlPickTxt">{RL.pick ? `Only the ${RL.pick.length} item${RL.pick.length > 1 ? 's' : ''} you picked` : ''}</span><button type="button" className="lnk" id="rlPickClr" onClick={() => set({ pick: null })}>Use all items</button></div>
            <div className="rlsec"><span>Categories</span><button type="button" className="lnk" id="rlAllCats" onClick={() => set({ cats: cats.size === allCats.length ? [] : allCats })}>All / none</button></div>
            <div className="rlchk" id="rlCats">{allCats.map((k) => <label className="cb2" key={k}><input type="checkbox" data-rlc={k} checked={cats.has(k)} onChange={(e) => togCat(k, e.target.checked)} /> {k}</label>)}</div>
            <div className="rlsec"><span>Columns</span></div>
            <div className="rlchk" id="rlCols">{([['brand', 'Brand'], ['mrp', 'MRP'], ['unit', 'Unit'], ...(gstOn ? [['hsn', 'HSN'], ['gst', 'GST %']] : [])] as [keyof Cols, string][]).map(([k, t]) => <label className="cb2" key={k}><input type="checkbox" data-rlcol={k} checked={RL.cols[k]} onChange={(e) => set({ cols: { ...RL.cols, [k]: e.target.checked } })} /> {t}</label>)}</div>
            <label className="cb2"><input type="checkbox" id="rlStock" checked={RL.stock} onChange={(e) => set({ stock: e.target.checked })} /> Include out-of-stock items</label>
          </div>
          <div className="rlprev"><div className="rlsheet" id="rlSheet">
            <div className="rlh"><div><b>{bzName}</b><small>{bzLine()}</small></div><div className="rlt"><b>{title}</b><small>{fmtD(today())}{RL.valid ? ` · valid till ${fmtD(RL.valid)}` : ''}</small></div></div>
            <table className="rltab"><thead><tr><th>#</th><th>Item</th>{c.brand && <th>Brand</th>}{c.hsn && <th>HSN</th>}{c.unit && <th>Unit</th>}{c.gst && <th className="n">GST</th>}{c.mrp && <th className="n">MRP</th>}<th className="n">Rate{rateHead}</th></tr></thead>
              <tbody>{R.length ? rows : <tr><td colSpan={9} className="ptempty">No items match. Tick some categories.</td></tr>}</tbody></table>
            <p className="rlfoot">Prices in ₹. Subject to change without notice. GST as applicable.</p>
          </div></div>
        </div>
        <div className="rlbar"><button className="btn" id="rlWa" onClick={whatsapp}><RawIcon d={CHAT} />Share on WhatsApp</button><button className="btn" id="rlPrint" onClick={print}>Print</button><span style={{ flex: 1 }}></span><button className="btn" id="rlXls" onClick={excel}><RawIcon d={DOWN} />Excel</button><button className="btn p" id="rlPdf" onClick={() => void pdf()}><RawIcon d={DOWN} />Download PDF</button></div>
      </div>
    </div>
  );
}

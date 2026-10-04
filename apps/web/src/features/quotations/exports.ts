/** Quotation Excel, PDF and WhatsApp (prototype qXls / qPdf / qWa): same layout, wording and file names. */
import { qSerName, type QuoteGrid } from '@billing/shared';
import { fmtD, inr2f } from '../../lib/format';
import { saveFile, xlsxBlob } from '../../lib/files';
import { today } from '../../lib/time';
import { qfmt } from '../items/ItemsPage';
import { bzLine, bzName, type Biz } from '../sales/InvoicePreview';
import { qCols, qRate, qTotals, type QCtx, type QDraft } from './model';

interface Ex { c: QCtx; g: QuoteGrid; d: QDraft; biz?: Biz; gst: boolean; gstin: string; plName: string }
const r2 = (n: number) => Math.round(n * 100) / 100;
const file = (d: QDraft, ext: string) => `quotation-${d.no.toLowerCase()}${d.cust ? '-' + d.cust.replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() : ''}.${ext}`;
export const qUsed = (g: QuoteGrid, d: QDraft) => g.rows.filter((r) => d.qty[r.id]);

export async function quoteExcel({ c, g, d, biz, plName }: Ex) {
  const cols = qCols(g, d), T = qTotals(c, g, d);
  const rows: (string | number)[][] = [[bzName(biz)], [`Quotation ${d.no}${d.cust ? ' · ' + d.cust : ''} · ${fmtD(today())} · ${plName}`], [], ['Item', 'Qty', ...cols.map(qSerName)]];
  const styles: Record<number, 1 | 3 | 4> = { 0: 3, 3: 1 };
  for (const r of qUsed(g, d)) {
    const q = d.qty[r.id]!;
    rows.push([r.n, q, ...cols.map((s) => { const v = qRate(c, r, s).v; return v === null ? 'n/a' : r2(q * v); })]);
  }
  rows.push([]);
  styles[rows.length] = 4;
  rows.push(['Switches & accessories', '', ...T.map((t) => r2(t.acc))]);
  rows.push(['Plates', '', ...T.map((t) => r2(t.plate))]);
  if (d.disc) rows.push([`Discount ${d.disc}%`, '', ...T.map((t) => -r2(t.dis))]);
  styles[rows.length] = 1;
  rows.push(['Total', '', ...T.map((t) => r2(t.total))]);
  saveFile(file(d, 'xlsx'), await xlsxBlob([{ name: 'Quotation', rows, widths: [26, 7, ...cols.map(() => 18)], freeze: 4, styles, money: cols.map((_, k) => k + 2) }]));
}

export async function quotePdf({ c, g, d, biz, gst, gstin, plName }: Ex) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 34, R = W - 34, per = 7;
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
  const text = (x: number, y: number, s: string, o: { size: number; bold?: boolean; color?: string; align?: 'right'; max?: number }) => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size); doc.setTextColor(...hex(o.color ?? '#151b2e'));
    let t = s;
    if (o.max) while (t.length > 1 && doc.getTextWidth(t) > o.max) t = t.slice(0, -2) + '…';
    doc.text(t, x, y, o.align ? { align: o.align } : undefined);
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string) => { doc.setFillColor(...hex(fill)); doc.rect(x, y, w, h, 'F'); };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => { doc.setDrawColor(...hex(color)); doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const all = qCols(g, d), T = qTotals(c, g, d), U = qUsed(g, d);
  const ok = T.filter((t) => !t.miss && t.total > 0), best = ok.length > 1 ? Math.min(...ok.map((t) => t.total)) : null;
  const groups: (typeof all)[] = [];
  for (let i = 0; i < all.length; i += per) groups.push(all.slice(i, i + per));
  groups.forEach((cols, gi) => {
    if (gi) doc.addPage();
    let y = 46;
    text(L, y, bzName(biz), { size: 15, bold: true }); text(R, y, `Quotation ${d.no}`, { size: 12, bold: true, align: 'right' }); y += 15;
    text(L, y, bzLine(biz, '  |  ') + (gst && gstin ? '  |  GSTIN ' + gstin : ''), { size: 8.5, color: '#5b6478' });
    text(R, y, `${fmtD(today())}  |  ${plName} rates${d.disc ? `, less ${d.disc}%` : ''}`, { size: 8.5, color: '#5b6478', align: 'right' }); y += 13;
    if (d.cust) { text(L, y, `To: ${d.cust}`, { size: 10, bold: true }); y += 6; }
    y += 6; line(L, y, R, y, 1.2, '#151b2e'); y += 10;
    const iw = 150, qw = 36, cw = Math.min(96, (R - L - iw - qw) / cols.length), x0 = L + iw + qw, tw = iw + qw + cw * cols.length;
    rect(L, y, tw, 30, '#0f766e');
    text(L + 5, y + 19, 'Item', { size: 8.5, bold: true, color: '#ffffff' }); text(L + iw + qw - 5, y + 19, 'Qty', { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
    cols.forEach((s, k) => { const xr = x0 + cw * (k + 1) - 5; text(xr, y + 12, s.b, { size: 8.5, bold: true, color: '#ffffff', align: 'right', max: cw - 8 }); text(xr, y + 24, `${s.r}${s.f ? ' ' + s.f : ''}`, { size: 7.5, color: '#d9f2ee', align: 'right', max: cw - 8 }); });
    y += 30;
    let sec: string | null = null;
    for (const r of U) {
      if (r.c !== sec) { sec = r.c; rect(L, y, tw, 15, '#e3f3f0'); text(L + 5, y + 10.5, sec === 'plate' ? 'PLATES' : 'SWITCHES & ACCESSORIES', { size: 7.5, bold: true, color: '#0f766e' }); y += 15; }
      const q = d.qty[r.id]!;
      y += 13;
      text(L + 5, y, r.n, { size: 9, max: iw - 8 }); text(L + iw + qw - 5, y, qfmt(q), { size: 9, align: 'right' });
      cols.forEach((s, k) => { const v = qRate(c, r, s).v; text(x0 + cw * (k + 1) - 5, y, v === null ? 'n/a' : inr2f(q * v), { size: 9, align: 'right', color: v === null ? '#c2410c' : '#151b2e' }); });
      line(L, y + 5, L + tw, y + 5, 0.4, '#e3e6ee'); y += 1;
    }
    y += 8;
    const TT = T.filter((t) => cols.includes(t.s));
    const tot = (label: string, f: (t: (typeof T)[number]) => string, o: { bold?: boolean; fill?: string; color?: string } = {}) => {
      y += 15;
      if (o.fill) rect(L, y - 11, tw, 16, o.fill);
      text(L + 5, y, label, { size: 9, bold: !!o.bold, color: o.color });
      TT.forEach((t, k) => text(x0 + cw * (k + 1) - 5, y, f(t), { size: 9, bold: !!o.bold, align: 'right', color: o.color }));
    };
    tot('Switches & accessories', (t) => inr2f(t.acc)); tot('Plates', (t) => inr2f(t.plate));
    if (d.disc) tot(`Discount ${d.disc}%`, (t) => '-' + inr2f(t.dis));
    tot('Total', (t) => inr2f(t.total), { bold: true, fill: '#151b2e', color: '#ffffff' });
    y += 13;
    TT.forEach((t, k) => { const xr = x0 + cw * (k + 1) - 5; if (t.miss) text(xr, y, `${t.miss} not available`, { size: 7, align: 'right', color: '#c2410c' }); else if (best !== null && t.total === best) text(xr, y, 'LOWEST', { size: 7.5, bold: true, align: 'right', color: '#0f766e' }); });
    text(L, H - 26, (gst ? 'Rates include GST. ' : '') + 'Prices valid for 15 days. Subject to stock availability.', { size: 7.5, color: '#5b6478' });
    text(R, H - 26, `Page ${gi + 1} of ${groups.length}`, { size: 7.5, color: '#5b6478', align: 'right' });
  });
  saveFile(file(d, 'pdf'), doc.output('blob'));
}

export function quoteWhatsApp({ c, g, d, biz, gst }: Ex): boolean {
  const T = qTotals(c, g, d).filter((t) => t.total > 0).sort((a, b) => a.total - b.total);
  if (!T.length) return false;
  const pcs = g.rows.reduce((a, r) => a + (d.qty[r.id] || 0), 0);
  const lines = [`*${bzName(biz)}*`, `*Quotation ${d.no}*${d.cust ? ' for ' + d.cust : ''}`, `${qUsed(g, d).length} items · ${qfmt(pcs)} pcs${d.disc ? ` · ${d.disc}% discount applied` : ''}`, '',
    ...T.map((t, k) => `${k === 0 && !t.miss ? '✅ ' : ''}${qSerName(t.s)}: ₹${inr2f(t.total)}${t.miss ? ` (${t.miss} item${t.miss > 1 ? 's' : ''} not available)` : ''}`), '', (gst ? 'Rates include GST. ' : '') + 'Valid for 15 days.'];
  const a = document.createElement('a');
  a.href = 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n')); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  return true;
}

/**
 * The invoice extras pop-up (#siPop, prototype dgPopBody / plBody): transport details,
 * terms & conditions, description, attachments and profit & loss on this bill.
 */
import { useEditorData } from './data';
import { saleAllocs } from './batches';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatQty, money, profitRows, type LineCost } from '@billing/shared';
import { Icon } from '../../../components/Icon';
import { api } from '../../../lib/api';
import { inr2f } from '../../../lib/format';
import { SI_TT, calc, r2, type Ctx, type SI } from './state';

export type ToolKey = 'tr' | 'te' | 'de' | 'at' | 'pl';
export const DGACC = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
export const DGIMG = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i;
const qfmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const TT: [keyof typeof SI_TT | 'custom', string][] = [['sale', 'Sale invoice'], ['est', 'Estimate'], ['custom', 'Custom']];

function Field({ id, label, value, type, on, onInput }: { id: string; label: string; value: string; type?: string; on?: boolean; onInput: (v: string) => void }) {
  return (
    <label className={`ff${on ? ' on' : ''}`}>
      <input className="fi" id={id} defaultValue={value} placeholder=" " autoComplete="off" type={type} onInput={(e) => onInput((e.target as HTMLInputElement).value)} onChange={type === 'date' ? (e) => onInput(e.target.value) : undefined} /><span>{label}</span>
    </label>
  );
}

/** What the pop-up shows for one tool. `up` marks the bill as changed. */
export function ToolBody({ k, s, ctx, up, onFiles, toast }: { k: ToolKey; s: SI; ctx: Ctx; up: (fn: (x: SI) => void) => void; onFiles: (names: string[]) => void; toast: (m: string) => void }) {
  if (k === 'tr') return (
    <><div className="dgph"><b>Transport details</b></div><div className="dgpl">
      <Field id="siTrans" label="Transport name" value={s.transport} onInput={(v) => up((x) => { x.transport = v; })} />
      <Field id="siVeh" label="Vehicle / bilty no." value={s.vehicle} onInput={(v) => up((x) => { x.vehicle = v; })} />
      <Field id="siDeliv" label="Delivery date" value={s.delivDate} type="date" on onInput={(v) => up((x) => { x.delivDate = v; })} />
    </div></>
  );
  if (k === 'te') {
    const sel = (Object.keys(SI_TT) as (keyof typeof SI_TT)[]).find((x) => SI_TT[x] === s.notes) ?? 'custom';
    return (
      <><div className="dgph"><b>Terms &amp; conditions</b><select className="fi" id="siTermsT" aria-label="Terms template" defaultValue={sel}
        onChange={(e) => { const v = e.target.value as keyof typeof SI_TT; const ta = document.getElementById('siNotes') as HTMLTextAreaElement | null; if (SI_TT[v]) { up((x) => { x.notes = SI_TT[v]; }); if (ta) ta.value = SI_TT[v]; } else ta?.focus(); }}>
        {TT.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></div>
        <textarea className="fi ta" id="siNotes" rows={5} aria-label="Terms and conditions" defaultValue={s.notes} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; up((x) => { x.notes = v; }); }}></textarea><small className="mu">Printed at the bottom of the invoice.</small></>
    );
  }
  if (k === 'de') return (
    <><div className="dgph"><b>Description</b></div>
      <textarea className="fi ta" id="siDesc" rows={5} placeholder="Shown on the invoice under the items" defaultValue={s.desc} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; up((x) => { x.desc = v; }); }}></textarea></>
  );
  if (k === 'pl') return <PlBody s={s} ctx={ctx} />;
  return (
    <><div className="dgph"><b>Attachments</b><small className="mu">Photos and documents</small></div><div className="dgfl">
      {s.attach.length ? s.attach.map((n, i) => (
        <span key={`${i}${n}`}><Icon name={DGIMG.test(n) ? 'cam' : 'doc'} /><i>{n}</i><button type="button" data-dgrm={`si:${i}`} aria-label={`Remove ${n}`} onClick={() => up((x) => { x.attach = x.attach.filter((_, j) => j !== i); })}>×</button></span>
      )) : <small className="mu">Nothing attached yet.</small>}</div>
      <label className="btn sm dgadd1"><Icon name="plus" />Add photo or document<input type="file" hidden data-dgfile="si" accept={DGACC} multiple
        onChange={(e) => { const f = e.target.files; if (f?.length) { const names = [...f].map((x) => x.name); onFiles(names); toast(`${names.length} file${names.length > 1 ? 's' : ''} attached`); e.target.value = ''; } }} /></label></>
  );
}

/**
 * Profit & loss on this bill (prototype plBody): before GST, after discounts. The cost comes from
 * the API: the purchase-rate lots each line uses, oldest first, the same calculation as the stock
 * value and the reports (owner's rule, Oct 2026). One row per lot rate a line used (owner, Oct
 * 2026); stock without a purchase entry and stock not bought yet have rows of their own at ₹0.
 */
function PlBody({ s, ctx }: { s: SI; ctx: Ctx }) {
  const c = calc(ctx, s);
  const L = s.lines.map((l, i) => ({ l, r: c.rows[i]! })).filter((x) => x.l.item && Number(x.l.qty) > 0);
  // Features › batch_expiry: a line's cost is the cost of the batches it uses
  const d = useEditorData();
  const allocs = d ? saleAllocs(d, s) : [];
  const body = { id: s.doc === 'sale' ? s.editId : null, date: s.date, lines: L.map(({ l }) => { const a = allocs[s.lines.indexOf(l)]; return { itemId: l.item!.id, qty: String(l.qty), ...(a?.length ? { batches: a } : {}) }; }) };
  const q = useQuery({ queryKey: ['sale-cost', body], queryFn: () => api<{ lines: LineCost[] }>('/sales/cost', { method: 'POST', body }), enabled: L.length > 0, placeholderData: keepPreviousData });
  const head = <div className="dgph"><b>Profit &amp; loss · this bill</b><small className="mu">Before GST · after discounts</small></div>;
  if (!L.length) return <>{head}<div className="ptempty">Add items to see the profit on this bill.</div></>;
  const lc = q.data?.lines.length === L.length ? q.data.lines : null;
  if (!lc) return <>{head}<div className="ptempty">{q.isError ? 'Could not work out the cost. Close and open this again.' : 'Working out the cost…'}</div></>;
  const sumTv = L.reduce((a, x) => a + x.r.tv, 0), f = sumTv > 0 ? c.taxable / sumTv : 1;
  const sales = L.map(({ r }) => r2(r.tv * f));
  const P = profitRows(L.map((_, k) => ({ saleValue: sales[k]!, rows: lc[k]!.rows })));
  const rows = L.flatMap(({ l }, k) => {
    const it = l.item!, qty = Number(l.qty) || 0;
    return P.lines[k]!.map((x, j) => {
      const sale = money(x.sale), pr = money(x.profit), m = sale.isZero() ? 0 : pr.div(sale).times(100).toNumber();
      // no purchase entry, or sold beyond stock and not bought yet: the cost is not known yet
      const known = x.kind === 'lot';
      return (
        <tr key={`${k}.${j}`}><td><b>{it.grp && it.brand ? it.grp : l.name}</b><small>{[it.brand, it.series].filter(Boolean).join(' · ')}</small></td><td className="n">{qfmt(Number(x.qty))}</td><td className="n">{inr2f(r2(sales[k]! / (qty || 1)))}</td>
          <td className="n">{known ? inr2f(x.rate) : <span className="warn">—</span>}</td><td className="n">{inr2f(sale)}</td><td className="n">{inr2f(x.cost)}</td>
          <td className={`n ${pr.isNeg() ? 'neg' : 'pos'}`}><b>{pr.isNeg() ? '−' : ''}{inr2f(pr.abs())}</b></td><td className={`n ${pr.isNeg() ? 'neg' : ''}`}>{known ? m.toFixed(1) + '%' : '—'}</td></tr>
      );
    });
  });
  const tS = money(P.sale), tC = money(P.cost);
  const tp = tS.minus(tC), tm = tS.isZero() ? 0 : tp.div(tS).times(100).toNumber();
  const miss = lc.filter((x) => x.noRate).length;
  const short = L.map(({ l }, k) => ({ l, q: money(lc[k]!.shortQty) })).filter((x) => x.q.gt(0));
  return (
    <>{head}
      <div className="plw"><table className="plt"><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Sale / unit</th><th className="n">Cost / unit</th><th className="n">Sale value</th><th className="n">Cost</th><th className="n">Profit</th><th className="n">Margin</th></tr></thead><tbody>{rows}</tbody>
        <tfoot><tr><td>Total</td><td></td><td></td><td></td><td className="n">{inr2f(tS)}</td><td className="n">{inr2f(tC)}</td><td className={`n ${tp.isNeg() ? 'neg' : 'pos'}`}>{tp.isNeg() ? '−' : ''}{inr2f(tp.abs())}</td><td className="n">{tm.toFixed(1)}%</td></tr></tfoot></table></div>
      <div className="plsum"><span>{tp.isNeg() ? 'Loss' : 'Profit'} on this bill</span><b className={tp.isNeg() ? 'neg' : 'pos'}>{tp.isNeg() ? '−' : ''}₹{inr2f(tp.abs())}</b><em>{tm.toFixed(1)}% margin</em></div>
      <small className="mu">Cost uses the purchase rate of the stock each sale used (oldest first).{c.bdisc ? ` Bill discount of ₹${inr2f(c.bdisc)} is spread across the items.` : ''}{c.chTr || c.chLab || c.chBank ? ' Transport, labour and bank charges are not counted as profit.' : ''}{miss ? <> <span className="warn">{miss} item{miss > 1 ? 's have' : ' has'} no purchase entry, so cost is taken as ₹0.</span></> : null}{short.length ? <> <span className="warn">{short.length === 1 ? `${formatQty(short[0]!.q)} ${short[0]!.l.unit || short[0]!.l.item!.unit}` : `${short.length} items`} sold beyond stock: their cost will be counted when the purchase is entered.</span></> : null}</small></>
  );
}

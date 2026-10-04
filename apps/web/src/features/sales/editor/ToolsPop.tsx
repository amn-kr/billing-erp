/**
 * The invoice extras pop-up (#siPop, prototype dgPopBody / plBody): transport details,
 * terms & conditions, description, attachments and profit & loss on this bill.
 */
import { Icon } from '../../../components/Icon';
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

/** Profit & loss on this bill (prototype plBody): before GST, after discounts, at each item's purchase price. */
function PlBody({ s, ctx }: { s: SI; ctx: Ctx }) {
  const c = calc(ctx, s);
  const L = s.lines.map((l, i) => ({ l, r: c.rows[i]! })).filter((x) => x.l.item && Number(x.l.qty) > 0);
  if (!L.length) return <><div className="dgph"><b>Profit &amp; loss · this bill</b><small className="mu">Before GST · after discounts</small></div><div className="ptempty">Add items to see the profit on this bill.</div></>;
  const sumTv = L.reduce((a, x) => a + x.r.tv, 0), f = sumTv > 0 ? c.taxable / sumTv : 1;
  let tS = 0, tC = 0;
  const rows = L.map(({ l, r }, k) => {
    const it = l.item!, qty = Number(l.qty) || 0;
    const sale = r2(r.tv * f), cost = r2((it.purch || 0) * qty), pr = r2(sale - cost), m = sale ? (pr / sale) * 100 : 0;
    tS += sale; tC += cost;
    return (
      <tr key={k}><td><b>{it.grp && it.brand ? it.grp : l.name}</b><small>{[it.brand, it.series].filter(Boolean).join(' · ')}</small></td><td className="n">{qfmt(qty)}</td><td className="n">{inr2f(r2(sale / (qty || 1)))}</td>
        <td className="n">{it.purch ? inr2f(it.purch) : <span className="warn">—</span>}</td><td className="n">{inr2f(sale)}</td><td className="n">{inr2f(cost)}</td>
        <td className={`n ${pr < 0 ? 'neg' : 'pos'}`}><b>{pr < 0 ? '−' : ''}{inr2f(Math.abs(pr))}</b></td><td className={`n ${pr < 0 ? 'neg' : ''}`}>{it.purch ? m.toFixed(1) + '%' : '—'}</td></tr>
    );
  });
  const tp = r2(tS - tC), tm = tS ? (tp / tS) * 100 : 0, miss = L.filter((x) => !x.l.item!.purch).length;
  return (
    <><div className="dgph"><b>Profit &amp; loss · this bill</b><small className="mu">Before GST · after discounts</small></div>
      <div className="plw"><table className="plt"><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Sale / unit</th><th className="n">Cost / unit</th><th className="n">Sale value</th><th className="n">Cost</th><th className="n">Profit</th><th className="n">Margin</th></tr></thead><tbody>{rows}</tbody>
        <tfoot><tr><td>Total</td><td></td><td></td><td></td><td className="n">{inr2f(r2(tS))}</td><td className="n">{inr2f(r2(tC))}</td><td className={`n ${tp < 0 ? 'neg' : 'pos'}`}>{tp < 0 ? '−' : ''}{inr2f(Math.abs(tp))}</td><td className="n">{tm.toFixed(1)}%</td></tr></tfoot></table></div>
      <div className="plsum"><span>{tp < 0 ? 'Loss' : 'Profit'} on this bill</span><b className={tp < 0 ? 'neg' : 'pos'}>{tp < 0 ? '−' : ''}₹{inr2f(Math.abs(tp))}</b><em>{tm.toFixed(1)}% margin</em></div>
      <small className="mu">Cost uses each item’s purchase price.{c.bdisc ? ` Bill discount of ₹${inr2f(c.bdisc)} is spread across the items.` : ''}{c.chTr || c.chLab || c.chBank ? ' Transport, labour and bank charges are not counted as profit.' : ''}{miss ? <> <span className="warn">{miss} item{miss > 1 ? 's have' : ' has'} no purchase price, so cost is taken as ₹0.</span></> : null}</small></>
  );
}

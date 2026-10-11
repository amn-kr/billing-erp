/**
 * Import from quotation (prototype #iqm, iqOpen / iqGo) and the "From quotation" chips on the
 * invoice with their remove question (siQrefs / siQrefRemove). Item-wise quotations for now;
 * brand-wise ones come with the Quotation page.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qSerName, type QuoteGrid } from '@billing/shared';
import { Icon } from '../../../components/Icon';
import { api } from '../../../lib/api';
import { dmy, inr2f } from '../../../lib/format';
import { useOpenFocus } from '../../../lib/useOpenFocus';
import { useEscape } from '../../../lib/useEscape';
import { useSales, type SaleDoc } from '../model';
import type { SlModalProps } from '../SlModal';
import type { EditorData } from './data';
import { SI_TT, addDaysIso, blankLine, cmApply, lineFor, partyState, unitPrice, type Line, type SI } from './state';
import { qRanked, qRate, qTotals, type QCtx, type QDraft } from '../../quotations/model';

const qfmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function ImportQuote({ open, onClose, d, s, up, toast }: { open: boolean; onClose: () => void; d: EditorData; s: SI; up: (fn: (x: SI) => void) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const list = useSales('quotation');
  const [sel, setSel] = useState<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const grid = useQuery({ queryKey: ['quote-grid'], queryFn: () => api<QuoteGrid>('/quote-grid'), enabled: open });
  const ref = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ref);
  useEscape(open, onClose);
  useEffect(() => { if (open) setSel(null); }, [open]);
  const pn = (s.party ? s.party.name : s.cashName.trim()).toLowerCase();
  const L = (list.data ?? []).filter((q) => q.status !== 'converted' && !q.cancelled && q.items > 0 && (q.qtype !== 'brand' || !!grid.data))
    .sort((a, b) => Number(b.partyName.toLowerCase() === pn) - Number(a.partyName.toLowerCase() === pn) || b.date.localeCompare(a.date));
  const q = L.find((x) => x.id === sel);
  /* a brand-wise quotation: which brand to bill (prototype iqBrandOpts), at the quotation's rate list and referral */
  const bq = q?.qtype === 'brand' && q.brandQuote && grid.data ? q.brandQuote : null;
  const bctx: QCtx | null = bq ? { IT: d.IT, pl: { id: bq.priceListId ?? d.ctx.defaultList ?? '', name: '', isDefault: !bq.priceListId || bq.priceListId === d.ctx.defaultList }, ref: q!.referrerId ?? '', rules: d.ctx.rules } : null;
  // a quotation whose ranges are all hidden now (brand not on Brands & Series) is priced against every range shown
  const bdraft: QDraft | null = bq ? { id: q!.id, no: q!.number, cust: bq.cust, disc: bq.disc, pl: bq.priceListId ?? '', sel: grid.data!.ser.some((x) => bq.sel.includes(x.id)) ? bq.sel : grid.data!.ser.map((x) => x.id), qty: bq.qty, ref: q!.referrerId ?? '', status: 'open', inv: '', brand: '' } : null;
  const opts = bq ? qRanked(qTotals(bctx!, grid.data!, bdraft!)).map((t) => ({ s: t.s, tot: t.total, miss: t.miss, n: Object.keys(bq.qty).length - t.miss })) : [];
  useEffect(() => { setSid(opts.find((o) => !o.miss)?.s.id ?? opts[0]?.s.id ?? null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel, !!grid.data]);
  const add = async () => {
    if (!q) return;
    const v = await qc.fetchQuery({ queryKey: ['sale', q.id], queryFn: () => api<SaleDoc>(`/sales/${q.id}`) });
    const lines: Line[] = [];
    let brand = 'Item-wise';
    if (bq && bctx && bdraft && grid.data) {
      const sr = grid.data.ser.find((x) => x.id === sid);
      if (!sr) return;
      brand = qSerName(sr);
      for (const r of grid.data.rows) {
        const n = bq.qty[r.id];
        if (!n) continue;
        const o = qRate(bctx, r, sr);
        if (!o.it || o.v === null) continue;
        const L2 = lineFor(d.ctx, { ...s, ref: '' }, o.it);
        L2.qty = n; L2.price = o.v; L2.disc = bq.disc || 0; L2.fromQ = v.number;
        // the commission inside a quoted rate is kept (prototype cmFromLoaded)
        const rule = d.ctx.rules[o.it.cat];
        if (bctx.ref && rule && rule.t !== 'n' && rule.v > 0) { L2.bp = rule.t === 'p' ? Math.round((o.v / (1 + rule.v / 100)) * 100) / 100 : Math.round((o.v - rule.v) * 100) / 100; L2.cmT = rule.t; L2.cmV = rule.v; }
        lines.push(L2);
      }
    }
    for (const l of bq ? [] : v.lines) {
      const it = d.IT.find((i) => i.id === l.itemId);
      if (!it) continue;
      const L2 = lineFor(d.ctx, s, it);
      L2.qty = Number(l.qty); L2.price = Number(l.price); L2.disc = Number(l.discPct) || 0; L2.gst = Number(l.gstRate);
      L2.fromQ = v.number;
      lines.push(L2);
    }
    if (!lines.length) return toast('None of these items are available in that brand');
    let start = 0;
    up((x) => {
      while (x.lines.length && !x.lines.at(-1)!.item && !x.lines.at(-1)!.name.trim()) x.lines.pop();
      start = x.lines.length;
      x.lines.push(...lines, blankLine());
      x.qrefs = [...x.qrefs.filter((r) => r.no !== v.number), { no: v.number, date: v.date, cust: v.partyName || '', brand, id: v.id }];
      // the quotation's referral comes with it; without one, its lines carry the invoice's (prototype iqGo)
      if (v.referrerId && !x.ref) x.ref = v.referrerId;
      else if (!v.referrerId && x.ref) x.lines.forEach((l) => { if (l.fromQ === v.number) { delete l.bp; cmApply(d.ctx, x, l); } });
      if (!x.party) {
        const p = (v.party && d.PT.find((y) => y.id === v.party!.id)) || d.PT.find((y) => v.partyName && y.name.trim().toLowerCase() === v.partyName.trim().toLowerCase());
        if (p) {
          // the customer's price list applies to the lines already there; the quoted rates stay as quoted
          x.mode = 'credit'; x.party = p; x.pos = partyState(d.ctx, p);
          if (!x.dueTouched) x.due = addDaysIso(x.date, p.days || 0);
          x.lines.forEach((l) => { if (l.item && !l.fromQ) l.price = unitPrice(d.ctx, l.item, p); });
        } else if (v.partyName && !x.cashName) { x.mode = 'cash'; x.cashName = v.partyName; }
      }
    });
    onClose();
    toast(`${lines.length} item${lines.length > 1 ? 's' : ''} added from ${v.number}`);
    setTimeout(() => document.querySelector(`#siRows tr[data-ln="${start}"]`)?.scrollIntoView({ block: 'center' }), 50);
  };
  return (
    <div className="ov c" id="iqm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'iqm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="iqT" style={{ width: 'min(640px,100%)' }}>
        <h3 id="iqT" style={{ margin: '0 0 4px', fontSize: 18 }}>Import from quotation</h3>
        <p className="mu" id="iqSub" style={{ margin: '0 0 14px', fontSize: 13 }}>{pn ? `Quotations for ${s.party ? s.party.name : s.cashName} are shown first. Items are added below the ones already on this invoice.` : 'Items are added below the ones already on this invoice.'}</p>
        <div className="iql" id="iqList" role="listbox" aria-label="Saved quotations">
          {L.length ? L.map((x) => (
            <button type="button" className={`iqr ${x.partyName.toLowerCase() === pn && pn ? 'me' : ''}${x.id === sel ? ' on' : ''}`} data-iq={x.number} key={x.id} onClick={() => setSel(x.id)}>
              <span className="mono"><b>{x.number}</b><small>{dmy(x.date)}</small></span>
              <span><b>{x.partyName || 'No customer'}</b><small>{x.qtype === 'brand' ? 'Brand-wise' : 'Item-wise'} · {x.items} item{x.items > 1 ? 's' : ''} · {qfmt(Number(x.qty))} pcs</small></span>
              <span className="n">{x.qtype === 'brand' ? (x.brandQuote?.low ? `₹${inr2f(x.brandQuote.low.total)}` : '') : `₹${inr2f(x.total)}`}</span></button>
          )) : <div className="ptempty">No open quotations. Save a quotation first, or convert one from the Quotation page.</div>}
        </div>
        <div className="qcl iqbr" id="iqBr" hidden={!q}>{bq ? <><b>Which brand?</b>{opts.map((o, k) => (
          <label className={`qco ${o.miss ? 'warn' : ''}`} key={o.s.id}><input type="radio" name="iqb" value={o.s.id} checked={o.s.id === sid} onChange={() => setSid(o.s.id)} /><span className="qct"><b>{qSerName(o.s)}</b><small>{o.miss ? `${o.miss} item${o.miss > 1 ? 's' : ''} not available — left out` : `All ${o.n} items available`}</small></span><span className="qcv">₹{inr2f(o.tot)}{k === 0 && !o.miss ? <i>Lowest</i> : null}</span></label>
        ))}</> : q ? <small className="mu">{q.items} item{q.items > 1 ? 's' : ''} will be added at the quoted rates.</small> : null}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" type="button" id="iqCancel" onClick={onClose}>Cancel</button><button className="btn p" type="button" id="iqGo" disabled={!q} onClick={() => void add()}>Add items</button></div>
      </div>
    </div>
  );
}

/** "From quotation" chips on the invoice (prototype siQrefs). */
export function QuoteRefs({ s, onRemove }: { s: SI; onRemove: (no: string) => void }) {
  if (s.doc === 'quote' || !s.qrefs.length) return null;
  return (
    <div className="qrefs"><span className="qrh"><Icon name="doc" />From quotation</span>
      {s.qrefs.map((x) => (
        <span className="qref" key={x.no}><b className="mono">{x.no}</b><i>{/^\d{4}-\d{2}-\d{2}$/.test(x.date) ? dmy(x.date) : x.date}</i><i>{x.cust || '—'}</i>{x.brand ? <em>{x.brand}</em> : null}
          <button type="button" className="qrx" data-qrx={x.no} aria-label={`Remove quotation ${x.no} from this invoice`} title="Remove from this invoice" onClick={(e) => { e.preventDefault(); onRemove(x.no); }}><Icon name="x" /></button></span>
      ))}
    </div>
  );
}

/** Remove a quotation from the invoice (prototype siQrefRemove); optionally its items too. */
export function qrefRemoveModal(s: SI, no: string, o: { up: (fn: (x: SI) => void) => void; close: () => void; toast: (m: string) => void; full: () => void }): SlModalProps {
  const n = s.lines.filter((l) => l.fromQ === no && l.item).length;
  return {
    title: `Remove ${no} from this invoice?`, sub: 'The quotation itself is not changed.', ok: 'Remove', danger: true,
    body: n ? <label className="cb2"><input type="checkbox" id="qrxItems" defaultChecked /> Also remove the {n} item{n > 1 ? 's' : ''} added from {no}</label> : <p className="mu" style={{ margin: 0 }}>Only the link to this quotation is removed. The items stay on the invoice.</p>,
    onOk: () => {
      const rm = !!n && !!(document.getElementById('qrxItems') as HTMLInputElement | null)?.checked;
      o.up((x) => {
        x.qrefs = x.qrefs.filter((r) => r.no !== no);
        if (/^As per quotation/.test(x.notes)) x.notes = SI_TT.sale;
        if (rm) { x.lines = x.lines.filter((l) => l.fromQ !== no); const last = x.lines.at(-1); if (!last || last.item || last.name.trim()) x.lines.push(blankLine()); }
        else x.lines.forEach((l) => { if (l.fromQ === no) delete l.fromQ; });
      });
      o.close(); o.full();
      o.toast(`${no} removed${rm ? ` with ${n} item${n > 1 ? 's' : ''}` : ''}`);
    },
  };
}

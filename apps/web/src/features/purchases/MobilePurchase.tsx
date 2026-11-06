/**
 * A purchase bill or order on a phone (owner's request, 6 Nov 2026), in the style of the owner's approved new-sale
 * mock: a white header (back, title, number and date), the supplier card, the items as small cards with the rate
 * and − / +, batch boxes for batch-tracked items, the totals card (Discount & charges opens in place, Paid with a
 * tick box) and a bar that always stays at the bottom: Save & New and Save. Nothing opens over the bill.
 * The document, its maths and saving are the desktop editor's own (PurchaseEditor passes them in).
 */
import { useState, type ReactNode } from 'react';
import { PU_MODES, isBankMode, type TotalsOut } from '@billing/shared';
import { inr, inr2f } from '../../lib/format';
import { RawIcon } from '../../components/Icon';
import { useStyles } from '../../lib/useStyles';
import { bankOf, type useBankPick } from '../banking/BankPick';
import type { EditorData } from '../sales/editor/data';
import { r2, type EItem, type EParty } from '../sales/editor/state';
import { PE_T } from './model';
import type { PE } from './PurchaseEditor';
import css from '../sales/editor/mobile-sale.css?inline';

const BACK = '<path d="M15 6l-6 6 6 6"/>';
const NEXT = '<path d="M9 6l6 6-6 6"/>';
const DOWN = '<path d="M6 9l6 6 6-6"/>';
const BIN = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>';
const SCAN = '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 8v8M11 8v8M14 8v8M17 8v8"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${MON[Number(m) - 1] ?? ''} ${y}`; };
const initials = (n: string) => n.split(/\s+/).filter((w) => /[a-z]/i.test(w[0] ?? '')).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const amt = (n: number) => (Math.round(n * 100) % 100 ? inr2f(n) : inr2f(n).replace(/\.00$/, ''));
const num = (v: string) => v.replace(/[^\d.]/g, '');
const n = (v: string | number | undefined) => Number(v) || 0;
const TITLE = { bill: 'Purchase Bill', order: 'Purchase Order', debit_note: 'Debit Note' };

export interface MobilePurchaseProps {
  d: EditorData;
  s: PE;
  t: TotalsOut;
  busy: boolean;
  /** what the supplier is owed from before (null without a supplier) */
  pre: number | null;
  bp: ReturnType<typeof useBankPick>;
  up: (fn: (x: PE) => void) => void;
  pickParty: (p: EParty) => void;
  /** puts the item on line i (the empty last line) the way the desktop list does */
  pickItem: (i: number, it: EItem) => void;
  tracked: (l: PE['lines'][number]) => boolean;
  stockTxt: (l: PE['lines'][number]) => ReactNode;
  mrpOn: boolean;
  back: () => void;
  save: (again: boolean) => void;
  addParty: (q: string) => void;
  addItem: (q: string, i: number) => void;
  toast: (m: string) => void;
}

export function MobilePurchase({ d, s, t, busy, pre, bp, up, pickParty, pickItem, tracked, stockTxt, mrpOn, back, save, addParty, addItem, toast }: MobilePurchaseProps) {
  useStyles([css], 'mobile-sale');
  const k = s.kind;
  const G = d.ctx.mode === 'gst';
  const bill = k === 'bill';
  const p = s.party;
  const total = Number(t.total);
  const [pq, setPq] = useState<string | null>(null);
  const [iq, setIq] = useState<string | null>(null);
  const [meta, setMeta] = useState(false);
  const [chg, setChg] = useState(false);
  const paid = r2(s.pays.reduce((a, q) => a + n(q.amt), 0));
  const bal = r2(total - paid - s.settled);
  const ch = r2(Number(t.chTr) + Number(t.chLab));
  const bdisc = Number(t.bdisc);

  /** an item tapped: one more of it when it is already on the bill */
  const addLine = (it: EItem) => {
    const same = s.lines.findIndex((l) => l.id === it.id);
    if (same >= 0) up((x) => { x.lines[same]!.qty = n(x.lines[same]!.qty) + 1; });
    else {
      const last = s.lines.length - 1;
      const L = s.lines[last];
      if (L && !L.id && !L.name.trim()) pickItem(last, it);
      else { up((x) => { x.lines.push({ id: '', name: '', hsn: '', qty: 1, unit: '', rate: 0, disc: 0, gst: 18 }); }); setTimeout(() => pickItem(s.lines.length, it), 0); }
    }
    setIq(null);
    toast(`${it.name} added`);
  };
  const parties = pq === null ? [] : d.PT.filter((x) => !pq || x.name.toLowerCase().includes(pq.toLowerCase()) || x.phone.includes(pq)).sort((a, b) => Number(b.supplier) - Number(a.supplier)).slice(0, 8);
  const items = iq === null ? [] : d.IT.filter((x) => !x.svc && (!iq || x.name.toLowerCase().includes(iq.toLowerCase()) || x.code.toLowerCase().includes(iq.toLowerCase()))).slice(0, 12);
  const lines = s.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.id);
  const setL = (i: number, f: string, v: string) => up((x) => { (x.lines[i] as unknown as Record<string, unknown>)[f] = v; x.err = ''; });

  return (
    <section id="vPEd" className="msale">
      <header className="ms-top">
        <button className="ms-ib" type="button" id="peBack" aria-label="Back" onClick={back}><RawIcon d={BACK} /></button>
        <button type="button" className="ms-tt" aria-expanded={meta} aria-label="Number and date" onClick={() => setMeta(!meta)}>
          <b id="peTitle">{s.editId ? `Edit ${PE_T[k].toLowerCase()}` : TITLE[k]}</b><small>{bill ? 'Bill' : 'Order'} #{s.no} · {longDate(s.date)}</small>
        </button>
        <span className={`ms-tag ${bill ? 'in' : ''}`}>{bill ? 'Stock in' : 'No stock change'}</span>
      </header>

      <div className="ms-body">
        {meta && (
          <div className="ms-nd">
            <label><span>{bill ? 'Bill no.' : 'Order no.'}</span><input id="peNo" value={s.no} readOnly={!!s.editId} autoComplete="off" onChange={(e) => up((x) => { x.no = e.target.value.trim(); x.autoNo = false; })} /></label>
            <label><span>Date</span><input id="peDate" type="date" value={s.date} onChange={(e) => up((x) => { x.date = e.target.value; })} /></label>
            {bill ? <label><span>Supplier’s bill no.</span><input id="peRef" value={s.ref} autoComplete="off" onChange={(e) => up((x) => { x.ref = e.target.value; })} /></label> : null}
            <label><span>{bill ? 'Due date' : 'Expected by'}</span><input id="peDue" type="date" value={bill ? s.due : s.exp} onChange={(e) => up((x) => { if (bill) x.due = e.target.value; else x.exp = e.target.value; })} /></label>
          </div>
        )}

        {p && pq === null ? (
          <button type="button" className="ms-cust" id="pePartyRow" onClick={() => setPq('')}>
            <span className="ms-av" aria-hidden="true">{initials(p.name)}</span>
            <span className="ms-cn"><small>Supplier</small><b id="pePartyName">{p.name}</b>
              {pre ? <em className={pre > 0 ? 'give' : 'get'}>Old balance {inr(Math.abs(pre))} · {pre > 0 ? 'You’ll Give' : 'You’ll Get'}</em> : <em>No old balance</em>}</span>
            <RawIcon d={NEXT} />
          </button>
        ) : (
          <div className="ms-card ms-find">
            <input id="peParty" value={pq ?? ''} autoComplete="off" placeholder="Supplier name or phone *" aria-label="Supplier" onFocus={() => pq === null && setPq('')} onChange={(e) => setPq(e.target.value)} />
            {pq !== null && (
              <div className="ms-list" role="listbox" aria-label="Parties">
                {parties.map((x) => (
                  <button type="button" role="option" aria-selected={false} key={x.id} onClick={() => { pickParty(x); setPq(null); }}>
                    <span className="ms-av sm" aria-hidden="true">{initials(x.name)}</span>
                    <span><b>{x.name}</b><small>{x.supplier ? 'Supplier' : 'Customer'}{x.phone ? ' · +91 ' + x.phone : ''}</small></span>
                    <em className={x.balance < 0 ? 'give' : x.balance > 0 ? 'get' : ''}>{inr(Math.abs(x.balance))}</em>
                  </button>
                ))}
                <button type="button" className="add" onClick={() => addParty(pq)}><RawIcon d={PLUS} /><b>Add new supplier{pq ? ` “${pq}”` : ''}</b></button>
              </div>
            )}
          </div>
        )}

        <div className="ms-ih"><span>Items ({lines.length})</span>
          <div>
            <button type="button" className="ms-sm" id="mpScan" onClick={() => toast('Scanning is coming with the Android app')}><RawIcon d={SCAN} />Scan</button>
            <button type="button" className="ms-sm p" id="mpAddItem" aria-expanded={iq !== null} onClick={() => setIq(iq === null ? '' : null)}><RawIcon d={PLUS} />Add item</button>
          </div>
        </div>
        {iq !== null && (
          <div className="ms-card ms-find">
            <input id="mpItemQ" value={iq} autoComplete="off" autoFocus placeholder="Item name or code" aria-label="Item name or code" onChange={(e) => setIq(e.target.value)} />
            <div className="ms-list" role="listbox" aria-label="Items">
              {items.map((it) => (
                <button type="button" role="option" aria-selected={false} key={it.id} onClick={() => addLine(it)}>
                  <span><b>{it.name}</b><small>Stock {it.stock ?? 0} {it.unit}{it.code ? ' · ' + it.code : ''}</small></span>
                  <em>₹{amt(it.purch || 0)}</em>
                </button>
              ))}
              <button type="button" className="add" onClick={() => addItem(iq, s.lines.length - 1)}><RawIcon d={PLUS} /><b>Add new item{iq ? ` “${iq}”` : ''}</b></button>
            </div>
          </div>
        )}
        <ul className="ms-items" id="mpItems" aria-label="Bill items">
          {lines.length ? lines.map(({ l, i }) => {
            const q = n(l.qty);
            return (
              <li key={i} data-ln={i}>
                <div className="ms-l1"><span>{l.name}</span><b>₹{amt(Number(t.rows[i]?.amt ?? 0))}</b></div>
                <div className="ms-l2">
                  <span className="ms-rate"><span className="ms-in"><i>₹</i><input value={String(l.rate || '')} inputMode="decimal" placeholder="Rate" aria-label={`Rate of ${l.name}`} onChange={(e) => setL(i, 'rate', num(e.target.value))} /></span><small>/{l.unit}{G ? ` · GST ${l.gst}%` : ''}</small></span>
                  <div className="ms-qty">
                    {/* at one, − takes the item off the bill */}
                    <button type="button" aria-label={q <= 1 ? `Remove ${l.name}` : 'Decrease quantity'} onClick={() => up((x) => { if (q <= 1) x.lines.splice(i, 1); else x.lines[i]!.qty = r2(q - 1); })}>{q <= 1 ? <RawIcon d={BIN} /> : '−'}</button>
                    <input value={String(l.qty)} inputMode="decimal" aria-label={`Quantity of ${l.name}`} onChange={(e) => setL(i, 'qty', num(e.target.value))} />
                    <button type="button" aria-label="Increase quantity" onClick={() => up((x) => { x.lines[i]!.qty = r2(q + 1); })}>+</button>
                  </div>
                </div>
                {bill && tracked(l) ? (
                  <div className="ms-bt" data-bx={i}>
                    <label><span>Batch no. *</span><input data-bf="batchNo" value={l.batchNo ?? ''} autoComplete="off" onChange={(e) => setL(i, 'batchNo', e.target.value)} /></label>
                    <label><span>Mfg</span><input data-bf="mfg" value={l.mfg ?? ''} placeholder="MM/YY" inputMode="numeric" autoComplete="off" onChange={(e) => setL(i, 'mfg', e.target.value)} /></label>
                    <label><span>Expiry</span><input data-bf="expiry" value={l.expiry ?? ''} placeholder="MM/YY" inputMode="numeric" autoComplete="off" onChange={(e) => setL(i, 'expiry', e.target.value)} /></label>
                    {mrpOn ? <label><span>MRP</span><input data-bf="mrp" value={l.mrp ?? ''} inputMode="decimal" autoComplete="off" onChange={(e) => setL(i, 'mrp', num(e.target.value))} /></label> : null}
                  </div>
                ) : null}
                <small className="ms-stk">{stockTxt(l)}</small>
              </li>
            );
          }) : <li className="ms-empty">No items yet. Tap <b>Add item</b> or <b>Scan</b>.</li>}
        </ul>

        <div className="ms-card ms-tot" id="peTot">
          <div className="ms-tl"><span>Subtotal</span><b>₹{inr2f(Number(t.items))}</b></div>
          <button type="button" className="ms-tl ms-chg" id="peChgBtn" aria-expanded={chg} onClick={() => setChg(!chg)}>
            <span>Discount &amp; charges<RawIcon d={DOWN} /></span>
            <b>{bdisc ? <em className="get">− ₹{inr2f(bdisc)}</em> : null}{ch ? <em>+ ₹{inr2f(ch)}</em> : null}{!bdisc && !ch ? <em className="mu">None</em> : null}</b>
          </button>
          {chg && (
            <div className="ms-chgb">
              <div className="ms-tr"><span>Discount</span><span className="ms-two">
                <span className="ms-in"><input id="peBdP" value={s.bdiscP || ''} inputMode="decimal" placeholder="0" aria-label="Discount percent" onChange={(e) => { let v = num(e.target.value); if (Number(v) > 100) v = '100'; up((x) => { x.bdiscP = v; x.bdisc = 0; }); }} /><i>%</i></span>
                <span className="ms-in"><i>₹</i><input id="peBd" value={s.bdiscP ? (bdisc ? String(bdisc) : '') : n(s.bdisc) ? String(s.bdisc) : ''} inputMode="decimal" placeholder="0" aria-label="Discount amount" onChange={(e) => { const v = num(e.target.value); up((x) => { x.bdisc = v; x.bdiscP = ''; }); }} /></span>
              </span></div>
              {([['Transport', 'peChTr', 'chTr'], ['Labour', 'peChLab', 'chLab']] as const).map(([lbl, id, f]) => (
                <div className="ms-tr" key={id}><span>{lbl}</span><span className="ms-in"><i>₹</i><input id={id} value={n(s[f]) ? String(s[f]) : ''} inputMode="decimal" placeholder="0" aria-label={lbl} onChange={(e) => { const v = num(e.target.value); up((x) => { x[f] = v; }); }} /></span></div>
              ))}
              <label className="ms-tr ms-ro"><span><input type="checkbox" id="peRound" checked={s.roundOff} onChange={(e) => up((x) => { x.roundOff = e.target.checked; })} />Round off</span><b>{Number(t.round) >= 0 ? '+' : '−'} ₹{inr2f(Math.abs(Number(t.round)))}</b></label>
            </div>
          )}
          {/* the item amounts and the subtotal already have the GST in them, so it is shown as included */}
          {G ? <div className="ms-tl"><span>GST included{t.inter ? ' (IGST)' : ' (CGST + SGST)'}</span><b className="mu">₹{inr2f(Number(t.tax))}</b></div> : null}
          <div className="ms-hr"></div>
          <div className="ms-total"><span>Total</span><b id="peTotal">₹{inr2f(total)}</b></div>
          {bill && (
            <div className="ms-recv">
              <label className="ms-tick"><input type="checkbox" id="mpPaidTick" checked={paid > 0}
                onChange={(e) => { const on = e.target.checked; up((x) => { x.pays = [{ ...(x.pays[0] ?? { mode: 'Cash', ref: '' }), amt: on ? Math.max(0, r2(total - x.settled)) : 0 }]; }); }} />Paid</label>
              {paid > 0 ? <>
                <select aria-label="Payment type" value={s.pays[0]?.mode ?? 'Cash'} onChange={(e) => up((x) => { x.pays[0]!.mode = e.target.value; })}>{PU_MODES.map((m) => <option key={m}>{m}</option>)}</select>
                <span className="ms-in"><i>₹</i><input id="mpPaid" value={n(s.pays[0]?.amt) ? String(s.pays[0]!.amt) : ''} inputMode="decimal" placeholder="0" aria-label="Amount paid" onChange={(e) => { const v = num(e.target.value); up((x) => { x.pays[0]!.amt = v; }); }} /></span>
              </> : <span className="ms-due">Balance <b className={bal > 0 ? 'give' : ''}>₹{inr2f(Math.max(0, bal))}</b></span>}
            </div>
          )}
          {bill && paid > 0 && bp.show && isBankMode(s.pays[0]?.mode ?? '') ? (
            <div className="ms-tr"><span>Paid from</span><select className="ms-sel" aria-label="Paid from" value={bankOf(bp, s.pays[0]?.acct)} onChange={(e) => up((x) => { x.pays[0]!.acct = e.target.value; })}>{bp.banks.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></div>
          ) : null}
          {bill && paid > 0 && bal > 0.004 ? <div className="ms-tl"><span>Balance due</span><b className="give">₹{inr2f(bal)}</b></div> : null}
          {bill && !s.editId ? <label className="ms-tr ms-ro"><span><input type="checkbox" id="peUpd" checked={s.updPrice} onChange={(e) => up((x) => { x.updPrice = e.target.checked; })} />Update items’ purchase price</span></label> : null}
        </div>
      </div>

      <div className="ms-bar">
        {s.err ? <div className="ms-err" id="peErr" role="alert">{s.err}</div> : null}
        <div className="ms-bb">
          <button type="button" className="ms-save" id="peSaveNew" disabled={busy} onClick={() => save(true)}>Save &amp; New</button>
          <button type="button" className="ms-share" id="peSave" disabled={busy} onClick={() => save(false)}>Save</button>
        </div>
      </div>
    </section>
  );
}

/**
 * The sale on a phone (owner's request, 6 Nov 2026), drawn after the owner's approved mock (Classic new-sale):
 * a white header (back, "New Sale", number and date, Credit / Cash), the customer card, the items as small cards
 * with − / +, the totals card (Discount & charges opens in place, Received with a tick box) and a bar that always
 * stays at the bottom: Save and Save & Share. Nothing opens over the bill.
 * The bill, its maths and saving are the desktop editor's own (SaleEditor passes them in).
 */
import { useState } from 'react';
import { inr, inr2f } from '../../../lib/format';
import { Icon, RawIcon } from '../../../components/Icon';
import { SI_MODES, calc, finalRate, lineFor, r2, stockText, type EItem, type EParty, type SI } from './state';
import type { EditorData } from './data';
import css from './mobile-sale.css?inline';
import { useStyles } from '../../../lib/useStyles';

const BACK = '<path d="M15 6l-6 6 6 6"/>';
const NEXT = '<path d="M9 6l6 6-6 6"/>';
const DOWN = '<path d="M6 9l6 6 6-6"/>';
const BIN = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>';
const SCAN = '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 8v8M11 8v8M14 8v8M17 8v8"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const SHARE = '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${MON[Number(m) - 1] ?? ''} ${y}`; };
const initials = (n: string) => n.split(/\s+/).filter((w) => /[a-z]/i.test(w[0] ?? '')).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
/** an amount as the mock shows it: no paise when there are none */
const amt = (n: number) => (Math.round(n * 100) % 100 ? inr2f(n) : inr2f(n).replace(/\.00$/, ''));
const num = (v: string) => v.replace(/[^\d.]/g, '');

export interface MobileSaleProps {
  d: EditorData;
  s: SI;
  title: string;
  busy: boolean;
  /** previous dues of the party (null without a party) */
  pre: number | null;
  up: (fn: (x: SI) => void) => void;
  pickParty: (p: EParty) => void;
  setMode: (cash: boolean) => void;
  back: () => void;
  save: (o: { again?: boolean; share?: boolean }) => void;
  addParty: (q: string) => void;
  addItem: (q: string, then: (it: EItem) => void) => void;
  toast: (m: string) => void;
}

export function MobileSale({ d, s, title, busy, up, pickParty, setMode, back, save, addParty, addItem, toast }: MobileSaleProps) {
  useStyles([css], 'mobile-sale');
  const ctx = d.ctx;
  const t = calc(ctx, s);
  const G = ctx.mode === 'gst';
  const cash = s.mode === 'cash';
  const quote = s.doc === 'quote';
  const p = s.party;
  const [pq, setPq] = useState<string | null>(null);
  const [iq, setIq] = useState<string | null>(null);
  const [meta, setMeta] = useState(false);
  const [chg, setChg] = useState(false);
  const rec = r2(s.pays.reduce((a, x) => a + (Number(x.amt) || 0), 0));
  const bal = r2(t.total - rec);
  const ch = r2(t.chTr + t.chLab + t.chBank);
  // prices without GST: item amounts and the subtotal are before GST and the GST is an added line (owner, 7 Nov);
  // prices with GST: amounts already have it, so it is shown as included
  const added = G && !s.incl;
  const preTv = r2(t.rows.reduce((a, r) => a + r.tv, 0));
  const preTx = r2(t.items - preTv);
  const gstName = t.inter ? 'IGST' : 'CGST + SGST';

  /** an item tapped (or scanned): one more of it when it is already on the bill */
  const addLine = (it: EItem) => {
    up((x) => {
      const same = x.lines.find((l) => l.item?.id === it.id);
      if (same) { same.qty = (Number(same.qty) || 0) + 1; return; }
      const L = lineFor(ctx, x, it);
      const last = x.lines[x.lines.length - 1];
      x.lines.splice(last && !last.item && !last.name.trim() ? x.lines.length - 1 : x.lines.length, 0, L);
    });
    setIq(null);
    toast(`${it.name} added`);
  };
  const parties = pq === null ? [] : d.PT.filter((x) => !pq || x.name.toLowerCase().includes(pq.toLowerCase()) || x.phone.includes(pq)).sort((a, b) => Number(a.supplier) - Number(b.supplier)).slice(0, 8);
  const items = iq === null ? [] : d.IT.filter((x) => !iq || x.name.toLowerCase().includes(iq.toLowerCase()) || x.code.toLowerCase().includes(iq.toLowerCase())).slice(0, 12);
  const lines = s.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.item);

  return (
    <section id="vNewInv" className="msale">
      <header className="ms-top">
        <button className="ms-ib" type="button" id="siCancel" aria-label="Back" onClick={back}><RawIcon d={BACK} /></button>
        <button type="button" className="ms-tt" aria-expanded={meta} aria-label="Invoice number and date" onClick={() => setMeta(!meta)}>
          <b id="siTitle">{title}</b><small>{ctx.txn?.showNo !== false ? `${quote ? 'Quotation' : 'Invoice'} #${s.no} · ` : ''}{longDate(s.date)}</small>
        </button>
        <div className="ms-seg" role="group" aria-label="Payment type">
          <button type="button" aria-pressed={!cash} onClick={() => cash && setMode(false)}>{quote ? 'Party' : 'Credit'}</button>
          <button type="button" aria-pressed={cash} onClick={() => !cash && setMode(true)}>{quote ? 'Walk-in' : 'Cash'}</button>
        </div>
      </header>

      <div className="ms-body">
        {meta && (
          <div className="ms-nd">
            {ctx.txn?.showNo !== false && <label><span>{quote ? 'Quotation no.' : 'Invoice no.'}</span><input id="siNo" value={s.no} readOnly={!!s.editId} autoComplete="off" onChange={(e) => up((x) => { x.no = e.target.value.trim(); x.autoNo = false; })} /></label>}
            <label><span>Date</span><input id="siDate" type="date" value={s.date} onChange={(e) => up((x) => { x.date = e.target.value; })} /></label>
          </div>
        )}

        {cash ? (
          <div className="ms-card ms-cash">
            <label><span>Customer name (optional)</span><input id="siCashName" value={s.cashName} autoComplete="off" onChange={(e) => up((x) => { x.cashName = e.target.value; })} /></label>
            <label><span>Mobile</span><input id="siCashPhone" value={s.cashPhone} inputMode="numeric" autoComplete="off" onChange={(e) => up((x) => { x.cashPhone = e.target.value; })} /></label>
          </div>
        ) : p && pq === null ? (
          <button type="button" className="ms-cust" id="siPartyRow" onClick={() => setPq('')}>
            <span className="ms-av" aria-hidden="true">{initials(p.name)}</span>
            <span className="ms-cn"><small>Customer</small><b id="siPartyName">{p.name}</b>
              {p.balance ? <em className={p.balance > 0 ? 'get' : 'give'}>Old balance {inr(Math.abs(p.balance))} · {p.balance > 0 ? 'You’ll Get' : 'You’ll Give'}</em> : <em>No old balance</em>}</span>
            <RawIcon d={NEXT} />
          </button>
        ) : (
          <div className="ms-card ms-find">
            <input id="siParty" value={pq ?? ''} autoComplete="off" placeholder="Customer name or phone *" aria-label="Customer" onFocus={() => pq === null && setPq('')} onChange={(e) => setPq(e.target.value)} />
            {pq !== null && (
              <div className="ms-list" role="listbox" aria-label="Parties">
                {parties.map((x) => (
                  <button type="button" role="option" aria-selected={false} key={x.id} onClick={() => { pickParty(x); setPq(null); }}>
                    <span className="ms-av sm" aria-hidden="true">{initials(x.name)}</span>
                    <span><b>{x.name}</b><small>{x.phone ? '+91 ' + x.phone : ''}{x.city ? ' · ' + x.city : ''}</small></span>
                    <em className={x.balance > 0 ? 'get' : x.balance < 0 ? 'give' : ''}>{inr(Math.abs(x.balance))}</em>
                  </button>
                ))}
                <button type="button" className="add" onClick={() => addParty(pq)}><RawIcon d={PLUS} /><b>Add new party{pq ? ` “${pq}”` : ''}</b></button>
              </div>
            )}
          </div>
        )}

        <div className="ms-ih"><span>Items ({lines.length})</span>
          <div>
            <button type="button" className="ms-sm" id="msScan" onClick={() => toast('Scanning is coming with the Android app')}><RawIcon d={SCAN} />Scan</button>
            <button type="button" className="ms-sm p" id="msAdd" aria-expanded={iq !== null} onClick={() => setIq(iq === null ? '' : null)}><RawIcon d={PLUS} />Add item</button>
          </div>
        </div>
        {iq !== null && (
          <div className="ms-card ms-find">
            <input id="msItemQ" value={iq} autoComplete="off" autoFocus placeholder="Item name or code" aria-label="Item name or code" onChange={(e) => setIq(e.target.value)} />
            <div className="ms-list" role="listbox" aria-label="Items">
              {items.map((it) => (
                <button type="button" role="option" aria-selected={false} key={it.id} onClick={() => addLine(it)}>
                  <span><b>{it.name}</b><small>{it.svc ? 'Service' : `Stock ${stockText(it, it.stock ?? 0)}`}{it.code ? ' · ' + it.code : ''}</small></span>
                  <em>₹{amt(lineFor(ctx, s, it).price)}</em>
                </button>
              ))}
              <button type="button" className="add" onClick={() => addItem(iq, addLine)}><RawIcon d={PLUS} /><b>Add new item{iq ? ` “${iq}”` : ''}</b></button>
            </div>
          </div>
        )}
        <ul className="ms-items" id="msItems" aria-label="Invoice items">
          {lines.length ? lines.map(({ l, i }) => {
            const q = Number(l.qty) || 0;
            return (
              <li key={i} data-ln={i}>
                <div className="ms-l1"><span>{l.name}</span><b>₹{amt((added ? t.rows[i]?.tv : t.rows[i]?.amt) ?? 0)}</b></div>
                <div className="ms-l2">
                  <span>₹{amt(finalRate(l))} × {q}{G ? ` · GST ${l.gst}%` : ''}</span>
                  <div className="ms-qty">
                    {/* at one, − takes the item off the bill */}
                    <button type="button" aria-label={q <= 1 ? `Remove ${l.name}` : 'Decrease quantity'} onClick={() => up((x) => { if (q <= 1) x.lines.splice(i, 1); else x.lines[i]!.qty = r2(q - 1); })}>{q <= 1 ? <RawIcon d={BIN} /> : '−'}</button>
                    <input value={String(l.qty)} inputMode="decimal" aria-label={`Quantity of ${l.name}`} onChange={(e) => up((x) => { x.lines[i]!.qty = num(e.target.value); })} />
                    <button type="button" aria-label="Increase quantity" onClick={() => up((x) => { x.lines[i]!.qty = r2(q + 1); })}>+</button>
                  </div>
                </div>
              </li>
            );
          }) : <li className="ms-empty">No items yet. Tap <b>Add item</b> or <b>Scan</b>.</li>}
        </ul>

        <div className="ms-card ms-tot" id="siTot">
          <div className="ms-tl"><span>Subtotal{added ? ' (before GST)' : ''}</span><b>₹{inr2f(added ? preTv : t.items)}</b></div>
          {added ? <div className="ms-tl" id="siGst"><span>GST ({gstName})</span><b>+ ₹{inr2f(preTx)}</b></div> : null}
          <button type="button" className="ms-tl ms-chg" id="siChgBtn" aria-expanded={chg} onClick={() => setChg(!chg)}>
            <span>Discount &amp; charges<RawIcon d={DOWN} /></span>
            <b>{t.bdisc ? <em className="get">− ₹{inr2f(t.bdisc)}</em> : null}{ch ? <em>+ ₹{inr2f(ch)}</em> : null}{!t.bdisc && !ch ? <em className="mu">None</em> : null}</b>
          </button>
          {chg && (
            <div className="ms-chgb" id="siChgBody">
              <div className="ms-tr"><span>Discount</span><span className="ms-two">
                <span className="ms-in"><input id="siBdP" value={s.bdiscP || ''} inputMode="decimal" placeholder="0" aria-label="Discount percent" onChange={(e) => { let v = num(e.target.value); if (Number(v) > 100) v = '100'; up((x) => { x.bdiscP = v; x.bdisc = 0; }); }} /><i>%</i></span>
                <span className="ms-in"><i>₹</i><input id="siBd" value={s.bdiscP ? (t.bdisc ? String(t.bdisc) : '') : s.bdisc ? String(s.bdisc) : ''} inputMode="decimal" placeholder="0" aria-label="Discount amount" onChange={(e) => { const v = num(e.target.value); up((x) => { x.bdisc = v; x.bdiscP = ''; }); }} /></span>
              </span></div>
              {([['Transport', 'siChTr', 'chTr'], ['Labour', 'siChLab', 'chLab'], ['Bank charges', 'siChBank', 'chBank']] as const).map(([lbl, id, f]) => (
                <div className="ms-tr" key={id}><span>{lbl}</span><span className="ms-in"><i>₹</i><input id={id} value={s[f] ? String(s[f]) : ''} inputMode="decimal" placeholder="0" aria-label={lbl} onChange={(e) => { const v = num(e.target.value); up((x) => { x[f] = v; }); }} /></span></div>
              ))}
              <label className="ms-tr ms-ro"><span><input type="checkbox" id="siRound" checked={s.roundOff} onChange={(e) => up((x) => { x.roundOff = e.target.checked; })} />Round off</span><b>{t.round >= 0 ? '+' : '−'} ₹{inr2f(Math.abs(t.round))}</b></label>
            </div>
          )}
          {added && t.bdisc ? <div className="ms-tl ms-note"><span>GST on the bill after discount</span><b className="mu">₹{inr2f(t.tax)}</b></div> : null}
          {G && !added ? <div className="ms-tl" id="siGst"><span>GST included ({gstName})</span><b className="mu">₹{inr2f(t.tax)}</b></div> : null}
          <div className="ms-hr"></div>
          <div className="ms-total"><span>Total</span><b id="siTotal">₹{inr2f(t.total)}</b></div>
          {!quote && (
            <div className="ms-recv">
              <label className="ms-tick"><input type="checkbox" id="msRecvTick" checked={rec > 0} disabled={cash}
                onChange={(e) => { const on = e.target.checked; up((x) => { x.recvTouched = true; x.pays = [{ ...(x.pays[0] ?? { mode: 'Cash', ref: '' }), amt: on ? t.total : 0 }]; }); }} />Received</label>
              {rec > 0 || cash ? <>
                <select aria-label="Payment type" value={s.pays[0]?.mode ?? 'Cash'} onChange={(e) => up((x) => { x.pays[0]!.mode = e.target.value; })}>{SI_MODES.map((m) => <option key={m}>{m}</option>)}</select>
                <span className="ms-in"><i>₹</i><input id="msRecv" value={Number(s.pays[0]?.amt) ? String(s.pays[0]!.amt) : ''} inputMode="decimal" placeholder="0" aria-label="Amount received" readOnly={cash} onChange={(e) => { const v = num(e.target.value); up((x) => { x.pays[0]!.amt = v; x.recvTouched = true; }); }} /></span>
              </> : <span className="ms-due">Balance <b className={bal > 0 ? 'give' : ''}>₹{inr2f(Math.max(0, bal))}</b></span>}
            </div>
          )}
          {!quote && rec > 0 && bal > 0.004 ? <div className="ms-tl"><span>Balance due</span><b className="give">₹{inr2f(bal)}</b></div> : null}
        </div>
      </div>

      <div className="ms-bar">
        {s.err ? <div className="ms-err" id="siErr" role="alert">{s.err}</div> : null}
        <div className="ms-bb">
          <button type="button" className="ms-save" id="siSave" disabled={busy} onClick={() => save({})}>{quote ? 'Save quotation' : 'Save'}</button>
          <button type="button" className="ms-share" id="siSaveShare" disabled={busy} onClick={() => save({ share: true })}><RawIcon d={SHARE} />Save &amp; Share</button>
        </div>
      </div>
    </section>
  );
}

/** After saving on a phone (owner's request, 6 Nov 2026): the bill number and total, a big New Bill and Share. */
export function BillSaved({ doc, number, total, party, onNew, onShare, onClose }: { doc: string; number: string; total: string; party: string; onNew: () => void; onShare: () => void; onClose: () => void }) {
  useStyles([css], 'mobile-sale');
  return (
    <section id="vNewInv" className="msale ms-done">
      <header className="ms-top"><button className="ms-ib" type="button" id="msDoneClose" aria-label="Close" onClick={onClose}><RawIcon d={BACK} /></button><span className="ms-tt"><b>{doc} saved</b></span></header>
      <div className="ms-ok">
        <span className="ms-tick-big" aria-hidden="true"><svg viewBox="0 0 24 24" className="i"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
        <h1 id="msDoneT">Bill saved</h1>
        <p>{doc} <b id="msDoneNo">{number}</b>{party ? <> · {party}</> : null}</p>
        <b className="ms-ok-amt" id="msDoneTotal">₹{inr2f(Number(total))}</b>
      </div>
      <div className="ms-bar">
        <div className="ms-bb">
          <button type="button" className="ms-save" id="msDoneShare" onClick={onShare}><RawIcon d={SHARE} />Share</button>
          <button type="button" className="ms-share" id="msDoneNew" onClick={onNew}><RawIcon d={PLUS} />New Bill</button>
        </div>
      </div>
    </section>
  );
}

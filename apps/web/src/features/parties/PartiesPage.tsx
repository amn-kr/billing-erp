/**
 * Parties (#vParties) — same markup as the prototype's renderParties /
 * renderPartyDetail / renderTx. Sales, payments and statements arrive in
 * Phase 3; until then a party's only transaction is its opening balance.
 */
import { useMemo, useState, type MouseEvent as RMouseEvent } from 'react';
import { go } from '../../lib/go';
import { useQuery } from '@tanstack/react-query';
import { money, todayIst } from '@billing/shared';
import { api } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useCur } from '../../lib/settings';
import { useFitTables } from '../../lib/useFitTables';
import { useMe } from '../../lib/me';
import { Icon, RawIcon } from '../../components/Icon';
import { soon, useShell } from '../shell/store';
import { statementOf } from '../reports/party';
import { InactiveList, useMasterDelete } from '../../components/MasterDelete';
import { AddPartyDialog, type EditParty } from './AddPartyDialog';
import { ui } from '../../styles/uiSize';

export interface Party extends EditParty {
  id: string;
  name: string;
  billingName?: string;
  kind: 'customer' | 'supplier';
  group: string;
  phone: string;
  email: string;
  gstin: string;
  state: string;
  creditLimit: string | null;
  creditDays: number;
  openingBalance: string;
  openingType: 'receive' | 'pay';
  openingDate: string | null;
  balance: string;
  billing: { line: string; city: string; pin: string; state: string } | null;
  createdAt: string;
}

const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const DOTS = '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>';
const CHEV = '<path d="M6 9l6 6 6-6"/>';
/** Parties added in the last week carry the prototype's "New" tag. */
const isNew = (p: Party) => Math.abs(Date.now() - Date.parse(p.createdAt)) < 7 * 86_400_000;

type Kind = 'all' | 'c' | 's';
type Bal = 'all' | 'rec' | 'pay' | 'zero';

interface Tx {
  i: number;
  type: string;
  no: string;
  /** the supplier's own bill number (bills and debit notes), '' when none */
  ref: string;
  date: string;
  total: string;
  bal: string;
  due: string;
  st: { t: string; c: string };
}

/** One row of GET /reports/party-tx/:id (ISO dates; bal = still unpaid, or unused for payments and notes). */
interface PartyTxRow { type: string; no: string; date: string; total: string; bal: string; due: string; supplierRef?: string }

/** prototype txStatus */
function txStatus(t: PartyTxRow, today: string, cur: (s: string) => string): Tx['st'] {
  const bal = money(t.bal);
  if (t.type === 'Payment-In' || t.type === 'Payment-Out') return bal.gt(0) ? { t: `Unused ${cur(inr(Number(t.bal)))}`, c: 'a' } : { t: 'Used', c: 'g' };
  if (t.type === 'Opening balance') return bal.gt(0) ? { t: 'Unpaid', c: 'a' } : { t: 'Settled', c: 'g' };
  if (bal.lte(0)) return { t: 'Paid', c: 'g' };
  const od = t.due ? Math.round((Date.parse(today) - Date.parse(t.due)) / 86_400_000) : 0;
  if (t.due && od > 0) return { t: `Overdue ${od} day${od > 1 ? 's' : ''}`, c: od > 14 ? 'r' : 'a' };
  if (t.due && od === 0) return { t: 'Due today', c: 'a' };
  if (bal.lt(t.total)) return { t: 'Partly paid', c: 'b' };
  return { t: t.due ? `Due in ${-od} days` : 'Unpaid', c: 'b' };
}

/** A party's transactions (prototype p.tx): sales, purchases, payments in / out, credit and debit notes, cheque bounces and the opening balance. */
function partyTx(rows: PartyTxRow[], cur: (s: string) => string): Tx[] {
  const today = todayIst();
  return rows.map((t, i) => ({ i, type: t.type, no: t.no, ref: t.supplierRef ?? '', date: dmy(t.date), total: t.total, bal: t.bal, due: t.due ? dmy(t.due) : '', st: txStatus(t, today, cur) }));
}

export function PartiesPage() {
  useFitTables();
  const cur = useCur();
  const me = useMe().data;
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties') });
  // ?sel=<party id> opens on that party (the commission page's "Ledger" link)
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(location.search).get('sel'));
  const [kind, setKind] = useState<Kind>('all');
  const [bal, setBal] = useState<Bal>('all');
  const [q, setQ] = useState('');
  const [pop, setPop] = useState<'kind' | 'more' | 'fil' | null>(null);
  const [tsOpen, setTsOpen] = useState(false);
  const [tq, setTq] = useState('');
  const [tType, setTType] = useState('all');
  const [tStat, setTStat] = useState('all');
  const [sort, setSort] = useState<'date' | 'total' | 'bal'>('date');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const del = useMasterDelete('party', () => setSel(null));

  const all = list.data ?? [];
  const L = useMemo(() => {
    const s = q.toLowerCase();
    return all.filter((p) => {
      const b = money(p.balance);
      return (kind === 'all' || (kind === 'c' ? p.kind === 'customer' : p.kind === 'supplier'))
        && (!s || p.name.toLowerCase().includes(s) || p.phone.includes(s))
        && (bal === 'all' || (bal === 'rec' ? b.gt(0) : bal === 'pay' ? b.lt(0) : b.isZero()));
    });
  }, [all, q, kind, bal]);

  const selId = sel && all.some((p) => p.id === sel) ? sel : (L[0] ?? all[0])?.id ?? null;
  const p = all.find((x) => x.id === selId) ?? null;
  const toggle = (k: 'kind' | 'more' | 'fil') => (e: RMouseEvent) => {
    e.stopPropagation();
    setPop(pop === k ? null : k);
  };
  const close = () => setPop(null);

  let rec = money(0), pay = money(0);
  all.forEach((x) => {
    const b = money(x.balance);
    if (b.gt(0)) rec = rec.plus(b);
    else pay = pay.minus(b);
  });

  if (list.isLoading) return <section id="vParties"></section>;

  return (
    <section id="vParties" onClick={close}>
      <div className="pthd">
        <div className="rel">
          <button className="ptkind" id="ptKindBtn" aria-haspopup="true" onClick={toggle('kind')}><span id="ptKind">{kind === 'all' ? 'All parties' : kind === 'c' ? 'Customers' : 'Suppliers'}</span><RawIcon d={CHEV} /></button>
          <div className="pop" id="ptKindPop" hidden={pop !== 'kind'} style={{ left: 0, right: 'auto' }}>
            {(['all', 'c', 's'] as const).map((k) => (
              <button key={k} data-kind={k} onClick={() => { setKind(k); close(); }}>{k === 'all' ? 'All parties' : k === 'c' ? 'Customers' : 'Suppliers'}</button>
            ))}
          </div>
        </div>
        <div className="pttot" id="ptTot">
          {all.length > 0 && (
            <>
              <span><i style={{ background: 'var(--green)' }}></i>To receive <b className="pos">{cur(inr(rec))}</b></span>
              <span><i style={{ background: 'var(--red)' }}></i>To pay <b className="neg">{cur(inr(pay))}</b></span>
            </>
          )}
        </div>
        <div className="sp"></div>
        <button className="btn p" data-soon="New party" onClick={() => setAdding(true)}><Icon name="plus" />Add party</button>
        <div className="rel">
          <button className="ib" id="ptMoreBtn" aria-label="More options" onClick={toggle('more')}><RawIcon d={DOTS} /></button>
          <div className="pop" id="ptMorePop" hidden={pop !== 'more'}>
            <button id="ptImportMenu" onClick={() => go('/parties/import')}>Import Parties</button>
            <button data-soon="Import contacts" onClick={() => soon('Import contacts')}>Import from phone contacts</button>
            <button data-soon="Party groups" onClick={() => soon('Party groups')}>Manage party groups</button>
            <button data-soon="Bulk payment reminders" onClick={() => soon('Bulk payment reminders')}>Send payment reminders</button>
          </div>
        </div>
      </div>
      <div className="ptg">
        <div className="card ptl">
          <label className="search pts" htmlFor="ptQ"><RawIcon d={SEARCH} /><input id="ptQ" placeholder="Search party name or mobile" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="ptlh">
            <span>Party name</span>
            <div className="rel">
              <button className="ixs" id="ptFilBtn" aria-label="Filter by balance" title="Filter by balance" onClick={toggle('fil')}><RawIcon d={FILTER} /><i className="fdot" id="ptFilterDot" hidden={bal === 'all'}></i></button>
              <div className="pop" id="ptFilPop" hidden={pop !== 'fil'} style={{ left: 0, right: 'auto' }}>
                <h4>Show</h4>
                {([['all', 'All balances'], ['rec', 'To receive'], ['pay', 'To pay'], ['zero', 'Settled (₹0)']] as const).map(([k, t]) => (
                  <button key={k} data-bal={k} className={bal === k ? 'cur' : undefined} onClick={() => { setBal(k); close(); }}>{cur(t)}</button>
                ))}
              </div>
            </div>
            <span className="sp"></span>
            <span>{cur('Amount (₹)')}</span>
          </div>
          <div className="ptlist" id="ptList">
            {!all.length ? (
              <div className="ptempty">No parties yet.<br /><button className="lnk" data-soon="New party" onClick={() => setAdding(true)}>+ Add your first party</button></div>
            ) : L.length ? (
              L.map((x) => {
                const b = money(x.balance);
                return (
                  <button className={`ptr ${x.id === selId ? 'on' : ''}`} data-pid={x.id} key={x.id} onClick={() => setSel(x.id)}>
                    <span className="ptn">{x.name}{isNew(x) && <>{' '}<span className="st b" style={{ fontSize: ui.fs(10), padding: ui.sp('1px 6px') }}>New</span></>}</span>
                    <span className={b.gt(0) ? 'pos' : b.lt(0) ? 'neg' : 'zero'}>{inr2f(b.abs())}</span>
                  </button>
                );
              })
            ) : (
              <div className="ptempty">No parties match.<br /><button className="lnk" data-soon="New party" onClick={() => setAdding(true)}>+ Add party</button></div>
            )}
            <InactiveList<Party> what="party" keep={(x) => kind === 'all' || (kind === 'c' ? x.kind === 'customer' : x.kind === 'supplier')} />
          </div>
        </div>
        <div className="ptr2" id="ptRight">
          <div className="card" id="ptHead">
            {!all.length ? (
              <div className="ptempty pue" style={{ padding: ui.sp('28px 16px') }}><b>Add your first party</b><span>Customers you sell to and suppliers you buy from. Old balances can be entered as opening balance.</span><button className="btn p sm" data-soon="New party" onClick={() => setAdding(true)}>Add party</button></div>
            ) : p ? (
              <PartyHead p={p} shop={me?.business?.name ?? ''} onCopied={showToast} onEdit={() => setEditing(p)} />
            ) : null}
          </div>
          <div className="card ptxc" hidden={!all.length}>
            <div className="hd" style={{ margin: 0, padding: ui.sp('14px 16px') }}>
              <h3>Transactions</h3>
              <div className="ptools">
                <div className={tsOpen ? 'xsr open' : 'xsr'} id="ptTsWrap">
                  <button className="ixs" id="ptTsBtn" type="button" title="Search transactions" aria-label="Search transactions" aria-expanded={tsOpen} onMouseDown={(e) => tsOpen && e.preventDefault()} onClick={() => { if (!tsOpen) { setTsOpen(true); setTimeout(() => document.getElementById('ptTq')?.focus(), 30); } else { setTq(''); setTsOpen(false); } }}><RawIcon d={SEARCH} /></button>
                  <input className="fi" id="ptTq" placeholder="Search number, type or amount" autoComplete="off" tabIndex={tsOpen ? 0 : -1} aria-label="Search transactions" value={tq} onChange={(e) => setTq(e.target.value)} onBlur={() => !tq.trim() && setTsOpen(false)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTq(''); setTsOpen(false); } }} />
                </div>
                <button className="ixs" id="ptPrint" title="Download statement" aria-label="Download statement" onClick={() => soon('Party statement')}><RawIcon d={PRINT} /></button>
                <button className="ixs xls" id="ptXls" title="Export to Excel" aria-label="Export to Excel" onClick={() => showToast('Excel export comes with the reports')}>XLS</button>
              </div>
            </div>
            {p && <TxTable p={p} tq={tq} tType={tType} tStat={tStat} sort={sort} setTType={setTType} setTStat={setTStat} setSort={setSort} />}
          </div>
        </div>
      </div>
      <div className="pop" id="ptRowPop" hidden style={{ position: 'fixed', minWidth: 220 }}></div>
      {/* one window for Add party and Edit party (the same ids) */}
      <AddPartyDialog open={adding || !!editing} edit={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={(id) => { setAdding(false); setEditing(null); setSel(id); }}
        onDelete={() => {
          const x = editing!, ob = money(x.openingBalance);
          setEditing(null);
          void del.ask(x, ob.gt(0) ? `its opening balance of ${cur(inr(ob))}` : '');
        }} />
      {del.modal}
    </section>
  );
}

function PartyHead({ p, shop, onCopied, onEdit }: { p: Party; shop: string; onCopied: (t: string) => void; onEdit: () => void }) {
  const b = money(p.balance);
  const msg = `Dear ${p.name}, your balance with ${shop} is ${inr(b.abs())}. Please pay at the earliest. Thank you.`;
  const city = p.billing?.city ?? '';
  return (
    <div className="pth">
      <div style={{ minWidth: 0 }}>
        <div className="ptt"><h2>{p.name}</h2><button className="ixs" id="ptEdit" aria-label="Edit party" title="Edit party" onClick={onEdit}><Icon name="edit" /></button></div>
        <div className="ptmeta">
          {p.phone && <span><Icon name="phone" />+91 {p.phone.slice(0, 5)} {p.phone.slice(5)}</span>}
          {p.gstin && <span className="mono needs-gst">GSTIN {p.gstin}</span>}
          <span>{p.group}</span>
          {city && <span>{city}</span>}
          {p.creditLimit && money(p.creditLimit).gt(0) && <span>Credit limit {inr(p.creditLimit)}</span>}
          {p.creditDays > 0 && <span>{p.creditDays}-day credit</span>}
        </div>
      </div>
      <div className="ptacts">
        {b.gt(0) && p.phone && (
          <>
            <a className="ixs wa" href={`https://wa.me/91${p.phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener" title="Send reminder on WhatsApp" aria-label="Send reminder on WhatsApp"><Icon name="chat" /></a>
            <button className="ixs" id="ptCopy" title="Copy reminder message" aria-label="Copy reminder message" onClick={() => { navigator.clipboard ? navigator.clipboard.writeText(msg).then(() => onCopied('Reminder message copied'), () => onCopied('Copy blocked by the browser')) : onCopied('Copy blocked by the browser'); }}><Icon name="doc" /></button>
          </>
        )}
        {b.gt(0) && <button className="btn sm" data-recv="all" onClick={() => soon('Receive payment')}><Icon name="dn" />Receive payment</button>}
        {/* the prototype adds Statement just before "New invoice", so suppliers don't get it */}
        {p.kind === 'customer' && (
          <>
            <button className="btn" id="ptStmtBtn" type="button" style={{ marginRight: ui.sp(8) }} onClick={() => { statementOf(p.id); go('/reports?r=pstmt'); }}><Icon name="doc" />Statement</button>
            <button className="btn p sm" data-sellparty={p.id} onClick={() => go(`/sales/new?party=${p.id}`)}><Icon name="plus" />New invoice</button>
          </>
        )}
      </div>
    </div>
  );
}

function TxTable(props: { p: Party; tq: string; tType: string; tStat: string; sort: 'date' | 'total' | 'bal'; setTType: (v: string) => void; setTStat: (v: string) => void; setSort: (v: 'date' | 'total' | 'bal') => void }) {
  const { p, tq, tType, tStat, sort } = props;
  const cur = useCur();
  const rows = useQuery({ queryKey: ['party-tx', p.id], queryFn: () => api<PartyTxRow[]>(`/reports/party-tx/${p.id}`) });
  const all = partyTx(rows.data ?? [], cur);
  const q = tq.toLowerCase();
  const tx = all
    .filter((t) => (tType === 'all' || t.type === tType) && (tStat === 'all' || (tStat === 'open' ? money(t.bal).gt(0) : tStat === 'over' ? t.st.t.startsWith('Overdue') : money(t.bal).isZero())) && (!q || t.no.toLowerCase().includes(q) || t.ref.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || t.total.includes(q)))
    .sort((a, b) => (sort === 'total' ? money(b.total).cmp(a.total) : sort === 'bal' ? money(b.bal).cmp(a.bal) : 0));
  const types = [...new Set(all.map((t) => t.type))];
  const [filOpen, setFilOpen] = useState(false);
  const th = (k: 'date' | 'total' | 'bal', label: string, n = false) => (
    <th data-sort={k} className={`${n ? 'n ' : ''}srt${sort === k ? ' sorted' : ''}`} onClick={() => props.setSort(k)}>{label}</th>
  );
  return (
    <>
      <div className="ptfil" hidden={!filOpen}>
        <select className="fi" id="ptTypeSel" aria-label="Filter by type" value={tType} onChange={(e) => props.setTType(e.target.value)}>
          <option value="all">All types</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="fi" id="ptStatSel" aria-label="Filter by status" value={tStat} onChange={(e) => props.setTStat(e.target.value)}>
          <option value="all">All statuses</option><option value="open">Unpaid</option><option value="over">Overdue</option><option value="paid">Paid / used</option>
        </select>
      </div>
      <div className="tw" style={{ margin: 0 }}>
        <table className="ptt2">
          <thead>
            <tr>
              <th><span className="thw2">Type<button type="button" className="thf" data-thf="ptTypeSel" aria-label="Filter by type" title="Filter by type" aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setFilOpen(!filOpen); }}><RawIcon d={FILTER} /></button></span></th>
              <th>Number</th>
              {th('date', 'Date')}
              {th('total', 'Total', true)}
              {th('bal', 'Balance / unused', true)}
              <th>Due date</th>
              <th><span className="thw2">Status<button type="button" className="thf" data-thf="ptStatSel" aria-label="Filter by status" title="Filter by status" aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setFilOpen(!filOpen); }}><RawIcon d={FILTER} /></button></span></th>
              <th><span className="vh">Actions</span></th>
            </tr>
          </thead>
          <tbody id="ptTx">
            {tx.length ? tx.map((t) => (
              <tr key={t.i}>
                <td>{t.type}</td><td className="mono">{t.no}{t.ref ? <small>Supplier: {t.ref}</small> : null}</td><td>{t.date}</td><td className="n">{inr2f(t.total)}</td><td className="n">{inr2f(t.bal)}</td>
                <td>{t.due && money(t.bal).gt(0) ? t.due : ''}</td><td><span className={`stt ${t.st.c}`}>{t.st.t}</span></td>
                <td className="n"><div className="rel"><button className="ixs" data-tm={t.i} aria-label={`More actions for ${t.no}`} onClick={() => soon(`Open ${t.no}`)}><Icon name="dots" /></button></div></td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="ptempty">{all.length ? 'No transactions match these filters.' : 'No transactions yet. Create an invoice for this party to see it here.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

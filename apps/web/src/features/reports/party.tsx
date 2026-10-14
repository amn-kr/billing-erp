/** Party reports (prototype RPT.pstmt / ppl / allp / pitem / spp / spg): same markup, wording and maths. */
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { fileTitle, printNow, usePrintSource } from '../print/printer';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { Icon, RawIcon } from '../../components/Icon';
import { useSettings } from '../../lib/settings';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useEscape } from '../../lib/useEscape';
import { qfmt } from '../items/ItemsPage';
import { useShell } from '../shell/store';
import { bzLine, bzName, useBiz } from '../sales/InvoicePreview';
import { choosePer, dmyOf, range, type PeriodState } from './periods';
import { ListToggle, PeriodFields, RpShell, Sel, type RpDef } from './Shell';
import type { RpProps } from './ReportsPage';
import { saveFile, xlsxBlob } from '../../lib/files';

export interface RParty { id: string; name: string; kind: string; group: string; phone: string; city: string; gstin: string; limit: number | null; sup: boolean; type: string; entries: number; sales: boolean }
interface StRow { date: string; no: string; type: string; kind: string; info: string; dr: number; cr: number; run: number; ref?: string; lines: { name: string; qty: number; unit: string; rate: number; amt: number }[] }
interface Statement { party: RParty; from: string; to: string; open: number; rows: StRow[]; dr: number; cr: number; close: number; overdue: number }
interface Act { id: string; name: string; group: string; groupName: string; type: string; sup: boolean; sn: number; sale: number; sr: number; pn: number; pur: number; pr: number; tv: number; cost: number; comm: number }
interface AllP extends Omit<RParty, 'entries' | 'sales'> { balance: number; last: string }

const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const r2 = (v: number) => Math.round(v * 100) / 100;
const rpN = (v: number) => (v ? inr2f(v) : '—');
const dmy = (iso: string) => (iso ? dmyOf(iso) : '');
const qs = (p: PeriodState) => { const [f, t] = range(p); return `from=${f}&to=${t}`; };
const useParties = () => useQuery({ queryKey: ['reports', 'parties'], queryFn: () => api<RParty[]>('/reports/parties') });
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/* the report filters are remembered while the app is open, as in the prototype (PSV / RPF) */
const PSV: { pid: string | null; p: PeriodState; detail: boolean } = { pid: null, p: choosePer('fy'), detail: false };
const RPF = { pplGrp: 'all', apType: 'all', apGrp: 'all', apBal: 'all', piParty: null as string | null, spType: 'all' };
function useRpf<K extends keyof typeof RPF>(k: K): [(typeof RPF)[K], (v: (typeof RPF)[K]) => void] {
  const [v, setV] = useState(RPF[k]);
  return [v, (x) => { RPF[k] = x; setV(x); }];
}
/** Party Statement opens on a party (from the Parties page's "Statement" button). */
export const statementOf = (pid: string) => { PSV.pid = pid; };

const psBal = (v: number): ReactNode => (v === 0 ? '0.00' : <>{inr2f(Math.abs(v))} <small>{v > 0 ? 'Dr' : 'Cr'}</small></>);
const psBalT = (v: number) => (v ? `${inr2f(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}` : '0.00');
const psWord = (v: number, sup: boolean) => (v > 0 ? (sup ? 'You are owed' : 'To receive') : v < 0 ? (sup ? 'To pay' : 'Advance / to pay') : 'Settled');

/* ---------- Party Statement ---------- */
function PStmt({ onToggle }: RpProps) {
  const parties = useParties();
  const biz = useBiz().data;
  const nav = useNavigate();
  const { showToast } = useShell();
  const [pidS, setPid] = useState(PSV.pid);
  const [p, setPs] = useState(PSV.p);
  const [detail, setDetail] = useState(PSV.detail);
  const [printing, setPrinting] = useState(false);
  const all = (parties.data ?? []).slice().sort(byName);
  const pid = pidS && all.some((x) => x.id === pidS) ? pidS : (all.find((x) => !x.sup && x.entries) ?? all[0])?.id ?? null;
  const st = useQuery({ queryKey: ['reports', 'statement', pid, qs(p)], queryFn: () => api<Statement>(`/reports/statement/${pid}?${qs(p)}`), enabled: !!pid });
  if (!parties.data) return null;
  if (!pid) return <p className="mu">Add a party first.</p>;
  const D = st.data && st.data.party.id === pid ? st.data : null;
  if (!D) return null;
  const P = D.party, sup = P.sup;
  const setP = (x: PeriodState) => {
    // switching to Custom keeps the range shown (an open end becomes this year / today)
    const n = x.per === 'custom' && p.per !== 'custom' ? (() => { const [f, t] = range(p); return { per: 'custom' as const, from: f < '2001' ? x.from : f, to: t > '2098' ? x.to : t }; })() : x;
    PSV.p = n; setPs(n);
  };
  const grp = (lbl: string, L: RParty[]) => (L.length ? <optgroup label={lbl}>{L.map((x) => <option value={x.id} key={x.id}>{x.name}{x.city ? ' · ' + x.city : ''}</option>)}</optgroup> : null);
  const title = `${P.name} · ${dmyOf(D.from).replace('01/01/2000', 'start')} to ${dmyOf(D.to).replace('31/12/2099', 'today')}`;
  const open = (r: StRow) => {
    if (r.type === 'Sale' && r.ref) nav('/sales', { state: { preview: r.ref } });
    else if (r.type === 'Payment-In') nav('/payments-received', { state: { view: r.no } });
    else if (r.type === 'Credit note') nav('/credit-notes', { state: { view: r.no } });
  };
  const xls = async () => {
    const rows: (string | number)[][] = [[bzName(biz)], [`Party statement · ${title}`], [], ['Date', 'Type', 'Txn no.', 'Details', 'Debit', 'Credit', 'Balance', 'Dr/Cr'], ['', 'Opening balance', '', '', '', '', Math.abs(D.open), D.open > 0 ? 'Dr' : D.open < 0 ? 'Cr' : '']];
    D.rows.forEach((e) => rows.push([dmy(e.date), e.kind, e.no === '—' ? '' : e.no, e.info || '', e.dr || '', e.cr || '', Math.abs(e.run), e.run > 0 ? 'Dr' : e.run < 0 ? 'Cr' : '']));
    rows.push([]); rows.push(['', 'Total', '', '', D.dr, D.cr, Math.abs(D.close), D.close > 0 ? 'Dr' : D.close < 0 ? 'Cr' : '']);
    saveFile(`Statement-${P.name.replace(/[^\w]+/g, '-')}.xlsx`, await xlsxBlob([{ name: 'Statement', rows, widths: [12, 18, 14, 34, 14, 14, 14, 6], freeze: 4, styles: { 0: 3, 3: 1, [rows.length - 1]: 1 }, money: [4, 5, 6] }]));
  };
  const pdf = async () => {
    const o: RpDef = { title: 'Party statement', group: '', sub: P.name, cols: [{ h: 'Date', w: 12 }, { h: 'Type', w: 22 }, { h: 'No.', w: 16 }, { h: 'Debit', n: true }, { h: 'Credit', n: true }, { h: 'Balance', n: true }],
      rows: [{ c: ['', 'Opening balance', '', '', '', psBalT(D.open)] }, ...D.rows.map((e) => ({ c: [dmy(e.date), e.kind, e.no === '—' ? '' : e.no, e.dr ? inr2f(e.dr) : '', e.cr ? inr2f(e.cr) : '', psBalT(e.run)] }))], foot: ['', 'Total', '', inr2f(D.dr), inr2f(D.cr), psBalT(D.close)] };
    const { rpPdf } = await import('./Shell');
    await rpPdf({ ...o }, p, biz);
  };
  const wa = () => {
    if (!P.phone) return showToast('No mobile number saved for this party');
    const msg = `Dear ${P.name},\nYour account statement (${dmyOf(D.from).replace('01/01/2000', 'start')} to ${dmyOf(D.to).replace('31/12/2099', 'today')}):\nOpening: ${inr2f(Math.abs(D.open))} ${D.open > 0 ? 'Dr' : D.open < 0 ? 'Cr' : ''}\n${sup ? 'Payments' : 'Bills'}: ${inr2f(D.dr)}\n${sup ? 'Bills' : 'Payments received'}: ${inr2f(D.cr)}\nBalance: ${inr2f(Math.abs(D.close))} ${D.close > 0 ? (sup ? 'Dr' : 'due from you') : D.close < 0 ? (sup ? 'payable by us' : 'advance with us') : ''}\n— ${bzName(biz)}`;
    window.open(`https://wa.me/91${P.phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };
  const clk = (t: string) => t === 'Sale' || t === 'Payment-In' || t === 'Credit note';
  return (
    <>
      <div className="psh"><ListToggle onToggle={onToggle} /><div><small className="mu">Party report</small><h2>Party Statement</h2></div>
        <div className="psa"><button className="btn sm" id="psWa" onClick={wa}><Icon name="chat" />WhatsApp</button><button className="btn sm" id="psPrint" onClick={() => setPrinting(true)}><Icon name="doc" />Print</button><button className="btn sm" id="psPdf" onClick={() => void pdf()}>PDF</button><button className="btn sm" id="psXls" onClick={() => void xls()}>Excel</button></div></div>
      <div className="psf"><label className="fl" htmlFor="psParty">Party<select className="fi" id="psParty" value={pid} onChange={(e) => { PSV.pid = e.target.value; setPid(e.target.value); }}>{grp('Customers', all.filter((x) => !x.sup && x.group !== 'Electricians'))}{grp('Electricians', all.filter((x) => x.group === 'Electricians'))}{grp('Suppliers', all.filter((x) => x.sup))}</select></label>
        <PeriodFields p={p} set={setP} ids={['psPer', 'psFrom', 'psTo']} />
        <label className="cb2 psdet"><input type="checkbox" id="psDet" checked={detail} onChange={(e) => { PSV.detail = e.target.checked; setDetail(e.target.checked); }} /> Show items</label></div>
      <div className="pscard"><div className="psid"><span className="psav">{P.name.trim().charAt(0).toUpperCase()}</span><div><b>{P.name}</b><small>{[P.phone && '+91 ' + P.phone, P.city, P.group, P.gstin && 'GSTIN ' + P.gstin].filter(Boolean).join(' · ')}</small></div></div>
        <div className="psk"><div><small>Opening balance</small><b>{psBal(D.open)}</b></div><div><small>{sup ? 'Payments & returns' : 'Bills & charges'} <span className="mu">(Dr)</span></small><b>{inr2f(D.dr)}</b></div><div><small>{sup ? 'Bills' : 'Payments & returns'} <span className="mu">(Cr)</span></small><b>{inr2f(D.cr)}</b></div>
          <div className={`pscl ${D.close > 0 && !sup ? 'neg' : D.close < 0 && sup ? 'neg' : 'pos'}`}><small>Closing balance · {psWord(D.close, sup)}</small><b>{psBal(D.close)}</b>{D.overdue > 0 ? <em>{inr2f(D.overdue)} overdue</em> : null}</div></div></div>
      <div className="tw pst"><table className="ptt2"><thead><tr><th>Date</th><th>Type</th><th>Txn no.</th><th>Details</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></tr></thead><tbody>
        <tr className="psop"><td>{dmyOf(D.from).replace('01/01/2000', '—')}</td><td colSpan={5}><b>Opening balance</b></td><td className="n"><b>{psBal(D.open)}</b></td></tr>
        {D.rows.length ? D.rows.map((e, i) => {
          const L = detail ? e.lines : [];
          return [
            <tr className={clk(e.type) ? 'psclk' : ''} data-pst={e.type} data-psno={e.no} tabIndex={0} key={i} onClick={() => open(e)} onKeyDown={(ev) => { if (ev.key === 'Enter') open(e); }}><td>{dmy(e.date)}</td><td>{e.kind}</td><td className="mono">{e.no === '—' ? '' : e.no}</td><td className="mu">{e.info || ''}</td><td className="n">{e.dr ? inr2f(e.dr) : ''}</td><td className="n pos">{e.cr ? inr2f(e.cr) : ''}</td><td className="n"><b>{psBal(e.run)}</b></td></tr>,
            L.length ? <tr className="psit" key={i + 'i'}><td></td><td colSpan={6}><table><tbody>{L.map((l, j) => <tr key={j}><td>{l.name}</td><td className="n">{qfmt(l.qty)} {l.unit || ''}</td><td className="n">× {inr2f(l.rate)}</td><td className="n">{inr2f(l.amt)}</td></tr>)}</tbody></table></td></tr> : null,
          ];
        }) : <tr><td colSpan={7} className="ptempty">No transactions in this period.</td></tr>}
      </tbody><tfoot><tr><td colSpan={4}><b>Total</b> <span className="mu">· {D.rows.length} transaction{D.rows.length === 1 ? '' : 's'}</span></td><td className="n"><b>{inr2f(D.dr)}</b></td><td className="n"><b>{inr2f(D.cr)}</b></td><td className="n"><b>{psBal(D.close)}</b></td></tr></tfoot></table></div>
      <p className="hint" style={{ margin: '10px 0 0' }}>Dr = {sup ? 'you paid or returned' : 'bills and charges'} · Cr = {sup ? 'their bills' : 'payments and returns'}. Click a bill, receipt or credit note to open it.</p>
      {printing ? <StPrint D={D} onClose={() => setPrinting(false)} /> : null}
    </>
  );
}

/** Print view of a statement (prototype psPrint). */
function StPrint({ D, onClose }: { D: Statement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const biz = useBiz().data;
  const gst = !!useSettings().data?.gstEnabled;
  useOpenFocus(true, ref);
  useEscape(true, onClose);
  const P = D.party, sup = P.sup;
  usePrintSource(true, { el: () => document.getElementById('ipvSheet'), title: fileTitle('Party statement', P.name) });
  const span = `${dmyOf(D.from).replace('01/01/2000', 'Start')} to ${dmyOf(D.to).replace('31/12/2099', 'Today')}`;
  return (
    <div className="ov c" id="ipv" ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'ipv') onClose(); }}>
      <div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle">
        <div className="ipvbar"><h3 id="ipvTitle" style={{ margin: 0, fontSize: 16, flex: 1 }}>Party statement · {P.name}</h3>
          <button className="btn sm" type="button" id="ipvLink" hidden style={{ display: 'none' }}><Icon name="phone" />Payment link</button>
          <a className="btn sm" id="ipvWa" href="#" target="_blank" rel="noopener" style={{ textDecoration: 'none', display: 'none' }}><svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: '<path d="M4 5h16v11H9l-5 4z"/>' }} />Share on WhatsApp</a>
          <button className="btn sm" type="button" id="ipvPrint" onClick={printNow}><RawIcon d={PRINT} />Print</button>
          <button className="btn p sm" type="button" id="ipvNew" style={{ display: 'none' }}><Icon name="plus" />New invoice</button>
          <button className="ib" type="button" id="ipvClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="ivsheet" id="ipvSheet"><div className="dch"><div className="dchh"><div><b>{bzName(biz)}</b><small>{bzLine(biz)}</small>{gst && biz?.gstin ? <small>GSTIN {biz.gstin}</small> : null}</div><div className="dcht"><span>PARTY STATEMENT</span><small>{span}</small></div></div>
          <div className="dchp"><span>Statement of</span><b>{P.name}</b><small>{[P.phone && '+91 ' + P.phone, P.city, P.gstin && 'GSTIN ' + P.gstin].filter(Boolean).join(' · ')}</small></div>
          <table className="ivtab"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></tr></thead><tbody><tr><td></td><td colSpan={4}><b>Opening balance</b></td><td className="n">{psBal(D.open)}</td></tr>
            {D.rows.map((e, i) => <tr key={i}><td>{dmy(e.date)}</td><td>{e.kind}</td><td>{e.no === '—' ? '' : e.no}</td><td className="n">{e.dr ? inr2f(e.dr) : ''}</td><td className="n">{e.cr ? inr2f(e.cr) : ''}</td><td className="n">{psBal(e.run)}</td></tr>)}
            <tr className="dchtot"><td></td><td colSpan={2}>Total</td><td className="n">{inr2f(D.dr)}</td><td className="n">{inr2f(D.cr)}</td><td className="n">{psBal(D.close)}</td></tr></tbody></table>
          <p className="ivdesc"><b>Closing balance: {inr2f(Math.abs(D.close))} {D.close > 0 ? 'Dr' : D.close < 0 ? 'Cr' : ''}</b> — {psWord(D.close, sup)}.</p></div></div>
      </div>
    </div>
  );
}

/* ---------- Party wise Profit & Loss ---------- */
const groupsOf = (L: { group: string }[]) => [...new Set(L.map((p) => p.group || 'General'))].sort();
function useAct(p: PeriodState) { return useQuery({ queryKey: ['reports', 'activity', qs(p)], queryFn: () => api<Act[]>(`/reports/party-activity?${qs(p)}`) }); }

function Ppl(props: RpProps) {
  const act = useAct(props.p);
  const [grp, setGrp] = useRpf('pplGrp');
  if (!act.data) return null;
  const R = act.data.filter((x) => !x.sup && (grp === 'all' || x.groupName === grp) && x.sn).map((x) => { const prof = r2(x.tv - x.cost - x.comm); return { ...x, prof, m: x.tv ? (prof / x.tv) * 100 : 0 }; }).sort((a, b) => b.prof - a.prof);
  const T = (k: 'tv' | 'cost' | 'comm' | 'prof') => r2(R.reduce((a, r) => a + r[k], 0)), ts = T('tv'), tp = T('prof');
  const def: RpDef = {
    title: 'Party wise Profit & Loss', group: 'Party report', sub: grp === 'all' ? '' : grp,
    filters: <label className="fl" htmlFor="rpG">Party group<select className="fi" id="rpG" value={grp} onChange={(e) => setGrp(e.target.value)}><option value="all">All groups</option>{groupsOf(act.data).filter((g) => g !== 'Suppliers').map((g) => <option key={g}>{g}</option>)}</select></label>,
    kpis: [[<>Sale value <span className="mu">(excl. GST)</span></>, inr2f(ts)], ['Cost of goods', inr2f(T('cost'))], ['Commission', inr2f(T('comm'))], ['Profit', inr2f(tp), tp >= 0 ? 'pscl pos' : 'pscl neg', ts ? `${((tp / ts) * 100).toFixed(1)}% margin` : '']],
    cols: [{ h: 'Party', w: 26 }, { h: 'Group', w: 16 }, { h: 'Bills', n: true, int: true, w: 7 }, { h: 'Sale value', n: true }, { h: 'Cost', n: true }, { h: 'Commission', n: true, w: 12 }, { h: 'Profit', n: true }, { h: 'Margin %', n: true, int: true, w: 10 }],
    rows: R.map((r) => ({ k: r.id, c: [r.name, r.groupName || '', r.sn, inr2f(r.tv), inr2f(r.cost), rpN(r.comm), inr2f(r.prof), r.m.toFixed(1) + '%'], h: { 6: <b className={r.prof < 0 ? 'neg' : 'pos'}>{inr2f(r.prof)}</b>, 7: <span className={r.m < 5 ? 'neg' : ''}>{r.m.toFixed(1)}%</span> } })),
    foot: ['Total', '', R.reduce((a, r) => a + r.sn, 0), inr2f(ts), inr2f(T('cost')), rpN(T('comm')), inr2f(tp), ts ? ((tp / ts) * 100).toFixed(1) + '%' : ''],
    note: 'Sale value is before GST and after goods returned on credit notes. Cost uses each item’s purchase price. Commission is the electrician commission on referred bills. Click a party for its statement.',
    click: (k) => { statementOf(k); props.open('pstmt'); },
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

/* ---------- All parties ---------- */
function AllParties(props: RpProps) {
  const q = useQuery({ queryKey: ['reports', 'all-parties'], queryFn: () => api<AllP[]>('/reports/all-parties') });
  const [ty, setTy] = useRpf('apType'), [grp, setGrp] = useRpf('apGrp'), [bal, setBal] = useRpf('apBal');
  if (!q.data) return null;
  const R = q.data.filter((p) => (ty === 'all' || (ty === 's' ? p.sup : !p.sup)) && (grp === 'all' || p.group === grp))
    .filter((r) => bal === 'all' || (bal === 'rec' ? r.balance > 0.009 : bal === 'pay' ? r.balance < -0.009 : Math.abs(r.balance) < 0.01)).sort(byName);
  const rec = r2(R.filter((r) => r.balance > 0).reduce((a, r) => a + r.balance, 0)), pay = r2(R.filter((r) => r.balance < 0).reduce((a, r) => a - r.balance, 0));
  const def: RpDef = {
    title: 'All parties', group: 'Party report', period: false,
    filters: <><Sel id="rpAt" label="Type" opts={[['all', 'All parties'], ['c', 'Customers'], ['s', 'Suppliers']]} value={ty} onChange={setTy} />
      <label className="fl" htmlFor="rpAg">Group<select className="fi" id="rpAg" value={grp} onChange={(e) => setGrp(e.target.value)}><option value="all">All groups</option>{groupsOf(q.data).map((g) => <option key={g}>{g}</option>)}</select></label>
      <Sel id="rpAb" label="Balance" opts={[['all', 'Any balance'], ['rec', 'To receive'], ['pay', 'To pay'], ['zero', 'Settled']]} value={bal} onChange={setBal} /></>,
    kpis: [['Parties', String(R.length)], ['To receive', inr2f(rec), 'pscl neg'], ['To pay', inr2f(pay), 'pscl neg'], ['Net', inr2f(Math.abs(rec - pay)) + (rec - pay >= 0 ? ' Dr' : ' Cr')]],
    cols: [{ h: 'Party', w: 24 }, { h: 'Type', w: 11 }, { h: 'Group', w: 15 }, { h: 'Mobile', w: 13 }, { h: 'City', w: 12 }, { h: 'GSTIN', w: 17 }, { h: 'Credit limit', n: true, w: 12 }, { h: 'Last txn', w: 11 }, { h: 'Balance', n: true }],
    rows: R.map((r) => ({ k: r.id, c: [r.name, r.type, r.group || '', r.phone || '', r.city || '', r.gstin || '', r.limit ? inr2f(r.limit) : '—', dmy(r.last), r.balance ? `${inr2f(Math.abs(r.balance))} ${r.balance > 0 ? 'Dr' : 'Cr'}` : '0.00'],
      h: { 8: r.balance ? <><b className={r.balance > 0 ? (r.sup ? 'pos' : 'neg') : r.sup ? 'neg' : 'pos'}>{inr2f(Math.abs(r.balance))}</b> <small>{r.balance > 0 ? (r.sup ? 'Dr' : 'receive') : r.sup ? 'pay' : 'Cr adv'}</small></> : <span className="mu">0.00</span> } })),
    foot: ['Total', String(R.length) + ' parties', '', '', '', '', '', '', `${inr2f(Math.abs(rec - pay))} ${rec - pay >= 0 ? 'Dr' : 'Cr'}`],
    note: 'Balance: Dr = they owe you, Cr = you owe them (or advance). Click a party for its statement.',
    click: (k) => { statementOf(k); props.open('pstmt'); },
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

/* ---------- Party Report By Item ---------- */
interface PItems { party: RParty; rows: { name: string; cat: string; unit: string; sq: number; sa: number; pq: number; pa: number }[] }
function PItem(props: RpProps) {
  const parties = useParties();
  const [pidS, setPid] = useRpf('piParty');
  const all = (parties.data ?? []).slice().sort(byName);
  const pid = pidS && all.some((x) => x.id === pidS) ? pidS : (all.find((x) => !x.sup && x.sales) ?? all[0])?.id ?? null;
  const q = useQuery({ queryKey: ['reports', 'party-items', pid, qs(props.p)], queryFn: () => api<PItems>(`/reports/party-items/${pid}?${qs(props.p)}`), enabled: !!pid });
  if (!parties.data) return null;
  const base = { p: props.p, setP: props.setP, onToggle: props.onToggle };
  if (!pid) { const d: RpDef = { title: 'Party Report By Item', group: 'Party report', cols: [{ h: 'Item' }, { h: 'Qty', n: true }, { h: 'Amount', n: true }], rows: [], empty: 'Add a party and make a sale to see this report.' }; return <RpShell o={d} {...base} onPrint={() => props.onPrint(d)} />; }
  if (!q.data || q.data.party.id !== pid) return null;
  const R = q.data.rows, P = q.data.party;
  const grp = (lbl: string, L: RParty[]) => (L.length ? <optgroup label={lbl}>{L.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</optgroup> : null);
  const S = (k: 'sq' | 'sa' | 'pa') => R.reduce((a, r) => a + r[k], 0);
  const def: RpDef = {
    title: 'Party Report By Item', group: 'Party report', sub: P.name,
    filters: <label className="fl" htmlFor="rpPi">Party<select className="fi" id="rpPi" value={pid} onChange={(e) => setPid(e.target.value)}>{grp('Customers', all.filter((x) => !x.sup))}{grp('Suppliers', all.filter((x) => x.sup))}</select></label>,
    kpis: [['Items', String(R.length)], ['Sale qty', qfmt(S('sq'))], ['Sale amount', inr2f(S('sa'))], ['Purchase amount', inr2f(S('pa'))]],
    cols: [{ h: 'Item', w: 30 }, { h: 'Category', w: 16 }, { h: 'Sale qty', n: true, int: true, w: 10 }, { h: 'Sale amount', n: true }, { h: 'Purchase qty', n: true, int: true, w: 11 }, { h: 'Purchase amount', n: true }],
    rows: R.map((r) => ({ c: [r.name, r.cat, r.sq ? qfmt(r.sq) + ' ' + r.unit : '—', rpN(r.sa), r.pq ? qfmt(r.pq) + ' ' + r.unit : '—', rpN(r.pa)] })),
    foot: ['Total', '', '', inr2f(S('sa')), '', inr2f(S('pa'))], empty: 'No items bought or sold with this party in this period.',
    note: 'Amounts include GST.',
  };
  return <RpShell o={def} {...base} onPrint={() => props.onPrint(def)} />;
}

/* ---------- Sale Purchase By Party ---------- */
function Spp(props: RpProps) {
  const act = useAct(props.p);
  const [ty, setTy] = useRpf('spType');
  if (!act.data) return null;
  const R = act.data.filter((x) => (ty === 'all' || (ty === 's' ? x.sup : !x.sup)) && (x.sn || x.pn || x.sr || x.pr)).sort((a, b) => b.sale + b.pur - (a.sale + a.pur));
  const T = (k: 'sn' | 'sale' | 'sr' | 'pn' | 'pur' | 'pr') => r2(R.reduce((a, r) => a + r[k], 0));
  const def: RpDef = {
    title: 'Sale Purchase By Party', group: 'Party report',
    filters: <Sel id="rpSt" label="Parties" opts={[['all', 'All parties'], ['c', 'Customers'], ['s', 'Suppliers']]} value={ty} onChange={setTy} />,
    kpis: [['Sales', inr2f(T('sale')), '', `${T('sn')} bills`], ['Sale returns', inr2f(T('sr'))], ['Purchases', inr2f(T('pur')), '', `${T('pn')} bills`], ['Purchase returns', inr2f(T('pr'))]],
    cols: [{ h: 'Party', w: 26 }, { h: 'Type', w: 11 }, { h: 'Sale bills', n: true, int: true, w: 9 }, { h: 'Sale amount', n: true }, { h: 'Sale returns', n: true, w: 12 }, { h: 'Purchase bills', n: true, int: true, w: 10 }, { h: 'Purchase amount', n: true }, { h: 'Purchase returns', n: true, w: 13 }],
    rows: R.map((r) => ({ k: r.id, c: [r.name, r.type, r.sn || '—', rpN(r.sale), rpN(r.sr), r.pn || '—', rpN(r.pur), rpN(r.pr)] })),
    foot: ['Total', '', T('sn'), inr2f(T('sale')), rpN(T('sr')), T('pn'), inr2f(T('pur')), rpN(T('pr'))], note: 'Amounts include GST. Cancelled bills are left out. Click a party for its statement.',
    click: (k) => { statementOf(k); props.open('pstmt'); },
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

/* ---------- Sale Purchase By Party Group ---------- */
function Spg(props: RpProps) {
  const act = useAct(props.p);
  if (!act.data) return null;
  const G = new Map<string, { g: string; np: number; act: number; sn: number; sale: number; sr: number; pn: number; pur: number; pr: number }>();
  for (const x of act.data) {
    const o2 = G.get(x.group) ?? { g: x.group, np: 0, act: 0, sn: 0, sale: 0, sr: 0, pn: 0, pur: 0, pr: 0 };
    o2.np++; if (x.sn || x.pn) o2.act++;
    o2.sn += x.sn; o2.sale += x.sale; o2.sr += x.sr; o2.pn += x.pn; o2.pur += x.pur; o2.pr += x.pr;
    G.set(x.group, o2);
  }
  const R = [...G.values()].map((x) => ({ ...x, sale: r2(x.sale), pur: r2(x.pur), sr: r2(x.sr), pr: r2(x.pr) })).sort((a, b) => b.sale + b.pur - (a.sale + a.pur));
  const T = (k: 'np' | 'act' | 'sn' | 'sale' | 'sr' | 'pur' | 'pr') => r2(R.reduce((a, r) => a + r[k], 0)), ts = T('sale');
  const top = R.slice().sort((a, b) => b.sale - a.sale)[0];
  const def: RpDef = {
    title: 'Sale Purchase By Party Group', group: 'Party report',
    kpis: [['Groups', String(R.length)], ['Sales', inr2f(ts)], ['Purchases', inr2f(T('pur'))], ['Top group', top && top.sale ? top.g : '—', '', top && ts && top.sale ? `${((top.sale / ts) * 100).toFixed(0)}% of sales` : '']],
    cols: [{ h: 'Party group', w: 22 }, { h: 'Parties', n: true, int: true, w: 9 }, { h: 'Active', n: true, int: true, w: 8 }, { h: 'Sale bills', n: true, int: true, w: 9 }, { h: 'Sale amount', n: true }, { h: 'Share', n: true, int: true, w: 8 }, { h: 'Sale returns', n: true, w: 12 }, { h: 'Purchase amount', n: true }, { h: 'Purchase returns', n: true, w: 12 }],
    rows: R.map((r) => ({ k: r.g, c: [r.g, r.np, r.act, r.sn || '—', rpN(r.sale), ts && r.sale ? ((r.sale / ts) * 100).toFixed(1) + '%' : '—', rpN(r.sr), rpN(r.pur), rpN(r.pr)],
      h: { 5: ts && r.sale ? <><span className="rpbar"><i style={{ width: `${Math.max(4, (r.sale / ts) * 100)}%` }}></i></span>{((r.sale / ts) * 100).toFixed(1)}%</> : '—' } })),
    foot: ['Total', T('np'), T('act'), T('sn'), inr2f(ts), '100%', rpN(T('sr')), inr2f(T('pur')), rpN(T('pr'))], note: 'Amounts include GST. Click a group to see its parties in All parties.',
    click: (k) => { RPF.apGrp = k; RPF.apType = 'all'; RPF.apBal = 'all'; props.open('allp'); },
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

export const PartyReports: Record<string, ComponentType<RpProps>> = { pstmt: PStmt, ppl: Ppl, allp: AllParties, pitem: PItem, spp: Spp, spg: Spg };

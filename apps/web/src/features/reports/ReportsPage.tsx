/**
 * Reports (#vRep, prototype renderRep): the catalogue on the left with a search, the chosen
 * report on the right. The 9 reports the prototype built are rebuilt; the others show the
 * prototype's "This report is being built". The chosen report is kept in the address (?r=).
 */
import { Fragment, useEffect, useRef, useState, type ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon, RawIcon } from '../../components/Icon';
import { useFitTables } from '../../lib/useFitTables';
import { REPS, repOf } from './catalogue';
import { choosePer, type PeriodState } from './periods';
import { RpPrint, type RpDef } from './Shell';
import { PartyReports } from './party';
import { ExpenseReports } from './expense';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';

/** What each rebuilt report gets: the shared period, the list toggle and the print window. */
export interface RpProps { sel: string; p: PeriodState; setP: (p: PeriodState) => void; onToggle: () => void; onPrint: (o: RpDef) => void; open: (key: string) => void }
const BUILT: Record<string, ComponentType<RpProps>> = { ...PartyReports, ...ExpenseReports };

const readFull = () => { try { return !!localStorage.getItem('erp-rpfull'); } catch { return false; } };

export function ReportsPage() {
  useFitTables();
  const [sp, setSp] = useSearchParams();
  const sel = repOf(sp.get('r') ?? '') ? sp.get('r')! : 'sale';
  const f = repOf(sel)!;
  const [q, setQ] = useState('');
  const [full, setFull] = useState(readFull);
  const [p, setP] = useState<PeriodState>(() => choosePer('fy'));
  const [print, setPrint] = useState<RpDef | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const open = (key: string) => setSp({ r: key });
  const toggle = () => setFull((v) => { try { localStorage.setItem('erp-rpfull', v ? '' : '1'); } catch { /* private window */ } return !v; });

  // coming from a sidebar section: the list scrolls to that section (prototype go('rep'))
  const sec = f.sec;
  useEffect(() => {
    const h = document.getElementById('rps-' + sec), L = listRef.current;
    if (h && L) L.scrollTop = h.offsetTop - L.offsetTop;
  }, [sec]);
  // a search clears when a sidebar section is chosen
  useEffect(() => { if (sp.get('sec')) { setQ(''); const n = new URLSearchParams(sp); n.delete('sec'); setSp(n, { replace: true }); } }, [sp, setSp]);

  const ql = q.toLowerCase();
  const lists = REPS.map(([k, h, L]) => [k, h, L.filter((r) => !ql || r[1].toLowerCase().includes(ql) || r[2].toLowerCase().includes(ql))] as const).filter((g) => g[2].length);
  const Rp = BUILT[sel];
  return (
    <section id="vRep">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Reports</h1><span className="pttot">{REPS.reduce((a, g) => a + g[2].length, 0)} reports</span></div>
      <div className={full ? 'rpw rpfull' : 'rpw'}>
        <aside className="card rpl"><label className="search rps" htmlFor="rpQ"><RawIcon d={SEARCH} /><input id="rpQ" placeholder="Search reports" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <nav id="rpList" aria-label="Reports" ref={listRef}>
            {lists.length ? lists.map(([k, h, L]) => (
              <Fragment key={k}>
                <div className="rph" id={'rps-' + k}>{h}</div>
                {L.map((r) => <button type="button" className={r[0] === sel ? 'rpi on' : 'rpi'} data-rp={r[0]} aria-current={r[0] === sel ? 'page' : undefined} key={r[0]} onClick={() => { open(r[0]); if (innerWidth < 900) document.getElementById('rpMain')?.scrollIntoView({ block: 'start' }); }}>{r[1]}</button>)}
              </Fragment>
            )) : <p className="mu" style={{ padding: 12, margin: 0 }}>No report matches.</p>}
          </nav></aside>
        <div className="card rpm" id="rpMain">
          {Rp ? <Rp sel={sel} p={p} setP={setP} onToggle={toggle} onPrint={setPrint} open={open} /> : (
            <><div className="rpmh"><div><small className="mu">{f.group}</small><h2>{f.title}</h2><p className="mu">{f.desc}</p></div></div>
              <div className="rpsoon"><Icon name="chart" /><b>This report is being built</b><span>It will show live figures from your invoices, purchases, payments and stock.</span></div></>
          )}
        </div>
      </div>
      <RpPrint o={print} p={p} onClose={() => setPrint(null)} />
    </section>
  );
}

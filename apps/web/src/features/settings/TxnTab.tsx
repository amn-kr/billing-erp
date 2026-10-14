/**
 * Settings › Transactions: the Transaction header switches (kept in the settings JSON) and the
 * Transaction prefixes of the open business (several per document type, one active).
 * Built from the prototype's Taxes & GST card and its Tax list dialog (#tl).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, PREFIX_HELP, PREFIX_RE, prefixesClash } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon } from '../../components/Icon';
import { P } from '../../components/icon-paths';
import { useShell } from '../shell/store';
import { Sw, useS, useSaveS } from './model';

const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });
const shown = (p: string) => p || 'None';
const mono = { fontSize: 13.5, letterSpacing: 0, width: 'auto' } as const;

interface Prefix { id: string; prefix: string; active: boolean; used: number; next: string }
interface PType { docType: string; label: string; prefixes: Prefix[] }
interface Prefixes { business: string; types: PType[] }

export function TxnCards() {
  const { S } = useS();
  const save = useSaveS();
  const { showToast } = useShell();
  const d = S as unknown as Record<string, unknown>;
  const opt = (id: string, key: string, on: boolean, t: string, desc: string) => (
    <div className="opt"><div className="tx"><b>{t}</b><small>{desc}</small></div><Sw id={id} on={on} label={t} onChange={(v) => { void save({ data: { [key]: v } }); showToast('Saved'); }} /></div>
  );
  return (
    <>
      <section className="card" id="cTxHead">
        <div className="tgl" style={{ marginTop: 0 }}><div className="ti" style={T('var(--ac)')}><Icon name="receipt" /></div><div className="tx"><b>Transaction header</b><small>What the top of a sale shows on the entry screen and the printed bill. Changes save on their own.</small></div></div>
        <div className="opts">
          {opt('tInvNo', 'txnInvNo', d.txnInvNo !== false, 'Invoice / bill number', 'Show the number on the entry screen and on the printed bill. When off, the number is hidden but every document still gets one.')}
          {opt('tTime', 'txnTime', !!d.txnTime, 'Add time on transactions', 'Show the time the bill was saved next to its date, for example 14 Oct 2026 · 4:35 pm. Bills brought in from the old app show only the date.')}
          {opt('tCash', 'txnCash', !!d.txnCash, 'Cash sale by default', 'A new sale opens with Cash selected instead of a customer on credit.')}
          {opt('tBill', 'txnBillName', !!d.txnBillName, 'Billing name of parties', 'Adds a “Billing name” field to the party form. Bills show it under Bill To; if it is empty, the party name is used.')}
        </div>
      </section>
      <PrefixCard />
    </>
  );
}

function PrefixCard() {
  const q = useQuery({ queryKey: ['prefixes'], queryFn: () => api<Prefixes>('/settings/prefixes') });
  const [open, setOpen] = useState<string | null>(null);
  const types = q.data?.types ?? [];
  return (
    <section className="card" id="cTxPre">
      <div className="tgl" style={{ marginTop: 0 }}><div className="ti" style={T('var(--blue)')}><Icon name="menu" /></div><div className="tx"><b>Transaction prefixes</b><small>Prefixes for: <b style={{ display: 'inline', fontSize: 'inherit' }} id="pxBiz">{q.data?.business ?? ''}</b>. The active prefix is used for new documents only — old documents keep their numbers.</small></div></div>
      <div className="tw" style={{ marginTop: 14 }}><table className="tlt" id="pxTable"><thead><tr><th>Document</th><th>Active prefix</th><th>Next number</th><th className="n">Prefixes</th><th className="n"><span className="vh">Manage</span></th></tr></thead>
        <tbody>
          {types.map((t) => {
            const a = t.prefixes.find((p) => p.active);
            return (
              <tr key={t.docType} data-px={t.docType}><td><b>{t.label}</b></td><td>{a ? <span className="mono" style={mono}>{shown(a.prefix)}</span> : null}</td><td className="mu">{a?.next}</td><td className="n">{t.prefixes.length}</td>
                <td className="n"><button className="btn sm" type="button" onClick={() => setOpen(t.docType)}>Manage</button></td></tr>
            );
          })}
        </tbody></table></div>
      <PrefixDialog t={types.find((x) => x.docType === open) ?? null} business={q.data?.business ?? ''} onClose={() => setOpen(null)} />
    </section>
  );
}

/** One document type's prefixes: used ones are locked; unused ones can be edited or deleted. */
function PrefixDialog({ t, business, onClose }: { t: PType | null; business: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const open = !!t;
  const ref = useRef<HTMLDivElement>(null);
  const [f, setF] = useState({ prefix: '', active: true });
  const [ed, setEd] = useState<{ id: string; v: string } | null>(null);
  const [m, setM] = useState<{ c: string; t: string }>({ c: 'msg', t: '' });
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    setF({ prefix: '', active: true }); setEd(null); setM({ c: 'msg', t: '' });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!t) return <div className="ov c" id="px" ref={ref} hidden><div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby="pxT"></div></div>;
  const word = t.label.toLowerCase();
  // the same checks as the server, so most mistakes show before saving
  const check = (p: string, exceptId?: string) => {
    if (!PREFIX_RE.test(p)) return PREFIX_HELP;
    const hit = t.prefixes.find((x) => x.id !== exceptId && prefixesClash(x.prefix, p));
    if (!hit) return '';
    return hit.prefix.toUpperCase() === p.toUpperCase() ? `${t.label} already has the prefix ${shown(hit.prefix)}.` : `${shown(p)} could make the same numbers as ${shown(hit.prefix)}. Choose a different prefix.`;
  };
  const run = async (call: Promise<Prefixes>, ok: string) => {
    try {
      qc.setQueryData(['prefixes'], await call);
      showToast(ok);
      return true;
    } catch (e) {
      setM({ c: 'msg bad', t: e instanceof ApiError ? e.message : 'Could not save the prefix.' });
      return false;
    }
  };
  const p = f.prefix.trim();
  const bad = check(p);
  const preview = bad ? { c: 'msg bad', t: bad } : { c: 'msg good', t: `Next ${word} number will be ${formatNumber(p, 1)}${p ? '' : ' (no prefix)'} · ${PREFIX_HELP.toLowerCase()}` };
  async function add(e: FormEvent) {
    e.preventDefault();
    if (bad) return setM({ c: 'msg bad', t: bad });
    if (await run(api<Prefixes>('/settings/prefixes', { body: { docType: t!.docType, prefix: p, active: f.active } }), `${shown(p)} added${f.active ? ' and active' : ''}`)) {
      setF({ prefix: '', active: true }); setM({ c: 'msg', t: '' });
    }
  }
  const saveEdit = async (x: Prefix) => {
    const v = ed!.v.trim();
    const why = check(v, x.id);
    if (why) return setM({ c: 'msg bad', t: why });
    if (await run(api<Prefixes>(`/settings/prefixes/${x.id}`, { method: 'PATCH', body: { prefix: v } }), `${shown(x.prefix)} changed to ${shown(v)}`)) setEd(null);
  };
  const msg = m.t ? m : f.prefix ? preview : { c: 'msg', t: '' };
  return (
    <div className="ov c" id="px" ref={ref} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'px') onClose(); }}>
      <div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby="pxT">
        <div className="dh"><div><h3 id="pxT" style={{ margin: 0, fontSize: 18 }}>{t.label} prefixes</h3><small style={{ color: 'var(--t2)' }}>{business} · one prefix is active and used for new {word === 'sale' ? 'sales' : `${word}s`}.</small></div><button className="ib" id="pxClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="tw stk" style={{ marginTop: 16 }}><table className="tlt"><thead><tr><th>Prefix</th><th>Used in</th><th>Next number</th><th className="n"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="pxBody">
            {t.prefixes.map((x) => (
              <tr key={x.id} data-prefix={x.prefix}>
                <td>{ed?.id === x.id
                  ? <input className="fi mono" style={{ ...mono, width: 130, height: 36 }} aria-label="Prefix" value={ed.v} maxLength={10} autoFocus onChange={(e) => { setEd({ id: x.id, v: e.target.value }); setM({ c: 'msg', t: '' }); }} onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(x); if (e.key === 'Escape') { e.stopPropagation(); setEd(null); } }} />
                  : <><b className="mono" style={mono}>{shown(x.prefix)}</b> {x.active ? <span className="st g">Active</span> : <span className="st q">Not in use</span>}</>}</td>
                <td>{x.used ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--t2)' }} title="Used prefixes can’t be edited or deleted"><svg className="i" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} dangerouslySetInnerHTML={{ __html: P.lock }} />Used in {x.used.toLocaleString('en-IN')} {x.used === 1 ? 'document' : 'documents'}</span> : <span className="mu">Not used yet</span>}</td>
                <td className="mu">{x.next}</td>
                <td className="n"><div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                  {ed?.id === x.id ? <><button className="btn sm p" type="button" onClick={() => void saveEdit(x)}>Save</button><button className="btn sm" type="button" onClick={() => setEd(null)}>Cancel</button></> : <>
                    {!x.active && <button className="btn sm" type="button" data-act={x.prefix} onClick={() => void run(api<Prefixes>(`/settings/prefixes/${x.id}`, { method: 'PATCH', body: { active: true } }), `New ${word === 'sale' ? 'sales' : `${word}s`} now use ${shown(x.prefix)}`)}>Make active</button>}
                    {!x.used && <button className="ib" type="button" aria-label={`Edit ${shown(x.prefix)}`} onClick={() => { setEd({ id: x.id, v: x.prefix }); setM({ c: 'msg', t: '' }); }}><Icon name="edit" /></button>}
                    {!x.used && !x.active && <button className="ix" type="button" aria-label={`Delete ${shown(x.prefix)}`} onClick={() => void run(api<Prefixes>(`/settings/prefixes/${x.id}`, { method: 'DELETE' }), `${shown(x.prefix)} deleted`)}><Icon name="x" /></button>}
                  </>}
                </div></td>
              </tr>
            ))}
          </tbody></table></div>
        <p className="hint" style={{ margin: '10px 0 0' }}>A prefix that is used can’t be edited or deleted. To change it, add a new prefix and make it active. Leave the box empty to add “None” (numbers without a prefix).</p>
        <form className="addf" id="pxForm" noValidate onSubmit={add} style={{ gridTemplateColumns: '1fr auto auto' }}>
          <label className="fl" htmlFor="pxNew">New prefix<input className="fi mono" id="pxNew" style={mono} value={f.prefix} maxLength={10} autoComplete="off" spellCheck={false} placeholder="e.g. JE/INV/" onChange={(e) => { setF({ ...f, prefix: e.target.value }); setM({ c: 'msg', t: '' }); }} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 13 }}><input type="checkbox" id="pxActive" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Make it active</label>
          <button className="btn p" type="submit" style={{ marginBottom: 8 }}><Icon name="plus" />Add</button>
        </form>
        <div className={msg.c} id="pxMsg" aria-live="polite">{msg.t}</div>
      </div>
    </div>
  );
}

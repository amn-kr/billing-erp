/**
 * Settings › General › Cloud sync, in the Windows app's single-PC mode: "Move to cloud" (Phase 6,
 * step 7). The books on this PC go into the online app once, under the owner's online account (signed
 * in to, or made here); the counts on both sides are compared; then this PC opens the online app. The
 * books on the PC are kept, unchanged. Built from the prototype's own pieces (synccard, rad, fl/fi,
 * the .ov/.mdl window, .rcv, cb2).
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { desktop } from '../../lib/desktop';
import { useMe } from '../../lib/me';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { ui } from '../../styles/uiSize';

const CLOUD = '<path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 8.5a4.75 4.75 0 01-.5 9.5z"/><path d="M12 15V9M9.5 11.5L12 9l2.5 2.5"/>';
const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });

interface Counts { invoices: number; parties: number; items: number; purchaseBills: number; paymentsReceived: number; salesTotalThisYear: string }
interface Moved { code: string; name: string; email: string; already: boolean; matches: boolean; here: Counts; online: Counts }

/** the Windows app in single-PC mode (the books are on this computer) */
export const onThisPc = () => !!desktop()?.local;

/** The Cloud sync card's place in single-PC mode. */
export function MoveCard() {
  const can = !!useMe().data?.permissions.includes('business.update');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="synccard" id="mvCard"><span className="ti" style={{ width: ui.w(36), height: ui.h(36), display: 'grid', placeItems: 'center', borderRadius: 10, ...T('var(--ac)') }}><RawIcon d={CLOUD} /></span>
        <div className="sx"><b>On this computer only</b><span>Move the books to the cloud to open them on other computers and phones, with your staff and salesmen. They are copied once; then this computer opens the online app.</span></div>
        {can && <button className="btn p" type="button" id="mvOpen" onClick={() => setOpen(true)}>Move to cloud…</button>}</div>
      <MoveWindow open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MoveWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Moved | null>(null);
  useOpenFocus(open, ref);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setMode('in'); setEmail(''); setPass(''); setName(''); setOk(false); setBusy(false); setErr(''); setDone(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busyRef.current && closeRef.current();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function go() {
    setErr('');
    if (mode === 'new' && pass.length < 8) return setErr('Use at least 8 characters for the password.');
    setBusy(true);
    try {
      setDone(await api<Moved>('/cloud/move', { body: { email, password: pass, create: mode === 'new', name, confirm: true } }));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'The books could not be moved. Nothing changed on this computer.'); }
    setBusy(false);
  }
  async function openOnline() {
    if (!done) return;
    try { await desktop()?.useCloud?.({ code: done.code, email: done.email }); } catch { setErr('Could not switch this computer to the online app. Close the app and open it again.'); }
  }
  const row = (c: Counts) => `${c.invoices} invoices, ${c.parties} parties, ${c.items} items, ${c.purchaseBills} purchase bills, ${c.paymentsReceived} payments`;

  return (
    <div className="ov c" id="mvm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'mvm' && !busy) onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="mvT" style={{ width: 'min(560px,100%)' }}>
        <div className="dh"><div><h3 id="mvT" style={{ margin: 0, fontSize: ui.fs(18) }}>Move to cloud</h3><small className="mu">The books on this computer go into the online app</small></div><button className="ib" type="button" id="mvClose" aria-label="Close" disabled={busy} onClick={onClose}><Icon name="x" /></button></div>
        <div style={{ marginTop: ui.sp(12) }}>
          {!done ? (
            <>
              <div className="rad" role="radiogroup" aria-label="Online account" id="mvWho" style={{ gridTemplateColumns: '1fr 1fr', margin: ui.sp('0 0 12px') }}>
                {([['in', 'I have an online account', 'Sign in with it'], ['new', 'Make a new online account', 'With your email and a password']] as const).map(([k, n, d]) => (
                  <label key={k} className={mode === k ? 'on' : ''}><input type="radio" name="mvWho" value={k} checked={mode === k} disabled={busy} onChange={() => { setMode(k); setErr(''); }} />{n}<small>{d}</small></label>
                ))}
              </div>
              {mode === 'new' && <label className="fl" htmlFor="mvName">Your name<input className="fi" id="mvName" value={name} autoComplete="name" disabled={busy} onChange={(e) => setName(e.target.value)} /></label>}
              <div className="two"><label className="fl" htmlFor="mvEmail">Email<input className="fi" id="mvEmail" type="email" value={email} autoComplete="email" disabled={busy} onChange={(e) => { setEmail(e.target.value); setErr(''); }} /></label>
                <label className="fl" htmlFor="mvPass">Password<input className="fi" id="mvPass" type="password" value={pass} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} disabled={busy} onChange={(e) => { setPass(e.target.value); setErr(''); }} /></label></div>
              <ul className="hint" style={{ margin: ui.sp('8px 0 10px'), paddingLeft: ui.sp(18) }}>
                <li>The whole books are copied into the online app as a shop of this account, and the counts are checked on both sides.</li>
                <li>Then this computer opens the online app: sign in there with this email. It needs internet from then on.</li>
                <li>The books on this computer are kept as they are, but no longer used.</li>
                <li>Staff accounts made on this computer are invited again online (Settings › Team).</li>
              </ul>
              <label className="cb2" style={{ alignItems: 'flex-start' }}><input type="checkbox" id="mvUnderstand" style={{ marginTop: ui.sp(3) }} checked={ok} disabled={busy} onChange={(e) => setOk(e.target.checked)} /> <span><b>I understand</b> from now on the books are kept online, and this computer works online.</span></label>
              {busy && <p className="hint" id="mvWait" style={{ margin: ui.sp('10px 0 0') }}>Moving the books… The online app may take a minute to wake up. Don’t close the app.</p>}
            </>
          ) : (
            <>
              <p className={`msg ${done.matches ? 'good' : 'warn'}`} id="mvDone" style={{ margin: ui.sp('0 0 10px'), fontSize: ui.fs(13) }}>{done.matches
                ? `Your books are online: ${done.name} (${done.code}). Everything was checked: the same as on this computer.`
                : `Your books are online as ${done.name} (${done.code}), but some counts differ. Please contact support before working in them.`}</p>
              <div className="rcv"><div><span>On this computer</span><b>{row(done.here)}</b></div><div><span>Online</span><b>{row(done.online)}</b></div><div><span>Online account</span><b>{done.email}</b></div></div>
            </>
          )}
        </div>
        <div className="msg bad" id="mvErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', marginTop: ui.sp(12) }}>
          {done ? (
            <button className="btn p" type="button" id="mvUse" onClick={() => void openOnline()}>Open the online app</button>
          ) : (
            <><button className="btn" type="button" id="mvCancel" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="btn p" type="button" id="mvGo" disabled={!ok || busy || !email.includes('@') || !pass} onClick={() => void go()}>{busy ? 'Moving…' : 'Move to cloud'}</button></>
          )}
        </div>
      </div>
    </div>
  );
}

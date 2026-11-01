/**
 * Settings › General › Recovery codes (#rcCard, owner's request, 1 Nov 2026), just below Team: everyone makes
 * ten one-time codes for their own account after typing their password. The codes are shown once (Copy,
 * Download, Print); on the sign-in page "Forgot password?" takes the email, one code and a new password.
 * "Make new codes" stops the unused old ones. The prototype has no such section, so it reuses the Team
 * card's synccard rows and the small window (#slm).
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecoveryCodes, RecoveryCodesState } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { saveFile } from '../../lib/files';
import { APP_NAME } from '../../lib/brand';
import { useMe } from '../../lib/me';
import { useShell } from '../shell/store';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { ui } from '../../styles/uiSize';

const RC_KEY = ['recovery-codes'] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const HOW = 'On the sign-in page: Forgot password? → your email, one code and a new password.';

export function RecoveryCard() {
  const me = useMe().data;
  const qc = useQueryClient();
  const { showToast } = useShell();
  const st = useQuery({ queryKey: RC_KEY, queryFn: () => api<RecoveryCodesState>('/auth/recovery-codes') });
  const [step, setStep] = useState<'ask' | RecoveryCodes | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** a fresh, empty password box each time the window opens */
  const [opened, setOpened] = useState(0);
  const pwRef = useRef<HTMLInputElement>(null);
  const s = st.data;
  const made = !!s?.total;

  function open() {
    setErr('');
    setOpened((n) => n + 1);
    setStep('ask');
  }

  async function makeCodes() {
    const password = pwRef.current?.value ?? '';
    if (!password) return setErr('Enter your password.');
    setBusy(true);
    try {
      setStep(await api<RecoveryCodes>('/auth/recovery-codes', { body: { password } }));
      void qc.invalidateQueries({ queryKey: RC_KEY });
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Couldn’t make the codes.');
    } finally {
      setBusy(false);
    }
  }

  const text = (c: RecoveryCodes) =>
    `${APP_NAME} recovery codes for ${me?.user.email ?? ''}\nMade on ${day(c.madeAt)}\n\n${c.codes.map((x, i) => `${String(i + 1).padStart(2)}. ${x}`).join('\n')}\n\nEach code works once. ${HOW}\n`;
  const print = (c: RecoveryCodes) => {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return showToast('Allow pop-ups to print');
    const pre = w.document.createElement('pre');
    pre.style.cssText = 'font:15px/1.6 ui-monospace,monospace;margin:24px';
    pre.textContent = text(c);
    w.document.body.append(pre);
    w.print();
  };

  let modal: SlModalProps | null = null;
  if (step === 'ask') {
    modal = {
      title: made ? 'Make new recovery codes?' : 'Make recovery codes',
      sub: made ? 'Your old codes stop working. Type your password to continue.' : 'Type your password to continue.',
      ok: busy ? 'Making…' : 'Make codes', onOk: () => void makeCodes(),
      cancel: 'Cancel',
      body: (
        <>
          <label className="fl" htmlFor="rcPw">Your password<input className="fi" id="rcPw" key={opened} autoFocus type="password" autoComplete="current-password" ref={pwRef} onChange={() => setErr('')} onKeyDown={(e) => e.key === 'Enter' && void makeCodes()} /></label>
          <div className="msg bad" id="rcErr" role="alert">{err}</div>
        </>
      ),
    };
  } else if (step) {
    const c = step;
    modal = {
      title: 'Your recovery codes', sub: 'Shown only once. Keep them somewhere safe: each code works one time.', cancel: 'Done',
      body: (
        <>
          <div id="rcList" className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.sp('8px 16px'), padding: ui.sp('12px 16px'), border: '1px solid var(--bd,#e2e8f0)', borderRadius: 10, fontSize: ui.fs(16), letterSpacing: 1 }}>
            {c.codes.map((x, i) => <span key={x}><span className="mu" style={{ display: 'inline-block', width: '2.2em' }}>{i + 1}.</span>{x}</span>)}
          </div>
          <div style={{ display: 'flex', gap: ui.sp(8), marginTop: ui.sp(12), flexWrap: 'wrap' }}>
            <button className="btn" type="button" id="rcCopy" onClick={() => void navigator.clipboard?.writeText(text(c)).then(() => showToast('Copied'), () => showToast('Select them and copy'))}>Copy</button>
            <button className="btn" type="button" id="rcDl" onClick={() => saveFile(`${APP_NAME} recovery codes.txt`, new Blob([text(c)], { type: 'text/plain' }))}>Download</button>
            <button className="btn" type="button" id="rcPrint" onClick={() => print(c)}>Print</button>
          </div>
          <p className="hint" style={{ margin: ui.sp('10px 0 0') }}>{HOW}</p>
        </>
      ),
    };
  }

  const status = !s ? (st.isError ? 'Couldn’t load right now.' : '…')
    : !made ? 'Not made yet. Make them now and keep them somewhere safe.'
    : s.left === 0 ? 'All codes are used. Make new codes.'
    : s.left <= 3 ? `Only ${s.left} of ${s.total} left. Make new codes soon.`
    : `${s.left} of ${s.total} left · made on ${day(s.madeAt!)}.`;
  const warn = !!s && (!made || s.left <= 3);
  return (
    <>
      <div id="rcCard"><h3 style={{ margin: ui.sp('26px 0 4px'), fontSize: ui.fs(16) }}>Recovery codes</h3><p className="mu" style={{ margin: ui.sp('0 0 12px'), fontSize: ui.fs(13) }}>If you forget your password, one of these codes lets you choose a new one. Only for your own account.</p>
        <div className="synccard"><div className="sx"><b>Your recovery codes{warn && <> <span className="st a" id="rcWarn">{made ? 'Few left' : 'Not set up'}</span></>}</b><span id="rcState">{status}</span></div>
          <button className={`btn${made && !warn ? '' : ' p'}`} type="button" id="rcMake" disabled={!s} onClick={open}>{made ? 'Make new codes' : 'Make codes'}</button></div>
      </div>
      <SlModal m={modal} onClose={() => setStep(null)} />
    </>
  );
}

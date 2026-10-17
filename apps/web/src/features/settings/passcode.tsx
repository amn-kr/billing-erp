/**
 * Transaction passcode (Settings › Transactions): the passcode box and withPasscode().
 * The box is the prototype's price PIN dialog (#plkm classes) with 4 to 6 digits. The server
 * checks every edit, cancel and delete; this only asks for the passcode and sends it along.
 * Asked every time — the passcode is never kept after the call it was typed for.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { PASSCODE_HEADER } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { RawIcon } from '../../components/Icon';
import { P } from '../../components/icon-paths';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';

export interface PasscodeState { set: boolean; enabled: boolean }
export const PASSCODE_KEY = ['txn-passcode'] as const;
const getState = () => api<PasscodeState>('/settings/passcode');
export const usePasscodeState = () => useQuery({ queryKey: PASSCODE_KEY, queryFn: getState, staleTime: 30_000 });

type Mode = 'ask' | 'set' | 'off' | 'change' | 'setNew' | 'forgot';
interface Ask { title: string; sub: ReactNode; go: string; keep?: string; run: (passcode: string) => Promise<void>; done: (ok: boolean, err?: unknown) => void }
interface Box { mode: Mode | null; ask: Ask | null; from: Mode | null; current: string; open: (mode: Mode, ask?: Ask) => void; close: () => void }
const useBox = create<Box>((set) => ({
  mode: null, ask: null, from: null, current: '',
  open: (mode, ask) => set((b) => ({ mode, ask: ask ?? b.ask, from: mode === 'forgot' || mode === 'setNew' ? b.mode : null })),
  close: () => set({ mode: null, ask: null, from: null, current: '' }),
}));

/** Settings › Transactions opens the box for turning on, off and Change Passcode. */
export const openPasscodeBox = (mode: 'set' | 'off' | 'change') => useBox.getState().open(mode);

/**
 * Runs an edit or cancel call. With the passcode switched on it first asks for it, sends it with
 * the call and keeps the box open on a wrong passcode. Resolves null when the box is closed.
 */
export async function withPasscode<T>(qc: QueryClient, ask: { title: string; sub: ReactNode; go: string; keep?: string }, call: (headers?: Record<string, string>) => Promise<T>): Promise<{ value: T } | null> {
  const st = await qc.fetchQuery({ queryKey: PASSCODE_KEY, queryFn: getState, staleTime: 30_000 }).catch(() => null);
  if (!st?.enabled) {
    try {
      return { value: await call() };
    } catch (e) {
      // switched on meanwhile (another device): ask for it now
      if (!(e instanceof ApiError && e.code === 'passcode')) throw e;
      void qc.invalidateQueries({ queryKey: PASSCODE_KEY });
    }
  }
  return new Promise((resolve, reject) => {
    let value: T;
    useBox.getState().open('ask', {
      ...ask,
      run: async (passcode) => { value = await call({ [PASSCODE_HEADER]: passcode }); },
      done: (ok, err) => (err ? reject(err) : resolve(ok ? { value } : null)),
    });
  });
}

/** The box's words when Save is pressed on a changed saved document. */
export const editAsk = (no: string) => ({ title: 'Passcode needed', sub: <>Enter the passcode to save your changes to <No n={no} />.</>, go: 'Save changes' });
/** The box's words when a document is cancelled ("invoice", "challan" …). */
export const cancelAsk = (no: string, what: string) => ({ title: `Cancel ${no}?`, sub: `Enter the passcode to cancel this ${what}. It stays in your records as cancelled.`, go: `Cancel ${what}`, keep: `Keep ${what}` });

/** The box's words when a document is deleted ("invoice" …): hidden from the lists, never erased. */
export const deleteAsk = (no: string, what: string) => ({ title: `Delete ${no}?`, sub: `Enter the passcode to delete this ${what}. It is hidden from your lists but kept safely in your records. Nothing is erased.`, go: `Delete ${what}`, keep: `Keep ${what}` });

/** True when a saved document can't be saved quietly (in the background) because the passcode is on. */
export const passcodeOn = (qc: QueryClient) => !!qc.getQueryData<PasscodeState>(PASSCODE_KEY)?.enabled;

/** A document number never breaks across lines (INV-0001). */
const No = ({ n }: { n: string }) => <span style={{ whiteSpace: 'nowrap' }}>{n}</span>;

const TEXT: Record<Exclude<Mode, 'ask'>, { title: string; sub: string; go: string }> = {
  set: { title: 'Set a passcode', sub: 'Choose a 4 to 6 digit passcode. It will be asked when a saved document is changed or cancelled.', go: 'Save passcode and turn on' },
  off: { title: 'Turn off the passcode?', sub: 'Enter the passcode to turn it off. Saved documents can then be changed or cancelled without it.', go: 'Turn off' },
  change: { title: 'Enter current passcode', sub: 'Enter your current passcode to set a new one.', go: 'Continue' },
  setNew: { title: 'Set a new passcode', sub: 'Choose a new 4 to 6 digit passcode.', go: 'Save new passcode' },
  forgot: { title: 'Forgot passcode', sub: 'Only the shop owner can do this. Enter your account password, then choose a new passcode.', go: 'Save new passcode' },
};

export function PasscodeBox() {
  const { mode, ask, from, current, open, close } = useBox();
  const { showToast } = useShell();
  const owner = useMe().data?.role === 'owner';
  const qcState = usePasscodeState();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const busy = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const pin2Ref = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const mdlRef = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  const shown = !!mode;
  useOpenFocus(shown, ovRef);

  // every time the box opens or changes step: empty fields, first field focused
  useEffect(() => {
    if (!mode) return;
    setPin(''); setPin2(''); setPw(''); setErr('');
    setTimeout(() => (mode === 'forgot' ? pwRef : pinRef).current?.focus(), 30);
  }, [mode]);
  const dismiss = () => { const a = ask; close(); a?.done(false); };
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, ask]);

  if (!mode) return <div className="ov c" id="pcm" ref={ovRef} hidden><div className="mdl plkm" role="dialog" aria-modal="true" aria-labelledby="pcT"></div></div>;
  const t = mode === 'ask' ? ask! : TEXT[mode];
  const two = mode === 'set' || mode === 'setNew' || mode === 'forgot';
  const shake = () => { const m = mdlRef.current; if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); } };
  const wrong = (x: unknown, fallback: string) => {
    setErr(x instanceof ApiError ? x.message : fallback);
    if (mode === 'forgot') { setPw(''); pwRef.current?.focus(); } else { setPin(''); setPin2(''); pinRef.current?.focus(); }
    shake();
  };
  const saved = (msg: string) => { void qcState.refetch(); showToast(msg); };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy.current) return;
    if (mode === 'forgot' && !pw) { setErr('Enter your account password.'); return pwRef.current?.focus(); }
    if (!/^\d{4,6}$/.test(pin)) { setErr('Enter 4 to 6 digits.'); return pinRef.current?.focus(); }
    if (two && !pin2) return pin2Ref.current?.focus();
    if (two && pin !== pin2) { setErr('The two passcodes don’t match.'); setPin2(''); return pin2Ref.current?.focus(); }
    busy.current = true;
    try {
      if (mode === 'ask') {
        await ask!.run(pin);
        const a = ask!; close(); a.done(true);
      } else if (mode === 'set') {
        await api('/settings/passcode/on', { body: { passcode: pin } });
        saved('Passcode saved and turned on');
        close();
      } else if (mode === 'off') {
        await api('/settings/passcode/off', { body: { passcode: pin } });
        saved('Passcode turned off');
        close();
      } else if (mode === 'change') {
        await api('/settings/passcode/check', { body: { passcode: pin } });
        useBox.setState({ current: pin });
        open('setNew');
      } else if (mode === 'setNew') {
        await api('/settings/passcode/change', { body: { current, passcode: pin } });
        saved('New passcode saved');
        close();
      } else {
        await api('/settings/passcode/reset', { body: { password: pw, passcode: pin } });
        saved(from === 'ask' ? 'New passcode saved. Enter it to continue' : 'New passcode saved');
        if (from === 'ask') open('ask'); else close();
      }
    } catch (x) {
      if (mode === 'ask' && !(x instanceof ApiError && x.code === 'passcode')) {
        // not a passcode problem (e.g. the bill itself can't be saved): close and let the screen say why
        const a = ask!; close(); a.done(false, x);
      } else wrong(x, 'Could not check the passcode.');
    } finally {
      busy.current = false;
    }
  }
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const canForgot = owner && (mode === 'ask' || mode === 'off' || mode === 'change');

  return (
    <div className="ov c" id="pcm" ref={ovRef} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'pcm') dismiss(); }}>
      <div className="mdl plkm" ref={mdlRef} role="dialog" aria-modal="true" aria-labelledby="pcT">
        <div className="plkic"><RawIcon d={P.lock} /></div>
        <h3 id="pcT">{t.title}</h3><p className="mu" id="pcSub">{t.sub}</p>
        <form id="pcForm" noValidate onSubmit={submit}>
          {mode === 'forgot' ? <><label className="vh" htmlFor="pcPw">Account password</label><input className="fi" id="pcPw" type="password" autoComplete="current-password" placeholder="Your account password" style={{ margin: '0 0 10px', height: 42 }} value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} ref={pwRef} /></> : null}
          <label className="vh" htmlFor="pcPin">{two ? 'New passcode' : 'Passcode'}</label><input className="fi plkpin" id="pcPin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder={mode === 'forgot' ? 'New passcode' : '••••••'} value={pin} onChange={(e) => { setPin(digits(e.target.value)); setErr(''); }} ref={pinRef} />
          {two ? <><label className="vh" htmlFor="pcPin2">Type it again</label><input className="fi plkpin" id="pcPin2" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="Type it again" value={pin2} onChange={(e) => { setPin2(digits(e.target.value)); setErr(''); }} ref={pin2Ref} /></> : null}
          <div className="msg bad" id="pcErr" role="alert">{err}</div>
          <button className="btn p" type="submit" id="pcGo" style={{ width: '100%', justifyContent: 'center' }}>{t.go}</button>
        </form>
        <div className="plkf">{canForgot ? <button type="button" className="lnk" id="pcForgot" onClick={() => open('forgot')}>Forgot passcode?</button> : <span></span>}<button type="button" className="lnk" id="pcCancel" onClick={dismiss}>{mode === 'ask' ? ask!.keep ?? 'Cancel' : 'Cancel'}</button></div>
      </div>
    </div>
  );
}

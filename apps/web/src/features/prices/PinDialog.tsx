/**
 * Price PIN (#plkm): set a PIN the first time, unlock, or change it — the
 * prototype's openPinModal(), with the PIN checked by the server.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { RawIcon } from '../../components/Icon';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { usePm } from './model';

type Mode = 'set' | 'unlock' | 'change' | 'setNew';
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';

export function PinDialog({ open, onClose, onUnlocked }: { open: boolean; onClose: () => void; onUnlocked: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const state = useQuery({ queryKey: ['price-pin'], queryFn: () => api<{ set: boolean }>('/prices/pin'), retry: false });
  const [mode, setMode] = useState<Mode>('unlock');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const [current, setCurrent] = useState('');
  const busy = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const pin2Ref = useRef<HTMLInputElement>(null);
  const mdlRef = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ovRef);

  const start = (m: Mode) => {
    setMode(m); setPin(''); setPin2(''); setErr('');
    setTimeout(() => pinRef.current?.focus(), 30);
  };
  useEffect(() => {
    if (open) start(state.data?.set === false ? 'set' : 'unlock');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  const isSet = mode === 'set' || mode === 'setNew';
  const title = mode === 'setNew' ? 'Set a new price PIN' : mode === 'set' ? 'Set a price PIN' : mode === 'change' ? 'Enter current PIN' : 'Unlock prices';
  const sub = isSet ? 'Choose a 4-digit PIN. You’ll need it to edit prices.' : mode === 'change' ? 'Enter your current PIN to set a new one.' : 'Enter your 4-digit price PIN to edit prices.';
  const go = isSet ? 'Save PIN and unlock' : mode === 'change' ? 'Continue' : 'Unlock';

  const unlocked = (p: string, msg: string) => {
    usePm.getState().set({ pin: p });
    void qc.invalidateQueries({ queryKey: ['price-pin'] });
    showToast(msg);
    onUnlocked();
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy.current) return;
    if (!/^\d{4}$/.test(pin)) { setErr('Enter 4 digits.'); return pinRef.current?.focus(); }
    if (isSet && pin !== pin2) { setErr('The two PINs don’t match.'); setPin2(''); return pin2Ref.current?.focus(); }
    busy.current = true;
    try {
      if (isSet) {
        await api('/prices/pin', { body: { pin, ...(mode === 'setNew' ? { currentPin: current } : {}) } });
        unlocked(pin, 'Price PIN saved. Prices unlocked');
      } else {
        await api('/prices/unlock', { body: { pin } });
        if (mode === 'change') { setCurrent(pin); start('setNew'); }
        else unlocked(pin, 'Prices unlocked');
      }
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not check the PIN.');
      setPin('');
      pinRef.current?.focus();
      const m = mdlRef.current;
      if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); }
    } finally {
      busy.current = false;
    }
  }

  // like the prototype: the 4th digit submits (or moves to "Confirm PIN")
  useEffect(() => {
    if (!open || pin.length !== 4) return;
    if (isSet) pin2Ref.current?.focus();
    else void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);
  useEffect(() => {
    if (open && isSet && pin2.length === 4) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin2]);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  return (
    <div className="ov c" id="plkm" ref={ovRef} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'plkm') onClose(); }}>
      <div className="mdl plkm" ref={mdlRef} role="dialog" aria-modal="true" aria-labelledby="plkT">
        <div className="plkic"><RawIcon d={LOCK} /></div>
        <h3 id="plkT">{title}</h3><p className="mu" id="plkSub">{sub}</p>
        <form id="plkForm" noValidate onSubmit={submit}>
          <label className="vh" htmlFor="plkPin">PIN</label><input className="fi plkpin" id="plkPin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="••••" value={pin} onChange={(e) => { setPin(digits(e.target.value)); setErr(''); }} ref={pinRef} />
          <div id="plkConfW" hidden={!isSet}><label className="vh" htmlFor="plkPin2">Confirm PIN</label><input className="fi plkpin" id="plkPin2" type="password" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="Confirm PIN" value={pin2} onChange={(e) => { setPin2(digits(e.target.value)); setErr(''); }} ref={pin2Ref} /></div>
          <div className="msg bad" id="plkErr" role="alert">{err}</div>
          <button className="btn p" type="submit" id="plkGo" style={{ width: '100%', justifyContent: 'center' }}>{go}</button>
        </form>
        <div className="plkf"><button type="button" className="lnk" id="plkChange" hidden={mode !== 'unlock'} onClick={() => start('change')}>Change PIN</button><button type="button" className="lnk" id="plkCancel" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

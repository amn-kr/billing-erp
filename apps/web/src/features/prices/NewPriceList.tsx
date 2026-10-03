/**
 * New price list (#plm) — the prototype's plNew dialog. Opened from Price manager
 * after the price PIN; the server checks the PIN again.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPrice } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { usePm, type PriceData } from './model';

interface Group { id: string; name: string }

export function NewPriceList({ open, data, exampleId, onClose }: { open: boolean; data: PriceData; exampleId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const groups = useQuery({ queryKey: ['party-groups'], queryFn: () => api<Group[]>('/party-groups'), enabled: open });
  const [name, setName] = useState('');
  const [rule, setRule] = useState<'disc' | 'mark'>('disc');
  const [val, setVal] = useState('5');
  const [round, setRound] = useState('1');
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const ovRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valRef = useRef<HTMLInputElement>(null);
  useOpenFocus(open, ovRef);
  useEffect(() => {
    if (!open) return;
    setName(''); setRule('disc'); setVal('5'); setRound('1'); setPicked([]); setErr('');
    nameRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  const ex = data.IT.find((i) => i.id === exampleId);
  const v = Number(val) || 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setErr('Enter a name for the price list.'); return nameRef.current?.focus(); }
    if (data.PLS.some((p) => p.name.toLowerCase() === n.toLowerCase())) { setErr('A price list with this name already exists.'); return nameRef.current?.focus(); }
    const num = Number(val);
    if (!(val.trim() !== '' && num >= 0 && num < 100)) { setErr('Enter a percentage between 0 and 99.'); return valRef.current?.focus(); }
    try {
      await api('/price-lists', { body: { name: n, rule, value: num, roundTo: Number(round), groups: picked, pin: usePm.getState().pin } });
      await Promise.all(['price-lists', 'prices'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
      showToast(`${n} created`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not create the price list.');
    }
  }

  return (
    <div className="ov c" id="plm" ref={ovRef} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'plm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="plT" style={{ width: 'min(500px,100%)' }}>
        <h3 id="plT" style={{ margin: '0 0 14px', fontSize: 18 }}>New price list</h3>
        <form id="plForm" noValidate onSubmit={submit}>
          <label className="fl" htmlFor="plName">Name<input className="fi" id="plName" placeholder="e.g. Dealer price" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} ref={nameRef} /></label>
          <div className="two"><label className="fl" htmlFor="plRule">Price is<select className="fi" id="plRule" value={rule} onChange={(e) => setRule(e.target.value as 'disc' | 'mark')}><option value="disc">Sale price minus %</option><option value="mark">Purchase price plus %</option></select></label>
            <label className="fl" htmlFor="plVal">Percentage<span className="pre2 post"><input className="fi" id="plVal" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} ref={valRef} /><span>%</span></span></label></div>
          <label className="fl" htmlFor="plRound">Round prices to<select className="fi" id="plRound" value={round} onChange={(e) => setRound(e.target.value)}><option value="0">No rounding (paise)</option><option value="1">Nearest ₹1</option><option value="5">Nearest ₹5</option><option value="10">Nearest ₹10</option></select></label>
          <div className="hint" id="plPrev" style={{ margin: '-4px 0 12px' }}>{ex ? <>Example: {ex.name} — sale {inr2f(ex.sale)}, purchase {inr2f(ex.purch)} → <b>{inr2f(listPrice(rule, v, round, { sale: ex.sale, purchase: ex.purch }))}</b></> : ''}</div>
          <span className="fl" style={{ marginBottom: 4 }}>Use automatically for these party groups</span>
          <div className="plgs" id="plGroups">{(groups.data ?? []).filter((g) => g.name !== 'Suppliers').map((g) => <label className="cb2" key={g.id}><input type="checkbox" value={g.name} checked={picked.includes(g.name)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.name] : picked.filter((x) => x !== g.name))} /> {g.name}</label>)}</div>
          <div className="msg bad" id="plErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn" type="button" id="plCancel" onClick={onClose}>Cancel</button><button className="btn p" type="submit">Create price list</button></div>
        </form>
      </div>
    </div>
  );
}

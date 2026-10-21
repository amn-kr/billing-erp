/**
 * Pieces shared by the Import Parties screens: the "← back" link with the page heading, the
 * status labels, leaving-the-page protection and the result summary after saving.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import type { PartyImportSummary, PartyRowStatus } from '@billing/shared';
import { go } from '../../lib/go';
import { useDcf } from '../../components/Discard';
import { RawIcon } from '../../components/Icon';

export const DOWN = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
export const UP = '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>';
export const num = (v: number) => v.toLocaleString('en-IN');
export const plural = (c: number, w: string, ws = w + 's') => `${num(c)} ${c === 1 ? w : ws}`;
/** a row's status label: class and text */
export const STATUS: Record<PartyRowStatus, [string, string]> = { ok: ['g', 'OK'], rejected: ['r', 'Rejected'], duplicate: ['a', 'Duplicate - skipped'], example: ['a', 'Example row - skipped'] };
/** the parties list and the duplicate check must see the new parties */
export const PARTY_QUERIES = ['parties', 'party-groups', 'party-import-context'];

/** "← Parties" (choice page) or "← Import Parties" (the two screens), then the heading row */
export function ImportHead({ back, children }: { back: 'parties' | 'choice'; children?: ReactNode }) {
  return (
    <>
      {back === 'parties'
        ? <button className="lnk" id="piBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/parties')}>← Parties</button>
        : <button className="lnk" id="piBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/parties/import')}>← Import Parties</button>}
      <div className="pthd">{children}</div>
    </>
  );
}

/** While there are rows not saved yet, leaving through the app asks first, and a reload warns. */
export function useKeepRows(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let went = false;
    useDcf.getState().ask('import', () => { went = true; blockerRef.current.proceed?.(); });
    // "Keep editing" (or Esc) closes the question without going: stay on this page
    const stop = useDcf.subscribe((s) => { if (!s.what) { stop(); setTimeout(() => { if (!went) blockerRef.current.reset?.(); }, 0); } });
    return stop;
  }, [blocker.state]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);
}

/**
 * After saving: how many were saved, rejected and skipped, and why. Bulk entry leaves out the "why"
 * table (`counts`): its rows are numbered again once the saved ones leave the table, and the list
 * under the table already says why, with the new numbers.
 */
export function Summary({ s, onRejected, again, againLabel, counts }: { s: PartyImportSummary; onRejected?: () => void; again: () => void; againLabel: string; counts?: boolean }) {
  const problems = counts ? [] : [...s.rejected.map((x) => ({ ...x, st: 'rejected' as const })), ...s.skipped.map((x) => ({ ...x, st: 'duplicate' as const })), ...s.examples.map((x) => ({ ...x, st: 'example' as const }))].sort((a, b) => a.line - b.line);
  return (
    <div className="card" id="piDone" style={{ padding: '22px 24px', maxWidth: 820 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>Import finished</h3>
      <ul style={{ margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.9, fontSize: 13.5 }}>
        <li id="piSaved"><b>{plural(s.saved.length, 'party', 'parties')} saved.</b></li>
        <li id="piRejected">{s.rejected.length ? <span className="stt r">{plural(s.rejected.length, 'row')} rejected</span> : 'No rows rejected.'}</li>
        <li id="piSkipped">{s.skipped.length ? <span className="stt a">{plural(s.skipped.length, 'duplicate')} skipped</span> : 'No duplicates skipped.'}</li>
        {s.examples.length > 0 && <li id="piExample"><span className="stt a">The sample file’s example row was skipped</span></li>}
      </ul>
      {problems.length > 0 && (
        <div className="tw" style={{ margin: '0 0 14px', maxHeight: 320, overflow: 'auto' }}>
          <table className="ptt2" id="piProblems">
            <thead><tr><th>Row</th><th>Status</th><th>Why it was not saved</th></tr></thead>
            <tbody>{problems.map((x) => <tr key={x.line}><td>{x.line}</td><td><span className={`stt ${STATUS[x.st][0]}`}>{STATUS[x.st][1]}</span></td><td style={{ whiteSpace: 'normal' }}>{x.reasons.join(' · ')}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {onRejected && s.rejected.length > 0 && <button className="btn" id="piDoneRej" onClick={onRejected}><RawIcon d={DOWN} />Download rejected rows</button>}
        <button className="btn" id="piAgain" onClick={again}>{againLabel}</button>
        <button className="btn p" id="piToParties" onClick={() => go('/parties')}>Go to parties</button>
      </div>
    </div>
  );
}

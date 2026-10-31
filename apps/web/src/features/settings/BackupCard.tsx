/**
 * Settings › General › Backup & restore: real-time backup to Google Drive, this computer or
 * both (owner-approved look, 12 Oct 2026). Built only from the prototype's own pieces: the
 * card's synccard rows, the rad choice cards, the st status pills, the subbar banners and the
 * Restore books window (.ov/.mdl/.rcv/.cb2).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatInr2 } from '@billing/shared';
import { api, apiWithToken, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { useSetTab } from './model';
import { ui } from '../../styles/uiSize';

export type Dest = 'drive' | 'local' | 'both';
type Place = 'drive' | 'local';
interface Line {
  enabled: boolean; connected: boolean; reconnect: boolean; folder: string; account: string;
  lastOkAt: string | null; failingSince: string | null; error: string | null; waiting: number; lastSnapshotAt: string | null;
}
export interface BackupStatus {
  keySet: boolean;
  driveSetUp: boolean;
  dest: Dest | null;
  drive: Line | null;
  local: Line | null;
  snapshot: { lastAt: string | null };
  space: { usedMb: number; limitMb: number };
  failMinutes: number;
  now: string;
}
interface TestResult {
  from: Place; fullCopyAt: string; changes: number; upTo: string; matches: boolean; differences: { table: string; backup: number; now: number }[];
  invoices: number; parties: number; items: number; purchaseBills: number; paymentsReceived: number; salesTotalThisYear: string;
}

const DRIVE = '<path d="M8.5 3h7l6 10.5-3.5 6H5.5L2 13.5z"/><path d="M8.5 3l6.5 10.5H2M15.5 3L9 13.5M18.5 19.5L15 13.5"/>';
const PC = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>';
const COPY = '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>';
const DB = '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>';
const T = (c: string) => ({ background: `color-mix(in srgb,${c} 14%,transparent)`, color: c });
const TI = (c: string) => ({ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, flex: 'none', ...T(c) }) as const;
const PLACE: Record<Place, string> = { drive: 'Google Drive', local: 'this computer' };
const folderOk = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export const BACKUP_KEY = ['backup-status'] as const;
export const useBackup = () => {
  const me = useMe();
  return useQuery({ queryKey: BACKUP_KEY, queryFn: () => api<BackupStatus>('/backup/status'), enabled: !!me.data?.business, refetchInterval: 20_000, retry: false });
};
/** the owner chooses places and restores; everyone sees whether backups work */
const useCanManage = () => !!useMe().data?.permissions.includes('business.update');
/** redraws every 10 seconds, so "40 seconds ago" keeps up */
function useTick() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), 10_000); return () => clearInterval(t); }, []);
}

/** "40 seconds ago", "3 minutes ago", "2 hours ago", "12 Oct, 1:05 am" */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - +new Date(iso)) / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return when(iso);
}
const at = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
/** the server's clock, moved on by the time since it answered */
const nowOf = (s: BackupStatus, got: number) => +new Date(s.now) + (Date.now() - got);
const failMin = (l: Line | null, now: number) => (l?.failingSince ? Math.floor((now - +new Date(l.failingSince)) / 60000) : 0);
const on = (s: BackupStatus, p: Place) => s.dest === 'both' || s.dest === p;
const plural = (n: number, w: string) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;

/** Scrolls to the Backup & restore card, its heading clear of the top bar. */
export function showCard(behavior: ScrollBehavior = 'auto') {
  const el = document.getElementById('bkpCard');
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior });
}

/** The red line across the top of every screen after 15 minutes without a working backup, and the amber one when space is nearly gone. */
export function BackupBanner() {
  const q = useBackup();
  const navigate = useNavigate();
  useTick();
  const s = q.data;
  if (!s) return null;
  const now = nowOf(s, q.dataUpdatedAt);
  const open = () => { useSetTab.getState().set('gen'); navigate('/settings'); setTimeout(() => showCard('smooth'), 120); };
  const bad = (['drive', 'local'] as const).filter((p) => on(s, p) && failMin(s[p], now) >= s.failMinutes);
  const mins = Math.max(0, ...bad.map((p) => failMin(s[p], now)));
  const err = bad.length === 1 ? s[bad[0]!]?.error : null;
  const full = s.space.usedMb / s.space.limitMb >= 0.85;
  return (
    <>
      {s.keySet && bad.length > 0 && (
        <div className="subbar ended" id="bkpBar" role="alert">
          <Icon name="alert" />
          <span><b>Backup to {bad.map((p) => PLACE[p]).join(' and ')} has not worked for {mins} minutes.</b> Your books are safe on the server; the app keeps trying.{err ? ` ${err}` : ''}</span>
          <button className="lnk2" type="button" onClick={open}>Open backup settings</button>
        </div>
      )}
      {full && (
        <div className="subbar pending" id="spaceBar" role="status">
          <Icon name="alert" />
          <span><b>Space for your books is almost full: {s.space.usedMb} MB of {s.space.limitMb} MB used.</b> When it is full, new entries can’t be saved. Contact support to get more space.</span>
          <button className="lnk2" type="button" onClick={open}>Open backup settings</button>
        </div>
      )}
    </>
  );
}

/** Where to keep backups, one row per place, the daily full copy and the space left; `children` is the Backup file row. */
export function BackupLive({ onDownload, children }: { onDownload: () => void; children?: ReactNode }) {
  const q = useBackup();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const can = useCanManage();
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState<'test' | 'restore' | null>(null);
  useTick();
  const s = q.data;
  const now = s ? nowOf(s, q.dataUpdatedAt) : Date.now();
  const dest = s?.dest ?? null;
  const fail = (e: unknown, what: string) => showToast(e instanceof ApiError ? e.message : what);

  async function pick(d: Dest) {
    if (!can || d === dest) return;
    try {
      qc.setQueryData(BACKUP_KEY, await api<BackupStatus>('/backup/destination', { method: 'PUT', body: { dest: d } }));
      showToast(d === 'both' ? 'Backups go to Google Drive and this computer' : d === 'drive' ? 'Backups go to Google Drive' : 'Backups go to this computer');
    } catch (e) { fail(e, 'Could not change where backups go.'); }
  }
  /** to Google's sign-in; Google sends the owner back to Settings (see SettingsPage) */
  async function connectDrive() {
    try {
      const { url } = await api<{ url: string }>('/backup/drive/connect', { method: 'POST' });
      window.location.assign(url);
    } catch (e) { fail(e, 'Could not open Google sign-in.'); }
  }
  async function backupNow(p: Place) {
    if (busy) return;
    setBusy(true);
    showToast(`Backing up to ${PLACE[p]}…`);
    try {
      const r = await api<{ results: Partial<Record<Place, string>>; status: BackupStatus }>('/backup/now', { method: 'POST' });
      qc.setQueryData(BACKUP_KEY, r.status);
      const x = r.results[p];
      showToast(x === 'sent' || x === 'up_to_date' ? `Backed up to ${PLACE[p]}`
        : x === 'failed' ? (r.status[p]?.error ?? 'The backup didn’t go through. The app keeps trying.')
        : x === 'off' ? 'Backups are not switched on for this server yet.'
        : x === 'busy' ? 'A backup is already on its way.'
        : `${p === 'drive' ? 'Google Drive' : 'This computer'} is not connected yet.`);
    } catch (e) { fail(e, 'Could not start the backup.'); }
    setBusy(false);
  }

  const fm = s?.failMinutes ?? 15;
  const status = (l: Line) => {
    if (l.failingSince) return failMin(l, now) >= fm ? <span className="st r">Not working</span> : <span className="st a">Trying again</span>;
    return l.lastOkAt ? <span className="st g">Working</span> : null;
  };
  const line = (l: Line) => (l.failingSince
    ? `${l.error ?? 'Could not save the backup.'} Last good backup ${l.lastOkAt ? ago(l.lastOkAt, now) : 'never'}${l.waiting ? ` · ${plural(l.waiting, 'change')} waiting` : ''}.`
    : l.lastOkAt ? `Last backup ${ago(l.lastOkAt, now)}.` : 'No backup yet.');
  const pct = s ? Math.min(100, (s.space.usedMb / s.space.limitMb) * 100) : 0;
  const spaceC = pct >= 85 ? 'var(--red,#dc2626)' : pct >= 70 ? 'var(--amber,#d97706)' : 'var(--ac)';
  const drive = s && on(s, 'drive') ? s.drive : null;
  const local = s && on(s, 'local') ? s.local : null;
  // a restore reads from Google Drive when it has a full copy, otherwise from this computer
  const from: Place | null = drive?.lastSnapshotAt ? 'drive' : local?.lastSnapshotAt ? 'local' : null;
  const snap = s?.snapshot.lastAt ?? null;

  return (
    <>
      <p className="mu" style={{ margin: ui.sp('0 0 8px'), fontSize: ui.fs(13) }}>Every change is copied within about a minute, and a full copy is made each day. Backups are locked (encrypted) so only this app can open them.</p>
      {s && !s.keySet && <p className="msg warn" id="bkpOff" style={{ fontSize: ui.fs(13) }}>Backups are not switched on for this server yet. They start once its backup key is set.</p>}
      <div className="rad" role="radiogroup" aria-label="Where to keep backups" id="bkpDest" style={{ gridTemplateColumns: '1fr 1fr 1fr', margin: ui.sp('0 0 12px') }}>
        {([['drive', 'Google Drive', 'In a folder in your Google Drive'], ['local', 'This computer', 'In a folder you choose on this computer'], ['both', 'Both', 'Google Drive and this computer']] as const).map(([k, n, d]) => (
          <label key={k} className={dest === k ? 'on' : ''}><input type="radio" name="bkpDest" value={k} checked={dest === k} disabled={!can || !s} onChange={() => void pick(k)} />{n}<small>{d}</small></label>
        ))}
      </div>
      {drive && (
        <div className="synccard" id="bkpDrive"><span className="ti" style={TI(drive.failingSince || !drive.connected ? 'var(--red)' : '#16a34a')}><RawIcon d={DRIVE} /></span>
          {drive.connected ? (
            <><div className="sx"><b>Google Drive {status(drive)}</b><span>{line(drive)}{drive.folder ? ` Folder “${drive.folder}”${drive.account ? ` in ${drive.account}` : ''}.` : drive.account ? ` Connected to ${drive.account}; the first full copy goes there within a minute.` : ''}</span></div>
              {can && (drive.reconnect
                ? <button className="btn p" type="button" id="bkpDriveAgain" onClick={() => void connectDrive()}>Connect again</button>
                : <button className="btn" type="button" id="bkpDriveNow" disabled={busy} onClick={() => void backupNow('drive')}>Backup now</button>)}</>
          ) : (
            <><div className="sx"><b>Google Drive</b><span>Not connected yet. The app makes a folder in your Drive and can see only the files it makes there.</span></div>
              {can && <button className="btn p" type="button" id="bkpDriveGo" onClick={() => void connectDrive()}>Connect Google Drive</button>}</>
          )}
        </div>
      )}
      {local && (folderOk() ? (
        <div className="synccard" id="bkpLocal"><span className="ti" style={TI(local.failingSince || !local.connected ? 'var(--red)' : '#16a34a')}><RawIcon d={PC} /></span>
          {local.connected ? (
            <><div className="sx"><b>This computer {status(local)}</b><span>{line(local)}{local.folder ? ` Folder “${local.folder}”.` : ''}</span><span className="mu" style={{ display: 'block', fontSize: ui.fs(12), marginTop: ui.sp(4) }}>Works only while this app is open in this browser. After the computer or browser restarts, the browser asks you once to allow the folder again.</span></div>
              {can && <button className="btn" type="button" id="bkpLocalNow" disabled={busy} onClick={() => void backupNow('local')}>Backup now</button>}</>
          ) : (
            <><div className="sx"><b>This computer</b><span>Choose a folder, for example in Documents. Works only while this app is open in this browser; after a restart the browser asks you once to allow it again.</span></div>
              {can && <button className="btn p" type="button" id="bkpLocalPick" onClick={() => showToast('Saving backups into a folder comes in a later update.')}>Choose folder…</button>}</>
          )}
        </div>
      ) : (
        <div className="synccard" id="bkpLocal"><span className="ti" style={TI('var(--amber,#d97706)')}><RawIcon d={PC} /></span>
          <div className="sx"><b>This computer</b><span>This browser can’t save backups into a folder by itself. Open the app in Chrome or Edge for automatic backups, or download a backup by hand.</span></div>
          <button className="btn p" type="button" id="bkpLocalDl" onClick={onDownload}>Download backup</button></div>
      ))}
      {s?.dest && (
        <div className="synccard" id="bkpCloud"><span className="ti" style={TI('var(--ac)')}><RawIcon d={COPY} /></span>
          <div className="sx"><b>Full copy every day</b><span id="bkpSnapTxt">{snap ? `Last full copy ${day(snap) === day(new Date(now).toISOString()) ? 'today' : 'on ' + day(snap)} at ${at(snap)}.` : 'The first full copy is made as soon as a place is connected.'} Restore uses the latest full copy plus every change after it. Try “Test restore” first: it checks the backup without touching your books.</span></div>
          {can && <><button className="btn" type="button" id="bkpTest" disabled={!from} onClick={() => setWin('test')}>Test restore</button><button className="btn dz" type="button" id="bkpRestoreLive" disabled={!from} onClick={() => setWin('restore')}>Restore…</button></>}</div>
      )}
      {children}
      <div className="synccard"><span className="ti" style={TI(spaceC)}><RawIcon d={DB} /></span><div className="sx"><b>Space for your books</b><span id="bkpUseTxt">{s ? `${s.space.usedMb} MB used of ${s.space.limitMb} MB${pct >= 85 ? ' — almost full. When it is full, new entries can’t be saved. Contact support to get more space.' : pct >= 70 ? ' — getting full.' : '.'}` : 'Your books are kept on the server, not on this device.'}</span><div style={{ height: 6, borderRadius: 3, background: 'var(--bd,#e2e8f0)', overflow: 'hidden', marginTop: ui.sp(6) }}><i id="bkpUseBar" style={{ display: 'block', height: '100%', width: Math.max(2, pct) + '%', background: spaceC }}></i></div></div></div>
      {from && <RestoreWindow mode={win} from={from} onClose={() => setWin(null)} />}
    </>
  );
}

type Done = { businessId: string; code: string; name: string };

/**
 * Test restore and Restore (one window, #trm): the backup is always rebuilt and checked first
 * without touching the books; only then can the owner tick "I understand" and restore it, into new books.
 */
function RestoreWindow({ mode, from, onClose }: { mode: 'test' | 'restore' | null; from: Place; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useShell();
  const [r, setR] = useState<TestResult | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const open = !!mode;
  useOpenFocus(open, ref);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setR(null); setErr(''); setOk(false); setBusy(false); setDone(null);
    let live = true;
    api<TestResult>('/backup/test-restore', { body: { from } })
      .then((x) => live && setR(x), (e) => live && setErr(e instanceof ApiError ? e.message : 'Could not check the backup.'));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', esc);
    return () => { live = false; document.removeEventListener('keydown', esc); };
  }, [open, from]);
  async function go() {
    setBusy(true);
    setErr('');
    try {
      setDone(await api<Done>('/backup/restore', { body: { from, confirm: true } }));
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setErr('Restore failed: ' + (e instanceof ApiError ? e.message : 'unknown error'));
    }
    setBusy(false);
  }
  async function openBooks() {
    if (!done) return;
    try {
      await apiWithToken('/businesses/switch', { businessId: done.businessId });
      await qc.invalidateQueries();
      onClose();
      navigate('/');
      showToast(`Opened the restored books (${done.code})`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not open the restored books.'); }
  }
  const restore = mode === 'restore';
  return (
    <div className="ov c" id="trm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'trm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="trmT" style={{ width: 'min(560px,100%)' }}>
        <div className="dh"><div><h3 id="trmT" style={{ margin: 0, fontSize: ui.fs(18) }}>{restore ? 'Restore from backup' : 'Test restore'}</h3><small className="mu" id="trmSub">From {from === 'drive' ? 'Google Drive' : 'this computer'}{r ? ` · full copy of ${when(r.fullCopyAt)} + ${plural(r.changes, 'later change')}` : ''}</small></div><button className="ib" type="button" id="trmClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div id="trmBody" style={{ marginTop: ui.sp(12) }}>
          {!r && !err && <p className="hint" id="trmWait" style={{ margin: 0 }}>Opening the backup and checking it…</p>}
          {r && !done && (
            <>
              <p className={`msg ${r.matches ? 'good' : 'warn'}`} id="trmOk" style={{ margin: ui.sp('0 0 10px'), fontSize: ui.fs(13) }}>{r.matches ? 'The backup opened and checked out. Your books were not touched.' : 'The backup opened. It differs from your books in a few places (changes still on their way, or made after it). Your books were not touched.'}</p>
              <div className="rcv"><div><span>Backed up up to</span><b>{when(r.upTo)}</b></div><div><span>Invoices</span><b>{r.invoices.toLocaleString('en-IN')}</b></div>
                <div><span>Parties</span><b>{r.parties.toLocaleString('en-IN')}</b></div><div><span>Items</span><b>{r.items.toLocaleString('en-IN')}</b></div>
                <div><span>Purchase bills</span><b>{r.purchaseBills.toLocaleString('en-IN')}</b></div><div><span>Payments received</span><b>{r.paymentsReceived.toLocaleString('en-IN')}</b></div>
                <div><span>Sales total this year</span><b>₹{formatInr2(r.salesTotalThisYear)}</b></div><div><span>Matches your books</span><b>{r.matches ? 'Yes' : `No — ${plural(r.differences.length, 'list')} differ`}</b></div></div>
              {restore ? (
                <>
                  <p className="hint" style={{ margin: ui.sp('10px 0') }}>The backup becomes new books, as with Start fresh. Your current books are kept exactly as they are and stay in the shop menu. Staff are invited to the new books again. The restore is written in the activity log.</p>
                  <label className="cb2" style={{ alignItems: 'flex-start' }}><input type="checkbox" id="trmUnderstand" style={{ marginTop: ui.sp(3) }} checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span><b>I understand</b> new books are made from this backup; nothing in the current books changes.</span></label>
                </>
              ) : <p className="hint" style={{ margin: ui.sp('10px 0 0') }}>To really restore, use “Restore…”. The backup becomes new books; your current books are kept as they are.</p>}
            </>
          )}
          {done && <p className="msg good" id="trmDone" style={{ margin: 0, fontSize: ui.fs(13) }}>Restored into new books: {done.name} ({done.code}). Your current books are unchanged and stay in the shop menu.</p>}
        </div>
        <div className="msg bad" id="trmErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', marginTop: ui.sp(12) }}>
          {done ? (
            <><button className="btn" type="button" id="trmStay" onClick={onClose}>Stay in these books</button><button className="btn p" type="button" id="trmOpen" onClick={() => void openBooks()}>Open the restored books</button></>
          ) : restore ? (
            <><button className="btn" type="button" id="trmCancel" onClick={onClose}>Cancel</button><button className="btn dz" type="button" id="trmGo" disabled={!r || !ok || busy} onClick={() => void go()}>{busy ? 'Restoring…' : 'Restore into new books'}</button></>
          ) : <button className="btn p" type="button" id="trmDoneBtn" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}

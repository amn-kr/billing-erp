/**
 * Settings › General › Team (#tmCard): the prototype website's team section (saas-ui.js teamSection),
 * placed just above Backup & restore like there. Invite staff, Remove and Cancel invite as in the
 * prototype; "Reset password" (owner's request, 25 Oct 2026) gives a temporary password, shown once,
 * for staff whose account is used in this shop only.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type TeamMember, type TempPassword } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useShell } from '../shell/store';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { ui } from '../../styles/uiSize';

interface Team { members: TeamMember[]; invites: { id: string; email: string }[] }
const TEAM_KEY = ['members'] as const;
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: ui.sp(10), padding: ui.sp('7px 0'), borderTop: '1px solid var(--bd,#e2e8f0)', fontSize: ui.fs(13) };
const Row = ({ l, r }: { l: ReactNode; r?: ReactNode }) => <div style={ROW}><span style={{ flex: 1, minWidth: 0 }}>{l}</span>{r}</div>;
const until = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const msgOf = (e: unknown, d: string) => (e instanceof ApiError ? e.message : d);

export function TeamCard() {
  const me = useMe().data;
  const qc = useQueryClient();
  const { showToast } = useShell();
  const owner = me?.role === 'owner';
  const team = useQuery({ queryKey: TEAM_KEY, queryFn: () => api<Team>('/members'), enabled: can(me?.permissions, 'members.view') });
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  if (!can(me?.permissions, 'members.view')) return null;
  const reload = () => qc.invalidateQueries({ queryKey: TEAM_KEY });

  async function invite() {
    const em = email.trim().toLowerCase();
    setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setErr('Enter a valid email address.');
    if (em === me?.user.email.toLowerCase()) return setErr('That’s your own email.');
    setBusy(true);
    try {
      // the prototype's staff work in all the books but don't manage the team: our Manager role
      await api('/members/invites', { body: { email: em, role: 'manager' } });
      setEmail('');
      showToast(`Invite sent to ${em}. Ask them to sign in at ${location.host} with this email.`);
      void reload();
    } catch (x) {
      setErr(msgOf(x, 'Couldn’t send the invite.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite(id: string) {
    try {
      await api(`/members/invites/${id}/revoke`, { method: 'POST' });
      showToast('Invite cancelled');
      void reload();
    } catch {
      showToast('Couldn’t cancel the invite');
    }
  }

  function remove(m: TeamMember) {
    setModal({
      title: `Remove ${m.name || m.email}?`, sub: 'They lose access to these books straight away.', body: <p style={{ margin: 0 }}>Their past entries stay in the books.</p>, ok: 'Remove', danger: true,
      onOk: async () => {
        setModal(null);
        try {
          await api(`/members/${m.id}/remove`, { method: 'POST' });
          showToast(`${m.name || m.email} removed`);
          void reload();
        } catch (x) {
          showToast(msgOf(x, 'Couldn’t remove'));
        }
      },
    });
  }

  function reset(m: TeamMember) {
    const n = m.name || m.email;
    setModal({
      title: `Reset ${n}’s password?`, sub: 'They are signed out on every device straight away.', body: <p style={{ margin: 0 }}>You get a temporary password to give them. They choose their own password when they sign in with it.</p>, ok: 'Reset password', danger: true,
      onOk: async () => {
        setModal(null);
        try {
          const t = await api<TempPassword>(`/members/${m.id}/reset-password`, { method: 'POST' });
          setModal({
            title: `Temporary password for ${n}`, sub: 'Shown only once. Give it to them in person.', cancel: 'Done',
            body: (
              <>
                <div style={{ display: 'flex', gap: ui.sp(8) }}><input className="fi mono" id="tmTemp" readOnly value={t.temporaryPassword} aria-label="Temporary password" style={{ margin: 0, flex: 1, fontSize: ui.fs(18), letterSpacing: 1 }} onFocus={(e) => e.target.select()} />
                  <button className="btn" type="button" id="tmCopy" onClick={() => void navigator.clipboard?.writeText(t.temporaryPassword).then(() => showToast('Copied'), () => showToast('Select it and copy'))}>Copy</button></div>
                <p className="hint" style={{ margin: ui.sp('10px 0 0') }}>It works until {until(t.expiresAt)}. When {n} signs in with it, they choose their own password.</p>
              </>
            ),
          });
        } catch (x) {
          showToast(msgOf(x, 'Couldn’t reset the password'));
        }
      },
    });
  }

  const members = (team.data?.members ?? []).filter((m) => m.status === 'active');
  return (
    <>
      <div id="tmCard"><h3 style={{ margin: ui.sp('26px 0 4px'), fontSize: ui.fs(16) }}>Team</h3><p className="mu" style={{ margin: ui.sp('0 0 12px'), fontSize: ui.fs(13) }}>People who can open these books. Each person signs in with their own email.</p>
        {owner && (
          <div className="synccard"><div className="sx"><b>Invite staff</b><span>They sign in at this website with the same email and join your shop.</span>
            <div style={{ display: 'flex', gap: ui.sp(8), marginTop: ui.sp(8), flexWrap: 'wrap' }}><input className="fi" id="tmEmail" type="email" placeholder="staff@email.com" autoComplete="off" style={{ margin: 0, flex: 1, minWidth: 200 }} value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && void invite()} /><button className="btn p" type="button" id="tmInvite" disabled={busy} onClick={() => void invite()}>Send invite</button></div>
            <div className="msg bad" id="tmErr" role="alert">{err}</div></div></div>
        )}
        <div className="synccard"><div className="sx"><b>Members</b><div id="tmList" style={{ marginTop: ui.sp(6) }}>
          {team.isError ? 'Couldn’t load the team right now.' : (
            <>
              {members.map((m) => {
                const isOwner = m.role === 'owner';
                const you = m.userId === me?.user.id;
                return (
                  <Row key={m.id} l={<><b>{m.name || m.email}</b> <small className="mu">{m.email}{you ? ' · you' : ''}</small></>}
                    r={<><span className={`st ${isOwner ? 'g' : 'b'}`}>{isOwner ? 'Owner' : 'Staff'}</span>
                      {owner && !isOwner && <button className="btn sm" type="button" data-tmrp={m.id} disabled={m.inOtherShops} title={m.inOtherShops ? 'Uses this account in another shop: they can use “Forgot password?” on the sign-in page.' : undefined} onClick={() => reset(m)}>Reset password</button>}
                      {owner && !isOwner && <button className="btn sm dz" type="button" data-tmrm={m.id} onClick={() => remove(m)}>Remove</button>}</>} />
                );
              })}
              {(team.data?.invites ?? []).map((i) => (
                <Row key={i.id} l={<><b>{i.email}</b> <small className="mu">invited · not joined yet</small></>} r={owner ? <button className="btn sm" type="button" data-tmcx={i.id} onClick={() => void cancelInvite(i.id)}>Cancel invite</button> : undefined} />
              ))}
            </>
          )}
        </div></div></div>
      </div>
      <SlModal m={modal} onClose={() => setModal(null)} />
    </>
  );
}

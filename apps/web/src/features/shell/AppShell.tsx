/**
 * The app frame: <div class="app" id="app"> with sidebar, top bar and <main class="page">.
 * Same DOM as the prototype; screens render inside <main> through the router.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiWithToken, signOut, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useSession } from '../../lib/session';
import { today as todayFn } from '../../lib/time';
import { useStyles } from '../../lib/useStyles';
import { goToLogin } from '../../lib/nav';
import { APP_STYLES } from '../../styles';
import { VIEW_LABEL, VIEW_PATH, type NavLink } from './nav';
import { PAL, type PalId } from './palette';
import { Sidebar } from './Sidebar';
import { SignOutDialog } from './SignOutDialog';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { readLocal, soon, useShell, write } from './store';

const savedPal = (): PalId => {
  const s = readLocal('erp-pal');
  return (PAL.some((p) => p.id === s) ? s : 'ledger') as PalId;
};

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function GoLogin({ query = '' }: { query?: string }) {
  useEffect(() => goToLogin(query), [query]);
  return null;
}

export function AppShell() {
  useStyles(APP_STYLES, 'app');
  const token = useSession((s) => s.accessToken);
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { mini, dialog, setDialog, closeAll, setPop, setPal, showToast } = useShell();
  const [pal, setPalId] = useState<PalId>(savedPal);
  const online = useOnline();
  const business = me.data?.business ?? null;

  /* html/body attributes the prototype's CSS keys off (data-pal, data-gst, data-sub, body classes) */
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.pal = pal;
    if (business) {
      html.dataset.gst = business.gstEnabled ? 'on' : 'off';
      html.dataset.sub = business.plan === 'expired' ? 'ended' : business.plan === 'paid' ? 'active' : 'trial';
    }
    document.body.className = 'nocur nomrp';
    document.title = 'Billing ERP – Dashboard';
  }, [pal, business]);
  useLayoutEffect(
    () => () => {
      const html = document.documentElement;
      delete html.dataset.pal;
      delete html.dataset.gst;
      delete html.dataset.sub;
      document.body.className = '';
    },
    [],
  );

  /* prototype: clicks outside a .pop close it; outside .palw closes the palette; outside the drawer closes it */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.pop')) setPop(null);
      if (!t.closest('.palw')) setPal(false);
      const side = document.getElementById('side');
      if (side?.classList.contains('open') && !side.contains(t) && t.id !== 'menuBtn') useShell.getState().setSideOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('q')?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [closeAll, setPop, setPal]);

  const onView = useCallback(
    (view: string, link?: NavLink) => {
      useShell.getState().setSideOpen(false);
      const path = VIEW_PATH[view];
      if (path) navigate(path);
      else soon(link?.rsec ? link.label : VIEW_LABEL[view] ?? view);
    },
    [navigate],
  );

  if (!token) return <GoLogin />;
  if (me.error instanceof ApiError && me.error.status === 403 && me.error.code === 'removed') return <GoLogin query="?removed=1" />;
  if (me.isError) return <GoLogin />;
  if (!me.data) return null;
  if (!me.data.business) return <GoLogin />;

  const active = Object.entries(VIEW_PATH).find(([, p]) => p === location.pathname)?.[0] ?? '';

  return (
    <>
      <div className={mini ? 'app mini' : 'app'} id="app">
        <Sidebar active={active} lowStock={0} onView={onView} onSoon={soon} />
        <div style={{ minWidth: 0 }}>
          <TopBar
            me={me.data}
            today={todayFn()}
            pal={pal}
            online={online}
            onPal={(id) => {
              setPalId(id);
              write('erp-pal', id);
              showToast(`${PAL.find((p) => p.id === id)!.name} applied`);
            }}
            onView={onView}
            onSoon={soon}
            onSwitch={async (businessId) => {
              try {
                await apiWithToken('/businesses/switch', { businessId });
                await qc.invalidateQueries();
                navigate('/');
              } catch (e) {
                showToast(e instanceof ApiError ? e.message : 'Could not switch business.');
              }
            }}
            onAddBusiness={() => goToLogin('?new=1')}
            onSignOut={() => setDialog('so')}
            onSearch={(q) => showToast(`Search for “${q}” comes with the Sales screen`)}
          />
          <main className="page">
            <div className="subbar" id="subBar" hidden role="status"></div>
            <Outlet context={me.data} />
          </main>
        </div>
      </div>
      <SignOutDialog
        open={dialog === 'so'}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          setDialog(null);
          await signOut();
          goToLogin();
        }}
      />
      <Toast />
    </>
  );
}

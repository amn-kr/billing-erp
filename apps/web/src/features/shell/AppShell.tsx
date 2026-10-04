/**
 * The app frame: <div class="app" id="app"> with sidebar, top bar and <main class="page">.
 * Same DOM as the prototype; screens render inside <main> through the router.
 */
import { QuickSale, useQuick } from '../sales/QuickSale';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithToken, signOut, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useSession } from '../../lib/session';
import { today as todayFn } from '../../lib/time';
import { useStyles } from '../../lib/useStyles';
import { curStart, curStop } from '../../lib/currency';
import { useSettings } from '../../lib/settings';
import { goToLogin } from '../../lib/nav';
import { setGo } from '../../lib/go';
import { APP_STYLES } from '../../styles';
import { VIEW_LABEL, VIEW_PATH, type NavLink } from './nav';
import { PAL, type PalId } from './palette';
import { Sidebar } from './Sidebar';
import { SignOutDialog } from './SignOutDialog';
import { Toast } from './Toast';
import { DiscardDialog } from '../../components/Discard';
import { TopBar } from './TopBar';
import type { Item } from '../items/ItemsPage';
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
  const settings = useSettings();
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
    document.title = 'Billing ERP – Dashboard';
  }, [pal, business]);
  // Settings › General: currency symbol and MRP switches (body classes + the prototype's ₹ remover)
  const sdata = settings.data?.data as { showCurrency?: boolean; mrp?: boolean; acct?: boolean } | undefined;
  const curOn = !!sdata?.showCurrency;
  const mrpOn = !!sdata?.mrp;
  useLayoutEffect(() => {
    document.body.classList.toggle('nocur', !curOn);
    document.body.classList.toggle('nomrp', !mrpOn);
    if (curOn) curStop();
    else curStart();
  }, [curOn, mrpOn]);
  useLayoutEffect(() => () => curStop(), []);
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

  useEffect(() => setGo(navigate), [navigate]);
  // entry points that now open real screens (the rest still say "coming next")
  const act = useCallback(
    (what: string) => {
      // a fresh address each time, so pressing it inside the editor opens another bill (or the empty one)
      if (what === 'New invoice') navigate(`/sales/new?n=${Date.now()}`);
      else if (/^(Receive payment|Payments|New payment received)$/i.test(what)) navigate('/payments-received?party=');
      else if (/^New delivery challan$/i.test(what)) navigate('/delivery-challans?new=1');
      else soon(what);
    },
    [navigate],
  );
  // Alt shortcuts, like desktop billing software (prototype KS): Alt+S new invoice, Alt+R receive payment, Alt+N quick sale
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if ([...document.querySelectorAll<HTMLElement>('.ov')].some((o) => !o.hidden)) return;
      if (e.code === 'KeyS') { e.preventDefault(); act('New invoice'); }
      else if (e.code === 'KeyR') { e.preventDefault(); act('Receive payment'); }
      else if (e.code === 'KeyN') { e.preventDefault(); useQuick.getState().show(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [act]);

  const onView = useCallback(
    (view: string, link?: NavLink) => {
      useShell.getState().setSideOpen(false);
      const path = VIEW_PATH[view];
      if (path) navigate(path);
      else soon(link?.rsec ? link.label : VIEW_LABEL[view] ?? view);
    },
    [navigate],
  );

  // Items & stock counter, as the prototype's home refresh sets it: goods with a minimum, at or below it
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items'), enabled: !!me.data?.business });
  const lowStock = (items.data ?? []).filter((i) => i.kind === 'goods' && Number(i.minStock) > 0 && Number(i.stock ?? 0) <= Number(i.minStock)).length;

  if (!token) return <GoLogin />;
  if (me.error instanceof ApiError && me.error.status === 403 && me.error.code === 'removed') return <GoLogin query="?removed=1" />;
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) return <GoLogin />;
  if (!me.data) return null;
  if (!me.data.business) return <GoLogin />;

  const active = Object.entries(VIEW_PATH).find(([, p]) => p === location.pathname)?.[0] ?? '';

  return (
    <>
      <div className={mini ? 'app mini' : 'app'} id="app">
        <Sidebar active={active} lowStock={lowStock} acct={!!sdata?.acct} onView={onView} onSoon={act} />
        <div style={{ minWidth: 0 }}>
          <TopBar
            me={me.data}
            today={todayFn()}
            lowItems={(items.data ?? []).filter((i) => i.kind === 'goods' && i.level !== 'ok').length}
            pal={pal}
            online={online}
            onPal={(id) => {
              setPalId(id);
              write('erp-pal', id);
              showToast(`${PAL.find((p) => p.id === id)!.name} applied`);
            }}
            onView={onView}
            onSoon={act}
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
      <DiscardDialog />
      <QuickSale />
    </>
  );
}

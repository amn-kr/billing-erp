/**
 * Settings (#vSet) — the prototype's hero, sub-menu (SUB / SETTABS / setTab) and
 * its three working tabs: Taxes & GST, Items (price lists) and General.
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icon-paths';
import { soon, useShell } from '../shell/store';
import { useMe } from '../../lib/me';
import { GeneralTab } from './GeneralTab';
import { ItemCards } from './ItemsTab';
import { showCard } from './BackupCard';
import { useS, useSetTab, type SetTab } from './model';
import { TxnCards } from './TxnTab';
import { TaxCards, TaxList, TaxPreview } from './TaxTab';
import { PrintCards, PrintPreview, PrinterTabs, ThermalSoon, usePrint } from './PrintTab';

const SUB: [IconName, string, string?][] = [['crown', 'Subscription', 'sub'], ['gear', 'General'], ['receipt', 'Transactions'], ['doc', 'Print & invoice'], ['pct', 'Taxes & GST'], ['chat', 'Messages'], ['users', 'Parties'], ['box', 'Items'], ['bell', 'Reminders'], ['book', 'Accounting'], ['swap', 'Multi-currency']];
const SETTABS: Record<string, SetTab> = { 'Print & invoice': 'print', 'Taxes & GST': 'tax', Transactions: 'txn', Items: 'items', General: 'gen' };
const LIST = '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>';
const HEAD = {
  tax: ['Taxes & GST', 'Turn tax features on or off. Changes save on their own and apply across the app.'],
  txn: ['Transactions', 'How sales, purchases and payments are numbered and what their header shows. Changes save on their own.'],
  items: ['Items', 'Choose what your item screens show. Only the shop owner can change this. Changes save on their own.'],
  gen: ['General', 'App-wide display preferences. Changes save on their own.'],
  print: ['Print & invoice', 'Choose how your printed invoices look. Changes save on their own and apply to every preview, print and PDF.'],
} as const;
/** back from Google's sign-in (Settings › General › Backup & restore › Connect Google Drive) */
const DRIVE_BACK: Record<string, string> = {
  connected: 'Google Drive connected. The first full copy goes there within a minute.',
  cancelled: 'Google Drive was not connected: the sign-in at Google was cancelled.',
  failed: 'Couldn’t connect Google Drive. Please try again.',
};

/** The old address of the Features page: its switches are on Settings › Items now (owner only; anyone else gets Settings as usual). */
export function OldFeaturesPage() {
  const { set } = useSetTab();
  useEffect(() => set('items'), [set]);
  return <Navigate to="/settings" replace />;
}

export function SettingsPage() {
  const { tab: openTab, set } = useSetTab();
  // Items is for the shop's owner only, also when the owner left it open in this browser and someone else signed in
  const owner = useMe().data?.role === 'owner';
  const tab = openTab === 'items' && !owner ? 'tax' : openTab;
  const { S, taxes, ready } = useS();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useShell();
  const [tl, setTl] = useState(false);
  const printer = usePrint((s) => s.printer);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get('drive');
    if (!r) return;
    set('gen');
    showToast(DRIVE_BACK[r] ?? DRIVE_BACK.failed!);
    navigate('/settings', { replace: true });
    setTimeout(() => showCard(), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
  if (!ready) return <section id="vSet"></section>;
  const isTax = tab === 'tax';
  const pr = tab === 'print' && printer === 'regular';
  return (
    <section id="vSet">
      <div className="hero">
        <div><div className="crumb"><a href="#" data-view="dash" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Dashboard</a> / Settings</div><h1 id="setH">{HEAD[tab][0]}</h1><p id="setP">{HEAD[tab][1]}</p></div>
        <div className="acts"><button className="btn" id="taxListBtn" style={isTax ? undefined : { display: 'none' }} onClick={() => setTl(true)}><svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: LIST }} />Tax list <span className="cnt" id="tlCount">{taxes.length}</span></button></div>
      </div>
      <div className={`setg${isTax || pr ? '' : ' one'}`}>
        <nav className="card subnav" id="subnav" aria-label="Settings sections">
          {SUB.map(([ic, label, view]) => {
            const t = SETTABS[label];
            const on = !!t && t === tab;
            // Accounting shows only with the Accounting module on (General › Modules)
            const hide = (label === 'Accounting' && !S.acct) || (label === 'Items' && !owner);
            return (
              <button key={label} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} data-settab={!on && t ? t : undefined} data-view={!on && !t ? view : undefined} data-soon={!on && !t && !view ? `${label} settings` : undefined}
                hidden={hide || undefined} style={hide ? { display: 'none' } : undefined}
                onClick={() => (t ? set(t) : view ? soon('Subscription') : soon(`${label} settings`))}><Icon name={ic} />{label}</button>
            );
          })}
        </nav>
        <div className="setc">
          {isTax ? <TaxCards /> : null}
          {tab === 'items' && <ItemCards />}
          {tab === 'gen' && <GeneralTab />}
          {tab === 'print' && <><PrinterTabs />{pr ? <PrintCards /> : <ThermalSoon />}</>}
          {tab === 'txn' && <TxnCards />}
        </div>
        {isTax ? <TaxPreview /> : pr ? <PrintPreview /> : <aside className="card pv" id="pv" hidden></aside>}
      </div>
      <TaxList open={tl} onClose={() => setTl(false)} />
    </section>
  );
}

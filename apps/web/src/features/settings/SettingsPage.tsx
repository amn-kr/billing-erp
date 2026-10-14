/**
 * Settings (#vSet) — the prototype's hero, sub-menu (SUB / SETTABS / setTab) and
 * its three working tabs: Taxes & GST, Items (price lists) and General.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icon-paths';
import { soon, useShell } from '../shell/store';
import type { PriceList } from '../prices/model';
import { GeneralTab } from './GeneralTab';
import { showCard } from './BackupCard';
import { ITEM_PREFIX } from '@billing/shared';
import { Sw, useS, useSaveS, useSetTab, type SetTab } from './model';
import { TaxCards, TaxList, TaxPreview } from './TaxTab';
import { PrintCards, PrintPreview, PrinterTabs, ThermalSoon, usePrint } from './PrintTab';

const SUB: [IconName, string, string?][] = [['crown', 'Subscription', 'sub'], ['gear', 'General'], ['receipt', 'Transactions'], ['doc', 'Print & invoice'], ['pct', 'Taxes & GST'], ['chat', 'Messages'], ['users', 'Parties'], ['box', 'Items'], ['bell', 'Reminders'], ['book', 'Accounting'], ['swap', 'Multi-currency']];
const SETTABS: Record<string, SetTab> = { 'Print & invoice': 'print', 'Taxes & GST': 'tax', Items: 'items', General: 'gen' };
const LIST = '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>';
const HEAD = {
  tax: ['Taxes & GST', 'Turn tax features on or off. Changes save on their own and apply across the app.'],
  items: ['Items & prices', 'Choose which price lists you use. Changes save on their own and apply across the app.'],
  gen: ['General', 'App-wide display preferences. Changes save on their own.'],
  print: ['Print & invoice', 'Choose how your printed invoices look. Changes save on their own and apply to every preview, print and PDF.'],
} as const;
/** back from Google's sign-in (Settings › General › Backup & restore › Connect Google Drive) */
const DRIVE_BACK: Record<string, string> = {
  connected: 'Google Drive connected. The first full copy goes there within a minute.',
  cancelled: 'Google Drive was not connected: the sign-in at Google was cancelled.',
  failed: 'Couldn’t connect Google Drive. Please try again.',
};
const ruleTxt = (p: PriceList) => (p.rule === 'base' ? 'Same as item sale price' : p.rule === 'disc' ? `${Number(p.value)}% off sale price` : `Purchase price + ${Number(p.value)}%`);

export function SettingsPage() {
  const { tab, set } = useSetTab();
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
            const hide = label === 'Accounting' && !S.acct;
            return (
              <button key={label} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} data-settab={!on && t ? t : undefined} data-view={!on && !t ? view : undefined} data-soon={!on && !t && !view ? `${label} settings` : undefined}
                hidden={hide || undefined} style={hide ? { display: 'none' } : undefined}
                onClick={() => (t ? set(t) : view ? soon('Subscription') : soon(`${label} settings`))}><Icon name={ic} />{label}</button>
            );
          })}
        </nav>
        <div className="setc">
          {isTax ? <TaxCards /> : null}
          <section className="card" id="cPlSet" hidden={tab !== 'items'}>{tab === 'items' && <PriceListSwitches />}</section>
          {tab === 'gen' && <GeneralTab />}
          {tab === 'print' && <><PrinterTabs />{pr ? <PrintCards /> : <ThermalSoon />}</>}
        </div>
        {isTax ? <TaxPreview /> : pr ? <PrintPreview /> : <aside className="card pv" id="pv" hidden></aside>}
      </div>
      <TaxList open={tl} onClose={() => setTl(false)} />
    </section>
  );
}

/** Settings › Items: turn price lists on or off (the prototype's renderPlSet). */
function PriceListSwitches() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api<PriceList[]>('/price-lists') });
  const toggle = async (p: PriceList, on: boolean) => {
    qc.setQueryData<PriceList[]>(['price-lists'], (o) => o?.map((x) => (x.id === p.id ? { ...x, active: on } : x)));
    try {
      await api(`/price-lists/${p.id}`, { method: 'PATCH', body: { active: on } });
      showToast(`${p.name} ${on ? 'turned on' : 'turned off and hidden'}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not change the price list.');
    } finally {
      await Promise.all(['price-lists', 'prices'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    }
  };
  return (
    <>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Price lists</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>Turn off the lists you don’t use. A turned-off list is hidden from the Price lists page, Price manager, rate lists and invoices. Its prices are kept, so you can turn it back on any time.</p>
      {(lists.data ?? []).map((p) => (
        <div className="tgl plset" key={p.id}><div className="tx"><b>{p.name}{p.isDefault && <> <span className="st g">Always on</span></>}</b><small>{ruleTxt(p)}{Number(p.roundTo) ? ` · rounded to ₹${Number(p.roundTo)}` : ''}{p.groups.length ? ` · used for ${p.groups.join(', ')}` : ''}</small></div>
          {p.isDefault ? <label className="tgs" title="The default list can’t be turned off"><input type="checkbox" checked disabled aria-label={`${p.name} (always on)`} readOnly /><i></i></label> : <Sw id={`plA_${p.id}`} on={p.active} label={p.name} onChange={(v) => void toggle(p, v)} />}</div>
      ))}
      <ItemCodePrefix />
    </>
  );
}

/** Settings › Items: the prefix of codes made by "Assign code" in Add item (JE → JE001, JE002, …). */
function ItemCodePrefix() {
  const { S } = useS();
  const save = useSaveS();
  const { showToast } = useShell();
  const [v, setV] = useState(S.itemPrefix);
  const ok = ITEM_PREFIX.test(v);
  const commit = () => {
    if (!ok || v === S.itemPrefix) return;
    void save({ data: { itemPrefix: v } });
    showToast(v ? `New item codes will start with ${v}, e.g. ${v}001` : 'New item codes will be numbers only, e.g. 001');
  };
  return (
    <>
      <h3 style={{ margin: '22px 0 4px', fontSize: 16 }}>Item codes</h3><p className="mu" style={{ margin: '0 0 14px', fontSize: 13 }}>“Assign code” in Add item gives the next free code: this prefix and a 3 to 5 digit number, e.g. {v || ''}001. Changing it affects only new codes; items you already have keep theirs.</p>
      <div className="two plset"><label className="fl" htmlFor="sItemPrefix">Item code prefix<input className="fi mono" id="sItemPrefix" value={v} placeholder="e.g. JE" maxLength={6} autoComplete="off" onChange={(e) => setV(e.target.value.toUpperCase().replace(/\s/g, ''))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label><span></span></div>
      <p className="xperr" id="sItemPrefixErr" hidden={ok}>Use up to 6 letters (A to Z), e.g. JE.</p>
    </>
  );
}

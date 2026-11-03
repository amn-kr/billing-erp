/**
 * Settings › Items, for the shop's owner only (owner's request, 3 Nov 2026; approved mock, no prototype design):
 * every item switch on one page in four tabs. A real box is shown only for what works today; what doesn't exist
 * yet is greyed with a Coming soon tag and saves nothing. Unticking asks first, because the screens go away for
 * everyone; nothing is deleted. Switches are in packages/shared/src/features.ts, labels in item-options.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BATCH_DATE_FORMATS, BATCH_DATE_FORMAT_NAMES, ITEM_LABEL_DEFAULTS, ITEM_PREFIX, featureInfo, featureName, featureNames, featureNeededBy, featuresNeeded, itemFieldOn, toggleFeature, toggleItemField, type BatchDateFormat, type FeatureKey, type ItemField, type ItemLabel, type ItemOptions, type MeResponse } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useFeatures, useItemOptions } from '../../lib/features';
import { ME_KEY } from '../../lib/me';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { ui } from '../../styles/uiSize';
import type { PriceList } from '../prices/model';
import { Sw, useS, useSaveS } from './model';

const TABS = ['Item settings', 'Price & units', 'Batch & serial tracking', 'Custom fields'] as const;
const ruleTxt = (p: PriceList) => (p.rule === 'base' ? 'Same as item sale price' : p.rule === 'disc' ? `${Number(p.value)}% off sale price` : `Purchase price + ${Number(p.value)}%`);
const OFF_NOTE = 'Unticking only hides the boxes and screens. Your data stays, and ticking again brings everything back.';

const Heading = ({ title, note, top }: { title: string; note?: string; top?: boolean }) => (
  <><h3 style={{ margin: ui.sp(`${top ? '22px' : '0'} 0 4px`), fontSize: ui.fs(16) }}>{title}</h3>{note && <p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(13) }}>{note}</p>}</>
);
const Tag = ({ children }: { children: ReactNode }) => <span className="st g">{children}</span>;
const SOON = <span className="st q">Coming soon</span>;

/** One line of the page: tick box, name with its tag, what it does, and its label and format boxes. */
function Row({ id, name, note, on, locked, grey, tag, right, onChange }: { id?: string; name: string; note?: ReactNode; on?: boolean; locked?: boolean; grey?: boolean; tag?: ReactNode; right?: ReactNode; onChange?: (on: boolean) => void }) {
  return (
    <div className="tgl plset" style={grey ? { opacity: 0.55 } : undefined} data-box={id}>
      <label className="cb2" style={{ marginTop: ui.sp(2) }}><input type="checkbox" id={id} checked={!!on} disabled={locked || grey} aria-label={name} onChange={(e) => onChange?.(e.target.checked)} /></label>
      <div className="tx"><b>{name}{tag ? <> {tag}</> : null}</b>{note ? <small>{note}</small> : null}</div>
      {right}
    </div>
  );
}
const Soon = ({ name, note, right }: { name: string; note?: string; right?: ReactNode }) => <Row name={name} note={note} grey tag={SOON} right={right} />;
const SoonHeading = () => <Heading top title="Coming soon" note="Not in the app yet. These can’t be ticked and change nothing." />;

interface Ask { name: string; also?: string; next: FeatureKey[] }
/** Saving the switches and the labels. */
function useItemSwitches() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const enabled = useFeatures();
  const options = useItemOptions();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const patchMe = (b: Partial<NonNullable<MeResponse['business']>>) => qc.setQueriesData<MeResponse>({ queryKey: ME_KEY }, (o) => (o?.business ? { ...o, business: { ...o.business, ...b } } : o));
  const save = async (next: FeatureKey[], done: string) => {
    setBusy(true);
    try {
      const r = await api<{ features: FeatureKey[] }>('/settings/features', { method: 'PUT', body: { enabled: next } });
      patchMe({ features: r.features });
      showToast(done);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not change that setting.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const saveOptions = async (next: ItemOptions, done: string) => {
    try {
      const r = await api<{ itemOptions: ItemOptions }>('/settings/item-options', { method: 'PUT', body: next });
      patchMe({ itemOptions: r.itemOptions });
      showToast(done);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save that.', 'error');
    }
  };
  const turnedOn = (name: string, also: readonly FeatureKey[]) => (also.length ? `${name} turned on, with ${featureNames(also)}` : `${name} turned on`);
  /** A box stored when on. */
  const feature = (key: FeatureKey): { id: string; name: string; note: string; on: boolean; locked: boolean; tag?: ReactNode; onChange: (on: boolean) => void } => {
    const on = enabled.includes(key), by = featureNeededBy(enabled, key);
    return {
      id: `f_${key}`, name: featureName(key), note: featureInfo(key).description, on, locked: !!by.length || busy, tag: by.length ? <Tag>Needed by {featureNames(by)}</Tag> : undefined,
      onChange: (v) => (v ? void save(toggleFeature(enabled, key, true), turnedOn(featureName(key), featuresNeeded(key).filter((k) => !enabled.includes(k)))) : setAsk({ name: featureName(key), next: toggleFeature(enabled, key, false) })),
    };
  };
  /** A box stored when off. */
  const field = (f: ItemField): { id: string; name: string; note: string; on: boolean; locked: boolean; onChange: (on: boolean) => void } => {
    const key = `no_${f}` as FeatureKey, name = featureName(key);
    return {
      id: `f_${f}`, name, note: featureInfo(key).description, on: itemFieldOn(enabled, f), locked: busy,
      onChange: (v) => (v
        ? void save(toggleItemField(enabled, f, true), f === 'series' && !itemFieldOn(enabled, 'brand') ? `${name} turned on, with Brand` : `${name} turned on`)
        : setAsk({ name, also: f === 'brand' && itemFieldOn(enabled, 'series') ? 'Series turns off with it, because a series belongs to a brand.' : undefined, next: toggleItemField(enabled, f, false) })),
    };
  };
  return { options, saveOptions, feature, field, itemFieldOn: (f: ItemField) => itemFieldOn(enabled, f), on: (k: FeatureKey) => enabled.includes(k), ask, setAsk, confirm: (a: Ask) => { setAsk(null); void save(a.next, `${a.name} turned off. Your data is kept.`); } };
}
type Switches = ReturnType<typeof useItemSwitches>;

/** A label box: saved when you leave it. Empty or the usual word means screens keep the words they use today. */
function LabelBox({ k, sw, width = 150 }: { k: ItemLabel; sw: Switches; width?: number }) {
  const saved = sw.options.labels[k] ?? ITEM_LABEL_DEFAULTS[k];
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  const commit = () => {
    const t = v.trim();
    const { [k]: _, ...others } = sw.options.labels;
    if (!t || t === ITEM_LABEL_DEFAULTS[k]) {
      setV(ITEM_LABEL_DEFAULTS[k]);
      if (sw.options.labels[k]) void sw.saveOptions({ ...sw.options, labels: others }, `Label back to ${ITEM_LABEL_DEFAULTS[k]}`);
      return;
    }
    if (t !== saved) void sw.saveOptions({ ...sw.options, labels: { ...others, [k]: t } }, `Label changed to ${t}`);
  };
  return <label className="fl" htmlFor={`lb_${k}`} style={{ margin: 0, width: ui.w(width), flex: 'none' }}>Label<input className="fi" id={`lb_${k}`} value={v} maxLength={20} autoComplete="off" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label>;
}
function FormatBox({ k, sw }: { k: 'expFormat' | 'mfgFormat'; sw: Switches }) {
  const change = (v: BatchDateFormat) => {
    const { [k]: _, ...others } = sw.options;
    void sw.saveOptions(v === 'month' ? others : { ...others, [k]: v }, `Date format changed to ${v === 'month' ? 'Mar 2027' : v}`);
  };
  return <label className="fl" htmlFor={`fmt_${k}`} style={{ margin: 0, width: ui.w(196), flex: 'none' }}>Date format<select className="fi" id={`fmt_${k}`} value={sw.options[k] ?? 'month'} onChange={(e) => change(e.target.value as BatchDateFormat)}>{BATCH_DATE_FORMATS.map((f) => <option key={f} value={f}>{BATCH_DATE_FORMAT_NAMES[f]}</option>)}</select></label>;
}
const Both = ({ children }: { children: ReactNode }) => <div style={{ display: 'flex', gap: ui.sp(10), flex: 'none' }}>{children}</div>;

function ItemSettingsTab({ sw }: { sw: Switches }) {
  const loc = sw.field('location');
  return (
    <section className="card" id="cItemSet">
      <Heading title="Item settings" note={OFF_NOTE} />
      <Row name="Enable item" on locked tag={<Tag>Always on</Tag>} note="Items, stock and prices are the heart of the app, so this stays on." />
      <Row {...sw.field('category')} />
      <Row {...sw.field('brand')} />
      <Row {...sw.field('series')} />
      <Row {...loc} right={loc.on ? <LabelBox k="location" sw={sw} /> : undefined} />
      <ItemCodePrefix />
      <SoonHeading />
      <Soon name="What do you sell" note="Product or Service" />
      <Soon name="Barcode scan" />
      <Soon name="Direct barcode scan" />
      <Soon name="Show low stock dialog" />
      <Soon name="Manufacturing" />
    </section>
  );
}

function PriceUnitsTab({ sw }: { sw: Switches }) {
  const mrp = sw.feature('mrp');
  return (
    <section className="card" id="cPriceUnit">
      <Heading title="Price & units" note={OFF_NOTE} />
      <Row {...mrp} right={mrp.on ? <LabelBox k="mrp" sw={sw} /> : undefined} />
      <Row {...sw.feature('pack_loose')} />
      <Row id="f_unit" name="Items unit" on locked tag={<Tag>Always on</Tag>} note="Every item has a unit, because stock, bills and print all count in it." />
      <Row id="f_default_unit" name="Default unit" on locked tag={<Tag>On with Items unit</Tag>} note="The unit a new item starts with. Stays ticked while Items unit is on." right={<DefaultUnit sw={sw} />} />
      <Row name="List price" on locked tag={<Tag>Always on</Tag>} note="The brand’s list price (LP) in Price manager and pricing rules." />
      <PriceListSwitches />
      <SoonHeading />
      <Soon name="Party wise item rate" note="Your price lists work per party group, not per party." />
      <Soon name="Wholesale price" note="An automatic rate from a minimum quantity on the bill." />
      <Soon name="Item wise tax" />
      <Soon name="Item wise discount" />
      <Soon name="Update sale price from transaction" />
      <Soon name="Calculate tax based on MRP" />
      <Soon name="Quantity decimal places" />
    </section>
  );
}

function DefaultUnit({ sw }: { sw: Switches }) {
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ units: { code: string; name: string }[] }>('/catalogue') });
  const change = (code: string) => {
    const { defaultUnit: _, ...others } = sw.options;
    void sw.saveOptions(code === 'PCS' ? others : { ...others, defaultUnit: code }, `New items will start with ${code}`);
  };
  return (
    <label className="fl" htmlFor="dfUnit" style={{ margin: 0, width: ui.w(196), flex: 'none' }}>Unit
      <select className="fi" id="dfUnit" value={sw.options.defaultUnit ?? 'PCS'} onChange={(e) => change(e.target.value)}>
        {(cat.data?.units ?? [{ code: sw.options.defaultUnit ?? 'PCS', name: '' }]).map((u) => <option key={u.code} value={u.code}>{u.name ? `${u.code} (${u.name})` : u.code}</option>)}
      </select>
    </label>
  );
}

function BatchTab({ sw }: { sw: Switches }) {
  const exp = sw.feature('exp_date'), mfg = sw.feature('mfg_date'), batch = sw.feature('batch_no');
  const label = (name: string, k: string) => <label className="fl" htmlFor={`lb_${k}`} style={{ margin: 0, width: ui.w(150), flex: 'none' }}>Label<input className="fi" id={`lb_${k}`} value={name} disabled style={{ cursor: 'not-allowed' }} /></label>;
  return (
    <section className="card" id="cBatch">
      <Heading title="Batch & serial tracking" note={OFF_NOTE} />
      <Row {...batch} note={batch.on && !exp.on ? `${batch.note} Without Exp Date, selling uses the oldest batch first.` : batch.note} right={batch.on ? <LabelBox k="batch" sw={sw} /> : undefined} />
      <Row {...exp} right={exp.on ? <Both><LabelBox k="exp" sw={sw} width={120} /><FormatBox k="expFormat" sw={sw} /></Both> : undefined} />
      <Row {...mfg} right={mfg.on ? <Both><LabelBox k="mfg" sw={sw} width={120} /><FormatBox k="mfgFormat" sw={sw} /></Both> : undefined} />
      <SoonHeading />
      <Soon name="Model No." right={label('Model No.', 'model')} />
      <Soon name="Size" right={label('Size', 'size')} />
      <Soon name="Serial No." right={label('Serial No.', 'serial')} />
    </section>
  );
}

const CustomFieldsTab = () => (
  <section className="card" id="cCustom"><div style={{ display: 'flex', alignItems: 'center', gap: ui.sp(10) }}><button type="button" className="btn" id="itCustom" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>Add custom fields</button>{SOON}</div></section>
);

export function ItemCards() {
  const [tab, setTab] = useState(0);
  const sw = useItemSwitches();
  return (
    <>
      <div className="seg2" role="tablist" id="itTabs" aria-label="Item settings">
        {TABS.map((t, k) => <button role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'on' : ''} key={t} data-ittab={k} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      {tab === 0 && <ItemSettingsTab sw={sw} />}
      {tab === 1 && <PriceUnitsTab sw={sw} />}
      {tab === 2 && <BatchTab sw={sw} />}
      {tab === 3 && <CustomFieldsTab />}
      <ConfirmOff ask={sw.ask} onClose={() => sw.setAsk(null)} onYes={sw.confirm} />
    </>
  );
}

/** Price lists (the prototype's renderPlSet): turn them on or off. */
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
    <div id="cPlSet">
      <h3 style={{ margin: ui.sp('22px 0 4px'), fontSize: ui.fs(16) }}>Price lists</h3><p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(13) }}>Turn off the lists you don’t use. A turned-off list is hidden from the Price lists page, Price manager, rate lists and invoices. Its prices are kept, so you can turn it back on any time.</p>
      {(lists.data ?? []).map((p) => (
        <div className="tgl plset" key={p.id}><div className="tx"><b>{p.name}{p.isDefault && <> <span className="st g">Always on</span></>}</b><small>{ruleTxt(p)}{Number(p.roundTo) ? ` · rounded to ₹${Number(p.roundTo)}` : ''}{p.groups.length ? ` · used for ${p.groups.join(', ')}` : ''}</small></div>
          {p.isDefault ? <label className="tgs" title="The default list can’t be turned off"><input type="checkbox" checked disabled aria-label={`${p.name} (always on)`} readOnly /><i></i></label> : <Sw id={`plA_${p.id}`} on={p.active} label={p.name} onChange={(v) => void toggle(p, v)} />}</div>
      ))}
    </div>
  );
}

/** The prefix of codes made by "Assign code" in Add item (JE → JE001, JE002, …). */
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
      <h3 style={{ margin: ui.sp('22px 0 4px'), fontSize: ui.fs(16) }}>Item codes</h3><p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(13) }}>“Assign code” in Add item gives the next free code: this prefix and a 3 to 5 digit number, e.g. {v || ''}001. Changing it affects only new codes; items you already have keep theirs.</p>
      <div className="two plset"><label className="fl" htmlFor="sItemPrefix">Item code prefix<input className="fi mono" id="sItemPrefix" value={v} placeholder="e.g. JE" maxLength={6} autoComplete="off" onChange={(e) => setV(e.target.value.toUpperCase().replace(/\s/g, ''))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label><span></span></div>
      <p className="xperr" id="sItemPrefixErr" hidden={ok}>Use up to 6 letters (A to Z), e.g. JE.</p>
    </>
  );
}

/** The prototype's "Turn off GST?" window (#cfm), with a plain button: nothing is lost here. */
function ConfirmOff({ ask, onClose, onYes }: { ask: Ask | null; onClose: () => void; onYes: (a: Ask) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = !!ask;
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  return (
    <div className="ov c" id="cfm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'cfm') onClose(); }}>
      <div className="mdl" role="alertdialog" aria-modal="true" aria-labelledby="cfmT">
        <div className="ti" style={{ background: 'color-mix(in srgb,var(--red) 14%,transparent)', color: 'var(--red)', marginBottom: ui.sp(12) }}><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg></div>
        <h3 id="cfmT" style={{ margin: ui.sp('0 0 6px'), fontSize: ui.fs(18) }}>Turn off {ask?.name ?? ''}?</h3>
        <p style={{ margin: ui.sp('0 0 18px'), color: 'var(--t2)' }}>Its screens will be hidden for everyone in this shop. Your data stays, and turning it back on brings everything back.{ask?.also ? <> {ask.also}</> : null}</p>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" id="cfmNo" onClick={onClose}>Keep it on</button><button className="btn p" id="cfmYes" onClick={() => ask && onYes(ask)}>Turn off</button></div>
      </div>
    </div>
  );
}

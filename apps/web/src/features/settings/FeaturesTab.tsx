/**
 * Settings › Features, for the shop's owner only (owner's request, 1 Nov 2026; approved mock, no prototype
 * design): one box per feature in packages/shared/src/features.ts. A box another turned-on feature needs is
 * locked, and unticking asks first because the screens go away for everyone.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FEATURES, featureName, featureNames, featureNeededBy, featuresNeeded, toggleFeature, type FeatureKey, type MeResponse } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { ME_KEY } from '../../lib/me';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { ui } from '../../styles/uiSize';

export function FeatureCards() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const enabled = useFeatures();
  const [ask, setAsk] = useState<FeatureKey | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (key: FeatureKey, on: boolean) => {
    const also = on ? featuresNeeded(key).filter((k) => !enabled.includes(k)) : [];
    setBusy(true);
    try {
      const r = await api<{ features: FeatureKey[] }>('/settings/features', { method: 'PUT', body: { enabled: toggleFeature(enabled, key, on) } });
      qc.setQueriesData<MeResponse>({ queryKey: ME_KEY }, (o) => (o?.business ? { ...o, business: { ...o.business, features: r.features } } : o));
      showToast(!on ? `${featureName(key)} turned off. Your data is kept.` : also.length ? `${featureName(key)} turned on, with ${featureNames(also)}` : `${featureName(key)} turned on`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not change the feature.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card" id="cFeat">
        <h3 style={{ margin: ui.sp('0 0 4px'), fontSize: ui.fs(16) }}>Choose your features</h3>
        <p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(13) }}>Turn on only what your business needs. Turning a feature off only hides its screens: your data stays, and turning it back on brings everything back.</p>
        {FEATURES.map((f) => {
          const on = enabled.includes(f.key);
          const by = featureNeededBy(enabled, f.key);
          return (
            <div className="tgl plset" key={f.key} data-feature={f.key}>
              <label className="cb2" style={{ marginTop: ui.sp(2) }}><input type="checkbox" id={`f_${f.key}`} checked={on} disabled={!!by.length || busy} aria-label={f.name} onChange={(e) => (e.target.checked ? void save(f.key, true) : setAsk(f.key))} /></label>
              <div className="tx"><b>{f.name}{!!by.length && <> <span className="st g">Needed by {featureNames(by)}</span></>}</b><small>{f.description}{!!by.length && <><br />{featureNames(by)} uses this, so it stays on. Untick {featureNames(by)} first to change it.</>}</small></div>
            </div>
          );
        })}
      </section>
      <ConfirmOff feature={ask} enabled={enabled} onClose={() => setAsk(null)} onYes={(k) => { setAsk(null); void save(k, false); }} />
    </>
  );
}

/** The prototype's "Turn off GST?" window (#cfm), with a plain button: nothing is lost here. */
function ConfirmOff({ feature, enabled, onClose, onYes }: { feature: FeatureKey | null; enabled: readonly FeatureKey[]; onClose: () => void; onYes: (k: FeatureKey) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = !!feature;
  useOpenFocus(open, ref);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const stay = feature ? featuresNeeded(feature).filter((k) => enabled.includes(k)) : [];
  return (
    <div className="ov c" id="cfm" ref={ref} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'cfm') onClose(); }}>
      <div className="mdl" role="alertdialog" aria-modal="true" aria-labelledby="cfmT">
        <div className="ti" style={{ background: 'color-mix(in srgb,var(--red) 14%,transparent)', color: 'var(--red)', marginBottom: ui.sp(12) }}><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg></div>
        <h3 id="cfmT" style={{ margin: ui.sp('0 0 6px'), fontSize: ui.fs(18) }}>Turn off {feature ? featureName(feature) : ''}?</h3>
        <p style={{ margin: ui.sp('0 0 18px'), color: 'var(--t2)' }}>Its screens will be hidden for everyone in this shop. Your data stays, and turning it back on brings everything back.{!!stay.length && <> {featureNames(stay)} {stay.length > 1 ? 'stay' : 'stays'} on.</>}</p>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" id="cfmNo" onClick={onClose}>Keep it on</button><button className="btn p" id="cfmYes" onClick={() => feature && onYes(feature)}>Turn off</button></div>
      </div>
    </div>
  );
}

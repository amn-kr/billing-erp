/**
 * Features a shop's owner can turn on or off (Settings › Features). Every shop starts with none.
 * Turning a feature off only hides its screens; its data stays. A new feature is one entry here
 * plus its screens, which ask useFeature('<key>').
 */
export const FEATURES = [
  {
    key: 'batch_expiry',
    name: 'Batch and expiry',
    description: 'Batch no., mfg and expiry date on purchase and sale, first-expiry-first-out, expiry reports.',
    needs: [],
  },
  {
    key: 'mrp_pack',
    name: 'MRP and pack/loose',
    description: 'MRP on bills and strip-to-loose conversion.',
    needs: [],
  },
  {
    key: 'medical',
    name: 'Medical',
    description: 'Doctor and patient name on the sale bill, drug license number, Schedule H register, salt/composition search. Needs the other two.',
    needs: ['batch_expiry', 'mrp_pack'],
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export interface FeatureInfo { key: FeatureKey; name: string; description: string; needs: readonly FeatureKey[] }

const LIST: readonly FeatureInfo[] = FEATURES;
const find = (key: string) => LIST.find((f) => f.key === key);
export const isFeatureKey = (key: string): key is FeatureKey => !!find(key);
export const featureName = (key: FeatureKey) => find(key)!.name;
/** Known keys only (a backup from a newer version may hold more), in the list's order. */
export const enabledFeatures = (stored: readonly string[] | null | undefined): FeatureKey[] => LIST.filter((f) => stored?.includes(f.key)).map((f) => f.key);

/** The features this one needs, and what those need in turn. */
export function featuresNeeded(key: FeatureKey): FeatureKey[] {
  const out = new Set<FeatureKey>();
  const add = (k: FeatureKey) => { for (const n of find(k)!.needs) if (!out.has(n)) { out.add(n); add(n); } };
  add(key);
  return enabledFeatures([...out]);
}

/** The turned-on features that need this one: while there are any, it can't be turned off. */
export const featureNeededBy = (enabled: readonly string[], key: FeatureKey): FeatureKey[] =>
  enabledFeatures(enabled).filter((k) => k !== key && featuresNeeded(k).includes(key));

/** The list after ticking or unticking one box. Ticking also ticks what it needs; a box that is needed stays ticked. */
export function toggleFeature(enabled: readonly string[], key: FeatureKey, on: boolean): FeatureKey[] {
  if (on) return enabledFeatures([...enabled, key, ...featuresNeeded(key)]);
  return featureNeededBy(enabled, key).length ? enabledFeatures(enabled) : enabledFeatures(enabled.filter((k) => k !== key));
}

/** What is wrong with a list the owner wants to save (null when fine). The server refuses anything else. */
export function featureListProblem(wanted: readonly string[]): string | null {
  const unknown = wanted.find((k) => !isFeatureKey(k));
  if (unknown !== undefined) return 'That feature does not exist.';
  for (const k of enabledFeatures(wanted)) {
    const missing = featuresNeeded(k).find((n) => !wanted.includes(n));
    if (missing) return `${featureName(k)} needs ${featureName(missing)}. Turn that on first.`;
  }
  return null;
}

/** Names joined for a sentence: "A", "A and B", "A, B and C". */
export const featureNames = (keys: readonly FeatureKey[]): string => {
  const n = keys.map(featureName);
  return n.length < 2 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

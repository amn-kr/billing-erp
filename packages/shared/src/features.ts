/**
 * What a shop's owner can turn on or off (Settings › Items). Turning something off only hides its screens;
 * its data stays. A new switch is one entry here plus its screens, which ask useFeature('<key>').
 *
 * Most start off, and are stored when on. Category, Brand, Series and Location start on, so they are stored
 * when off (no_brand, …): shops and backups from before these switches then show them, with nothing to change.
 */
export const FEATURES = [
  { key: 'batch_no', name: 'Batch No.', description: 'Batch number on purchases, sales, stock and the Item Batch Report.', needs: [] },
  { key: 'exp_date', name: 'Exp Date', description: 'Earliest expiry sold first, Expiry Report, Home alert and the expired-stock warning.', needs: ['batch_no'] },
  { key: 'mfg_date', name: 'Mfg Date', description: 'Manufacturing date on the batch.', needs: ['batch_no'] },
  { key: 'mrp', name: 'MRP', description: 'MRP on bills and batches, and the warning when a rate is above MRP.', needs: [] },
  { key: 'pack_loose', name: 'Pack and loose', description: 'Buy and sell by the strip or by the tablet, e.g. 1 STRIP = 10 TAB.', needs: [] },
  // on hold (owner, 3 Nov 2026): no box on the page and nothing built, so it locks nothing. Add back what it needs when it is built.
  { key: 'medical', name: 'Medical', description: 'Doctor and patient name on the sale bill, drug license number, Schedule H register, salt/composition search.', needs: [] },
  { key: 'no_category', name: 'Item category', description: 'Category box on items, the category filters and the Category column in imports.', needs: [] },
  { key: 'no_brand', name: 'Brand', description: 'Brand box on items, the brand filters, the Brands & Series page and the Brand columns.', needs: ['no_series'] },
  { key: 'no_series', name: 'Series', description: 'Series box on items and its columns. Needs Brand: a series belongs to a brand.', needs: [] },
  { key: 'no_location', name: 'Item location', description: 'Rack or shelf of an item, shown on the item form, item card and item search.', needs: [] },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export interface FeatureInfo { key: FeatureKey; name: string; description: string; needs: readonly FeatureKey[] }
/** Boxes that start ticked: ticked means its no_… key is not stored. */
export type ItemField = 'category' | 'brand' | 'series' | 'location';

const LIST: readonly FeatureInfo[] = FEATURES;
const find = (key: string) => LIST.find((f) => f.key === key);
export const isFeatureKey = (key: string): key is FeatureKey => !!find(key);
export const featureName = (key: FeatureKey) => find(key)!.name;
export const featureInfo = (key: FeatureKey) => find(key)!;

/** The two old switches, in shops not yet moved, old backups and old open browser tabs. */
const OLD_KEYS: Record<string, FeatureKey[]> = { batch_expiry: ['batch_no', 'exp_date', 'mfg_date'], mrp_pack: ['mrp', 'pack_loose'] };

/** Known keys only (a backup from a newer version may hold more), old ones as today's, in the list's order. */
export const enabledFeatures = (stored: readonly string[] | null | undefined): FeatureKey[] => {
  const all = stored?.flatMap((k) => OLD_KEYS[k] ?? [k]);
  return LIST.filter((f) => all?.includes(f.key)).map((f) => f.key);
};

/** Whether a box that starts ticked is ticked. */
export const itemFieldOn = (enabled: readonly string[], field: ItemField): boolean => !enabled.includes(`no_${field}`);

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

/** The list after ticking or unticking Category, Brand, Series or Location. A series belongs to a brand: unticking Brand unticks Series, ticking Series ticks Brand. */
export function toggleItemField(enabled: readonly string[], field: ItemField, on: boolean): FeatureKey[] {
  const key = `no_${field}` as FeatureKey;
  if (!on) return toggleFeature(enabled, key, true);
  const list = field === 'series' ? enabledFeatures(enabled).filter((k) => k !== 'no_brand') : enabledFeatures(enabled);
  return list.filter((k) => k !== key);
}

/** What is wrong with a list the owner wants to save (null when fine). The server refuses anything else. */
export function featureListProblem(wanted: readonly string[]): string | null {
  const unknown = wanted.find((k) => !isFeatureKey(k) && !OLD_KEYS[k]);
  if (unknown !== undefined) return 'That feature does not exist.';
  const list = enabledFeatures(wanted);
  for (const k of list) {
    const missing = featuresNeeded(k).find((n) => !list.includes(n));
    if (missing) return k === 'no_brand' ? 'Series belongs to a brand, so it can’t stay on without Brand.' : `${featureName(k)} needs ${featureName(missing)}. Turn that on first.`;
  }
  return null;
}

/** Names joined for a sentence: "A", "A and B", "A, B and C". */
export const featureNames = (keys: readonly FeatureKey[]): string => {
  const n = keys.map(featureName);
  return n.length < 2 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

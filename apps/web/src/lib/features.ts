import { batchView, itemFieldOn, type BatchView, type FeatureKey, type ItemField, type ItemLabel, type ItemOptions } from '@billing/shared';
import { useMe } from './me';

/** What this shop's owner turned on in Settings › Items; nothing until the shop has loaded. */
export const useFeatures = (): FeatureKey[] => useMe().data?.business?.features ?? [];
/** Whether a screen for this feature should show. */
export const useFeature = (key: FeatureKey): boolean => useFeatures().includes(key);
/** Whether Category, Brand, Series or Location shows: they start on, also before the shop has loaded. */
export const useItemField = (field: ItemField): boolean => itemFieldOn(useFeatures(), field);

const NO_OPTIONS: ItemOptions = { labels: {} };
/** The labels, date formats and default unit from Settings › Items. */
export const useItemOptions = (): ItemOptions => useMe().data?.business?.itemOptions ?? NO_OPTIONS;
/** A word on a screen: what the owner typed in Settings › Items, else the word this screen always used. */
export function useItemWord(): (label: ItemLabel, usual: string) => string {
  const { labels } = useItemOptions();
  return (label, usual) => labels[label] ?? usual;
}
/** Whether batch screens show their dates, and in which words and format. */
export const useBatchView = (): BatchView => batchView(useFeatures(), useItemOptions());

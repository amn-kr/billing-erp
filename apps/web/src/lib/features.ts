import type { FeatureKey } from '@billing/shared';
import { useMe } from './me';

/** What this shop's owner turned on in Settings › Features; nothing until the shop has loaded. */
export const useFeatures = (): FeatureKey[] => useMe().data?.business?.features ?? [];
/** Whether a screen for this feature should show. */
export const useFeature = (key: FeatureKey): boolean => useFeatures().includes(key);

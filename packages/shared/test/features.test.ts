import { describe, expect, it } from 'vitest';
import { FEATURES, enabledFeatures, featureListProblem, featureNames, featureNeededBy, featuresNeeded, isFeatureKey, toggleFeature } from '../src';

describe('Settings › Features: the list', () => {
  it('has the three features, each with a name and a one-line description', () => {
    expect(FEATURES.map((f) => f.key)).toEqual(['batch_expiry', 'mrp_pack', 'medical']);
    for (const f of FEATURES) {
      expect(f.name).not.toBe('');
      expect(f.description).not.toContain('\n');
    }
  });

  it('every feature needs only features on the list, and none ends up needing itself', () => {
    for (const f of FEATURES) {
      for (const n of f.needs) expect(isFeatureKey(n)).toBe(true);
      expect(featuresNeeded(f.key)).not.toContain(f.key);
    }
  });

  it('old or unknown stored keys are ignored, and the order is always the list’s', () => {
    expect(enabledFeatures(null)).toEqual([]);
    expect(enabledFeatures(['medical', 'from_a_newer_version', 'batch_expiry'])).toEqual(['batch_expiry', 'medical']);
  });
});

describe('Settings › Features: ticking and unticking', () => {
  it('ticking Medical ticks the other two', () => {
    expect(toggleFeature([], 'medical', true)).toEqual(['batch_expiry', 'mrp_pack', 'medical']);
    expect(toggleFeature(['mrp_pack'], 'medical', true)).toEqual(['batch_expiry', 'mrp_pack', 'medical']);
  });

  it('while Medical is on, the other two stay ticked and say who needs them', () => {
    const on = ['batch_expiry', 'mrp_pack', 'medical'];
    expect(toggleFeature(on, 'batch_expiry', false)).toEqual(on);
    expect(toggleFeature(on, 'mrp_pack', false)).toEqual(on);
    expect(featureNeededBy(on, 'batch_expiry')).toEqual(['medical']);
    expect(featureNeededBy(on, 'mrp_pack')).toEqual(['medical']);
    expect(featureNeededBy(on, 'medical')).toEqual([]);
  });

  it('unticking Medical leaves the other two ticked and free', () => {
    const after = toggleFeature(['batch_expiry', 'mrp_pack', 'medical'], 'medical', false);
    expect(after).toEqual(['batch_expiry', 'mrp_pack']);
    expect(featureNeededBy(after, 'batch_expiry')).toEqual([]);
  });

  it('with Medical off, the other two tick and untick on their own', () => {
    expect(toggleFeature([], 'batch_expiry', true)).toEqual(['batch_expiry']);
    expect(toggleFeature([], 'mrp_pack', true)).toEqual(['mrp_pack']);
    expect(toggleFeature(['batch_expiry', 'mrp_pack'], 'batch_expiry', false)).toEqual(['mrp_pack']);
  });
});

describe('Settings › Features: what the server accepts', () => {
  it('accepts nothing on, each one alone, and Medical with both', () => {
    for (const ok of [[], ['batch_expiry'], ['mrp_pack'], ['batch_expiry', 'mrp_pack'], ['batch_expiry', 'mrp_pack', 'medical']]) expect(featureListProblem(ok)).toBeNull();
  });

  it('refuses Medical without what it needs, naming what is missing', () => {
    expect(featureListProblem(['medical'])).toBe('Medical needs Batch and expiry. Turn that on first.');
    expect(featureListProblem(['batch_expiry', 'medical'])).toBe('Medical needs MRP and pack/loose. Turn that on first.');
  });

  it('refuses a feature that does not exist', () => {
    expect(featureListProblem(['nope'])).toBe('That feature does not exist.');
  });

  it('joins names for a sentence', () => {
    expect(featureNames(['medical'])).toBe('Medical');
    expect(featureNames(['batch_expiry', 'mrp_pack'])).toBe('Batch and expiry and MRP and pack/loose');
  });
});

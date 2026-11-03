import { describe, expect, it } from 'vitest';
import { FEATURES, enabledFeatures, featureListProblem, featureNames, featureNeededBy, featuresNeeded, isFeatureKey, itemFieldOn, toggleFeature, toggleItemField } from '../src';

describe('Settings › Items: the list', () => {
  it('has every switch, each with a name and a one-line description', () => {
    expect(FEATURES.map((f) => f.key)).toEqual(['batch_no', 'exp_date', 'mfg_date', 'mrp', 'pack_loose', 'medical', 'no_category', 'no_brand', 'no_series', 'no_location']);
    for (const f of FEATURES) {
      expect(f.name).not.toBe('');
      expect(f.description).not.toContain('\n');
    }
  });

  it('every switch needs only switches on the list, and none ends up needing itself', () => {
    for (const f of FEATURES) {
      for (const n of f.needs) expect(isFeatureKey(n)).toBe(true);
      expect(featuresNeeded(f.key)).not.toContain(f.key);
    }
  });

  it('unknown stored keys are ignored, and the order is always the list’s', () => {
    expect(enabledFeatures(null)).toEqual([]);
    expect(enabledFeatures(['medical', 'from_a_newer_version', 'mrp'])).toEqual(['mrp', 'medical']);
  });

  it('the two old switch words read as today’s boxes: all three, and both', () => {
    expect(enabledFeatures(['batch_expiry'])).toEqual(['batch_no', 'exp_date', 'mfg_date']);
    expect(enabledFeatures(['mrp_pack'])).toEqual(['mrp', 'pack_loose']);
    expect(enabledFeatures(['batch_expiry', 'mrp_pack', 'medical'])).toEqual(['batch_no', 'exp_date', 'mfg_date', 'mrp', 'pack_loose', 'medical']);
  });

  it('Medical is on hold: it stays stored and locks nothing', () => {
    expect(featuresNeeded('medical')).toEqual([]);
    expect(featureNeededBy(['batch_no', 'medical'], 'batch_no')).toEqual([]);
    expect(featureListProblem(['medical'])).toBeNull();
  });
});

describe('Settings › Items: boxes that start ticked', () => {
  it('a shop with nothing stored has Category, Brand, Series and Location on', () => {
    for (const f of ['category', 'brand', 'series', 'location'] as const) expect(itemFieldOn([], f)).toBe(true);
  });

  it('each unticks on its own and ticks back', () => {
    expect(itemFieldOn(toggleItemField([], 'category', false), 'category')).toBe(false);
    expect(toggleItemField(['no_location', 'mrp'], 'location', true)).toEqual(['mrp']);
  });

  it('unticking Brand unticks Series too; unticking Series leaves Brand', () => {
    expect(toggleItemField([], 'brand', false)).toEqual(['no_brand', 'no_series']);
    expect(toggleItemField([], 'series', false)).toEqual(['no_series']);
  });

  it('ticking Series ticks Brand too; ticking Brand leaves Series off', () => {
    expect(toggleItemField(['no_brand', 'no_series'], 'series', true)).toEqual([]);
    expect(toggleItemField(['no_brand', 'no_series'], 'brand', true)).toEqual(['no_series']);
  });
});

describe('Settings › Items: ticking and unticking', () => {
  it('ticking a date ticks Batch No.', () => {
    expect(toggleFeature([], 'exp_date', true)).toEqual(['batch_no', 'exp_date']);
    expect(toggleFeature([], 'mfg_date', true)).toEqual(['batch_no', 'mfg_date']);
  });

  it('while a date is on, Batch No. stays ticked and says who needs it', () => {
    const on = ['batch_no', 'exp_date', 'mfg_date'];
    expect(toggleFeature(on, 'batch_no', false)).toEqual(on);
    expect(featureNeededBy(on, 'batch_no')).toEqual(['exp_date', 'mfg_date']);
    expect(featureNeededBy(['batch_no', 'mfg_date'], 'batch_no')).toEqual(['mfg_date']);
  });

  it('with both dates off, Batch No. comes free', () => {
    expect(toggleFeature(['batch_no'], 'batch_no', false)).toEqual([]);
  });

  it('MRP and Pack and loose tick and untick on their own', () => {
    expect(toggleFeature([], 'mrp', true)).toEqual(['mrp']);
    expect(toggleFeature(['mrp', 'pack_loose'], 'mrp', false)).toEqual(['pack_loose']);
    expect(toggleFeature(['mrp', 'pack_loose'], 'pack_loose', false)).toEqual(['mrp']);
  });
});

describe('Settings › Items: what the server accepts', () => {
  it('accepts nothing on, Batch No. alone, MRP alone, and everything', () => {
    for (const ok of [[], ['batch_no'], ['mrp'], ['pack_loose'], FEATURES.map((f) => f.key)]) expect(featureListProblem(ok)).toBeNull();
  });

  it('still accepts the old words, from a browser tab left open', () => {
    expect(featureListProblem(['batch_expiry', 'mrp_pack'])).toBeNull();
  });

  it('refuses a date without Batch No., naming what is missing', () => {
    expect(featureListProblem(['exp_date'])).toBe('Exp Date needs Batch No. Turn that on first.');
    expect(featureListProblem(['mfg_date'])).toBe('Mfg Date needs Batch No. Turn that on first.');
  });

  it('refuses Series on without Brand', () => {
    expect(featureListProblem(['no_brand'])).toBe('Series belongs to a brand, so it can’t stay on without Brand.');
    expect(featureListProblem(['no_brand', 'no_series'])).toBeNull();
  });

  it('refuses a feature that does not exist', () => {
    expect(featureListProblem(['nope'])).toBe('That feature does not exist.');
  });

  it('joins names for a sentence', () => {
    expect(featureNames(['mrp'])).toBe('MRP');
    expect(featureNames(['exp_date', 'mfg_date'])).toBe('Exp Date and Mfg Date');
    expect(featureNames(['exp_date', 'mfg_date', 'mrp'])).toBe('Exp Date, Mfg Date and MRP');
  });
});

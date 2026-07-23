import { describe, it, expect } from 'vitest';
import {
  PACK_OPTIONS,
  normalizeActivePacks,
  partitionForRegen,
} from '@/lib/learning/content-packs';

describe('PACK_OPTIONS', () => {
  it('lists the three choices with daily-core, ielts as packs and freechat as a mode', () => {
    const ids = PACK_OPTIONS.map((p) => p.id);
    expect(ids).toEqual(['daily-core', 'ielts', 'freechat']);
    expect(PACK_OPTIONS.find((p) => p.id === 'freechat')?.kind).toBe('mode');
    expect(PACK_OPTIONS.find((p) => p.id === 'daily-core')?.kind).toBe('pack');
  });
});

describe('normalizeActivePacks (legacy multi → single)', () => {
  it('keeps a single content pack as-is', () => {
    expect(normalizeActivePacks(['ielts'])).toEqual(['ielts']);
  });

  it('collapses a legacy multi-pack to the first content pack', () => {
    expect(normalizeActivePacks(['daily-core', 'ielts'])).toEqual(['daily-core']);
    expect(normalizeActivePacks(['ielts', 'daily-core'])).toEqual(['ielts']);
  });

  it('freechat wins and is exclusive', () => {
    expect(normalizeActivePacks(['freechat'])).toEqual(['freechat']);
    expect(normalizeActivePacks(['daily-core', 'freechat'])).toEqual(['freechat']);
  });

  it('defaults empty / missing / unknown to daily-core', () => {
    expect(normalizeActivePacks([])).toEqual(['daily-core']);
    expect(normalizeActivePacks(undefined)).toEqual(['daily-core']);
    expect(normalizeActivePacks(null)).toEqual(['daily-core']);
    expect(normalizeActivePacks(['bogus'])).toEqual(['daily-core']);
  });
});

describe('partitionForRegen (keep practiced or in-scope; drop untouched out-of-scope)', () => {
  const items = [
    { id: 'a', pack: 'daily-core', practiced: true }, // practiced → keep (history)
    { id: 'b', pack: 'daily-core', practiced: false }, // untouched, out of scope → drop
    { id: 'c', pack: 'ielts', practiced: false }, // untouched, in scope → keep
    { id: 'd', pack: 'ielts', practiced: true }, // practiced → keep
    { id: 'e', pack: null, practiced: false }, // untouched, unknown pack → drop
  ];

  it('keeps practiced words regardless of pack, and untouched words in the new scope', () => {
    const { keep, drop } = partitionForRegen(items, ['ielts']);
    expect(keep.map((i) => i.id).sort()).toEqual(['a', 'c', 'd']);
    expect(drop.map((i) => i.id).sort()).toEqual(['b', 'e']);
  });

  it('when nothing is practiced and scope changes fully, drops all untouched out-of-scope', () => {
    const fresh = [
      { id: 'x', pack: 'daily-core', practiced: false },
      { id: 'y', pack: 'daily-core', practiced: false },
    ];
    const { keep, drop } = partitionForRegen(fresh, ['ielts']);
    expect(keep).toEqual([]);
    expect(drop.map((i) => i.id)).toEqual(['x', 'y']);
  });

  it('is a no-op partition when everything is already in scope', () => {
    const { keep, drop } = partitionForRegen(
      [{ id: 'p', pack: 'ielts', practiced: false }],
      ['ielts'],
    );
    expect(keep.map((i) => i.id)).toEqual(['p']);
    expect(drop).toEqual([]);
  });
});

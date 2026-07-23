import { describe, it, expect } from 'vitest';
import { groupCorrections, KNOWLEDGE_GROUPS } from '@/lib/learning/knowledge-groups';
import type { Correction } from '@/lib/types';

function corr(id: string, category: Correction['category'], is_upgrade = false): Correction {
  return {
    id,
    user_id: 'u1',
    conversation_id: 'c1',
    original: `orig ${id}`,
    improved: `better ${id}`,
    explanation: `why ${id}`,
    category,
    is_upgrade,
  };
}

describe('groupCorrections (学到的知识点)', () => {
  it('groups upgrades separately from error fixes, in the defined group order', () => {
    const groups = groupCorrections([
      corr('a', 'grammar'),
      corr('b', 'chinglish'),
      corr('c', 'word-choice', true), // upgrade wins over its category
      corr('d', 'grammar'),
    ]);
    const keys = groups.map((g) => g.key);
    // Only non-empty groups, ordered per KNOWLEDGE_GROUPS.
    expect(keys).toEqual(['upgrade', 'grammar', 'chinglish']);
    expect(groups.find((g) => g.key === 'grammar')!.items.map((c) => c.id)).toEqual(['a', 'd']);
    expect(groups.find((g) => g.key === 'upgrade')!.items.map((c) => c.id)).toEqual(['c']);
  });

  it('every group key has a Chinese label', () => {
    for (const g of KNOWLEDGE_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
    }
  });

  it('returns [] for no corrections', () => {
    expect(groupCorrections([])).toEqual([]);
  });
});

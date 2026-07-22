import { describe, it, expect } from 'vitest';
import { selectFromCurriculum, type CurriculumItem } from '@/lib/learning/curriculum-select';

function item(pack: string, rank: number, english: string, level = 'elementary'): CurriculumItem {
  return {
    id: `${pack}-${rank}`,
    pack,
    rank,
    level: level as CurriculumItem['level'],
    english,
    chinese: '',
    scenario: '',
    formality: 'casual',
    example_sentence: '',
    common_mistake: '',
  };
}

describe('selectFromCurriculum', () => {
  const daily = [
    item('daily-core', 1, 'A'),
    item('daily-core', 2, 'B'),
    item('daily-core', 3, 'C'),
    item('daily-core', 4, 'D'),
    item('daily-core', 5, 'E'),
    item('daily-core', 6, 'F'),
  ];
  const ielts = [item('ielts', 1, 'X'), item('ielts', 2, 'Y'), item('ielts', 3, 'Z')];

  it('picks the lowest-rank (most common) items first from a single pack', () => {
    const picked = selectFromCurriculum([daily], 3);
    expect(picked.map((e) => e.english)).toEqual(['A', 'B', 'C']);
  });

  it('never exceeds the requested count', () => {
    expect(selectFromCurriculum([daily], 4)).toHaveLength(4);
  });

  it('returns everything available when the library is thinner than requested', () => {
    expect(selectFromCurriculum([ielts], 5).map((e) => e.english)).toEqual(['X', 'Y', 'Z']);
  });

  it('round-robins across multiple active packs, rank order within each', () => {
    const picked = selectFromCurriculum([daily, ielts], 4);
    // daily#1, ielts#1, daily#2, ielts#2
    expect(picked.map((e) => e.english)).toEqual(['A', 'X', 'B', 'Y']);
  });

  it('drains the remaining pack once the other is exhausted', () => {
    const picked = selectFromCurriculum([daily, ielts], 6);
    expect(picked.map((e) => e.english)).toEqual(['A', 'X', 'B', 'Y', 'C', 'Z']);
  });

  it('returns empty for no candidates', () => {
    expect(selectFromCurriculum([[], []], 5)).toEqual([]);
  });
});

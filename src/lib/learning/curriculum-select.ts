import type { EnglishLevel, Formality } from '@/lib/types';

export interface CurriculumItem {
  id: string;
  pack: string;
  rank: number;
  level: EnglishLevel;
  english: string;
  chinese: string;
  scenario: string;
  formality: Formality;
  example_sentence: string;
  common_mistake: string;
}

/**
 * Picks the day's expressions from the user's active packs.
 * Each pack's list must already be filtered (level-appropriate, not yet learned)
 * and sorted by rank ascending. Multiple packs are round-robined so a mixed
 * learner gets a fair blend, always taking the most common (lowest-rank) first.
 */
export function selectFromCurriculum(packLists: CurriculumItem[][], count: number): CurriculumItem[] {
  const picked: CurriculumItem[] = [];
  const cursors = packLists.map(() => 0);
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (let p = 0; p < packLists.length && picked.length < count; p++) {
      const list = packLists[p];
      if (cursors[p] < list.length) {
        picked.push(list[cursors[p]]);
        cursors[p]++;
        progressed = true;
      }
    }
  }
  return picked;
}

import type { Correction } from '@/lib/types';

/**
 * Groups the user's historical corrections into the 学到的知识点 sections shown on
 * the stats page. Naturalness upgrades (is_upgrade) are their own group regardless
 * of category; error fixes group by category. Group order = display order.
 */

export interface KnowledgeGroupDef {
  key: string;
  label: string;
  matches: (c: Correction) => boolean;
}

export const KNOWLEDGE_GROUPS: readonly KnowledgeGroupDef[] = [
  { key: 'upgrade', label: '✨ 更地道的说法', matches: (c) => c.is_upgrade },
  { key: 'grammar', label: '📐 语法', matches: (c) => !c.is_upgrade && c.category === 'grammar' },
  {
    key: 'chinglish',
    label: '🀄 中式英语',
    matches: (c) => !c.is_upgrade && c.category === 'chinglish',
  },
  {
    key: 'word-choice',
    label: '🔤 用词',
    matches: (c) => !c.is_upgrade && c.category === 'word-choice',
  },
  {
    key: 'pronunciation',
    label: '🔊 发音',
    matches: (c) => !c.is_upgrade && c.category === 'pronunciation-note',
  },
] as const;

export interface KnowledgeGroup {
  key: string;
  label: string;
  items: Correction[];
}

/** Non-empty groups in display order; each correction lands in exactly one group. */
export function groupCorrections(corrections: Correction[]): KnowledgeGroup[] {
  return KNOWLEDGE_GROUPS.map((def) => ({
    key: def.key,
    label: def.label,
    items: corrections.filter(def.matches),
  })).filter((g) => g.items.length > 0);
}

/**
 * Content selection shared between Settings and the Home picker. Single-select:
 * exactly one of the content packs, or 自由畅聊 (a mode, not a pack). Legacy profiles
 * may hold multiple packs (['daily-core','ielts']) — normalize them on READ; never
 * mutate the DB for migration.
 */

export type PackKind = 'pack' | 'mode';

export interface PackOption {
  id: string;
  label: string;
  desc: string;
  kind: PackKind;
}

export const PACK_OPTIONS: readonly PackOption[] = [
  { id: 'daily-core', label: '日常地道表达', desc: '最常用的日常口语,高频优先', kind: 'pack' },
  { id: 'ielts', label: '雅思', desc: 'IELTS 口语/写作提分表达与搭配', kind: 'pack' },
  { id: 'freechat', label: '自由畅聊', desc: '不刷词,纯聊天,顺口教你更地道的说法', kind: 'mode' },
] as const;

const CONTENT_PACK_IDS = PACK_OPTIONS.filter((p) => p.kind === 'pack').map((p) => p.id);
const DEFAULT_PACK = 'daily-core';

/**
 * Collapse an active_packs value to a single selection for the single-select UI:
 * freechat wins (exclusive); otherwise the first known content pack; else default.
 */
export function normalizeActivePacks(packs: string[] | null | undefined): string[] {
  if (packs && packs.includes('freechat')) return ['freechat'];
  const firstContent = (packs ?? []).find((p) => CONTENT_PACK_IDS.includes(p));
  return [firstContent ?? DEFAULT_PACK];
}

export interface RegenItem {
  id: string;
  pack: string | null;
  practiced: boolean;
}

/**
 * Reconcile today's expressions to the newly-selected content, without losing history:
 *   KEEP = practiced (any pack) OR the word's pack is in the new selection
 *   DROP = untouched AND the word's pack is not in the new selection
 * The dropped rows (and their progress) are safe to delete; new-content words fill back.
 */
export function partitionForRegen<T extends RegenItem>(
  items: T[],
  activePacks: string[],
): { keep: T[]; drop: T[] } {
  const scope = new Set(activePacks);
  const keep: T[] = [];
  const drop: T[] = [];
  for (const item of items) {
    if (item.practiced || (item.pack !== null && scope.has(item.pack))) keep.push(item);
    else drop.push(item);
  }
  return { keep, drop };
}

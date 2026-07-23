import type { Expression } from '@/lib/types';

/**
 * localStorage SWR cache for today's expressions (home picker + talk 今日要学).
 * Cached lists render instantly; the caller ALWAYS revalidates in the background —
 * this cache is never the source of truth, just the fast first paint.
 *
 * Cache discipline:
 * - key = userId + normalized pack selection (no cross-account / cross-content bleed)
 * - TTL bounds staleness across days (revalidation corrects sooner)
 * - only successful lists are written; corrupted entries read as a miss
 * - storage failures (quota, private mode) degrade to no-cache, never throw
 */

export const CACHE_TTL_MS = 26 * 60 * 60 * 1000; // ~1 day + slack; revalidation corrects sooner

const PREFIX = 'expr-cache:v1';

function cacheKey(userId: string, packs: string[]): string {
  return `${PREFIX}:${userId}:${[...packs].sort().join('+')}`;
}

interface Entry {
  at: number;
  expressions: Expression[];
}

function isValidEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.at === 'number' &&
    Array.isArray(e.expressions) &&
    e.expressions.every(
      (x) => typeof x === 'object' && x !== null && typeof (x as Expression).english === 'string',
    )
  );
}

export function readCachedExpressions(userId: string, packs: string[]): Expression[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId, packs));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidEntry(parsed)) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.expressions;
  } catch {
    return null; // corrupted / unavailable storage → miss
  }
}

export function writeCachedExpressions(
  userId: string,
  packs: string[],
  expressions: Expression[],
): void {
  try {
    const entry: Entry = { at: Date.now(), expressions };
    localStorage.setItem(cacheKey(userId, packs), JSON.stringify(entry));
  } catch {
    // quota / private mode — caching is best-effort
  }
}

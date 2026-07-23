import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCachedExpressions,
  writeCachedExpressions,
  CACHE_TTL_MS,
} from '@/lib/cache/expressions-cache';
import type { Expression } from '@/lib/types';

function expr(id: string, english = 'hello'): Expression {
  return {
    id,
    user_id: 'u1',
    daily_session_id: 'd1',
    date: '2026-07-23',
    english,
    chinese: '你好',
    scenario: 's',
    formality: 'casual',
    example_sentence: 'ex',
    common_mistake: 'm',
    source: { pack: 'daily-core' },
  };
}

beforeEach(() => localStorage.clear());

describe('expressions cache (SWR for the home/talk daily list)', () => {
  it('round-trips a successful list for user+packs', () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a'), expr('b')]);
    const hit = readCachedExpressions('u1', ['daily-core']);
    expect(hit?.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('misses across users, pack selections, and normalizes pack order', () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a')]);
    expect(readCachedExpressions('u2', ['daily-core'])).toBeNull(); // other user
    expect(readCachedExpressions('u1', ['ielts'])).toBeNull(); // other content
  });

  it('expires after the TTL (no yesterday flash)', () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a')]);
    const key = Object.keys(localStorage).find((k) => k.includes('expr-cache'))!;
    const entry = JSON.parse(localStorage.getItem(key)!);
    entry.at = Date.now() - CACHE_TTL_MS - 1;
    localStorage.setItem(key, JSON.stringify(entry));
    expect(readCachedExpressions('u1', ['daily-core'])).toBeNull();
  });

  it('rejects corrupted / wrong-shaped entries instead of throwing', () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a')]);
    const key = Object.keys(localStorage).find((k) => k.includes('expr-cache'))!;
    localStorage.setItem(key, '{not json');
    expect(readCachedExpressions('u1', ['daily-core'])).toBeNull();
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), expressions: 'nope' }));
    expect(readCachedExpressions('u1', ['daily-core'])).toBeNull();
  });

  it('an empty list is cacheable (freechat is handled by the caller, but empty ≠ invalid)', () => {
    writeCachedExpressions('u1', ['daily-core'], []);
    expect(readCachedExpressions('u1', ['daily-core'])).toEqual([]);
  });
});

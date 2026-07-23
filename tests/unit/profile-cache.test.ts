import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCachedProfile,
  writeCachedProfile,
  clearCachedProfile,
  PROFILE_CACHE_TTL_MS,
} from '@/lib/cache/profile-cache';
import { makeProfile } from '../fakes/learning-store';

beforeEach(() => localStorage.clear());

describe('profile cache (SWR paint for settings/talk)', () => {
  it('round-trips the profile', () => {
    writeCachedProfile(makeProfile({ nickname: 'Q' }));
    expect(readCachedProfile()?.nickname).toBe('Q');
  });

  it('clears on demand (logout must wipe it)', () => {
    writeCachedProfile(makeProfile());
    clearCachedProfile();
    expect(readCachedProfile()).toBeNull();
  });

  it('expires after the TTL', () => {
    writeCachedProfile(makeProfile());
    const key = Object.keys(localStorage).find((k) => k.includes('profile-cache'))!;
    const entry = JSON.parse(localStorage.getItem(key)!);
    entry.at = Date.now() - PROFILE_CACHE_TTL_MS - 1;
    localStorage.setItem(key, JSON.stringify(entry));
    expect(readCachedProfile()).toBeNull();
  });

  it('rejects corrupted entries instead of throwing', () => {
    writeCachedProfile(makeProfile());
    const key = Object.keys(localStorage).find((k) => k.includes('profile-cache'))!;
    localStorage.setItem(key, '{nope');
    expect(readCachedProfile()).toBeNull();
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), profile: 'wrong' }));
    expect(readCachedProfile()).toBeNull();
  });
});

import type { Profile } from '@/lib/types';

/**
 * localStorage SWR cache of the signed-in user's profile row, so Settings and the
 * talk page paint instantly instead of waiting on auth + profile fetch. Callers
 * ALWAYS revalidate against the server and overwrite; logout MUST clearCachedProfile()
 * so a shared device never paints the previous account.
 */

export const PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // revalidation corrects far sooner

const KEY = 'profile-cache:v1';

interface Entry {
  at: number;
  profile: Profile;
}

export function readCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const e = parsed as Record<string, unknown>;
    if (typeof e.at !== 'number' || typeof e.profile !== 'object' || e.profile === null) return null;
    if (typeof (e.profile as Profile).id !== 'string') return null;
    if (Date.now() - e.at > PROFILE_CACHE_TTL_MS) return null;
    return e.profile as Profile;
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: Profile): void {
  try {
    const entry: Entry = { at: Date.now(), profile };
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // quota / private mode — best-effort
  }
}

export function clearCachedProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

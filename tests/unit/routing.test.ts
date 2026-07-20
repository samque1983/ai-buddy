import { describe, it, expect } from 'vitest';
import { resolveLandingRoute } from '@/lib/routing';
import type { Profile } from '@/lib/types';

function profileWith(overrides: Partial<Profile>): Profile {
  return {
    id: 'u1',
    nickname: null,
    english_level: null,
    goals: [],
    interests: [],
    correction_preference: 'balanced',
    speech_speed: 1.0,
    subtitles_enabled: true,
    selected_character_id: null,
    timezone: 'Asia/Shanghai',
    streak_current: 0,
    streak_longest: 0,
    last_active_date: null,
    total_talk_seconds: 0,
    onboarding_completed_at: null,
    ...overrides,
  };
}

describe('resolveLandingRoute', () => {
  it('sends a user with no profile row to onboarding', () => {
    expect(resolveLandingRoute(null)).toBe('/onboarding');
  });

  it('sends an incomplete onboarding to /onboarding', () => {
    expect(resolveLandingRoute(profileWith({}))).toBe('/onboarding');
  });

  it('sends onboarded users without a character to /characters', () => {
    expect(
      resolveLandingRoute(profileWith({ onboarding_completed_at: '2026-07-20T00:00:00Z' })),
    ).toBe('/characters');
  });

  it('sends fully set up users to /home', () => {
    expect(
      resolveLandingRoute(
        profileWith({ onboarding_completed_at: '2026-07-20T00:00:00Z', selected_character_id: 'c1' }),
      ),
    ).toBe('/home');
  });
});

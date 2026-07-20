import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  emptyDraft,
  canProceed,
  type OnboardingDraft,
} from '@/lib/onboarding';

describe('onboarding step flow', () => {
  it('has the expected steps in order', () => {
    expect(ONBOARDING_STEPS).toEqual(['nickname', 'level', 'goals', 'interests', 'preferences']);
  });

  it('requires a non-blank nickname', () => {
    expect(canProceed('nickname', emptyDraft())).toBe(false);
    expect(canProceed('nickname', { ...emptyDraft(), nickname: '   ' })).toBe(false);
    expect(canProceed('nickname', { ...emptyDraft(), nickname: 'Q' })).toBe(true);
  });

  it('requires an english level', () => {
    expect(canProceed('level', emptyDraft())).toBe(false);
    expect(canProceed('level', { ...emptyDraft(), english_level: 'intermediate' })).toBe(true);
  });

  it('requires at least one goal and one interest', () => {
    expect(canProceed('goals', emptyDraft())).toBe(false);
    expect(canProceed('goals', { ...emptyDraft(), goals: ['daily-chat'] })).toBe(true);
    expect(canProceed('interests', emptyDraft())).toBe(false);
    expect(canProceed('interests', { ...emptyDraft(), interests: ['movies'] })).toBe(true);
  });

  it('always allows proceeding from preferences (all have defaults)', () => {
    expect(canProceed('preferences', emptyDraft())).toBe(true);
  });

  it('empty draft has sensible preference defaults', () => {
    const d: OnboardingDraft = emptyDraft();
    expect(d.correction_preference).toBe('balanced');
    expect(d.speech_speed).toBe(1.0);
    expect(d.subtitles_enabled).toBe(true);
  });
});

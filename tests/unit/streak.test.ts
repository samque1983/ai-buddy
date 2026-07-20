import { describe, it, expect } from 'vitest';
import { computeStreak, todayInTimezone } from '@/lib/streak';

describe('computeStreak', () => {
  it('starts a streak at 1 for a first-ever session', () => {
    expect(computeStreak({ lastActiveDate: null, current: 0, longest: 0, today: '2026-07-20' }))
      .toEqual({ current: 1, longest: 1, lastActiveDate: '2026-07-20' });
  });

  it('does not change on a second session the same day', () => {
    expect(computeStreak({ lastActiveDate: '2026-07-20', current: 3, longest: 5, today: '2026-07-20' }))
      .toEqual({ current: 3, longest: 5, lastActiveDate: '2026-07-20' });
  });

  it('increments when last active was yesterday', () => {
    expect(computeStreak({ lastActiveDate: '2026-07-19', current: 3, longest: 5, today: '2026-07-20' }))
      .toEqual({ current: 4, longest: 5, lastActiveDate: '2026-07-20' });
  });

  it('updates longest when the incremented streak passes it', () => {
    expect(computeStreak({ lastActiveDate: '2026-07-19', current: 5, longest: 5, today: '2026-07-20' }))
      .toEqual({ current: 6, longest: 6, lastActiveDate: '2026-07-20' });
  });

  it('resets to 1 after a gap of two or more days', () => {
    expect(computeStreak({ lastActiveDate: '2026-07-17', current: 9, longest: 9, today: '2026-07-20' }))
      .toEqual({ current: 1, longest: 9, lastActiveDate: '2026-07-20' });
  });

  it('handles month boundaries (Jan 31 -> Feb 1 is consecutive)', () => {
    expect(computeStreak({ lastActiveDate: '2026-01-31', current: 1, longest: 1, today: '2026-02-01' }))
      .toEqual({ current: 2, longest: 2, lastActiveDate: '2026-02-01' });
  });

  it('treats a clock anomaly (today before lastActiveDate) as same-day, not a reset', () => {
    expect(computeStreak({ lastActiveDate: '2026-07-21', current: 2, longest: 4, today: '2026-07-20' }))
      .toEqual({ current: 2, longest: 4, lastActiveDate: '2026-07-21' });
  });
});

describe('todayInTimezone', () => {
  it('formats a UTC instant as a YYYY-MM-DD date in the given timezone', () => {
    // 2026-07-20T18:00:00Z is already 2026-07-21 02:00 in Shanghai (UTC+8)
    const instant = new Date('2026-07-20T18:00:00Z');
    expect(todayInTimezone('Asia/Shanghai', instant)).toBe('2026-07-21');
    expect(todayInTimezone('UTC', instant)).toBe('2026-07-20');
  });
});

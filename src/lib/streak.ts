export interface StreakInput {
  /** YYYY-MM-DD in the user's timezone, or null if never active */
  lastActiveDate: string | null;
  current: number;
  longest: number;
  /** YYYY-MM-DD in the user's timezone */
  today: string;
}

export interface StreakResult {
  current: number;
  longest: number;
  lastActiveDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function computeStreak({ lastActiveDate, current, longest, today }: StreakInput): StreakResult {
  if (lastActiveDate === null) {
    return { current: 1, longest: Math.max(longest, 1), lastActiveDate: today };
  }
  const gap = daysBetween(lastActiveDate, today);
  // gap <= 0: same day, or clock moved backwards — leave the streak untouched
  if (gap <= 0) {
    return { current, longest, lastActiveDate };
  }
  const next = gap === 1 ? current + 1 : 1;
  return { current: next, longest: Math.max(longest, next), lastActiveDate: today };
}

export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

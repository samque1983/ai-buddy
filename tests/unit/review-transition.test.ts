import { describe, it, expect } from 'vitest';
import { reviewTransition } from '@/lib/learning/review-transition';

describe('reviewTransition', () => {
  it('moves a new expression to practicing with a next-day review when practiced', () => {
    expect(
      reviewTransition({ status: 'new', review_stage: 0 }, true, '2026-07-20'),
    ).toEqual({ status: 'practicing', review_stage: 1, next_review_at: '2026-07-21' });
  });

  it('moves a new expression to seen (no review date change) when introduced but not practiced', () => {
    expect(
      reviewTransition({ status: 'new', review_stage: 0 }, false, '2026-07-20'),
    ).toEqual({ status: 'seen', review_stage: 0, next_review_at: '2026-07-21' });
  });

  it('advances stage 1 -> 2 with a +3 day review', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 1 }, true, '2026-07-21'),
    ).toEqual({ status: 'practicing', review_stage: 2, next_review_at: '2026-07-24' });
  });

  it('advances stage 2 -> 3 with a +7 day review', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 2 }, true, '2026-07-24'),
    ).toEqual({ status: 'practicing', review_stage: 3, next_review_at: '2026-07-31' });
  });

  it('marks mastered after passing the final stage', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 3 }, true, '2026-07-31'),
    ).toEqual({ status: 'mastered', review_stage: 4, next_review_at: null });
  });

  it('keeps a mastered expression mastered', () => {
    expect(
      reviewTransition({ status: 'mastered', review_stage: 4 }, true, '2026-08-05'),
    ).toEqual({ status: 'mastered', review_stage: 4, next_review_at: null });
  });

  it('flags needs_review when not practiced and stage already progressing', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 2 }, false, '2026-07-30'),
    ).toEqual({ status: 'needs_review', review_stage: 2, next_review_at: '2026-07-31' });
  });

  it('recovers needs_review back to practicing when practiced again', () => {
    expect(
      reviewTransition({ status: 'needs_review', review_stage: 2 }, true, '2026-07-31'),
    ).toEqual({ status: 'practicing', review_stage: 3, next_review_at: '2026-08-07' });
  });
});

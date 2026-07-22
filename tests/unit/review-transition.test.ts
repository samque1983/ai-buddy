import { describe, it, expect } from 'vitest';
import { reviewTransition } from '@/lib/learning/review-transition';

// outcome: { practiced, score } — score is 0-10 when practiced, null otherwise.
describe('reviewTransition (score-aware)', () => {
  it('did not come up: new -> seen with a next-day review', () => {
    expect(
      reviewTransition({ status: 'new', review_stage: 0 }, { practiced: false, score: null }, '2026-07-20'),
    ).toEqual({ status: 'seen', review_stage: 0, next_review_at: '2026-07-21', last_score: null });
  });

  it('did not come up: an in-progress one -> needs_review tomorrow', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 2 }, { practiced: false, score: null }, '2026-07-20'),
    ).toEqual({ status: 'needs_review', review_stage: 2, next_review_at: '2026-07-21', last_score: null });
  });

  it('strong attempt (>=8) advances a stage and records the score', () => {
    expect(
      reviewTransition({ status: 'new', review_stage: 0 }, { practiced: true, score: 9 }, '2026-07-20'),
    ).toEqual({ status: 'practicing', review_stage: 1, next_review_at: '2026-07-21', last_score: 9 });
  });

  it('ok attempt (6-7) also advances a stage', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 1 }, { practiced: true, score: 6 }, '2026-07-21'),
    ).toEqual({ status: 'practicing', review_stage: 2, next_review_at: '2026-07-24', last_score: 6 });
  });

  it('weak attempt (<6) does NOT advance and comes back tomorrow', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 2 }, { practiced: true, score: 4 }, '2026-07-24'),
    ).toEqual({ status: 'needs_review', review_stage: 2, next_review_at: '2026-07-25', last_score: 4 });
  });

  it('weak attempt on a brand-new expression -> needs_review, stage stays 0', () => {
    expect(
      reviewTransition({ status: 'new', review_stage: 0 }, { practiced: true, score: 3 }, '2026-07-20'),
    ).toEqual({ status: 'needs_review', review_stage: 0, next_review_at: '2026-07-21', last_score: 3 });
  });

  it('a strong attempt past the final stage graduates to mastered', () => {
    expect(
      reviewTransition({ status: 'practicing', review_stage: 3 }, { practiced: true, score: 9 }, '2026-07-31'),
    ).toEqual({ status: 'mastered', review_stage: 4, next_review_at: null, last_score: 9 });
  });

  it('a needs_review one recovers to practicing on a good score', () => {
    expect(
      reviewTransition({ status: 'needs_review', review_stage: 2 }, { practiced: true, score: 8 }, '2026-07-31'),
    ).toEqual({ status: 'practicing', review_stage: 3, next_review_at: '2026-08-07', last_score: 8 });
  });

  it('mastered stays mastered regardless of a stray low score', () => {
    expect(
      reviewTransition({ status: 'mastered', review_stage: 4 }, { practiced: true, score: 4 }, '2026-08-05'),
    ).toEqual({ status: 'mastered', review_stage: 4, next_review_at: null, last_score: 4 });
  });
});

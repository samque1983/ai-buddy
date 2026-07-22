import type { ExpressionStatus } from '@/lib/types';

/** Review offsets in days per completed stage: next day, +3, +7. */
const STAGE_OFFSETS = [1, 3, 7];
const FINAL_STAGE = STAGE_OFFSETS.length; // stage 3 passed -> mastered
const PASS_SCORE = 6; // >= advances a stage; < sends it back for review

export interface ReviewState {
  status: ExpressionStatus;
  review_stage: number;
}

export interface PracticeOutcome {
  /** Did the user actually attempt the expression this session? */
  practiced: boolean;
  /** 0-10 quality of the attempt (from post-session analysis); null if not attempted. */
  score: number | null;
}

export interface ReviewTransitionResult {
  status: ExpressionStatus;
  review_stage: number;
  next_review_at: string | null;
  last_score: number | null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Spaced-repetition transition applied after a session, driven by the attempt score:
 * a strong/ok attempt (>= PASS_SCORE) advances a stage; a weak one (< PASS_SCORE)
 * is marked needs_review and resurfaces tomorrow; an expression that never came up
 * degrades gently.
 */
export function reviewTransition(
  state: ReviewState,
  outcome: PracticeOutcome,
  today: string,
): ReviewTransitionResult {
  const last_score = outcome.score;

  if (state.status === 'mastered') {
    return { status: 'mastered', review_stage: state.review_stage, next_review_at: null, last_score };
  }

  if (outcome.practiced && outcome.score !== null) {
    if (outcome.score >= PASS_SCORE) {
      const nextStage = state.review_stage + 1;
      if (nextStage > FINAL_STAGE) {
        return { status: 'mastered', review_stage: nextStage, next_review_at: null, last_score };
      }
      return {
        status: 'practicing',
        review_stage: nextStage,
        next_review_at: addDays(today, STAGE_OFFSETS[nextStage - 1]),
        last_score,
      };
    }
    // Weak attempt: hold the stage, bring it back tomorrow.
    return {
      status: 'needs_review',
      review_stage: state.review_stage,
      next_review_at: addDays(today, 1),
      last_score,
    };
  }

  // Surfaced but not attempted.
  if (state.status === 'new') {
    return { status: 'seen', review_stage: 0, next_review_at: addDays(today, 1), last_score };
  }
  return {
    status: 'needs_review',
    review_stage: state.review_stage,
    next_review_at: addDays(today, 1),
    last_score,
  };
}

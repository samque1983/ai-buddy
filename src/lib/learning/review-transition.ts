import type { ExpressionStatus } from '@/lib/types';

/** Review offsets in days per completed stage: next day, +3, +7. */
const STAGE_OFFSETS = [1, 3, 7];
const FINAL_STAGE = STAGE_OFFSETS.length; // stage 3 passed -> mastered

export interface ReviewState {
  status: ExpressionStatus;
  review_stage: number;
}

export interface ReviewTransitionResult {
  status: ExpressionStatus;
  review_stage: number;
  next_review_at: string | null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Spaced-repetition transition applied after each session that surfaced the expression.
 * `practiced` = the user actually used/attempted the expression this session.
 */
export function reviewTransition(
  state: ReviewState,
  practiced: boolean,
  today: string,
): ReviewTransitionResult {
  if (state.status === 'mastered') {
    return { status: 'mastered', review_stage: state.review_stage, next_review_at: null };
  }

  if (practiced) {
    const nextStage = state.review_stage + 1;
    if (nextStage > FINAL_STAGE) {
      return { status: 'mastered', review_stage: nextStage, next_review_at: null };
    }
    return {
      status: 'practicing',
      review_stage: nextStage,
      next_review_at: addDays(today, STAGE_OFFSETS[nextStage - 1]),
    };
  }

  // Surfaced but not practiced.
  if (state.status === 'new') {
    return { status: 'seen', review_stage: 0, next_review_at: addDays(today, 1) };
  }
  return {
    status: 'needs_review',
    review_stage: state.review_stage,
    next_review_at: addDays(today, 1),
  };
}

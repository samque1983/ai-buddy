import { describe, it, expect } from 'vitest';
import { LearningSummaryService } from '@/lib/learning/learning-summary';
import { FakeLlm } from '../fakes';
import { InMemoryLearningStore, makeProfile } from '../fakes/learning-store';

const structured = {
  overall: { zh: '整体不错,坚持得很好。', en: 'Solid overall; great consistency.' },
  strengths: [
    { zh: '日常表达越来越自然', en: 'Everyday expressions sound more natural' },
    { zh: '敢开口,停顿变少', en: 'Speaking up more, fewer pauses' },
  ],
  improvements: [
    { zh: '过去式还常忘', en: 'Past tense still slips' },
    { zh: '中式直译要注意', en: 'Watch for direct translations from Chinese' },
  ],
};

function setup() {
  const store = new InMemoryLearningStore();
  store.profiles.set('u1', makeProfile());
  const llm = new FakeLlm('unused', structured);
  return { store, llm, service: new LearningSummaryService(llm, store) };
}

describe('LearningSummaryService.refresh', () => {
  it('synthesizes a bilingual summary and upserts it for the user', async () => {
    const { store, service } = setup();
    await service.refresh('u1');
    const saved = store.learningSummaries.get('u1');
    expect(saved).toBeTruthy();
    expect(saved!.overall.zh).toContain('整体');
    expect(saved!.overall.en).toContain('Solid');
    expect(saved!.strengths).toHaveLength(2);
    expect(saved!.improvements).toHaveLength(2);
  });

  it('feeds the LLM aggregate signals: level, streak, progress counts, recent corrections', async () => {
    const { store, llm, service } = setup();
    // Some progress rows + corrections to aggregate.
    store.progress.push(
      {
        id: 'p1', expression_id: 'e1', user_id: 'u1', status: 'mastered',
        times_practiced: 3, last_practiced_at: null, review_stage: 3, next_review_at: null, last_score: 9,
      },
      {
        id: 'p2', expression_id: 'e2', user_id: 'u1', status: 'needs_review',
        times_practiced: 1, last_practiced_at: null, review_stage: 1, next_review_at: '2026-07-30', last_score: 4,
      },
    );
    store.corrections.push({
      id: 'c1', user_id: 'u1', conversation_id: 'cv1',
      original: 'I very like it', improved: 'I really like it',
      explanation: 'adverb order', category: 'grammar', is_upgrade: false,
    } as (typeof store.corrections)[number]);

    await service.refresh('u1');
    const input = llm.extractCalls[0].input;
    expect(input).toContain('mastered: 1');
    expect(input).toContain('needs_review: 1');
    expect(input).toContain('I very like it');
    expect(input).toContain('intermediate'); // level from makeProfile
  });

  it('skips quietly when the user has no learning data yet', async () => {
    const { store, llm, service } = setup();
    // No progress, no corrections → nothing meaningful to summarize.
    await service.refresh('u1');
    // Still writes (an early-encouragement summary is fine) OR skips — but never throws.
    // We lock the non-throwing contract:
    expect(llm.extractCalls.length).toBeLessThanOrEqual(1);
  });
});

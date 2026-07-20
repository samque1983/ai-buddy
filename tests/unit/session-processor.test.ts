import { describe, it, expect } from 'vitest';
import { SessionProcessor } from '@/lib/learning/session-processor';
import { ExpressionService } from '@/lib/learning/expression-service';
import { FakeLlm } from '../fakes';
import { InMemoryLearningStore, makeProfile } from '../fakes/learning-store';
import { todayInTimezone } from '@/lib/streak';
import type { Conversation } from '@/lib/types';

const today = todayInTimezone('Asia/Shanghai');

const analysis = {
  summary: {
    highlights: ['Used past tense correctly twice'],
    topics: ['shopping'],
    tomorrow_preview: 'Tomorrow we will practice ordering food.',
    encouragement: '今天说得很棒!',
  },
  corrections: [
    {
      original: 'Yesterday I go shopping',
      improved: 'Yesterday I went shopping',
      explanation: '过去式用 went',
      category: 'grammar',
    },
  ],
  expression_usage: [
    { english: 'Expression 1', practiced: true },
    { english: 'Expression 2', practiced: false },
  ],
  memories: [
    { type: 'event', content: 'User went shopping with their girlfriend yesterday.', importance: 3 },
  ],
  tomorrow_greeting: 'Hey! Did you end up wearing that new jacket?',
};

async function setup() {
  const store = new InMemoryLearningStore();
  store.profiles.set('u1', makeProfile({ streak_current: 2, streak_longest: 4, last_active_date: null }));

  // seed today's expressions via the service
  const genLlm = new FakeLlm('unused', {
    expressions: Array.from({ length: 5 }, (_, i) => ({
      english: `Expression ${i + 1}`,
      chinese: `表达${i + 1}`,
      scenario: 's',
      formality: 'casual',
      example_sentence: 'e',
      common_mistake: 'm',
      reason: 'r',
    })),
  });
  await new ExpressionService(genLlm, store).getOrGenerateDaily('u1', today);

  const session = await store.ensureDailySession('u1', today);
  const conversation: Conversation = {
    id: 'conv1',
    user_id: 'u1',
    character_id: 'c1',
    daily_session_id: session.id,
    status: 'ended',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: 0,
    summary: null,
    tomorrow_greeting: null,
  };
  store.conversations.set('conv1', conversation);
  store.transcripts.set('conv1', [
    { role: 'assistant', content: 'Hey! How are you?', audio_duration_ms: null },
    { role: 'user', content: 'Yesterday I go shopping', audio_duration_ms: 4000 },
    { role: 'assistant', content: 'Nice! A more natural way: Yesterday I went shopping.', audio_duration_ms: null },
    { role: 'user', content: 'Yesterday I went shopping. I am gonna head out now, Expression 1!', audio_duration_ms: 6000 },
  ]);

  const llm = new FakeLlm('unused', analysis);
  const processor = new SessionProcessor(llm, store);
  return { store, llm, processor };
}

describe('SessionProcessor.finalize', () => {
  it('saves corrections, memories, summary and marks the conversation finalized', async () => {
    const { store, processor } = await setup();
    await processor.finalize('conv1');

    expect(store.conversations.get('conv1')!.status).toBe('finalized');
    expect(store.corrections.filter((c) => c.conversation_id === 'conv1')).toHaveLength(1);
    expect(store.memories).toHaveLength(1);
    expect(store.memories[0].content).toContain('shopping');
    expect(store.summaries.get('conv1')!.tomorrowGreeting).toContain('jacket');
    expect(store.conversations.get('conv1')!.summary?.encouragement).toBe('今天说得很棒!');
  });

  it('updates streak and talk time on the profile and daily session', async () => {
    const { store, processor } = await setup();
    await processor.finalize('conv1');

    const profile = store.profiles.get('u1')!;
    expect(profile.streak_current).toBe(1); // last_active_date was null -> restart at 1
    expect(profile.last_active_date).toBe(today);
    expect(profile.total_talk_seconds).toBe(10); // 4s + 6s
    const session = store.dailySessions[0];
    expect(session.talk_seconds).toBe(10);
    expect(session.completed).toBe(true);
  });

  it('applies review transitions from expression usage', async () => {
    const { store, processor } = await setup();
    await processor.finalize('conv1');

    const byEnglish = (english: string) => {
      const e = store.expressions.find((x) => x.english === english)!;
      return store.progress.find((p) => p.expression_id === e.id)!;
    };
    const practiced = byEnglish('Expression 1');
    expect(practiced.status).toBe('practicing');
    expect(practiced.review_stage).toBe(1);
    expect(practiced.times_practiced).toBe(1);

    const surfacedOnly = byEnglish('Expression 2');
    expect(surfacedOnly.status).toBe('seen');

    // Expression 3 never came up — untouched
    expect(byEnglish('Expression 3').status).toBe('new');
  });

  it('is a no-op for already-finalized conversations', async () => {
    const { store, llm, processor } = await setup();
    await processor.finalize('conv1');
    const callsAfterFirst = llm.extractCalls.length;
    await processor.finalize('conv1');
    expect(llm.extractCalls.length).toBe(callsAfterFirst);
  });

  it('marks the conversation failed when analysis throws', async () => {
    const { store } = await setup();
    const badLlm = new FakeLlm('unused', { totally: 'wrong shape' });
    const processor = new SessionProcessor(badLlm, store);
    await expect(processor.finalize('conv1')).rejects.toThrow();
    expect(store.conversations.get('conv1')!.status).toBe('failed');
  });

  it('finalizes short sessions without calling the LLM', async () => {
    const { store, llm, processor } = await setup();
    store.transcripts.set('conv1', [
      { role: 'assistant', content: 'Hey!', audio_duration_ms: null },
    ]);
    await processor.finalize('conv1');
    expect(store.conversations.get('conv1')!.status).toBe('finalized');
    expect(llm.extractCalls).toHaveLength(0);
  });
});

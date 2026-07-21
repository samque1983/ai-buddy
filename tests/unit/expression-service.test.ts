import { describe, it, expect } from 'vitest';
import { ExpressionService } from '@/lib/learning/expression-service';
import { FakeLlm } from '../fakes';
import { InMemoryLearningStore, makeProfile } from '../fakes/learning-store';

const structured = {
  expressions: Array.from({ length: 5 }, (_, i) => ({
    english: `Expression ${i + 1}`,
    chinese: `表达${i + 1}`,
    scenario: 'casual chat',
    formality: 'casual',
    example_sentence: `Example sentence number ${i + 1}.`,
    common_mistake: `Mistake ${i + 1}`,
    reason: 'matches interests',
  })),
};

function setup() {
  const store = new InMemoryLearningStore();
  store.profiles.set('u1', makeProfile());
  const llm = new FakeLlm('unused', structured);
  const service = new ExpressionService(llm, store, 1);
  return { store, llm, service };
}

describe('ExpressionService.getOrGenerateDaily', () => {
  it('generates 5 expressions with progress rows on first call', async () => {
    const { store, service } = setup();
    const result = await service.getOrGenerateDaily('u1', '2026-07-20');
    expect(result).toHaveLength(5);
    expect(store.progress).toHaveLength(5);
    expect(store.progress.every((p) => p.status === 'new')).toBe(true);
    expect(store.dailySessions[0].expressions_generated).toBe(true);
  });

  it('is idempotent: second call returns the same 5 without calling the LLM again', async () => {
    const { store, llm, service } = setup();
    const first = await service.getOrGenerateDaily('u1', '2026-07-20');
    const second = await service.getOrGenerateDaily('u1', '2026-07-20');
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(llm.extractCalls).toHaveLength(1);
    expect(store.expressions).toHaveLength(5);
  });

  it('never generates twice under concurrent calls (atomic claim)', async () => {
    const { store, llm, service } = setup();
    const [a, b] = await Promise.all([
      service.getOrGenerateDaily('u1', '2026-07-20'),
      service.getOrGenerateDaily('u1', '2026-07-20'),
    ]);
    expect(llm.extractCalls).toHaveLength(1);
    expect(store.expressions).toHaveLength(5);
    expect(a.map((e) => e.id).sort()).toEqual(b.map((e) => e.id).sort());
  });

  it('releases the claim when generation fails so a retry can succeed', async () => {
    const store = new InMemoryLearningStore();
    store.profiles.set('u1', makeProfile());
    const badLlm = new FakeLlm('unused', { wrong: 'shape' });
    const failing = new ExpressionService(badLlm, store, 1);
    await expect(failing.getOrGenerateDaily('u1', '2026-07-20')).rejects.toThrow();
    expect(store.dailySessions[0].expressions_generated).toBe(false);

    const goodService = new ExpressionService(new FakeLlm('unused', structured), store, 1);
    const rows = await goodService.getOrGenerateDaily('u1', '2026-07-20');
    expect(rows).toHaveLength(5);
  });

  it('feeds recent corrections and level into the generation input', async () => {
    const { store, llm, service } = setup();
    store.corrections.push({
      id: 'c1',
      user_id: 'u1',
      conversation_id: 'x',
      original: 'I will leave now',
      improved: "I'm gonna head out",
      explanation: '',
      category: 'chinglish',
    });
    await service.getOrGenerateDaily('u1', '2026-07-20');
    const input = llm.extractCalls[0].input;
    expect(input).toContain('I will leave now');
    expect(input).toContain('intermediate');
    expect(input).toContain('movies');
  });
});

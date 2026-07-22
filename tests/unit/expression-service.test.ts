import { describe, it, expect } from 'vitest';
import { ExpressionService } from '@/lib/learning/expression-service';
import { FakeLlm } from '../fakes';
import { InMemoryLearningStore, makeProfile } from '../fakes/learning-store';
import type { CurriculumItem } from '@/lib/learning/curriculum-select';

function curr(pack: string, rank: number, english: string, level = 'elementary'): CurriculumItem {
  return {
    id: `${pack}-${rank}`,
    pack,
    rank,
    level: level as CurriculumItem['level'],
    english,
    chinese: `${english} 中文`,
    scenario: 's',
    formality: 'casual',
    example_sentence: `${english} example.`,
    common_mistake: 'm',
  };
}

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

  it('draws from the curriculum (rank order) without calling the LLM', async () => {
    const { store, llm, service } = setup();
    store.curriculum = [
      curr('daily-core', 3, 'C'),
      curr('daily-core', 1, 'A'),
      curr('daily-core', 2, 'B'),
      curr('daily-core', 4, 'D'),
      curr('daily-core', 5, 'E'),
      curr('daily-core', 6, 'F'),
    ];
    const rows = await service.getOrGenerateDaily('u1', '2026-07-20');
    expect(rows.map((e) => e.english)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(llm.extractCalls).toHaveLength(0);
    expect(rows.every((e) => (e.source as { pack?: string }).pack === 'daily-core')).toBe(true);
  });

  it('skips curriculum items the user has already learned', async () => {
    const { store, service } = setup();
    store.curriculum = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s, i) => curr('daily-core', i + 1, s));
    // Pretend the user already learned A and C on a previous day.
    await store.insertExpressions('u1', 'prev', '2026-07-19', [
      { english: 'A', chinese: '', scenario: '', formality: 'casual', example_sentence: '', common_mistake: '', source: null },
      { english: 'C', chinese: '', scenario: '', formality: 'casual', example_sentence: '', common_mistake: '', source: null },
    ]);
    const rows = await service.getOrGenerateDaily('u1', '2026-07-20');
    expect(rows.map((e) => e.english)).toEqual(['B', 'D', 'E', 'F', 'G']);
  });

  it('gates out items harder than the user level + 1 tier', async () => {
    const { store, service } = setup(); // profile is intermediate (tier 3), so max tier 4 = advanced ok
    store.profiles.set('u1', makeProfile({ english_level: 'beginner' })); // tier 1, max tier 2
    store.curriculum = [
      curr('daily-core', 1, 'easy1', 'beginner'),
      curr('daily-core', 2, 'hard', 'advanced'),
      curr('daily-core', 3, 'easy2', 'elementary'),
    ];
    const rows = await service.getOrGenerateDaily('u1', '2026-07-20');
    const englishes = rows.map((e) => e.english);
    expect(englishes.slice(0, 2)).toEqual(['easy1', 'easy2']); // curriculum, common first
    expect(englishes).not.toContain('hard'); // too hard — gated out
    expect(rows).toHaveLength(5); // LLM fallback tops up the remaining 3
  });

  it('round-robins across two active packs', async () => {
    const { store, service } = setup();
    store.profiles.set('u1', makeProfile({ active_packs: ['daily-core', 'ielts'] }));
    store.curriculum = [
      curr('daily-core', 1, 'D1'),
      curr('daily-core', 2, 'D2'),
      curr('daily-core', 3, 'D3'),
      curr('ielts', 1, 'I1', 'intermediate'),
      curr('ielts', 2, 'I2', 'intermediate'),
    ];
    const rows = await service.getOrGenerateDaily('u1', '2026-07-20');
    expect(rows.map((e) => e.english)).toEqual(['D1', 'I1', 'D2', 'I2', 'D3']);
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

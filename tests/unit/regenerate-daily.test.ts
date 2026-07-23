import { describe, it, expect } from 'vitest';
import { ExpressionService } from '@/lib/learning/expression-service';
import { FakeLlm } from '../fakes';
import { InMemoryLearningStore, makeProfile } from '../fakes/learning-store';
import type { CurriculumItem } from '@/lib/learning/curriculum-select';

function curr(pack: string, rank: number, english: string): CurriculumItem {
  return {
    id: `${pack}-${rank}`,
    pack,
    rank,
    level: 'elementary',
    english,
    chinese: `${english} 中文`,
    scenario: 's',
    formality: 'casual',
    example_sentence: `${english} example.`,
    common_mistake: 'm',
  };
}

function packOf(e: { source: Record<string, unknown> | null }): unknown {
  return e.source?.pack;
}

function setup() {
  const store = new InMemoryLearningStore();
  store.profiles.set('u1', makeProfile({ active_packs: ['daily-core'] }));
  store.curriculum = [
    curr('daily-core', 1, 'daily A'),
    curr('daily-core', 2, 'daily B'),
    curr('daily-core', 3, 'daily C'),
    curr('daily-core', 4, 'daily D'),
    curr('daily-core', 5, 'daily E'),
    curr('ielts', 1, 'ielts A'),
    curr('ielts', 2, 'ielts B'),
    curr('ielts', 3, 'ielts C'),
    curr('ielts', 4, 'ielts D'),
  ];
  const llm = new FakeLlm('unused', { expressions: [] });
  return { store, llm, service: new ExpressionService(llm, store, 1) };
}

describe('ExpressionService.regenerateDaily', () => {
  it('keeps practiced words and swaps untouched ones for the new content', async () => {
    const { store, service } = setup();
    const today = await service.getOrGenerateDaily('u1', '2026-07-20'); // 5 daily-core
    expect(today).toHaveLength(5);

    // Practice the first two.
    const practiced = [today[0].id, today[1].id];
    store.progress.forEach((p) => {
      if (practiced.includes(p.expression_id)) p.times_practiced = 1;
    });

    // Switch content to ielts.
    store.profiles.set('u1', makeProfile({ active_packs: ['ielts'] }));
    const after = await service.regenerateDaily('u1', '2026-07-20');

    expect(after).toHaveLength(5);
    expect(after.map((e) => e.id)).toEqual(expect.arrayContaining(practiced)); // history kept
    expect(after.map(packOf).filter((p) => p === 'daily-core')).toHaveLength(2); // only practiced
    expect(after.map(packOf).filter((p) => p === 'ielts')).toHaveLength(3); // filled
    expect(store.expressions).toHaveLength(5); // 3 untouched daily deleted
    // Dropped words' progress rows are gone too (no orphans).
    expect(store.progress).toHaveLength(5);
  });

  it('is a no-op when content is unchanged (no delete, no generate)', async () => {
    const { store, service } = setup();
    const today = await service.getOrGenerateDaily('u1', '2026-07-20');
    const after = await service.regenerateDaily('u1', '2026-07-20'); // still daily-core
    expect(after.map((e) => e.id).sort()).toEqual(today.map((e) => e.id).sort());
    expect(store.expressions).toHaveLength(5);
  });

  it('freechat leaves today untouched (chat mode shows no list)', async () => {
    const { store, service } = setup();
    const today = await service.getOrGenerateDaily('u1', '2026-07-20');
    store.profiles.set('u1', makeProfile({ active_packs: ['freechat'] }));
    const after = await service.regenerateDaily('u1', '2026-07-20');
    expect(after.map((e) => e.id)).toEqual(today.map((e) => e.id));
    expect(store.expressions).toHaveLength(5);
  });

  it('normalizes a legacy multi-pack profile to its first content pack', async () => {
    const { store, service } = setup();
    await service.getOrGenerateDaily('u1', '2026-07-20'); // daily-core
    store.profiles.set('u1', makeProfile({ active_packs: ['daily-core', 'ielts'] }));
    const after = await service.regenerateDaily('u1', '2026-07-20');
    // Normalized to daily-core (first) → today already daily-core → unchanged.
    expect(after).toHaveLength(5);
    expect(after.every((e) => packOf(e) === 'daily-core')).toBe(true);
  });
});

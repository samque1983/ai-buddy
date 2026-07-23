import type { LlmService } from '@/lib/services/types';
import type { EnglishLevel, Expression, Profile } from '@/lib/types';
import { sessionModeFromPacks } from '@/lib/types';
import { dailyExpressionsSchema } from './schemas';
import { selectFromCurriculum, type CurriculumItem } from './curriculum-select';
import { normalizeActivePacks, partitionForRegen } from './content-packs';
import type { LearningStore, NewExpression } from './store';

const DAILY_COUNT = 5;

const LEVEL_TIER: Record<EnglishLevel, number> = {
  beginner: 1,
  elementary: 2,
  intermediate: 3,
  advanced: 4,
};

const GENERATION_SYSTEM = [
  'You create daily English learning content for a Chinese learner in a voice-conversation app.',
  'Pick natural, high-frequency spoken expressions tailored to this user.',
  'Priorities, in order: fix their recent recurring mistakes; match their recent topics and interests; match their level.',
  'Expressions must be things real people say in casual conversation, not textbook phrases.',
  'Avoid anything the user has already learned.',
].join('\n');

export class ExpressionService {
  constructor(
    private llm: LlmService,
    private store: LearningStore,
    /** Wait between polls while another request holds the generation claim. */
    private pollMs: number = 1000,
  ) {}

  /** Idempotent: returns today's expressions, drawing them on first call of the day. */
  async getOrGenerateDaily(userId: string, date: string): Promise<Expression[]> {
    const existing = await this.store.getExpressionsByDate(userId, date);
    if (existing.length > 0) return existing;

    // Free-chat mode has no curriculum — learning happens through organic upgrades.
    const profileEarly = await this.store.getProfile(userId);
    if (sessionModeFromPacks(profileEarly?.active_packs) === 'freechat') return [];

    const session = await this.store.ensureDailySession(userId, date);

    const claimed = await this.store.claimExpressionGeneration(session.id);
    if (!claimed) {
      for (let i = 0; i < 10; i++) {
        const rows = await this.store.getExpressionsByDate(userId, date);
        if (rows.length > 0) return rows;
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
      return this.store.getExpressionsByDate(userId, date);
    }

    try {
      const profile = await this.store.getProfile(userId);
      const packs = profile?.active_packs?.length ? profile.active_packs : ['daily-core'];
      const rows = await this.buildRows(userId, date, profile, packs, DAILY_COUNT);
      return await this.store.insertExpressions(userId, session.id, date, rows);
    } catch (err) {
      await this.store.releaseExpressionGeneration(session.id);
      throw err;
    }
  }

  /**
   * Reconcile today's expressions to the currently-selected content WITHOUT losing
   * history: practiced words stay (with their long-term progress), untouched words
   * from removed content are dropped, and new-content words fill back to DAILY_COUNT.
   * Called when the user switches content on the Home picker.
   *
   *   today's expressions ─partition─► KEEP (practiced OR in-scope) ─┐
   *                                    DROP (untouched, out-of-scope)─► delete + progress
   *   fill from new packs (exclude KEEP + learned) ──────────────────► insert
   *   return KEEP ∪ new
   */
  async regenerateDaily(userId: string, date: string): Promise<Expression[]> {
    const profile = await this.store.getProfile(userId);
    const packs = normalizeActivePacks(profile?.active_packs);

    // Free-chat has no curriculum — leave today's rows untouched (the client shows a
    // chat state); switching back regenerates normally.
    if (sessionModeFromPacks(packs) === 'freechat') {
      return this.store.getExpressionsByDate(userId, date);
    }

    const withProgress = await this.store.getExpressionsWithProgress(userId, date);
    const items = withProgress.map(({ expression, progress }) => ({
      id: expression.id,
      pack: typeof expression.source?.pack === 'string' ? expression.source.pack : null,
      practiced: progress.times_practiced > 0,
      expression,
    }));

    const { keep, drop } = partitionForRegen(items, packs);
    // No-op: nothing to drop and today is already full for this content.
    if (drop.length === 0 && items.length >= DAILY_COUNT) {
      return items.map((i) => i.expression);
    }
    if (drop.length > 0) await this.store.deleteExpressions(drop.map((d) => d.id));

    const keptExpr = keep.map((k) => k.expression);
    const need = DAILY_COUNT - keptExpr.length;
    let added: Expression[] = [];
    if (need > 0) {
      const session = await this.store.ensureDailySession(userId, date);
      const excludeEnglish = new Set(keptExpr.map((e) => e.english.toLowerCase().trim()));
      const rows = await this.buildRows(userId, date, profile, packs, need, excludeEnglish);
      if (rows.length > 0) {
        added = await this.store.insertExpressions(userId, session.id, date, rows);
      }
    }
    return [...keptExpr, ...added];
  }

  /** Curriculum-first: pick `count` from `packs`; fall back to the LLM only if short. */
  private async buildRows(
    userId: string,
    date: string,
    profile: Profile | null,
    packs: string[],
    count: number,
    excludeExtra: Set<string> = new Set(),
  ): Promise<NewExpression[]> {
    // Gate by difficulty (allow one tier above), then rank order does "common first".
    const maxTier = (LEVEL_TIER[profile?.english_level ?? 'elementary'] ?? 2) + 1;
    const learned = await this.store.getLearnedEnglish(userId);
    const exclude = new Set([...learned, ...excludeExtra]);
    const chosen = new Set<string>();

    const packLists: CurriculumItem[][] = [];
    for (const pack of packs) {
      const items = (await this.store.getCurriculum(pack)).filter(
        (i) => LEVEL_TIER[i.level] <= maxTier && !exclude.has(i.english.toLowerCase().trim()),
      );
      packLists.push(items);
    }

    const picked = selectFromCurriculum(packLists, count);
    const rows: NewExpression[] = picked.map((i) => {
      chosen.add(i.english.toLowerCase().trim());
      return {
        english: i.english,
        chinese: i.chinese,
        scenario: i.scenario,
        formality: i.formality,
        example_sentence: i.example_sentence,
        common_mistake: i.common_mistake,
        source: { pack: i.pack, rank: i.rank },
      };
    });

    // Curriculum exhausted (or empty) — top up with LLM-generated expressions.
    if (rows.length < count) {
      const generated = await this.generate(userId, date, profile, count - rows.length, exclude, chosen);
      rows.push(...generated);
    }

    return rows;
  }

  private async generate(
    userId: string,
    date: string,
    profile: Profile | null,
    need: number,
    learned: Set<string>,
    chosen: Set<string>,
  ): Promise<NewExpression[]> {
    const [recentCorrections, dueReviews] = await Promise.all([
      this.store.getRecentCorrections(userId, 10),
      this.store.getDueReviews(userId, date),
    ]);
    const input = this.buildInput(profile, recentCorrections, dueReviews, need);
    const result = await this.llm.extractStructured({
      system: GENERATION_SYSTEM,
      input,
      schema: dailyExpressionsSchema,
      schemaName: 'daily_expressions',
    });
    return result.expressions
      .filter((e) => {
        const k = e.english.toLowerCase().trim();
        return !learned.has(k) && !chosen.has(k);
      })
      .slice(0, need)
      .map((e) => ({
        english: e.english,
        chinese: e.chinese,
        scenario: e.scenario,
        formality: e.formality,
        example_sentence: e.example_sentence,
        common_mistake: e.common_mistake,
        source: { reason: e.reason, wildcard: true },
      }));
  }

  private buildInput(
    profile: Profile | null,
    corrections: { original: string; improved: string; category: string }[],
    dueReviews: Expression[],
    need: number,
  ): string {
    const parts = [
      `User level: ${profile?.english_level ?? 'intermediate'}`,
      `Goals: ${profile?.goals?.join(', ') || 'daily conversation'}`,
      `Interests: ${profile?.interests?.join(', ') || 'general topics'}`,
    ];
    if (corrections.length > 0) {
      parts.push(
        'Recent mistakes (original -> better):',
        ...corrections.map((c) => `- "${c.original}" -> "${c.improved}" (${c.category})`),
      );
    }
    if (dueReviews.length > 0) {
      parts.push(
        'Expressions due for review (do NOT duplicate; may inspire related new ones):',
        ...dueReviews.map((e) => `- ${e.english}`),
      );
    }
    parts.push(`Generate exactly ${need} expression(s) for today.`);
    return parts.join('\n');
  }
}

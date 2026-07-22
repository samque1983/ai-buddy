import type { LlmService } from '@/lib/services/types';
import type { EnglishLevel, Expression, Profile } from '@/lib/types';
import { dailyExpressionsSchema } from './schemas';
import { selectFromCurriculum, type CurriculumItem } from './curriculum-select';
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
      const rows = await this.buildDailyRows(userId, date, profile);
      return await this.store.insertExpressions(userId, session.id, date, rows);
    } catch (err) {
      await this.store.releaseExpressionGeneration(session.id);
      throw err;
    }
  }

  /** Curriculum-first: pick from the user's active packs; fall back to the LLM only if short. */
  private async buildDailyRows(
    userId: string,
    date: string,
    profile: Profile | null,
  ): Promise<NewExpression[]> {
    const activePacks = profile?.active_packs?.length ? profile.active_packs : ['daily-core'];
    // Gate by difficulty (allow one tier above), then rank order does "common first".
    const maxTier = (LEVEL_TIER[profile?.english_level ?? 'elementary'] ?? 2) + 1;
    const learned = await this.store.getLearnedEnglish(userId);
    const chosen = new Set<string>();

    const packLists: CurriculumItem[][] = [];
    for (const pack of activePacks) {
      const items = (await this.store.getCurriculum(pack)).filter(
        (i) => LEVEL_TIER[i.level] <= maxTier && !learned.has(i.english.toLowerCase().trim()),
      );
      packLists.push(items);
    }

    const picked = selectFromCurriculum(packLists, DAILY_COUNT);
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
    if (rows.length < DAILY_COUNT) {
      const need = DAILY_COUNT - rows.length;
      const generated = await this.generate(userId, date, profile, need, learned, chosen);
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

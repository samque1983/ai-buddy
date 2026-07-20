import type { LlmService } from '@/lib/services/types';
import type { Expression, Profile } from '@/lib/types';
import { dailyExpressionsSchema } from './schemas';
import type { LearningStore } from './store';

const GENERATION_SYSTEM = [
  'You create daily English learning content for a Chinese learner in a voice-conversation app.',
  'Pick exactly 5 natural, high-frequency spoken American English expressions tailored to this user.',
  'Priorities, in order: fix their recent recurring mistakes; match their recent topics and interests; match their level; genuinely useful everyday speech.',
  'Expressions must be things real people say in casual conversation, not textbook phrases.',
  'Avoid anything the user has already mastered. Include due-for-review items only as inspiration for related NEW expressions, not duplicates.',
].join('\n');

export class ExpressionService {
  constructor(
    private llm: LlmService,
    private store: LearningStore,
  ) {}

  /** Idempotent: returns today's 5 expressions, generating them on first call of the day. */
  async getOrGenerateDaily(userId: string, date: string): Promise<Expression[]> {
    const existing = await this.store.getExpressionsByDate(userId, date);
    if (existing.length > 0) return existing;

    const session = await this.store.ensureDailySession(userId, date);
    // Re-check after ensuring the session (cheap race guard).
    if (session.expressions_generated) {
      return this.store.getExpressionsByDate(userId, date);
    }

    const [profile, recentCorrections, dueReviews] = await Promise.all([
      this.store.getProfile(userId),
      this.store.getRecentCorrections(userId, 10),
      this.store.getDueReviews(userId, date),
    ]);

    const input = this.buildInput(profile, recentCorrections, dueReviews);
    const result = await this.llm.extractStructured({
      system: GENERATION_SYSTEM,
      input,
      schema: dailyExpressionsSchema,
      schemaName: 'daily_expressions',
    });

    const rows = result.expressions.map((e) => ({
      english: e.english,
      chinese: e.chinese,
      scenario: e.scenario,
      formality: e.formality,
      example_sentence: e.example_sentence,
      common_mistake: e.common_mistake,
      source: { reason: e.reason },
    }));

    const inserted = await this.store.insertExpressions(userId, session.id, date, rows);
    await this.store.markExpressionsGenerated(session.id);
    return inserted;
  }

  private buildInput(
    profile: Profile | null,
    corrections: { original: string; improved: string; category: string }[],
    dueReviews: Expression[],
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
    parts.push('Generate exactly 5 expressions for today.');
    return parts.join('\n');
  }
}

import type { LlmService } from '@/lib/services/types';
import { learningSummarySchema } from './schemas';
import type { LearningStore } from './store';

const SUMMARY_SYSTEM = [
  "You write a whole-journey learning summary for a Chinese learner of English in a voice-conversation app. The reader is the learner — speak to them (你/you).",
  'You are given aggregate signals: level, streak, expression-progress counts, and their recent corrections (original -> improved).',
  'Synthesize, do not enumerate: find the PATTERNS (e.g. recurring grammar slips, tense issues, chinglish direct translations), not a list of individual mistakes.',
  'overall: their current situation in one warm, honest sentence. strengths: concrete progress they earned. improvements: the highest-leverage things to fix next, actionable.',
  'Both languages carry the same meaning; write natural Chinese and natural English, not literal translations of each other.',
].join('\n');

/**
 * Maintains the per-user whole-journey learning summary (the stats-page card):
 * aggregate signals → one LLM synthesis → upserted into learning_summaries.
 * Refreshed after each conversation finalizes, so reading it is always instant.
 */
export class LearningSummaryService {
  constructor(
    private llm: LlmService,
    private store: LearningStore,
  ) {}

  async refresh(userId: string): Promise<void> {
    const [profile, counts, corrections] = await Promise.all([
      this.store.getProfile(userId),
      this.store.getProgressCounts(userId),
      this.store.getRecentCorrections(userId, 20),
    ]);

    const parts = [
      `Level: ${profile?.english_level ?? 'unknown'}`,
      `Goals: ${profile?.goals?.join(', ') || 'daily conversation'}`,
      `Streak: current ${profile?.streak_current ?? 0} days, longest ${profile?.streak_longest ?? 0} days`,
      `Total speaking time: ${Math.round((profile?.total_talk_seconds ?? 0) / 60)} minutes`,
      'Expression progress counts:',
      ...Object.entries(counts).map(([status, n]) => `- ${status}: ${n}`),
    ];
    if (corrections.length > 0) {
      parts.push(
        'Recent corrections (original -> improved, category):',
        ...corrections.map((c) => `- "${c.original}" -> "${c.improved}" (${c.category})`),
      );
    }

    const content = await this.llm.extractStructured({
      system: SUMMARY_SYSTEM,
      input: parts.join('\n'),
      schema: learningSummarySchema,
      schemaName: 'learning_summary',
    });

    await this.store.saveLearningSummary(userId, content);
  }
}

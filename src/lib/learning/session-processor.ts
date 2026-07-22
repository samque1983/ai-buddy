import type { LlmService } from '@/lib/services/types';
import { computeStreak, todayInTimezone } from '@/lib/streak';
import { reviewTransition } from './review-transition';
import { postSessionSchema } from './schemas';
import type { LearningStore } from './store';

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, Math.round(score)));
}

const ANALYSIS_SYSTEM = [
  'You analyze a finished English practice conversation between a Chinese learner (user) and their AI companion (assistant).',
  'Extract: a warm summary, the most valuable corrections of the USER\'s English, which target expressions the user actually practiced, new long-term memories, and a greeting draft for tomorrow.',
  'Corrections must come from actual user utterances. Never invent mistakes.',
  'Also capture NATURALNESS UPGRADES: places where the user said something correct but plain and a more native version was (or could have been) offered. Record these in the same corrections array with is_upgrade=true (original = what they said, improved = the more natural version). Error fixes get is_upgrade=false.',
  'Memories must be facts worth knowing weeks later (their life, preferences, recurring issues) — not small talk. Do not duplicate existing memories.',
].join('\n');

export class SessionProcessor {
  constructor(
    private llm: LlmService,
    private store: LearningStore,
  ) {}

  /** Idempotent post-session pipeline. Safe to re-run on 'ended' or 'failed'. */
  async finalize(conversationId: string): Promise<void> {
    const conversation = await this.store.getConversation(conversationId);
    if (!conversation) return;

    // Atomic claim (ended/failed -> processing): concurrent callbacks and
    // already-finalized conversations bail out here.
    const claimed = await this.store.claimConversationForProcessing(conversationId);
    if (!claimed) return;

    try {
      const [transcript, profile, dailySession] = await Promise.all([
        this.store.getTranscript(conversationId),
        this.store.getProfile(conversation.user_id),
        conversation.daily_session_id
          ? this.store.getDailySession(conversation.daily_session_id)
          : Promise.resolve(null),
      ]);
      if (!profile) throw new Error('profile missing');

      // The conversation belongs to its daily session's date, not to whenever
      // this background callback happens to run (midnight/retry drift).
      const sessionDate = dailySession?.date ?? todayInTimezone(profile.timezone);
      const userTurns = transcript.filter((m) => m.role === 'user');
      const talkSeconds = Math.round(
        userTurns.reduce((sum, m) => sum + (m.audio_duration_ms ?? 0), 0) / 1000,
      );

      const applyAccounting = async () => {
        const streak = computeStreak({
          lastActiveDate: profile.last_active_date,
          current: profile.streak_current,
          longest: profile.streak_longest,
          today: sessionDate,
        });
        await this.store.updateProfile(conversation.user_id, {
          streak_current: streak.current,
          streak_longest: streak.longest,
          last_active_date: streak.lastActiveDate,
          total_talk_seconds: profile.total_talk_seconds + talkSeconds,
        });
        if (conversation.daily_session_id) {
          await this.store.bumpDailySession(conversation.daily_session_id, talkSeconds);
        }
      };

      // Too short to analyze — account and finalize without LLM work.
      if (userTurns.length === 0) {
        await applyAccounting();
        await this.store.setConversationStatus(conversationId, 'finalized');
        return;
      }

      const [todays, reviews, existingMemories] = await Promise.all([
        this.store.getExpressionsWithProgress(conversation.user_id, sessionDate),
        this.store.getDueReviewsWithProgress(conversation.user_id, sessionDate),
        this.store.getMemories(conversation.user_id),
      ]);
      // Today's new set plus any due-review expressions that resurfaced —
      // both can be practiced and scored this session. Dedupe by expression id.
      const seen = new Set(todays.map((e) => e.expression.id));
      const expressions = [...todays, ...reviews.filter((e) => !seen.has(e.expression.id))];

      const analysis = await this.llm.extractStructured({
        system: ANALYSIS_SYSTEM,
        input: this.buildInput(transcript, expressions, existingMemories),
        schema: postSessionSchema,
        schemaName: 'post_session_analysis',
        maxTokens: 4096,
      });

      // save* calls overwrite per-conversation rows, so a retry after a
      // mid-pipeline failure never duplicates corrections or memories.
      await this.store.saveCorrections(
        conversation.user_id,
        conversationId,
        analysis.corrections,
      );
      await this.store.saveMemories(
        conversation.user_id,
        conversationId,
        analysis.memories.filter((m) => m.content.trim().length > 0),
      );
      await this.store.saveSummary(conversationId, analysis.summary, analysis.tomorrow_greeting);

      // Apply score-driven spaced-repetition transitions for expressions that came up.
      const usageByEnglish = new Map(
        analysis.expression_usage.map((u) => [
          u.english.toLowerCase().trim(),
          { practiced: u.practiced, score: clampScore(u.score) },
        ]),
      );
      for (const { expression, progress } of expressions) {
        const usage = usageByEnglish.get(expression.english.toLowerCase().trim());
        if (usage === undefined) continue; // never came up — leave as-is
        const next = reviewTransition(
          { status: progress.status, review_stage: progress.review_stage },
          { practiced: usage.practiced, score: usage.practiced ? usage.score : null },
          sessionDate,
        );
        await this.store.updateExpressionProgress(progress.id, {
          status: next.status,
          review_stage: next.review_stage,
          next_review_at: next.next_review_at,
          last_score: next.last_score,
          times_practiced: progress.times_practiced + (usage.practiced ? 1 : 0),
          last_practiced_at: usage.practiced ? new Date().toISOString() : undefined,
        });
      }

      // Accounting runs last: a failure anywhere above leaves it unapplied, so
      // the retry path can't double-count streaks or talk time.
      await applyAccounting();
      await this.store.setConversationStatus(conversationId, 'finalized');
    } catch (err) {
      await this.store.setConversationStatus(conversationId, 'failed');
      throw err;
    }
  }

  private buildInput(
    transcript: { role: string; content: string }[],
    expressions: { expression: { english: string } }[],
    existingMemories: { content: string }[],
  ): string {
    const parts = [
      'Target expressions for today:',
      ...expressions.map((e) => `- ${e.expression.english}`),
      '',
      'Existing memories (do NOT duplicate):',
      ...existingMemories.map((m) => `- ${m.content}`),
      '',
      'Transcript:',
      ...transcript.map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`),
    ];
    return parts.join('\n');
  }
}

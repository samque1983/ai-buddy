import type { LlmService } from '@/lib/services/types';
import { computeStreak, todayInTimezone } from '@/lib/streak';
import { reviewTransition } from './review-transition';
import { postSessionSchema } from './schemas';
import type { LearningStore } from './store';

const ANALYSIS_SYSTEM = [
  'You analyze a finished English practice conversation between a Chinese learner (user) and their AI companion (assistant).',
  'Extract: a warm summary, the most valuable corrections of the USER\'s English, which target expressions the user actually practiced, new long-term memories, and a greeting draft for tomorrow.',
  'Corrections must come from actual user utterances. Never invent mistakes.',
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
    if (conversation.status === 'finalized' || conversation.status === 'active') return;

    await this.store.setConversationStatus(conversationId, 'processing');
    try {
      const [transcript, profile] = await Promise.all([
        this.store.getTranscript(conversationId),
        this.store.getProfile(conversation.user_id),
      ]);
      if (!profile) throw new Error('profile missing');

      const today = todayInTimezone(profile.timezone);
      const userTurns = transcript.filter((m) => m.role === 'user');
      const talkSeconds = Math.round(
        userTurns.reduce((sum, m) => sum + (m.audio_duration_ms ?? 0), 0) / 1000,
      );

      // Update streak + talk time regardless of transcript length.
      const streak = computeStreak({
        lastActiveDate: profile.last_active_date,
        current: profile.streak_current,
        longest: profile.streak_longest,
        today,
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

      // Too short to analyze — finalize without LLM work.
      if (userTurns.length === 0) {
        await this.store.setConversationStatus(conversationId, 'finalized');
        return;
      }

      const [expressions, existingMemories] = await Promise.all([
        this.store.getExpressionsWithProgress(conversation.user_id, today),
        this.store.getMemories(conversation.user_id),
      ]);

      const analysis = await this.llm.extractStructured({
        system: ANALYSIS_SYSTEM,
        input: this.buildInput(transcript, expressions, existingMemories),
        schema: postSessionSchema,
        schemaName: 'post_session_analysis',
        maxTokens: 4096,
      });

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

      // Apply spaced-repetition transitions for expressions that came up.
      const usageByEnglish = new Map(
        analysis.expression_usage.map((u) => [u.english.toLowerCase().trim(), u.practiced]),
      );
      for (const { expression, progress } of expressions) {
        const practiced = usageByEnglish.get(expression.english.toLowerCase().trim());
        if (practiced === undefined) continue; // never came up — leave as-is
        const next = reviewTransition(
          { status: progress.status, review_stage: progress.review_stage },
          practiced,
          today,
        );
        await this.store.updateExpressionProgress(progress.id, {
          status: next.status,
          review_stage: next.review_stage,
          next_review_at: next.next_review_at,
          times_practiced: progress.times_practiced + (practiced ? 1 : 0),
          last_practiced_at: practiced ? new Date().toISOString() : undefined,
        });
      }

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

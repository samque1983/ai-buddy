import { getServices } from '@/lib/services/factory';
import { buildRealtimeInstructions } from '@/lib/realtime/instructions';
import { chargeTurnAttempt } from '@/lib/api/rate-limit';
import { ExpressionService } from '@/lib/learning/expression-service';
import { SupabaseLearningStore } from '@/lib/learning/supabase-store';
import { todayInTimezone } from '@/lib/streak';
import { toRealtimeVoice } from '@/lib/realtime/voice-map';
import { ensureDailySession, loadConversationContext } from '@/lib/db/conversation-context';
import { buildTranscriptionPrompt } from '@/lib/realtime/relay-openai';
import type { createRelaySupabase } from '@/lib/realtime/relay-auth';

type RelaySupabase = ReturnType<typeof createRelaySupabase>;
type ExplainLanguage = 'bilingual' | 'english';

export type RelayContextResult =
  | {
      ok: true;
      instructions: string;
      voice: string;
      conversationId: string;
      model: string;
      transcriptionPrompt: string;
    }
  | { ok: false; error: 'setup_incomplete' | 'daily_limit' | 'create_failed' };

/**
 * Server-side prep for a relayed realtime session — the WS-relay twin of the WebRTC
 * mint route (src/app/api/realtime/session/route.ts), minus the OpenAI client_secret
 * mint (the relay opens the OpenAI socket itself). Loads persona + lesson, charges
 * the daily budget once, ensures today's expressions + session, and opens a
 * conversation row so transcripts + finalize reuse the normal pipeline.
 */
export async function prepareRelayContext(
  supabase: RelaySupabase,
  userId: string,
  explainLanguage: ExplainLanguage,
): Promise<RelayContextResult> {
  let ctx = await loadConversationContext(supabase, userId);
  if (!ctx) return { ok: false, error: 'setup_incomplete' };
  ctx = { ...ctx, explainLanguage };

  const budget = await chargeTurnAttempt(supabase, todayInTimezone(ctx.profile.timezone));
  if (budget === 'limited') return { ok: false, error: 'daily_limit' };

  if (ctx.todaysExpressions.length === 0) {
    try {
      const service = new ExpressionService(getServices().llm, new SupabaseLearningStore(supabase));
      const expressions = await service.getOrGenerateDaily(
        userId,
        todayInTimezone(ctx.profile.timezone),
      );
      ctx = { ...ctx, todaysExpressions: expressions };
    } catch (err) {
      console.error('relay expression generation failed', err);
    }
  }

  const dailySessionId = await ensureDailySession(supabase, userId, ctx.profile.timezone);
  const model = process.env.REALTIME_MODEL ?? 'gpt-realtime-mini';
  const instructions = buildRealtimeInstructions(ctx);
  const voice = toRealtimeVoice(ctx.character.tts_voice);
  // Prime the transcription model with today's target phrases so the learner's
  // subtitle is accurate for exactly the words they practice.
  const transcriptionPrompt = buildTranscriptionPrompt(ctx.todaysExpressions);

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, character_id: ctx.character.id, daily_session_id: dailySessionId })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: 'create_failed' };

  return { ok: true, instructions, voice, conversationId: data.id, model, transcriptionPrompt };
}

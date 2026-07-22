import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServices } from '@/lib/services/factory';
import { buildRealtimeInstructions } from '@/lib/realtime/instructions';
import { chargeTurnAttempt } from '@/lib/api/rate-limit';
import { ExpressionService } from '@/lib/learning/expression-service';
import { SupabaseLearningStore } from '@/lib/learning/supabase-store';
import { todayInTimezone } from '@/lib/streak';
import { toRealtimeVoice } from '@/lib/realtime/voice-map';
import {
  ensureDailySession,
  loadConversationContext,
} from '@/lib/db/conversation-context';

export const maxDuration = 60;

/**
 * Mints an ephemeral OpenAI Realtime client secret configured with the
 * character persona + today's lesson, and opens a conversation row so
 * transcripts and post-session processing reuse the normal pipeline.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { explainLanguage?: string };
  const explainLanguage = body.explainLanguage === 'english' ? 'english' : 'bilingual';

  let ctx = await loadConversationContext(supabase, user.id);
  if (!ctx) return NextResponse.json({ error: 'setup_incomplete' }, { status: 400 });
  ctx = { ...ctx, explainLanguage };

  // One charge per realtime session start (single round-trip, not five).
  const budget = await chargeTurnAttempt(supabase, todayInTimezone(ctx.profile.timezone));
  if (budget === 'limited') {
    return NextResponse.json({ error: 'daily_limit_reached' }, { status: 429 });
  }

  if (ctx.todaysExpressions.length === 0) {
    try {
      const service = new ExpressionService(
        getServices().llm,
        new SupabaseLearningStore(supabase),
      );
      const expressions = await service.getOrGenerateDaily(
        user.id,
        todayInTimezone(ctx.profile.timezone),
      );
      ctx = { ...ctx, todaysExpressions: expressions };
    } catch (err) {
      console.error('expression generation failed', err);
    }
  }

  const dailySessionId = await ensureDailySession(supabase, user.id, ctx.profile.timezone);
  const model = process.env.REALTIME_MODEL ?? 'gpt-realtime-mini';
  const instructions = buildRealtimeInstructions(ctx);

  // The slow hop is minting the client secret (OpenAI, US). Run it in parallel
  // with the conversation insert (Supabase) instead of one after the other.
  const [mintRes, conversationRes] = await Promise.all([
    fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model,
          instructions,
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: { type: 'semantic_vad' },
            },
            output: { voice: toRealtimeVoice(ctx.character.tts_voice) },
          },
        },
      }),
    }),
    supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        character_id: ctx.character.id,
        daily_session_id: dailySessionId,
      })
      .select('id')
      .single<{ id: string }>(),
  ]);

  if (conversationRes.error || !conversationRes.data) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  if (!mintRes.ok) {
    console.error('realtime client secret failed:', mintRes.status, await mintRes.text());
    return NextResponse.json({ error: 'realtime_unavailable' }, { status: 502 });
  }
  const data = (await mintRes.json()) as { value: string };

  return NextResponse.json({
    clientSecret: data.value,
    conversationId: conversationRes.data.id,
    model,
  });
}

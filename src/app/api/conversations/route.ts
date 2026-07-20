import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServices } from '@/lib/services/factory';
import { runConverseTurn } from '@/lib/services/converse-pipeline';
import { buildConversationSystem } from '@/lib/prompts/builder';
import { ndjsonResponse } from '@/lib/api/ndjson-response';
import {
  appendMessage,
  ensureDailySession,
  loadConversationContext,
} from '@/lib/db/conversation-context';

export const maxDuration = 90;

/** Creates a conversation and streams the character's greeting turn. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ctx = await loadConversationContext(supabase, user.id);
  if (!ctx) return NextResponse.json({ error: 'setup_incomplete' }, { status: 400 });

  const dailySessionId = await ensureDailySession(supabase, user.id, ctx.profile.timezone);

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      character_id: ctx.character.id,
      daily_session_id: dailySessionId,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !conversation) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  const system = buildConversationSystem(ctx);
  const gen = runConverseTurn(getServices(), {
    system,
    history: [],
    voice: ctx.character.tts_voice,
    speed: ctx.profile.speech_speed,
  });

  const response = ndjsonResponse(gen, async (event) => {
    if (event.type === 'done') {
      await appendMessage(supabase, conversation.id, 'assistant', event.assistantText);
    }
  });
  response.headers.set('X-Conversation-Id', conversation.id);
  return response;
}

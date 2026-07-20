import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServices } from '@/lib/services/factory';
import { runConverseTurn } from '@/lib/services/converse-pipeline';
import { buildConversationSystem } from '@/lib/prompts/builder';
import { ndjsonResponse } from '@/lib/api/ndjson-response';
import {
  appendMessage,
  loadConversationContext,
  loadHistory,
} from '@/lib/db/conversation-context';

export const maxDuration = 90;

/** One voice turn: audio in → NDJSON stream (stt / text / audio / done) out. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await request.formData();
  const audioFile = form.get('audio');
  const conversationId = form.get('conversationId');
  if (!(audioFile instanceof Blob) || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single<{ id: string; status: string }>();
  if (!conversation || conversation.status !== 'active') {
    return NextResponse.json({ error: 'conversation_not_active' }, { status: 400 });
  }

  const ctx = await loadConversationContext(supabase, user.id);
  if (!ctx) return NextResponse.json({ error: 'setup_incomplete' }, { status: 400 });

  const history = await loadHistory(supabase, conversationId);
  const audio = Buffer.from(await audioFile.arrayBuffer());
  const mimeType = audioFile.type || 'audio/webm';

  const system = buildConversationSystem(ctx);
  const gen = runConverseTurn(getServices(), {
    audio,
    mimeType,
    system,
    history,
    voice: ctx.character.tts_voice,
    speed: ctx.profile.speech_speed,
  });

  return ndjsonResponse(gen, async (event) => {
    if (event.type === 'stt') {
      await appendMessage(supabase, conversationId, 'user', event.text);
    } else if (event.type === 'done') {
      await appendMessage(supabase, conversationId, 'assistant', event.assistantText);
    }
  });
}

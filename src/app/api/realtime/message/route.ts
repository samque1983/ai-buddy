import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appendMessage } from '@/lib/db/conversation-context';

/** Persists a finalized realtime transcript line into the conversation. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    conversationId?: string;
    role?: string;
    content?: string;
  } | null;
  if (
    !body?.conversationId ||
    (body.role !== 'user' && body.role !== 'assistant') ||
    typeof body.content !== 'string' ||
    body.content.trim().length === 0
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('id', body.conversationId)
    .eq('user_id', user.id)
    .single<{ id: string; status: string }>();
  if (!conversation || conversation.status !== 'active') {
    return NextResponse.json({ error: 'conversation_not_active' }, { status: 400 });
  }

  await appendMessage(supabase, conversation.id, body.role, body.content.trim());
  return NextResponse.json({ ok: true });
}

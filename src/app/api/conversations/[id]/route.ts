import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { Conversation, Correction, Expression } from '@/lib/types';
import { todayInTimezone } from '@/lib/streak';
import type { Profile } from '@/lib/types';

/** Summary-page polling endpoint: conversation status + summary payload. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single<Conversation>();
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [{ data: corrections }, { data: profile }] = await Promise.all([
    supabase
      .from('corrections')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at')
      .returns<Correction[]>(),
    supabase.from('profiles').select('*').eq('id', user.id).single<Profile>(),
  ]);

  // Expressions belong to the conversation's daily session, not "today" —
  // summaries viewed after midnight must show what was actually practiced.
  let expressionsQuery = supabase.from('expressions').select('*').eq('user_id', user.id);
  if (conversation.daily_session_id) {
    expressionsQuery = expressionsQuery.eq('daily_session_id', conversation.daily_session_id);
  } else {
    expressionsQuery = expressionsQuery.eq(
      'date',
      todayInTimezone(profile?.timezone ?? 'Asia/Shanghai'),
    );
  }
  const { data: expressions } = await expressionsQuery.returns<Expression[]>();

  return NextResponse.json({
    conversation,
    corrections: corrections ?? [],
    expressions: expressions ?? [],
    streak: profile?.streak_current ?? 0,
  });
}

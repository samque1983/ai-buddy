import type { SupabaseClient } from '@supabase/supabase-js';
import type { Character, Expression, Profile, UserMemory } from '@/lib/types';
import type { ChatMessage } from '@/lib/services/types';
import { todayInTimezone } from '@/lib/streak';

const HISTORY_LIMIT = 30;

export interface ConversationContext {
  profile: Profile;
  character: Character;
  memories: UserMemory[];
  todaysExpressions: Expression[];
  tomorrowGreetingDraft?: string;
}

/** Loads everything the prompt builder needs for the current user. */
export async function loadConversationContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConversationContext | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single<Profile>();
  if (!profile?.selected_character_id) return null;

  const { data: character } = await supabase
    .from('characters')
    .select('*')
    .eq('id', profile.selected_character_id)
    .single<Character>();
  if (!character) return null;

  const today = todayInTimezone(profile.timezone);

  const [{ data: memories }, { data: expressions }, { data: lastConv }] = await Promise.all([
    supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15)
      .returns<UserMemory[]>(),
    supabase
      .from('expressions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .returns<Expression[]>(),
    supabase
      .from('conversations')
      .select('tomorrow_greeting')
      .eq('user_id', userId)
      .eq('status', 'finalized')
      .order('started_at', { ascending: false })
      .limit(1)
      .returns<{ tomorrow_greeting: string | null }[]>(),
  ]);

  return {
    profile,
    character,
    memories: memories ?? [],
    todaysExpressions: expressions ?? [],
    tomorrowGreetingDraft: lastConv?.[0]?.tomorrow_greeting ?? undefined,
  };
}

export async function loadHistory(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('role, content, seq')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(HISTORY_LIMIT);
  return (data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export async function appendMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  audioDurationMs?: number,
): Promise<void> {
  const { data } = await supabase
    .from('messages')
    .select('seq')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(1);
  const nextSeq = (data?.[0]?.seq ?? 0) + 1;
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    seq: nextSeq,
    role,
    content,
    audio_duration_ms: audioDurationMs ?? null,
  });
}

/** Ensures today's daily_session row exists; returns its id. */
export async function ensureDailySession(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
): Promise<string | null> {
  const today = todayInTimezone(timezone);
  const { data } = await supabase
    .from('daily_sessions')
    .upsert({ user_id: userId, date: today }, { onConflict: 'user_id,date', ignoreDuplicates: false })
    .select('id')
    .single<{ id: string }>();
  return data?.id ?? null;
}

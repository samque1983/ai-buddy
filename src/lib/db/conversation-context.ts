import type { SupabaseClient } from '@supabase/supabase-js';
import type { Character, Expression, Profile, SessionMode, UserMemory } from '@/lib/types';
import { sessionModeFromPacks } from '@/lib/types';
import type { ChatMessage } from '@/lib/services/types';
import { todayInTimezone } from '@/lib/streak';

const HISTORY_LIMIT = 30;

export interface ReviewExpression extends Expression {
  last_score: number | null;
}

export interface ConversationContext {
  profile: Profile;
  character: Character;
  memories: UserMemory[];
  todaysExpressions: Expression[];
  reviewExpressions: ReviewExpression[];
  masteredCount: number;
  practicingCount: number;
  tomorrowGreetingDraft?: string;
  explainLanguage?: 'bilingual' | 'english';
  mode?: SessionMode;
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

  // Due-for-review expressions from earlier days (the actual weak ones to re-drill),
  // plus overall mastery counts so the character can give the user a progress read.
  const { data: progress } = await supabase
    .from('expression_progress')
    .select('expression_id, status, last_score, next_review_at')
    .eq('user_id', userId)
    .returns<
      { expression_id: string; status: string; last_score: number | null; next_review_at: string | null }[]
    >();

  const masteredCount = (progress ?? []).filter((p) => p.status === 'mastered').length;
  const practicingCount = (progress ?? []).filter(
    (p) => p.status === 'practicing' || p.status === 'needs_review' || p.status === 'seen',
  ).length;

  const todaysIds = new Set((expressions ?? []).map((e) => e.id));
  const dueIds = (progress ?? [])
    .filter((p) => p.status !== 'mastered' && p.next_review_at !== null && p.next_review_at <= today)
    .map((p) => p.expression_id)
    .filter((id) => !todaysIds.has(id))
    .slice(0, 3);

  let reviewExpressions: ReviewExpression[] = [];
  if (dueIds.length > 0) {
    const { data: rows } = await supabase
      .from('expressions')
      .select('*')
      .in('id', dueIds)
      .returns<Expression[]>();
    const scoreById = new Map((progress ?? []).map((p) => [p.expression_id, p.last_score]));
    reviewExpressions = (rows ?? []).map((e) => ({ ...e, last_score: scoreById.get(e.id) ?? null }));
  }

  return {
    profile,
    character,
    memories: memories ?? [],
    todaysExpressions: expressions ?? [],
    reviewExpressions,
    masteredCount,
    practicingCount,
    tomorrowGreetingDraft: lastConv?.[0]?.tomorrow_greeting ?? undefined,
    mode: sessionModeFromPacks(profile.active_packs),
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

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Conversation,
  ConversationStatus,
  ConversationSummary,
  Correction,
  Expression,
  ExpressionProgress,
  Profile,
  UserMemory,
} from '@/lib/types';
import type {
  ExpressionWithProgress,
  LearningStore,
  NewCorrection,
  NewExpression,
  NewMemory,
  TranscriptRow,
} from './store';

export class SupabaseLearningStore implements LearningStore {
  constructor(private db: SupabaseClient) {}

  async getConversation(id: string): Promise<Conversation | null> {
    const { data } = await this.db.from('conversations').select('*').eq('id', id).single<Conversation>();
    return data ?? null;
  }

  async setConversationStatus(id: string, status: ConversationStatus): Promise<void> {
    await this.db.from('conversations').update({ status }).eq('id', id);
  }

  async claimConversationForProcessing(id: string): Promise<boolean> {
    const { data } = await this.db
      .from('conversations')
      .update({ status: 'processing' })
      .eq('id', id)
      .in('status', ['ended', 'failed'])
      .select('id');
    return (data?.length ?? 0) > 0;
  }

  async saveSummary(id: string, summary: ConversationSummary, tomorrowGreeting: string) {
    await this.db
      .from('conversations')
      .update({ summary, tomorrow_greeting: tomorrowGreeting })
      .eq('id', id);
  }

  async getTranscript(conversationId: string): Promise<TranscriptRow[]> {
    const { data } = await this.db
      .from('messages')
      .select('role, content, audio_duration_ms')
      .eq('conversation_id', conversationId)
      .order('seq');
    return (data ?? []) as TranscriptRow[];
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data } = await this.db.from('profiles').select('*').eq('id', userId).single<Profile>();
    return data ?? null;
  }

  async updateProfile(userId: string, patch: Partial<Profile>): Promise<void> {
    await this.db.from('profiles').update(patch).eq('id', userId);
  }

  async ensureDailySession(userId: string, date: string) {
    const { data } = await this.db
      .from('daily_sessions')
      .upsert({ user_id: userId, date }, { onConflict: 'user_id,date' })
      .select('id, expressions_generated')
      .single<{ id: string; expressions_generated: boolean }>();
    if (!data) throw new Error('daily session upsert failed');
    return data;
  }

  async getDailySession(dailySessionId: string): Promise<{ id: string; date: string } | null> {
    const { data } = await this.db
      .from('daily_sessions')
      .select('id, date')
      .eq('id', dailySessionId)
      .single<{ id: string; date: string }>();
    return data ?? null;
  }

  async claimExpressionGeneration(dailySessionId: string): Promise<boolean> {
    const { data } = await this.db
      .from('daily_sessions')
      .update({ expressions_generated: true })
      .eq('id', dailySessionId)
      .eq('expressions_generated', false)
      .select('id');
    return (data?.length ?? 0) > 0;
  }

  async releaseExpressionGeneration(dailySessionId: string): Promise<void> {
    await this.db
      .from('daily_sessions')
      .update({ expressions_generated: false })
      .eq('id', dailySessionId);
  }

  async bumpDailySession(dailySessionId: string, talkSecondsDelta: number): Promise<void> {
    const { data } = await this.db
      .from('daily_sessions')
      .select('talk_seconds, conversation_count')
      .eq('id', dailySessionId)
      .single<{ talk_seconds: number; conversation_count: number }>();
    if (!data) return;
    await this.db
      .from('daily_sessions')
      .update({
        talk_seconds: data.talk_seconds + talkSecondsDelta,
        conversation_count: data.conversation_count + 1,
        completed: true,
      })
      .eq('id', dailySessionId);
  }

  async getExpressionsByDate(userId: string, date: string): Promise<Expression[]> {
    const { data } = await this.db
      .from('expressions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .order('created_at')
      .returns<Expression[]>();
    return data ?? [];
  }

  async getExpressionsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]> {
    const expressions = await this.getExpressionsByDate(userId, date);
    if (expressions.length === 0) return [];
    const { data: progress } = await this.db
      .from('expression_progress')
      .select('*')
      .in(
        'expression_id',
        expressions.map((e) => e.id),
      )
      .returns<ExpressionProgress[]>();
    return expressions.flatMap((expression) => {
      const p = (progress ?? []).find((x) => x.expression_id === expression.id);
      return p ? [{ expression, progress: p }] : [];
    });
  }

  async getDueReviewsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]> {
    const { data: due } = await this.db
      .from('expression_progress')
      .select('*')
      .eq('user_id', userId)
      .lte('next_review_at', date)
      .neq('status', 'mastered')
      .returns<ExpressionProgress[]>();
    if (!due || due.length === 0) return [];
    const { data: expressions } = await this.db
      .from('expressions')
      .select('*')
      .in(
        'id',
        due.map((p) => p.expression_id),
      )
      .returns<Expression[]>();
    return (expressions ?? []).flatMap((expression) => {
      const progress = due.find((p) => p.expression_id === expression.id);
      return progress ? [{ expression, progress }] : [];
    });
  }

  async insertExpressions(
    userId: string,
    dailySessionId: string,
    date: string,
    rows: NewExpression[],
  ): Promise<Expression[]> {
    const { data: inserted, error } = await this.db
      .from('expressions')
      .insert(
        rows.map((r) => ({ user_id: userId, daily_session_id: dailySessionId, date, ...r })),
      )
      .select('*')
      .returns<Expression[]>();
    if (error || !inserted) throw new Error(`insert expressions failed: ${error?.message}`);
    await this.db
      .from('expression_progress')
      .insert(inserted.map((e) => ({ expression_id: e.id, user_id: userId })));
    return inserted;
  }

  async updateExpressionProgress(progressId: string, patch: Partial<ExpressionProgress>) {
    const clean = Object.fromEntries(
      Object.entries({ ...patch, updated_at: new Date().toISOString() }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    await this.db.from('expression_progress').update(clean).eq('id', progressId);
  }

  async getDueReviews(userId: string, date: string): Promise<Expression[]> {
    const { data: due } = await this.db
      .from('expression_progress')
      .select('expression_id')
      .eq('user_id', userId)
      .lte('next_review_at', date)
      .neq('status', 'mastered')
      .returns<{ expression_id: string }[]>();
    if (!due || due.length === 0) return [];
    const { data } = await this.db
      .from('expressions')
      .select('*')
      .in(
        'id',
        due.map((d) => d.expression_id),
      )
      .returns<Expression[]>();
    return data ?? [];
  }

  async getRecentCorrections(userId: string, limit: number): Promise<Correction[]> {
    const { data } = await this.db
      .from('corrections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<Correction[]>();
    return data ?? [];
  }

  async saveCorrections(userId: string, conversationId: string, rows: NewCorrection[]) {
    // Overwrite: a retried finalization must not duplicate rows.
    await this.db.from('corrections').delete().eq('conversation_id', conversationId);
    if (rows.length === 0) return;
    await this.db
      .from('corrections')
      .insert(rows.map((r) => ({ user_id: userId, conversation_id: conversationId, ...r })));
  }

  async getMemories(userId: string): Promise<UserMemory[]> {
    const { data } = await this.db
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .returns<UserMemory[]>();
    return data ?? [];
  }

  async saveMemories(userId: string, conversationId: string, rows: NewMemory[]) {
    // Overwrite memories extracted from this conversation on retry.
    await this.db.from('user_memories').delete().eq('source_conversation_id', conversationId);
    if (rows.length === 0) return;
    await this.db.from('user_memories').insert(
      rows.map((r) => ({
        user_id: userId,
        source_conversation_id: conversationId,
        type: r.type,
        content: r.content.slice(0, 300),
        importance: Math.min(5, Math.max(1, Math.round(r.importance))),
      })),
    );
  }
}

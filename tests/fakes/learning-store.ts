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
} from '@/lib/learning/store';

let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    nickname: 'Q',
    english_level: 'intermediate',
    goals: ['daily-chat'],
    interests: ['movies'],
    correction_preference: 'balanced',
    speech_speed: 1.0,
    subtitles_enabled: true,
    selected_character_id: 'c1',
    timezone: 'Asia/Shanghai',
    streak_current: 0,
    streak_longest: 0,
    last_active_date: null,
    total_talk_seconds: 0,
    onboarding_completed_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

export class InMemoryLearningStore implements LearningStore {
  profiles = new Map<string, Profile>();
  conversations = new Map<string, Conversation>();
  transcripts = new Map<string, TranscriptRow[]>();
  dailySessions: { id: string; user_id: string; date: string; expressions_generated: boolean; talk_seconds: number; conversation_count: number; completed: boolean }[] = [];
  expressions: Expression[] = [];
  progress: ExpressionProgress[] = [];
  corrections: Correction[] = [];
  memories: UserMemory[] = [];
  summaries = new Map<string, { summary: ConversationSummary; tomorrowGreeting: string }>();

  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }
  async setConversationStatus(id: string, status: ConversationStatus) {
    const c = this.conversations.get(id);
    if (c) c.status = status;
  }
  async claimConversationForProcessing(id: string) {
    const c = this.conversations.get(id);
    if (!c || (c.status !== 'ended' && c.status !== 'failed')) return false;
    c.status = 'processing';
    return true;
  }
  async saveSummary(id: string, summary: ConversationSummary, tomorrowGreeting: string) {
    this.summaries.set(id, { summary, tomorrowGreeting });
    const c = this.conversations.get(id);
    if (c) {
      c.summary = summary;
      c.tomorrow_greeting = tomorrowGreeting;
    }
  }
  async getTranscript(conversationId: string) {
    return this.transcripts.get(conversationId) ?? [];
  }
  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async updateProfile(userId: string, patch: Partial<Profile>) {
    const p = this.profiles.get(userId);
    if (p) Object.assign(p, patch);
  }
  async ensureDailySession(userId: string, date: string) {
    let s = this.dailySessions.find((d) => d.user_id === userId && d.date === date);
    if (!s) {
      s = { id: nextId(), user_id: userId, date, expressions_generated: false, talk_seconds: 0, conversation_count: 0, completed: false };
      this.dailySessions.push(s);
    }
    return { id: s.id, expressions_generated: s.expressions_generated };
  }
  async getDailySession(dailySessionId: string) {
    const s = this.dailySessions.find((d) => d.id === dailySessionId);
    return s ? { id: s.id, date: s.date } : null;
  }
  async claimExpressionGeneration(dailySessionId: string) {
    const s = this.dailySessions.find((d) => d.id === dailySessionId);
    if (!s || s.expressions_generated) return false;
    s.expressions_generated = true;
    return true;
  }
  async releaseExpressionGeneration(dailySessionId: string) {
    const s = this.dailySessions.find((d) => d.id === dailySessionId);
    if (s) s.expressions_generated = false;
  }
  async bumpDailySession(dailySessionId: string, talkSecondsDelta: number) {
    const s = this.dailySessions.find((d) => d.id === dailySessionId);
    if (s) {
      s.talk_seconds += talkSecondsDelta;
      s.conversation_count += 1;
      s.completed = true;
    }
  }
  async getExpressionsByDate(userId: string, date: string) {
    return this.expressions.filter((e) => e.user_id === userId && e.date === date);
  }
  async getExpressionsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]> {
    return this.expressions
      .filter((e) => e.user_id === userId && e.date === date)
      .map((expression) => {
        const progress = this.progress.find((p) => p.expression_id === expression.id)!;
        return { expression, progress };
      });
  }
  async insertExpressions(userId: string, dailySessionId: string, date: string, rows: NewExpression[]) {
    const inserted = rows.map((r) => {
      const expression: Expression = {
        id: nextId(),
        user_id: userId,
        daily_session_id: dailySessionId,
        date,
        ...r,
      };
      this.expressions.push(expression);
      this.progress.push({
        id: nextId(),
        expression_id: expression.id,
        user_id: userId,
        status: 'new',
        times_practiced: 0,
        last_practiced_at: null,
        review_stage: 0,
        next_review_at: null,
      });
      return expression;
    });
    return inserted;
  }
  async updateExpressionProgress(progressId: string, patch: Partial<ExpressionProgress>) {
    const p = this.progress.find((x) => x.id === progressId);
    if (p) Object.assign(p, patch);
  }
  async getDueReviews(userId: string, date: string) {
    const due = this.progress.filter(
      (p) => p.user_id === userId && p.next_review_at !== null && p.next_review_at <= date && p.status !== 'mastered',
    );
    return this.expressions.filter((e) => due.some((p) => p.expression_id === e.id));
  }
  async getRecentCorrections(userId: string, limit: number) {
    return this.corrections.filter((c) => c.user_id === userId).slice(-limit);
  }
  async saveCorrections(userId: string, conversationId: string, rows: NewCorrection[]) {
    this.corrections = this.corrections.filter((c) => c.conversation_id !== conversationId);
    for (const r of rows) {
      this.corrections.push({ id: nextId(), user_id: userId, conversation_id: conversationId, ...r });
    }
  }
  async getMemories(userId: string) {
    return this.memories.filter((m) => m.user_id === userId);
  }
  async saveMemories(userId: string, conversationId: string, rows: NewMemory[]) {
    this.memories = this.memories.filter((m) => m.source_conversation_id !== conversationId);
    for (const r of rows) {
      this.memories.push({
        id: nextId(),
        user_id: userId,
        source_conversation_id: conversationId,
        created_at: new Date().toISOString(),
        ...r,
      });
    }
  }
}

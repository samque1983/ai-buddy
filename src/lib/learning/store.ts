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

export interface TranscriptRow {
  role: 'user' | 'assistant';
  content: string;
  audio_duration_ms: number | null;
}

export interface NewExpression {
  english: string;
  chinese: string;
  scenario: string;
  formality: 'casual' | 'neutral' | 'formal';
  example_sentence: string;
  common_mistake: string;
  source: Record<string, unknown> | null;
}

export interface NewCorrection {
  original: string;
  improved: string;
  explanation: string;
  category: Correction['category'];
}

export interface NewMemory {
  type: UserMemory['type'];
  content: string;
  importance: number;
}

export interface ExpressionWithProgress {
  expression: Expression;
  progress: Pick<ExpressionProgress, 'id' | 'status' | 'review_stage' | 'times_practiced'>;
}

/** Persistence needed by the learning system (implemented on Supabase, faked in tests). */
export interface LearningStore {
  // conversations
  getConversation(id: string): Promise<Conversation | null>;
  setConversationStatus(id: string, status: ConversationStatus): Promise<void>;
  saveSummary(id: string, summary: ConversationSummary, tomorrowGreeting: string): Promise<void>;
  getTranscript(conversationId: string): Promise<TranscriptRow[]>;

  // profile / daily session
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: Partial<Profile>): Promise<void>;
  ensureDailySession(
    userId: string,
    date: string,
  ): Promise<{ id: string; expressions_generated: boolean }>;
  markExpressionsGenerated(dailySessionId: string): Promise<void>;
  bumpDailySession(dailySessionId: string, talkSecondsDelta: number): Promise<void>;

  // expressions
  getExpressionsByDate(userId: string, date: string): Promise<Expression[]>;
  getExpressionsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]>;
  insertExpressions(
    userId: string,
    dailySessionId: string,
    date: string,
    rows: NewExpression[],
  ): Promise<Expression[]>;
  updateExpressionProgress(
    progressId: string,
    patch: Partial<ExpressionProgress>,
  ): Promise<void>;
  getDueReviews(userId: string, date: string): Promise<Expression[]>;

  // corrections / memories
  getRecentCorrections(userId: string, limit: number): Promise<Correction[]>;
  saveCorrections(
    userId: string,
    conversationId: string,
    rows: NewCorrection[],
  ): Promise<void>;
  getMemories(userId: string): Promise<UserMemory[]>;
  saveMemories(userId: string, conversationId: string, rows: NewMemory[]): Promise<void>;
}

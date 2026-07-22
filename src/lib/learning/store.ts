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
import type { CurriculumItem } from './curriculum-select';

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
  is_upgrade: boolean;
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
  /** Atomic CAS ended/failed -> processing. False = someone else claimed it (or wrong state). */
  claimConversationForProcessing(id: string): Promise<boolean>;
  saveSummary(id: string, summary: ConversationSummary, tomorrowGreeting: string): Promise<void>;
  getTranscript(conversationId: string): Promise<TranscriptRow[]>;

  // profile / daily session
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: Partial<Profile>): Promise<void>;
  ensureDailySession(
    userId: string,
    date: string,
  ): Promise<{ id: string; expressions_generated: boolean }>;
  getDailySession(dailySessionId: string): Promise<{ id: string; date: string } | null>;
  /** Atomic CAS expressions_generated false -> true. False = another request holds the claim. */
  claimExpressionGeneration(dailySessionId: string): Promise<boolean>;
  /** Releases a claim after a failed generation so a later attempt can retry. */
  releaseExpressionGeneration(dailySessionId: string): Promise<void>;
  bumpDailySession(dailySessionId: string, talkSecondsDelta: number): Promise<void>;

  // expressions
  getExpressionsByDate(userId: string, date: string): Promise<Expression[]>;
  getExpressionsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]>;
  /** Due-for-review expressions (from earlier days) with their progress rows. */
  getDueReviewsWithProgress(userId: string, date: string): Promise<ExpressionWithProgress[]>;
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
  /** All expressions a pack contains, ordered by rank ascending. */
  getCurriculum(pack: string): Promise<CurriculumItem[]>;
  /** Lowercased english of every expression the user has already been taught. */
  getLearnedEnglish(userId: string): Promise<Set<string>>;

  // corrections / memories — save* calls OVERWRITE prior rows for the
  // conversation so re-running finalization never duplicates them.
  getRecentCorrections(userId: string, limit: number): Promise<Correction[]>;
  saveCorrections(
    userId: string,
    conversationId: string,
    rows: NewCorrection[],
  ): Promise<void>;
  getMemories(userId: string): Promise<UserMemory[]>;
  saveMemories(userId: string, conversationId: string, rows: NewMemory[]): Promise<void>;
}

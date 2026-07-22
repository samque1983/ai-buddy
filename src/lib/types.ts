// Domain types mirroring the database schema (supabase/migrations).

export type EnglishLevel = 'beginner' | 'elementary' | 'intermediate' | 'advanced';
export type CorrectionPreference = 'light' | 'balanced' | 'strict';
export type ConversationStatus = 'active' | 'ended' | 'processing' | 'finalized' | 'failed';
export type ExpressionStatus = 'new' | 'seen' | 'practicing' | 'mastered' | 'needs_review';
export type Formality = 'casual' | 'neutral' | 'formal';
export type MemoryType = 'profile' | 'event' | 'learning' | 'relationship';
export type CorrectionCategory = 'grammar' | 'word-choice' | 'chinglish' | 'pronunciation-note';

export interface Character {
  id: string;
  slug: string;
  name: string;
  avatar_url: string;
  tts_voice: string;
  preview_audio_url: string;
  preview_text: string;
  tagline: string;
  suited_for: string;
  personality: string;
  speaking_style: string;
  correction_style: string;
  system_prompt_fragment: string;
  is_active: boolean;
  sort_order: number;
}

export interface Profile {
  id: string;
  nickname: string | null;
  english_level: EnglishLevel | null;
  goals: string[];
  interests: string[];
  correction_preference: CorrectionPreference;
  speech_speed: number;
  subtitles_enabled: boolean;
  selected_character_id: string | null;
  active_packs: string[];
  timezone: string;
  streak_current: number;
  streak_longest: number;
  last_active_date: string | null;
  total_talk_seconds: number;
  onboarding_completed_at: string | null;
}

export interface Conversation {
  id: string;
  user_id: string;
  character_id: string;
  daily_session_id: string | null;
  status: ConversationStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  summary: ConversationSummary | null;
  tomorrow_greeting: string | null;
}

export interface ConversationSummary {
  highlights: string[];
  topics: string[];
  tomorrow_preview: string;
  encouragement: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  audio_duration_ms: number | null;
}

export interface Expression {
  id: string;
  user_id: string;
  daily_session_id: string;
  date: string;
  english: string;
  chinese: string;
  scenario: string;
  formality: Formality;
  example_sentence: string;
  common_mistake: string;
  source: Record<string, unknown> | null;
}

export interface ExpressionProgress {
  id: string;
  expression_id: string;
  user_id: string;
  status: ExpressionStatus;
  times_practiced: number;
  last_practiced_at: string | null;
  review_stage: number;
  next_review_at: string | null;
  last_score: number | null;
}

export interface UserMemory {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  importance: number;
  source_conversation_id: string | null;
  created_at: string;
}

export interface Correction {
  id: string;
  user_id: string;
  conversation_id: string;
  original: string;
  improved: string;
  explanation: string;
  category: CorrectionCategory;
}

export interface DailySession {
  id: string;
  user_id: string;
  date: string;
  expressions_generated: boolean;
  conversation_count: number;
  talk_seconds: number;
  completed: boolean;
}

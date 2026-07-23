import { describe, it, expect } from 'vitest';
import { buildConversationSystem } from '@/lib/prompts/builder';
import type { Character, Expression, Profile, UserMemory } from '@/lib/types';

const character: Character = {
  id: 'c1',
  slug: 'emma',
  name: 'Emma',
  avatar_url: '',
  tts_voice: 'nova',
  preview_audio_url: '',
  preview_text: '',
  tagline: '',
  suited_for: '',
  personality: 'Warm and patient.',
  speaking_style: 'Speaks slowly and clearly.',
  correction_style: 'Very gentle.',
  system_prompt_fragment: 'You are Emma, a warm and patient American friend.',
  is_active: true,
  sort_order: 1,
};

const profile: Profile = {
  id: 'u1',
  nickname: 'Q',
  english_level: 'intermediate',
  goals: ['daily-chat'],
  interests: ['movies', 'tech'],
  correction_preference: 'balanced',
  speech_speed: 1.0,
  subtitles_enabled: true,
  selected_character_id: 'c1',
  timezone: 'Asia/Shanghai',
  streak_current: 3,
  streak_longest: 5,
  last_active_date: '2026-07-19',
  total_talk_seconds: 1200,
  onboarding_completed_at: '2026-07-01T00:00:00Z',
};

const memories: UserMemory[] = [
  {
    id: 'm1',
    user_id: 'u1',
    type: 'event',
    content: 'User planned to play badminton on July 19.',
    importance: 4,
    source_conversation_id: null,
    created_at: '2026-07-19T00:00:00Z',
  },
];

const expressions: Expression[] = [
  {
    id: 'e1',
    user_id: 'u1',
    daily_session_id: 'd1',
    date: '2026-07-20',
    english: "I'm gonna head out.",
    chinese: '我要走了',
    scenario: 'Leaving casually',
    formality: 'casual',
    example_sentence: "It's getting late, I'm gonna head out.",
    common_mistake: 'I will leave now.',
    source: null,
  },
];

describe('buildConversationSystem', () => {
  const system = buildConversationSystem({
    character,
    profile,
    memories,
    todaysExpressions: expressions,
    tomorrowGreetingDraft: 'Ask how badminton went.',
  });

  it('includes the character persona fragment', () => {
    expect(system).toContain('You are Emma, a warm and patient American friend.');
  });

  it('includes the user profile facts', () => {
    expect(system).toContain('Q');
    expect(system).toContain('intermediate');
    expect(system).toContain('movies');
  });

  it('includes long-term memories', () => {
    expect(system).toContain('badminton');
  });

  it("includes today's expressions with meaning", () => {
    expect(system).toContain("I'm gonna head out.");
    expect(system).toContain('我要走了');
  });

  it('includes the correction style for the balanced preference', () => {
    expect(system.toLowerCase()).toContain('correction');
  });

  it('includes the greeting hint when provided', () => {
    expect(system).toContain('Ask how badminton went.');
  });

  it('forbids non-speakable output (markdown, stage directions)', () => {
    expect(system.toLowerCase()).toContain('markdown');
  });

  it('defaults to bilingual explanations (must also explain in Chinese)', () => {
    expect(system).toContain('EXPLAIN IN CHINESE TOO');
  });

  it('switches to English-only explanations when requested', () => {
    const englishOnly = buildConversationSystem({
      character,
      profile,
      memories,
      todaysExpressions: expressions,
      explainLanguage: 'english',
    });
    expect(englishOnly).toContain('ENGLISH ONLY');
    expect(englishOnly).not.toContain('EXPLAIN IN CHINESE TOO');
  });

  it('refuses to score a non-attempt (waits for a real try before giving a number)', () => {
    expect(system).toContain('ONLY score a REAL attempt');
    expect(system.toLowerCase()).toContain('do not rush in');
  });

  it('lesson mode drills the daily expressions', () => {
    expect(system).toContain("Today's target expressions");
    expect(system).not.toContain('FREE CHAT');
  });

  it('free-chat mode replaces the drill with conversation + naturalness upgrades', () => {
    const freechat = buildConversationSystem({
      character,
      profile,
      memories,
      todaysExpressions: expressions,
      mode: 'freechat',
    });
    expect(freechat).toContain('FREE CHAT');
    expect(freechat).toContain('NATURALNESS UPGRADES');
    expect(freechat).not.toContain("Today's target expressions"); // no drill
    expect(freechat).toContain('Emma'); // persona still there
  });

  it('omits the memory section when there are no memories', () => {
    const noMem = buildConversationSystem({
      character,
      profile,
      memories: [],
      todaysExpressions: expressions,
    });
    expect(noMem).not.toContain('badminton');
  });
});

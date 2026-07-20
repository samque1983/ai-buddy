import type { CorrectionPreference, EnglishLevel } from './types';

export const ONBOARDING_STEPS = ['nickname', 'level', 'goals', 'interests', 'preferences'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingDraft {
  nickname: string;
  english_level: EnglishLevel | null;
  goals: string[];
  interests: string[];
  correction_preference: CorrectionPreference;
  speech_speed: number;
  subtitles_enabled: boolean;
}

export function emptyDraft(): OnboardingDraft {
  return {
    nickname: '',
    english_level: null,
    goals: [],
    interests: [],
    correction_preference: 'balanced',
    speech_speed: 1.0,
    subtitles_enabled: true,
  };
}

export function canProceed(step: OnboardingStep, draft: OnboardingDraft): boolean {
  switch (step) {
    case 'nickname':
      return draft.nickname.trim().length > 0;
    case 'level':
      return draft.english_level !== null;
    case 'goals':
      return draft.goals.length > 0;
    case 'interests':
      return draft.interests.length > 0;
    case 'preferences':
      return true;
  }
}

export const GOAL_OPTIONS = [
  { value: 'daily-chat', label: '日常口语交流' },
  { value: 'natural-expressions', label: '学地道表达' },
  { value: 'confidence', label: '敢开口不紧张' },
  { value: 'work-english', label: '工作场景英语' },
  { value: 'travel', label: '出国旅行' },
] as const;

export const INTEREST_OPTIONS = [
  { value: 'movies', label: '电影剧集' },
  { value: 'music', label: '音乐' },
  { value: 'sports', label: '运动健身' },
  { value: 'food', label: '美食' },
  { value: 'travel', label: '旅行' },
  { value: 'tech', label: '科技数码' },
  { value: 'games', label: '游戏' },
  { value: 'reading', label: '阅读' },
  { value: 'pets', label: '宠物' },
  { value: 'career', label: '职场成长' },
] as const;

export const LEVEL_OPTIONS: { value: EnglishLevel; label: string; description: string }[] = [
  { value: 'beginner', label: '初级', description: '只能说简单句' },
  { value: 'elementary', label: '初中级', description: '可以交流,但经常卡住' },
  { value: 'intermediate', label: '中级', description: '可以交流,但表达不够自然' },
  { value: 'advanced', label: '中高级', description: '表达流畅,想更地道' },
];

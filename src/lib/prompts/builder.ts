import type { Character, Expression, Profile, UserMemory } from '@/lib/types';
import * as m from './modules';

export interface ReviewExpression extends Expression {
  last_score: number | null;
}

export interface ConversationContext {
  character: Character;
  profile: Profile;
  memories: UserMemory[];
  todaysExpressions: Expression[];
  reviewExpressions?: ReviewExpression[];
  masteredCount?: number;
  practicingCount?: number;
  tomorrowGreetingDraft?: string;
  /** How much Chinese to use when explaining. Defaults to 'bilingual'. */
  explainLanguage?: m.ExplainLanguage;
}

/**
 * Assembles the conversation system prompt from ordered modules.
 * Stable sections first (cache-friendly), volatile per-day/per-user content after.
 */
export function buildConversationSystem(ctx: ConversationContext): string {
  const sections = [
    m.globalRules(),
    m.safetyRules(),
    m.characterPersona(ctx.character),
    m.sessionFlow(),
    m.correctionStyle(ctx.profile.correction_preference),
    m.explanationLanguage(ctx.explainLanguage ?? 'bilingual'),
    m.userProfile(ctx.profile),
    m.progressSnapshot(ctx.masteredCount, ctx.practicingCount),
    m.memories(ctx.memories),
    m.reviewExpressions(ctx.reviewExpressions),
    m.dailyExpressions(ctx.todaysExpressions),
    m.greetingHint(ctx.tomorrowGreetingDraft),
  ];
  return sections.filter((s): s is string => s !== null).join('\n\n');
}

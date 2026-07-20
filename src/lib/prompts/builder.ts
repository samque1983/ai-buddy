import type { Character, Expression, Profile, UserMemory } from '@/lib/types';
import * as m from './modules';

export interface ConversationContext {
  character: Character;
  profile: Profile;
  memories: UserMemory[];
  todaysExpressions: Expression[];
  tomorrowGreetingDraft?: string;
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
    m.userProfile(ctx.profile),
    m.memories(ctx.memories),
    m.dailyExpressions(ctx.todaysExpressions),
    m.greetingHint(ctx.tomorrowGreetingDraft),
  ];
  return sections.filter((s): s is string => s !== null).join('\n\n');
}

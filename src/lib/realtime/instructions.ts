import { buildConversationSystem, type ConversationContext } from '@/lib/prompts/builder';

/**
 * Realtime-voice tail appended to the persona/lesson system prompt. Shared by the
 * WebRTC mint route and the WS relay so both realtime transports behave identically.
 */
export const REALTIME_INSTRUCTIONS_SUFFIX = [
  '',
  'Realtime voice notes:',
  '- This is live speech: the user can interrupt you at any time — stop and listen when they do.',
  '- Speak at a relaxed, natural pace. Keep every reply short (one or two sentences) unless teaching an expression.',
  '- Never output markdown, lists, or stage directions; everything you say is spoken aloud.',
].join('\n');

/** Full system prompt for a realtime session: persona + lesson + realtime voice tail. */
export function buildRealtimeInstructions(ctx: ConversationContext): string {
  return buildConversationSystem(ctx) + REALTIME_INSTRUCTIONS_SUFFIX;
}

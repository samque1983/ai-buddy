import { z } from 'zod';

/** Structured-output schemas for LLM extraction calls (validated with zod). */

export const dailyExpressionsSchema = z.object({
  expressions: z
    .array(
      z.object({
        english: z.string(),
        chinese: z.string(),
        scenario: z.string(),
        formality: z.enum(['casual', 'neutral', 'formal']),
        example_sentence: z.string(),
        common_mistake: z
          .string()
          .describe('The unnatural direct-translation a Chinese learner would typically say'),
        reason: z.string().describe('Why this expression was chosen for this user today'),
      }),
    )
    .min(5)
    .max(5),
});
export type DailyExpressionsOutput = z.infer<typeof dailyExpressionsSchema>;

export const postSessionSchema = z.object({
  summary: z.object({
    highlights: z.array(z.string()).describe('2-3 things the user did well, specific'),
    topics: z.array(z.string()),
    tomorrow_preview: z.string().describe('One sentence in English previewing tomorrow'),
    encouragement: z.string().describe('One warm sentence in Chinese for the summary card'),
  }),
  corrections: z
    .array(
      z.object({
        original: z.string(),
        improved: z.string(),
        explanation: z.string().describe('Short explanation; Chinese is fine'),
        category: z.enum(['grammar', 'word-choice', 'chinglish', 'pronunciation-note']),
      }),
    )
    .describe('The 0-5 most valuable corrections from this session'),
  expression_usage: z
    .array(
      z.object({
        english: z.string().describe('Must exactly match one of the target/review expressions'),
        practiced: z.boolean().describe('True if the USER actually attempted/used it'),
        score: z
          .number()
          .describe(
            'Quality of the user\'s best attempt, 0-10 (pronunciation + correct usage). 0 if they did not attempt it.',
          ),
      }),
    )
    .describe('Usage status and score for each target/review expression that came up'),
  memories: z
    .array(
      z.object({
        type: z.enum(['profile', 'event', 'learning', 'relationship']),
        content: z.string().describe('One atomic fact in English, max 200 chars'),
        importance: z.number().describe('1-5'),
      }),
    )
    .describe('New facts worth remembering long-term. Empty if nothing notable.'),
  tomorrow_greeting: z
    .string()
    .describe('A one-sentence English opener the character can use tomorrow, referencing this session'),
});
export type PostSessionOutput = z.infer<typeof postSessionSchema>;

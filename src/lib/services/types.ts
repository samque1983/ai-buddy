import type { z } from 'zod';

// ---- Provider interfaces (swappable via factory + env) ----

export interface SttService {
  transcribe(
    audio: Buffer,
    opts: { mimeType: string; language?: string },
  ): Promise<{ text: string; durationMs?: number }>;
}

export interface TtsService {
  /** Returns encoded audio bytes (mp3) for one sentence/chunk. */
  synthesize(text: string, opts: { voice: string; speed?: number }): Promise<Buffer>;
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export interface LlmService {
  /** Streaming conversational completion. Yields text deltas. */
  streamChat(params: {
    system: string;
    messages: ChatMessage[];
    maxTokens?: number;
  }): AsyncIterable<string>;

  /** Structured extraction: forces a tool call and validates against the zod schema. */
  extractStructured<T>(params: {
    system: string;
    input: string;
    schema: z.ZodType<T>;
    schemaName: string;
    maxTokens?: number;
  }): Promise<T>;
}

export interface AiServices {
  stt: SttService;
  tts: TtsService;
  llm: LlmService;
}

import type { z } from 'zod';
import type { AiServices, ChatMessage, LlmService, SttService, TtsService } from '@/lib/services/types';

export class FakeStt implements SttService {
  constructor(private text: string = 'Hello, I am practicing English.') {}
  calls: { mimeType: string }[] = [];
  async transcribe(_audio: Buffer, opts: { mimeType: string }) {
    this.calls.push({ mimeType: opts.mimeType });
    return { text: this.text, durationMs: 3000 };
  }
}

export class FakeTts implements TtsService {
  calls: string[] = [];
  async synthesize(text: string, _opts: { voice: string; speed?: number }): Promise<Buffer> {
    this.calls.push(text);
    return Buffer.from(`audio:${text}`);
  }
}

export class FakeLlm implements LlmService {
  constructor(
    private reply: string = "That sounds great! What did you do next? Tell me more about it.",
    private structured: unknown = {},
  ) {}
  streamCalls: { system: string; messages: ChatMessage[] }[] = [];
  extractCalls: { schemaName: string; input: string }[] = [];

  async *streamChat(params: { system: string; messages: ChatMessage[] }): AsyncIterable<string> {
    this.streamCalls.push({ system: params.system, messages: params.messages });
    // emit in small deltas to exercise the chunker
    for (let i = 0; i < this.reply.length; i += 5) {
      yield this.reply.slice(i, i + 5);
    }
  }

  setStructured(structured: unknown) {
    this.structured = structured;
  }

  private structuredByName = new Map<string, unknown>();
  /** Canned payload for a specific schemaName (falls back to the default otherwise). */
  setStructuredFor(schemaName: string, structured: unknown) {
    this.structuredByName.set(schemaName, structured);
  }

  async extractStructured<T>(params: {
    schema: z.ZodType<T>;
    schemaName: string;
    input: string;
    system: string;
  }): Promise<T> {
    this.extractCalls.push({ schemaName: params.schemaName, input: params.input });
    const payload = this.structuredByName.has(params.schemaName)
      ? this.structuredByName.get(params.schemaName)
      : this.structured;
    return params.schema.parse(payload);
  }
}

export function fakeServices(overrides?: Partial<AiServices>): AiServices & {
  stt: FakeStt;
  tts: FakeTts;
  llm: FakeLlm;
} {
  return {
    stt: new FakeStt(),
    tts: new FakeTts(),
    llm: new FakeLlm(),
    ...overrides,
  } as AiServices & { stt: FakeStt; tts: FakeTts; llm: FakeLlm };
}

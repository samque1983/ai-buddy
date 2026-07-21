import { SentenceChunker } from '@/lib/audio/sentence-chunker';
import type { ConverseEvent } from '@/lib/audio/ndjson';
import type { AiServices, ChatMessage } from './types';

const TTS_CONCURRENCY = 2;

export interface ConverseTurnParams {
  /** Absent for the greeting turn (character speaks first). */
  audio?: Buffer;
  mimeType?: string;
  system: string;
  history: ChatMessage[];
  voice: string;
  speed: number;
}

function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * One voice turn: (audio → STT) → LLM stream → sentence chunks → TTS.
 * TTS runs up to TTS_CONCURRENCY ahead, but events are emitted strictly in order:
 * stt? → (text, audio)* → done.
 */
export async function* runConverseTurn(
  services: AiServices,
  params: ConverseTurnParams,
): AsyncGenerator<ConverseEvent> {
  const { stt, tts, llm } = services;
  const messages: ChatMessage[] = [...params.history];

  if (params.audio) {
    const result = await stt.transcribe(params.audio, {
      mimeType: params.mimeType ?? 'audio/webm',
    });
    if (!result.text) {
      yield { type: 'error', message: 'empty_transcription' };
      return;
    }
    yield { type: 'stt', text: result.text, durationMs: result.durationMs };
    messages.push({ role: 'user', content: result.text });
  }

  // The Messages API requires a non-empty array starting with a user turn.
  // Greeting turns (no audio, no history) and histories that begin with the
  // character's greeting both need a synthetic kick-off.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({
      role: 'user',
      content: "(I just opened the app. Greet me and start today's session.)",
    });
  }

  // Producer: read LLM stream, chunk into sentences, kick off TTS eagerly.
  const queue: { text: string; audioP: Promise<Buffer> }[] = [];
  let producerDone = false;
  let producerError: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const limit = createLimiter(TTS_CONCURRENCY);
  const enqueue = (text: string) => {
    queue.push({
      text,
      audioP: limit(() => tts.synthesize(text, { voice: params.voice, speed: params.speed })),
    });
    notify();
  };

  const producer = (async () => {
    try {
      const chunker = new SentenceChunker();
      for await (const delta of llm.streamChat({ system: params.system, messages })) {
        for (const sentence of chunker.push(delta)) enqueue(sentence);
      }
      for (const sentence of chunker.flush()) enqueue(sentence);
    } catch (err) {
      console.error('converse pipeline: LLM stream failed:', err);
      producerError = err;
    } finally {
      producerDone = true;
      notify();
    }
  })();

  // Consumer: emit text + audio strictly in sentence order.
  const parts: string[] = [];
  let index = 0;
  while (true) {
    if (index < queue.length) {
      const item = queue[index++];
      parts.push(item.text);
      yield { type: 'text', text: item.text };
      try {
        const buf = await item.audioP;
        yield { type: 'audio', b64: buf.toString('base64'), mime: 'audio/mpeg' };
      } catch (err) {
        // TTS failure for one sentence: the text is already on screen; keep going.
        console.error('converse pipeline: TTS failed:', err);
        yield { type: 'error', message: 'tts_failed' };
      }
    } else if (producerDone) {
      break;
    } else {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  await producer;

  if (producerError) {
    yield { type: 'error', message: 'llm_failed' };
    return;
  }
  yield { type: 'done', assistantText: parts.join(' ') };
}

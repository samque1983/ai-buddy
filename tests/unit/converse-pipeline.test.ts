import { describe, it, expect } from 'vitest';
import { runConverseTurn } from '@/lib/services/converse-pipeline';
import { FakeLlm, FakeStt, FakeTts } from '../fakes';
import type { ConverseEvent } from '@/lib/audio/ndjson';

async function collect(gen: AsyncGenerator<ConverseEvent>): Promise<ConverseEvent[]> {
  const events: ConverseEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('runConverseTurn', () => {
  it('emits stt, then alternating text/audio per sentence, then done', async () => {
    const stt = new FakeStt('I go shopping yesterday.');
    const tts = new FakeTts();
    const llm = new FakeLlm('Nice, shopping is fun! What did you buy at the store?');

    const events = await collect(
      runConverseTurn(
        { stt, tts, llm },
        {
          audio: Buffer.from('fake'),
          mimeType: 'audio/webm',
          system: 'SYSTEM',
          history: [],
          voice: 'nova',
          speed: 1.0,
        },
      ),
    );

    expect(events[0]).toEqual({ type: 'stt', text: 'I go shopping yesterday.', durationMs: 3000 });

    const textEvents = events.filter((e) => e.type === 'text');
    const audioEvents = events.filter((e) => e.type === 'audio');
    expect(textEvents.map((e) => (e as { text: string }).text)).toEqual([
      'Nice, shopping is fun!',
      'What did you buy at the store?',
    ]);
    // each audio corresponds to its sentence, in order
    expect(
      audioEvents.map((e) => Buffer.from((e as { b64: string }).b64, 'base64').toString()),
    ).toEqual(['audio:Nice, shopping is fun!', 'audio:What did you buy at the store?']);

    // ordering: text always immediately before its audio
    const types = events.map((e) => e.type);
    expect(types).toEqual(['stt', 'text', 'audio', 'text', 'audio', 'done']);

    const done = events.at(-1) as { type: 'done'; assistantText: string };
    expect(done.assistantText).toBe('Nice, shopping is fun! What did you buy at the store?');
  });

  it('passes transcribed text as the latest user message to the LLM', async () => {
    const stt = new FakeStt('How do I say zaijian?');
    const tts = new FakeTts();
    const llm = new FakeLlm('You can just say goodbye, or see you later!');

    await collect(
      runConverseTurn(
        { stt, tts, llm },
        {
          audio: Buffer.from('x'),
          mimeType: 'audio/mp4',
          system: 'SYS',
          history: [{ role: 'assistant', content: 'Hey there!' }],
          voice: 'echo',
          speed: 1.0,
        },
      ),
    );

    expect(llm.streamCalls).toHaveLength(1);
    expect(llm.streamCalls[0].messages).toEqual([
      { role: 'assistant', content: 'Hey there!' },
      { role: 'user', content: 'How do I say zaijian?' },
    ]);
    expect(stt.calls[0].mimeType).toBe('audio/mp4');
  });

  it('runs a greeting turn with no audio input (no stt event)', async () => {
    const stt = new FakeStt();
    const tts = new FakeTts();
    const llm = new FakeLlm('Hey! How did badminton go yesterday?');

    const events = await collect(
      runConverseTurn(
        { stt, tts, llm },
        { system: 'SYS', history: [], voice: 'nova', speed: 1.0 },
      ),
    );

    expect(events.some((e) => e.type === 'stt')).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['text', 'audio', 'done']);
    expect(stt.calls).toHaveLength(0);
  });

  it('emits an error event when STT returns empty text', async () => {
    const stt = new FakeStt('');
    const tts = new FakeTts();
    const llm = new FakeLlm();

    const events = await collect(
      runConverseTurn(
        { stt, tts, llm },
        { audio: Buffer.from('x'), mimeType: 'audio/webm', system: 'S', history: [], voice: 'nova', speed: 1.0 },
      ),
    );
    expect(events.at(-1)?.type).toBe('error');
    expect(llm.streamCalls).toHaveLength(0);
  });
});

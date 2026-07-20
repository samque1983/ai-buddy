import { describe, it, expect, vi } from 'vitest';
import { AudioQueue, type MinimalAudioContext } from '@/components/talk/audio-queue';

interface MockSource {
  buffer: unknown;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

function mockContext() {
  const sources: MockSource[] = [];
  const ctx: MinimalAudioContext = {
    state: 'running',
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => ({ byteLength: data.byteLength }) as unknown as AudioBuffer),
    createBufferSource: vi.fn(() => {
      const source: MockSource = {
        buffer: null,
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
      };
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    }),
  };
  return { ctx, sources };
}

const b64 = Buffer.from('fake-audio').toString('base64');

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('AudioQueue', () => {
  it('plays chunks strictly sequentially', async () => {
    const { ctx, sources } = mockContext();
    const queue = new AudioQueue(ctx);

    queue.enqueue(b64);
    queue.enqueue(b64);
    await flush();

    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledOnce();

    // second starts only after the first ends
    sources[0].onended?.();
    await flush();
    expect(sources).toHaveLength(2);
    expect(sources[1].start).toHaveBeenCalledOnce();
  });

  it('fires onIdle after the last chunk finishes', async () => {
    const { ctx, sources } = mockContext();
    const queue = new AudioQueue(ctx);
    const onIdle = vi.fn();
    queue.onIdle = onIdle;

    queue.enqueue(b64);
    await flush();
    expect(onIdle).not.toHaveBeenCalled();

    sources[0].onended?.();
    await flush();
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('stop() halts playback and clears pending chunks', async () => {
    const { ctx, sources } = mockContext();
    const queue = new AudioQueue(ctx);

    queue.enqueue(b64);
    queue.enqueue(b64);
    await flush();

    queue.stop();
    expect(sources[0].stop).toHaveBeenCalled();

    // ending the stopped source must not start the next one
    sources[0].onended?.();
    await flush();
    expect(sources).toHaveLength(1);
  });
});

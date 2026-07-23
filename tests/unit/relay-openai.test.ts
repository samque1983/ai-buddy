import { describe, it, expect } from 'vitest';
import {
  buildSessionUpdate,
  classifyServerEvent,
  encodeAudioAppend,
  createOpenAIRelaySession,
  BACKPRESSURE_BYTES,
} from '@/lib/realtime/relay-openai';

describe('buildSessionUpdate', () => {
  const s = buildSessionUpdate('You are Emma. 中文讲解.', 'marin') as {
    type: string;
    session: {
      instructions: string;
      audio: {
        input: {
          format: { type: string; rate: number };
          noise_reduction: { type: string };
          transcription: unknown;
          turn_detection: { type: string; threshold: number; silence_duration_ms: number };
        };
        output: { format: { type: string; rate: number }; voice: string };
      };
    };
  };

  it('is a session.update carrying the instructions and voice', () => {
    expect(s.type).toBe('session.update');
    expect(s.session.instructions).toContain('中文讲解');
    expect(s.session.audio.output.voice).toBe('marin');
  });

  it('uses the GA object audio format (audio/pcm 24k), not the rejected "pcm16" string', () => {
    expect(s.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(s.session.audio.output.format).toEqual({ type: 'audio/pcm', rate: 24000 });
  });

  it('waits for hesitant learners (server_vad, long silence) and filters noise', () => {
    const td = s.session.audio.input.turn_detection;
    expect(td.type).toBe('server_vad');
    // Long enough that a mid-phrase pause doesn't end the turn.
    expect(td.silence_duration_ms).toBeGreaterThanOrEqual(1000);
    // Higher-than-default threshold to ignore quiet background sound.
    expect(td.threshold).toBeGreaterThan(0.5);
    expect(s.session.audio.input.noise_reduction.type).toBe('near_field');
    expect(s.session.audio.input.transcription).toBeTruthy();
  });
});

describe('encodeAudioAppend', () => {
  it('wraps base64 audio into an input_audio_buffer.append event', () => {
    const evt = JSON.parse(encodeAudioAppend('AAECAw=='));
    expect(evt.type).toBe('input_audio_buffer.append');
    expect(evt.audio).toBe('AAECAw==');
  });
});

describe('classifyServerEvent', () => {
  it('forwards output audio deltas to the client (both event names)', () => {
    expect(classifyServerEvent({ type: 'response.output_audio.delta', delta: 'x' }).forwardToClient).toBe(true);
    expect(classifyServerEvent({ type: 'response.audio.delta', delta: 'x' }).forwardToClient).toBe(true);
  });

  it('forwards speaking-state + transcript events (client shows subtitles / animation)', () => {
    expect(classifyServerEvent({ type: 'output_audio_buffer.started' }).forwardToClient).toBe(true);
    expect(classifyServerEvent({ type: 'output_audio_buffer.stopped' }).forwardToClient).toBe(true);
  });

  it('persists the user transcript', () => {
    const r = classifyServerEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'hello there',
    });
    expect(r.persist).toEqual({ role: 'user', content: 'hello there' });
    expect(r.forwardToClient).toBe(true);
  });

  it('persists the assistant transcript (GA + beta event names)', () => {
    for (const type of ['response.output_audio_transcript.done', 'response.audio_transcript.done']) {
      const r = classifyServerEvent({ type, transcript: 'nice one' });
      expect(r.persist).toEqual({ role: 'assistant', content: 'nice one' });
    }
  });

  it('drops unknown / internal events (no blind passthrough)', () => {
    expect(classifyServerEvent({ type: 'session.updated' }).forwardToClient).toBe(false);
    expect(classifyServerEvent({ type: 'rate_limits.updated' }).forwardToClient).toBe(false);
  });

  it('does not persist an empty transcript', () => {
    const r = classifyServerEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '   ',
    });
    expect(r.persist).toBeUndefined();
  });
});

describe('createOpenAIRelaySession', () => {
  function harness(bufferedAmount = 0) {
    const toClient: unknown[] = [];
    const toUpstream: string[] = [];
    const persisted: { role: string; content: string }[] = [];
    let upstreamCloses = 0;
    let clientCloses = 0;
    const s = createOpenAIRelaySession({
      client: {
        send: (d) => toClient.push(d),
        close: () => {
          clientCloses++;
        },
        bufferedAmount,
      },
      upstream: {
        send: (d) => toUpstream.push(d),
        close: () => {
          upstreamCloses++;
        },
      },
      instructions: 'You are Emma.',
      voice: 'marin',
      persist: (role, content) => persisted.push({ role, content }),
    });
    return {
      s,
      toClient,
      toUpstream,
      persisted,
      get upstreamCloses() {
        return upstreamCloses;
      },
      get clientCloses() {
        return clientCloses;
      },
    };
  }

  it('sends session.update then response.create when the upstream opens (assistant greets first)', () => {
    const h = harness();
    h.s.onUpstreamOpen();
    expect(JSON.parse(h.toUpstream[0]).type).toBe('session.update');
    expect(JSON.parse(h.toUpstream[0]).session.instructions).toBe('You are Emma.');
    expect(JSON.parse(h.toUpstream[1]).type).toBe('response.create');
  });

  it('drops audio deltas under client backpressure but still forwards transcripts', () => {
    const h = harness(BACKPRESSURE_BYTES + 1); // client is backed up
    h.s.onUpstreamMessage(JSON.stringify({ type: 'response.output_audio.delta', delta: 'zzz' }));
    h.s.onUpstreamMessage(
      JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hi' }),
    );
    // audio dropped, transcript still forwarded (1), and persisted
    expect(h.toClient.length).toBe(1);
    expect(h.persisted).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('teardown is idempotent — double close fires the opposite side once', () => {
    const h = harness();
    h.s.onClose();
    h.s.onClose();
    expect(h.upstreamCloses).toBe(1);
    const h2 = harness();
    h2.s.onUpstreamClose();
    h2.s.onUpstreamClose();
    expect(h2.clientCloses).toBe(1);
  });

  it('relays client audio (binary) up as an audio append', () => {
    const h = harness();
    h.s.onMessage(new Uint8Array([0, 1, 2, 3]), true);
    const evt = JSON.parse(h.toUpstream[0]);
    expect(evt.type).toBe('input_audio_buffer.append');
    expect(typeof evt.audio).toBe('string');
  });

  it('forwards OpenAI audio deltas down to the client and persists transcripts', () => {
    const h = harness();
    h.s.onUpstreamMessage(JSON.stringify({ type: 'response.output_audio.delta', delta: 'zzz' }));
    h.s.onUpstreamMessage(
      JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hi' }),
    );
    expect(h.toClient.length).toBe(2); // both forwarded
    expect(h.persisted).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('tears down the upstream when the client disconnects', () => {
    const h = harness();
    h.s.onClose();
    expect(h.upstreamCloses).toBe(1);
  });

  it('closes the client when the upstream drops', () => {
    let clientClosed = false;
    const s = createOpenAIRelaySession({
      client: { send: () => {}, close: () => { clientClosed = true; } },
      upstream: { send: () => {}, close: () => {} },
      instructions: 'x',
      voice: 'marin',
      persist: () => {},
    });
    s.onUpstreamClose();
    expect(clientClosed).toBe(true);
  });
});

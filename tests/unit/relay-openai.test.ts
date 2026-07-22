import { describe, it, expect } from 'vitest';
import {
  buildSessionUpdate,
  classifyServerEvent,
  encodeAudioAppend,
  createOpenAIRelaySession,
} from '@/lib/realtime/relay-openai';

describe('buildSessionUpdate', () => {
  const s = buildSessionUpdate('You are Emma. 中文讲解.', 'marin') as {
    type: string;
    session: {
      instructions: string;
      audio: {
        input: { format: string; transcription: unknown; turn_detection: { type: string } };
        output: { format: string; voice: string };
      };
    };
  };

  it('is a session.update carrying the instructions and voice', () => {
    expect(s.type).toBe('session.update');
    expect(s.session.instructions).toContain('中文讲解');
    expect(s.session.audio.output.voice).toBe('marin');
  });

  it('uses pcm16 both ways so raw audio can be relayed', () => {
    expect(s.session.audio.input.format).toBe('pcm16');
    expect(s.session.audio.output.format).toBe('pcm16');
  });

  it('enables VAD and input transcription (matches the WebRTC mint config)', () => {
    expect(s.session.audio.input.turn_detection.type).toBe('semantic_vad');
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
  function harness() {
    const toClient: unknown[] = [];
    const toUpstream: string[] = [];
    const persisted: { role: string; content: string }[] = [];
    let upstreamClosed = false;
    const s = createOpenAIRelaySession({
      client: { send: (d) => toClient.push(d), close: () => {} },
      upstream: { send: (d) => toUpstream.push(d), close: () => { upstreamClosed = true; } },
      instructions: 'You are Emma.',
      voice: 'marin',
      persist: (role, content) => persisted.push({ role, content }),
    });
    return { s, toClient, toUpstream, persisted, get upstreamClosed() { return upstreamClosed; } };
  }

  it('sends session.update to OpenAI when the upstream opens', () => {
    const h = harness();
    h.s.onUpstreamOpen();
    const evt = JSON.parse(h.toUpstream[0]);
    expect(evt.type).toBe('session.update');
    expect(evt.session.instructions).toBe('You are Emma.');
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
    expect(h.upstreamClosed).toBe(true);
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

import { isPhantomTranscript } from './transcript-filter';
import type { RelaySession, RelayTransport } from './relay-session';

/**
 * OpenAI Realtime bridge — the P2 replacement for the P1 echo. Same client-facing
 * RelaySession interface; underneath it talks to OpenAI over a second WebSocket.
 *
 *   client PCM16 (binary) ──► input_audio_buffer.append ──► OpenAI
 *   OpenAI audio delta / transcript / speaking events ──► (whitelist) ──► client
 *   transcripts also persisted server-side (reuses the normal conversation store)
 *
 * The transport I/O is injected so all of this is unit-testable without real sockets.
 */

/** Minimal upstream (OpenAI) socket the bridge drives. */
export interface Upstream {
  send(data: string): void;
  close(): void;
}

interface ServerEvent {
  type: string;
  transcript?: string;
  delta?: string;
}

/**
 * The session.update sent once the OpenAI socket opens. Uses the SAME nested GA
 * `session.audio` shape + transcription/VAD choices as the existing WebRTC mint
 * (src/app/api/realtime/session/route.ts), plus pcm16 formats for the raw relay.
 * ⚠️ VERIFY-AT-DEPLOY: this exact payload against the live GA `gpt-realtime` WS is
 * the #1 thing to confirm on first deploy (see task_plan.md P2 audio-format note).
 */
export function buildSessionUpdate(instructions: string, voice: string, transcriptionPrompt?: string) {
  // Better model than 'mini' for accented non-native English, and bias it with the
  // day's target phrases so the subtitle of the learner's own speech is accurate
  // (the conversation model understands the audio directly, but transcription is a
  // separate best-effort pass that otherwise mangles practice words).
  const transcription: { model: string; prompt?: string } = { model: 'gpt-4o-transcribe' };
  if (transcriptionPrompt) transcription.prompt = transcriptionPrompt;

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions,
      audio: {
        // GA wants an object, not the string 'pcm16' — a string is rejected with a
        // type error, which silently drops the WHOLE session.update (no persona, no
        // language, wrong audio → the model babbles in a random language).
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          // Filter ambient noise before VAD/transcription so nearby sounds aren't
          // taken as the learner's answer (phone held close → near_field).
          noise_reduction: { type: 'near_field' },
          transcription,
          // server_vad with a long silence window: a hesitant learner reading an
          // expression pauses mid-phrase, and we must NOT cut them off. 1200ms of
          // silence before the turn ends (vs the 500ms default). threshold 0.7:
          // at 0.6 users still saw phantom transcripts from noise/echo they never
          // spoke — trade a bit of quiet-speech sensitivity for far fewer ghosts.
          turn_detection: {
            type: 'server_vad',
            threshold: 0.7,
            prefix_padding_ms: 300,
            silence_duration_ms: 1200,
          },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice },
      },
    },
  };
}

/** Wraps base64 PCM16 into the OpenAI append event. */
export function encodeAudioAppend(base64Audio: string): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Audio });
}

/**
 * A transcription-model prompt biased toward today's target phrases so the
 * learner's subtitle transcribes exactly the words they're practicing.
 */
export function buildTranscriptionPrompt(expressions: { english: string }[]): string {
  const base = 'Spoken English practice by a Chinese learner of English.';
  const phrases = expressions.map((e) => e.english?.trim()).filter(Boolean);
  if (phrases.length === 0) return base;
  return `${base} The learner is practicing these phrases: ${phrases.join('; ')}.`;
}

// Events we relay to the client (audio to play, subtitles, speaking animation).
const FORWARD_TYPES = new Set([
  'response.output_audio.delta',
  'response.audio.delta',
  'response.output_audio_transcript.done',
  'response.audio_transcript.done',
  'conversation.item.input_audio_transcription.completed',
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
  'output_audio_buffer.cleared',
  'error',
]);

export interface EventClassification {
  forwardToClient: boolean;
  persist?: { role: 'user' | 'assistant'; content: string };
}

/** Whitelist + persistence routing for an OpenAI server event. No blind passthrough. */
export function classifyServerEvent(evt: ServerEvent): EventClassification {
  const forwardToClient = FORWARD_TYPES.has(evt.type);
  const text = evt.transcript?.trim();
  if (evt.type === 'conversation.item.input_audio_transcription.completed' && text) {
    // Phantom guard: hallucinated no-speech fragments must not enter the
    // conversation record (they'd pollute post-session analysis too).
    if (isPhantomTranscript(text)) return { forwardToClient };
    return { forwardToClient, persist: { role: 'user', content: text } };
  }
  if ((evt.type === 'response.output_audio_transcript.done' || evt.type === 'response.audio_transcript.done') && text) {
    return { forwardToClient, persist: { role: 'assistant', content: text } };
  }
  return { forwardToClient };
}

function toBase64(data: ArrayBufferView | ArrayBuffer | string): string {
  if (typeof data === 'string') return Buffer.from(data).toString('base64');
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(view).toString('base64');
}

export interface OpenAIRelaySession extends RelaySession {
  /** Wired by the server to the real OpenAI socket lifecycle. */
  onUpstreamOpen(): void;
  onUpstreamMessage(raw: string): void;
  onUpstreamClose(): void;
}

// Drop audio deltas once the client's send buffer passes this — a slow client
// (the target: bad China networks) drains slower than OpenAI fills, so without
// this the Node heap grows unbounded per session → OOM on the 512MB box.
export const BACKPRESSURE_BYTES = 1_000_000; // 1 MB

const AUDIO_DELTA_TYPES = new Set(['response.output_audio.delta', 'response.audio.delta']);

export function createOpenAIRelaySession(deps: {
  client: RelayTransport;
  upstream: Upstream;
  instructions: string;
  voice: string;
  /** Biases the transcription model toward today's target phrases (accurate subtitles). */
  transcriptionPrompt?: string;
  persist: (role: 'user' | 'assistant', content: string) => void;
}): OpenAIRelaySession {
  const { client, upstream, instructions, voice, transcriptionPrompt, persist } = deps;
  // One guarded teardown so close events (which cross-trigger each other) can't
  // re-enter or leak the opposite socket.
  let closed = false;

  return {
    // --- OpenAI (upstream) side ---
    onUpstreamOpen() {
      upstream.send(JSON.stringify(buildSessionUpdate(instructions, voice, transcriptionPrompt)));
      // Kick off the assistant's greeting (sessionFlow: it speaks first). Server
      // VAD drives every turn after this.
      upstream.send(JSON.stringify({ type: 'response.create' }));
    },
    onUpstreamMessage(raw) {
      let evt: ServerEvent;
      try {
        evt = JSON.parse(raw) as ServerEvent;
      } catch {
        return; // non-JSON frame — ignore
      }
      // Surface OpenAI-side errors (e.g. a rejected session.update) to server logs so
      // schema/config problems are diagnosable without the client console.
      if (evt.type === 'error') console.error('openai realtime error:', raw);
      const { forwardToClient, persist: p } = classifyServerEvent(evt);
      if (forwardToClient) {
        const isAudio = AUDIO_DELTA_TYPES.has(evt.type);
        const backedUp = (client.bufferedAmount ?? 0) > BACKPRESSURE_BYTES;
        // Under backpressure, drop audio (recoverable) but never the small
        // transcript/state events.
        if (!(isAudio && backedUp)) client.send(raw);
      }
      if (p) persist(p.role, p.content);
    },
    onUpstreamClose() {
      if (closed) return;
      closed = true;
      client.close(1011, 'realtime upstream closed');
    },
    // --- client side ---
    onMessage(data, isBinary) {
      if (isBinary) {
        upstream.send(encodeAudioAppend(toBase64(data)));
      } else {
        // Client-originated JSON control (e.g. response.create) — forward as-is.
        upstream.send(typeof data === 'string' ? data : toBase64(data));
      }
    },
    onClose() {
      if (closed) return;
      closed = true;
      upstream.close();
    },
  };
}

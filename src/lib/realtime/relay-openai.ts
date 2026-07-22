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
export function buildSessionUpdate(instructions: string, voice: string) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions,
      audio: {
        input: {
          format: 'pcm16',
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'semantic_vad' },
        },
        output: { format: 'pcm16', voice },
      },
    },
  };
}

/** Wraps base64 PCM16 into the OpenAI append event. */
export function encodeAudioAppend(base64Audio: string): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Audio });
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

export function createOpenAIRelaySession(deps: {
  client: RelayTransport;
  upstream: Upstream;
  instructions: string;
  voice: string;
  persist: (role: 'user' | 'assistant', content: string) => void;
}): OpenAIRelaySession {
  const { client, upstream, instructions, voice, persist } = deps;
  return {
    // --- OpenAI (upstream) side ---
    onUpstreamOpen() {
      upstream.send(JSON.stringify(buildSessionUpdate(instructions, voice)));
    },
    onUpstreamMessage(raw) {
      let evt: ServerEvent;
      try {
        evt = JSON.parse(raw) as ServerEvent;
      } catch {
        return; // non-JSON frame — ignore
      }
      const { forwardToClient, persist: p } = classifyServerEvent(evt);
      if (forwardToClient) client.send(raw);
      if (p) persist(p.role, p.content);
    },
    onUpstreamClose() {
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
      upstream.close();
    },
  };
}

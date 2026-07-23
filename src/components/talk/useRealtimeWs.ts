'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceErrorMessage } from '@/lib/env/browser';
import { downsample, floatTo16BitPCM } from '@/lib/audio/pcm';
import { isPhantomTranscript } from '@/lib/realtime/transcript-filter';
import { PCMPlayer } from './pcm-player';
import type { TranscriptEntry } from './useConversation';

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'error';

/**
 * WS-relay 流畅模式: browser ↔ our server ↔ OpenAI, all over WebSocket. The browser
 * never talks to OpenAI directly, so this works on networks that can't reach OpenAI
 * (the whole reason it exists). Same hook API as useRealtime (WebRTC) so talk/page
 * can switch transports behind a flag.
 *
 *   mic → AudioWorklet (native rate) → downsample 24k + PCM16 → ws (binary)
 *   ws (JSON events) → audio deltas → PCMPlayer; transcripts → subtitles
 *
 * Transcripts persist server-side (the relay calls appendMessage), so this client
 * only renders them — no double-write.
 */
export function useRealtimeWs() {
  const [status, setStatus] = useState<RealtimeStatus>('off');
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  // True while WE are closing on purpose, so onclose doesn't flash an error.
  const endingRef = useRef(false);

  const cleanup = useCallback(() => {
    endingRef.current = true;
    wsRef.current?.close();
    wsRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    void captureCtxRef.current?.close();
    captureCtxRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    setSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setStatus('off');
  }, [cleanup]);

  const start = useCallback(
    async (opts?: { explainLanguage?: 'bilingual' | 'english' }): Promise<boolean> => {
      const explainLanguage = opts?.explainLanguage ?? 'bilingual';
      setStatus('connecting');
      setError(null);
      endingRef.current = false;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          // Keep the browser's echo/noise/gain processing — without it the model
          // barges in on its own playback (P6 guardrail).
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        micRef.current = mic;

        const player = new PCMPlayer(24000);
        playerRef.current = player;

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(
          `${proto}://${window.location.host}/api/realtime/ws?lang=${explainLanguage}`,
        );
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        // Capture: mic → worklet → downsample + PCM16 → ws. Worklet is NOT connected
        // to destination (that would loop the mic back to the speakers). Pin 48k so
        // the downsample to 24k is a clean 2:1 (downsample() still reads the actual
        // rate, so a browser that ignores the hint stays correct).
        const captureCtx = new AudioContext({ sampleRate: 48000 });
        captureCtxRef.current = captureCtx;
        await captureCtx.audioWorklet.addModule('/worklets/pcm-capture.js');
        const source = captureCtx.createMediaStreamSource(mic);
        const worklet = new AudioWorkletNode(captureCtx, 'pcm-capture');
        workletRef.current = worklet;
        worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const pcm = floatTo16BitPCM(downsample(e.data, captureCtx.sampleRate, 24000));
          ws.send(pcm.buffer);
        };
        source.connect(worklet);

        ws.onmessage = (evt) => {
          if (typeof evt.data !== 'string') return; // control/events are JSON text
          let event: {
            type: string;
            transcript?: string;
            delta?: string;
            conversationId?: string;
          };
          try {
            event = JSON.parse(evt.data);
          } catch {
            return;
          }
          switch (event.type) {
            case 'relay.ready':
              conversationIdRef.current = event.conversationId ?? null;
              setStatus('live');
              break;
            case 'conversation.item.input_audio_transcription.completed': {
              const t = event.transcript?.trim();
              // Phantom guard: VAD noise triggers produce hallucinated fragments
              // the user never said — don't show them as the user's words.
              if (t && !isPhantomTranscript(t))
                setTranscript((prev) => [...prev, { role: 'user', text: t }]);
              break;
            }
            case 'response.output_audio_transcript.done':
            case 'response.audio_transcript.done': {
              const t = event.transcript?.trim();
              if (t) setTranscript((prev) => [...prev, { role: 'assistant', text: t }]);
              break;
            }
            case 'response.output_audio.delta':
            case 'response.audio.delta':
              if (event.delta) player.enqueue(event.delta);
              break;
            case 'output_audio_buffer.started':
              setSpeaking(true);
              break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared':
              setSpeaking(false);
              player.clear();
              break;
            case 'error':
              console.error('realtime relay event error:', evt.data);
              break;
          }
        };

        ws.onclose = (e) => {
          if (endingRef.current) return; // we closed it on purpose
          // 4001 = server rejected after upgrade (daily limit / setup / create failed).
          const reason = e.code === 4001 ? e.reason || 'session_failed' : 'session_failed';
          setError(voiceErrorMessage(new Error(reason)));
          setStatus('error');
          cleanup();
        };
        ws.onerror = () => {
          // onclose fires next and does the messaging.
        };

        return true;
      } catch (err) {
        console.error('realtime WS start failed:', err);
        cleanup();
        setStatus('error');
        setError(voiceErrorMessage(err));
        return false;
      }
    },
    [cleanup],
  );

  const end = useCallback(async (): Promise<string | null> => {
    const conversationId = conversationIdRef.current;
    stop();
    if (conversationId) {
      await fetch(`/api/conversations/${conversationId}/finalize`, { method: 'POST' }).catch(
        () => {},
      );
    }
    return conversationId;
  }, [stop]);

  // No client-side prewarm in the WS model (the server sets everything up on
  // connect). Kept as no-ops so talk/page can use either transport interchangeably.
  const prewarm = useCallback(() => {}, []);
  const discardPrewarm = useCallback(() => {}, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, speaking, transcript, error, start, end, prewarm, discardPrewarm };
}

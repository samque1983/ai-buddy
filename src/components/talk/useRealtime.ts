'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { voiceErrorMessage } from '@/lib/env/browser';
import type { TranscriptEntry } from './useConversation';

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'error';
type ExplainLanguage = 'bilingual' | 'english';

interface MintedSession {
  clientSecret: string;
  conversationId: string;
  model: string;
  explainLanguage: ExplainLanguage;
  at: number;
}

// Ephemeral secrets live 10 min; refuse to reuse a prewarm older than this.
const PREWARM_MAX_AGE_MS = 8 * 60 * 1000;

// A network hop in the connect path can black-hole — e.g. a device that can't
// reach api.openai.com — which, with no timeout, spins the UI on 连接中 forever.
// Cap every hop so it fails fast with an actionable error instead of hanging.
const CONNECT_TIMEOUT_MS = 15000;

/** fetch() that rejects with Error('connect_timeout') if it hangs past `ms`. */
async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('connect_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Awaits the mic prompt but rejects with Error('mic_timeout') if it never
 * resolves (some WebViews leave getUserMedia pending forever). If the stream
 * arrives after we've given up, stop it so the mic isn't left hot.
 */
function micWithTimeout(p: Promise<MediaStream>, ms: number): Promise<MediaStream> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      p.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      reject(new Error('mic_timeout'));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<MediaStream>;
}

/**
 * 流畅模式: browser ↔ OpenAI Realtime over WebRTC. The server only mints an
 * ephemeral client secret (with persona + lesson instructions) and persists
 * transcript lines; audio flows directly between browser and OpenAI.
 */
export function useRealtime() {
  const [status, setStatus] = useState<RealtimeStatus>('off');
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const prewarmRef = useRef<MintedSession | null>(null);
  const prewarmInFlight = useRef<Promise<MintedSession | null> | null>(null);
  // The explainLanguage we've already attempted to prewarm, so a failed mint
  // isn't retried on every render (start() mints fresh on tap as a fallback).
  const prewarmAttemptedLang = useRef<ExplainLanguage | null>(null);

  const persist = useCallback((role: 'user' | 'assistant', content: string) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId || !content.trim()) return;
    void fetch('/api/realtime/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, role, content }),
    }).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    setSpeaking(false);
    setStatus('off');
  }, []);

  /** Mints a session on the server (~2-3s). No WebRTC yet. */
  const mint = useCallback(async (explainLanguage: ExplainLanguage): Promise<MintedSession> => {
    const res = await fetchWithTimeout(
      '/api/realtime/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explainLanguage }),
      },
      CONNECT_TIMEOUT_MS,
    );
    if (res.status === 429) throw new Error('daily_limit');
    if (!res.ok) throw new Error('session_failed');
    const data = (await res.json()) as { clientSecret: string; conversationId: string; model: string };
    return { ...data, explainLanguage, at: Date.now() };
  }, []);

  /** Deletes an unused prewarmed conversation so it doesn't linger or skew stats. */
  const dropConversation = useCallback((conversationId: string) => {
    createClient().from('conversations').delete().eq('id', conversationId).then(
      () => {},
      () => {},
    );
  }, []);

  /**
   * Prewarm: mint the session in the background while the user is deciding, so
   * tapping 流畅模式 skips the ~2.7s server work and only pays the WebRTC handshake.
   */
  const prewarm = useCallback(
    (explainLanguage: ExplainLanguage = 'bilingual') => {
      // Already attempted this language (succeeded, in-flight, or failed) — don't retry.
      if (prewarmAttemptedLang.current === explainLanguage) return;

      const existing = prewarmRef.current;
      if (existing && existing.explainLanguage !== explainLanguage) {
        prewarmRef.current = null;
        dropConversation(existing.conversationId); // language changed — discard the old one
      }
      prewarmAttemptedLang.current = explainLanguage;
      prewarmInFlight.current = mint(explainLanguage)
        .then((session) => {
          prewarmRef.current = session;
          return session;
        })
        .catch(() => null)
        .finally(() => {
          prewarmInFlight.current = null;
        });
    },
    [mint, dropConversation],
  );

  /** Discard any unused prewarmed session (on leaving, or switching to pipeline mode). */
  const discardPrewarm = useCallback(() => {
    const p = prewarmRef.current;
    prewarmRef.current = null;
    prewarmAttemptedLang.current = null;
    if (p) dropConversation(p.conversationId);
  }, [dropConversation]);

  const start = useCallback(
    async (opts?: { explainLanguage?: 'bilingual' | 'english' }): Promise<boolean> => {
    const explainLanguage = opts?.explainLanguage ?? 'bilingual';
    setStatus('connecting');
    setError(null);
    try {
      const micPromise = navigator.mediaDevices.getUserMedia({ audio: true });

      // Use a matching, fresh prewarm if we have one; otherwise mint now
      // (awaiting an in-flight prewarm first so we don't double-charge).
      let session = prewarmRef.current;
      prewarmRef.current = null;
      prewarmAttemptedLang.current = null;
      if (
        !session ||
        session.explainLanguage !== explainLanguage ||
        Date.now() - session.at >= PREWARM_MAX_AGE_MS
      ) {
        if (session) dropConversation(session.conversationId);
        const pending = prewarmInFlight.current ? await prewarmInFlight.current : null;
        if (pending && pending.explainLanguage === explainLanguage) {
          session = pending;
        } else {
          if (pending) dropConversation(pending.conversationId);
          session = await mint(explainLanguage);
        }
      }
      const { clientSecret, conversationId, model } = session;
      conversationIdRef.current = conversationId;

      const mic = await micWithTimeout(micPromise, CONNECT_TIMEOUT_MS);
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      // Remote audio playback element.
      if (!audioElRef.current) {
        const el = document.createElement('audio');
        el.autoplay = true;
        audioElRef.current = el;
      }
      pc.ontrack = (e) => {
        if (audioElRef.current) audioElRef.current.srcObject = e.streams[0];
      };

      const channel = pc.createDataChannel('oai-events');
      channel.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data as string) as {
            type: string;
            transcript?: string;
          };
          switch (event.type) {
            case 'conversation.item.input_audio_transcription.completed': {
              const text = event.transcript?.trim();
              if (text) {
                setTranscript((t) => [...t, { role: 'user', text }]);
                persist('user', text);
              }
              break;
            }
            // GA and beta event names for the assistant transcript.
            case 'response.output_audio_transcript.done':
            case 'response.audio_transcript.done': {
              const text = event.transcript?.trim();
              if (text) {
                setTranscript((t) => [...t, { role: 'assistant', text }]);
                persist('assistant', text);
              }
              break;
            }
            case 'output_audio_buffer.started':
              setSpeaking(true);
              break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared':
              setSpeaking(false);
              break;
            case 'error':
              console.error('realtime event error:', msg.data);
              break;
          }
        } catch {
          // non-JSON frame — ignore
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetchWithTimeout(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        },
        CONNECT_TIMEOUT_MS,
      );
      if (!sdpRes.ok) throw new Error(`sdp_failed_${sdpRes.status}`);
      const answer = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setSpeaking(false);
          setStatus((s) => (s === 'live' ? 'error' : s));
          setError('连接断开了,请重新进入流畅模式');
        }
      };

      setStatus('live');
      return true;
    } catch (err) {
      console.error('realtime start failed:', err);
      stop();
      setStatus('error');
      setError(voiceErrorMessage(err));
      return false;
    }
    },
    [persist, stop, mint, dropConversation],
  );

  /** Ends the session: closes the connection and finalizes the conversation. */
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

  // On unmount, tear down the connection and drop any unused prewarm.
  useEffect(
    () => () => {
      stop();
      const p = prewarmRef.current;
      prewarmRef.current = null;
      if (p) {
        createClient().from('conversations').delete().eq('id', p.conversationId).then(
          () => {},
          () => {},
        );
      }
    },
    [stop],
  );

  return { status, speaking, transcript, error, start, end, prewarm, discardPrewarm };
}

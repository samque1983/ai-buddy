'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptEntry } from './useConversation';

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'error';

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

  const start = useCallback(
    async (opts?: { explainLanguage?: 'bilingual' | 'english' }): Promise<boolean> => {
    setStatus('connecting');
    setError(null);
    try {
      const sessionRes = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explainLanguage: opts?.explainLanguage ?? 'bilingual' }),
      });
      if (sessionRes.status === 429) throw new Error('daily_limit');
      if (!sessionRes.ok) throw new Error('session_failed');
      const { clientSecret, conversationId, model } = (await sessionRes.json()) as {
        clientSecret: string;
        conversationId: string;
        model: string;
      };
      conversationIdRef.current = conversationId;

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        },
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
      setError(
        err instanceof Error && err.message === 'daily_limit'
          ? '今天的对话额度用完了,明天再来吧'
          : '流畅模式连接失败,可以改用普通模式',
      );
      return false;
    }
    },
    [persist, stop],
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

  useEffect(() => () => stop(), [stop]);

  return { status, speaking, transcript, error, start, end };
}

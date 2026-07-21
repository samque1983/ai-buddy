'use client';

import { useCallback, useRef, useState } from 'react';
import { createEventParser } from '@/lib/audio/ndjson';
import { AudioQueue } from './audio-queue';

export type ConversationPhase =
  | 'idle' // not started
  | 'connecting' // creating conversation / waiting for greeting
  | 'ready' // user's turn to talk
  | 'recording'
  | 'thinking' // uploading + waiting for AI
  | 'speaking' // AI audio playing
  | 'ended'
  | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

export function useConversation() {
  const [phase, setPhase] = useState<ConversationPhase>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const streamDoneRef = useRef(true);
  const activeStreamRef = useRef<Promise<void> | null>(null);

  const getQueue = useCallback(() => {
    if (!audioQueueRef.current) {
      type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext!;
      const queue = new AudioQueue(new Ctor());
      queue.onIdle = () => {
        if (streamDoneRef.current) {
          setPhase((p) => (p === 'speaking' || p === 'thinking' ? 'ready' : p));
        }
      };
      audioQueueRef.current = queue;
    }
    return audioQueueRef.current;
  }, []);

  const consumeStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      const parser = createEventParser();
      const queue = getQueue();
      streamDoneRef.current = false;

      let assistantSoFar = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          switch (event.type) {
            case 'stt':
              setTranscript((t) => [...t, { role: 'user', text: event.text }]);
              break;
            case 'text':
              assistantSoFar = assistantSoFar ? `${assistantSoFar} ${event.text}` : event.text;
              setPhase('speaking');
              setTranscript((t) => {
                const copy = [...t];
                const last = copy.at(-1);
                if (last?.role === 'assistant' && last.text !== '' && assistantSoFar.startsWith(last.text)) {
                  copy[copy.length - 1] = { role: 'assistant', text: assistantSoFar };
                } else {
                  copy.push({ role: 'assistant', text: event.text });
                }
                return copy;
              });
              break;
            case 'audio':
              queue.enqueue(event.b64);
              break;
            case 'error':
              if (event.message === 'empty_transcription') {
                setError('没听清,请再说一次');
                setPhase('ready');
              } else {
                setError('出了点问题,请重试');
              }
              break;
            case 'done':
              break;
          }
        }
      }
      streamDoneRef.current = true;
      if (!queue.isPlaying) {
        setPhase((p) => (p === 'speaking' || p === 'thinking' ? 'ready' : p));
      }
    },
    [getQueue],
  );

  /** Starts a conversation: character greets first. Call from a user gesture. */
  const begin = useCallback(async () => {
    setPhase('connecting');
    setError(null);
    getQueue(); // create AudioContext inside the user gesture
    try {
      const res = await fetch('/api/conversations', { method: 'POST' });
      if (!res.ok) throw new Error('create failed');
      conversationIdRef.current = res.headers.get('X-Conversation-Id');
      const streaming = consumeStream(res);
      activeStreamRef.current = streaming;
      await streaming;
    } catch {
      setError('连接失败,请重试');
      setPhase('error');
    } finally {
      activeStreamRef.current = null;
    }
  }, [consumeStream, getQueue]);

  /** Sends one recorded turn. */
  const sendAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      const conversationId = conversationIdRef.current;
      if (!conversationId) return;
      setPhase('thinking');
      setError(null);
      try {
        const form = new FormData();
        form.append('audio', blob, 'turn');
        form.append('conversationId', conversationId);
        const res = await fetch('/api/converse', { method: 'POST', body: form });
        if (!res.ok) throw new Error('converse failed');
        const streaming = consumeStream(res);
        activeStreamRef.current = streaming;
        await streaming;
      } catch {
        setError('发送失败,请重试');
        setPhase('ready');
      } finally {
        activeStreamRef.current = null;
      }
      void mimeType;
    },
    [consumeStream],
  );

  /** Stops AI speech so the user can talk. */
  const interrupt = useCallback(() => {
    audioQueueRef.current?.stop();
    setPhase('ready');
  }, []);

  const end = useCallback(async (): Promise<string | null> => {
    const conversationId = conversationIdRef.current;
    audioQueueRef.current?.stop();
    setPhase('ended');
    // Let an in-flight turn finish persisting before finalizing, so the
    // summary is computed over the complete transcript (bounded wait).
    const active = activeStreamRef.current;
    if (active) {
      await Promise.race([
        active.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]);
    }
    if (conversationId) {
      await fetch(`/api/conversations/${conversationId}/finalize`, { method: 'POST' }).catch(
        () => {},
      );
    }
    return conversationId;
  }, []);

  return {
    phase,
    setPhase,
    transcript,
    error,
    begin,
    sendAudio,
    interrupt,
    end,
    conversationId: conversationIdRef,
  };
}

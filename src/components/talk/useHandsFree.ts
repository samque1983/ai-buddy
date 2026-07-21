'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { float32ToWav } from '@/lib/audio/wav';

interface VadHandle {
  start(): void;
  pause(): void;
  destroy(): void;
}

/**
 * Hands-free conversation mode: browser-side VAD (Silero, WASM) detects when
 * the user starts/stops speaking and emits each utterance as a WAV blob.
 * Assets are served from /public/vad — no CDN dependency.
 */
export function useHandsFree(onSpeech: (blob: Blob, mimeType: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const vadRef = useRef<VadHandle | null>(null);
  const onSpeechRef = useRef(onSpeech);
  onSpeechRef.current = onSpeech;

  const enable = useCallback(async (): Promise<boolean> => {
    if (vadRef.current) {
      setEnabled(true);
      return true;
    }
    setStarting(true);
    setFailed(false);
    try {
      const { MicVAD } = await import('@ricky0123/vad-web');
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',
        // Slightly conservative: ignore blips shorter than 250ms and wait
        // ~1.2s of silence before cutting the utterance.
        minSpeechMs: 250,
        redemptionMs: 1200,
        onSpeechEnd: (audio: Float32Array) => {
          const wav = float32ToWav(audio, 16000);
          onSpeechRef.current(new Blob([wav], { type: 'audio/wav' }), 'audio/wav');
        },
      });
      vadRef.current = vad as unknown as VadHandle;
      setEnabled(true);
      return true;
    } catch (err) {
      console.error('VAD init failed:', err);
      setFailed(true);
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  const disable = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    setEnabled(false);
  }, []);

  /** Listen only while it's the user's turn (paused during AI speech = no echo). */
  const setListening = useCallback((listen: boolean) => {
    const vad = vadRef.current;
    if (!vad) return;
    if (listen) vad.start();
    else vad.pause();
  }, []);

  useEffect(
    () => () => {
      vadRef.current?.destroy();
      vadRef.current = null;
    },
    [],
  );

  return { enabled, starting, failed, enable, disable, setListening };
}

'use client';

import { useCallback, useRef, useState } from 'react';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** MediaRecorder wrapper for push-to-talk. Safari records audio/mp4, Chrome audio/webm. */
export function useRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setIsRecording(true);
      setPermissionError(false);
      return true;
    } catch {
      setPermissionError(true);
      return false;
    }
  }, []);

  const stop = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setIsRecording(false);
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        recorder.stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        setIsRecording(false);
        resolve({
          blob,
          mimeType,
          durationMs: Date.now() - startedAtRef.current,
        });
      };
      recorder.stop();
    });
  }, []);

  return { start, stop, isRecording, permissionError };
}

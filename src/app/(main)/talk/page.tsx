'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConversation } from '@/components/talk/useConversation';
import { useRecorder } from '@/components/talk/useRecorder';

const PHASE_LABEL: Record<string, string> = {
  idle: '点击开始',
  connecting: '正在连接…',
  ready: '按住说话',
  recording: '松开发送',
  thinking: '思考中…',
  speaking: '正在说话…',
  ended: '对话已结束',
  error: '出错了',
};

export default function TalkPage() {
  const router = useRouter();
  const conv = useConversation();
  const recorder = useRecorder();
  const [subtitles, setSubtitles] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (conv.phase === 'idle' || conv.phase === 'ended') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [conv.phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conv.transcript]);

  async function pressStart() {
    if (conv.phase === 'speaking') conv.interrupt();
    if (conv.phase !== 'ready' && conv.phase !== 'speaking') return;
    const ok = await recorder.start();
    if (ok) conv.setPhase('recording');
  }

  async function pressEnd() {
    if (conv.phase !== 'recording') return;
    const result = await recorder.stop();
    if (!result || result.durationMs < 300) {
      conv.setPhase('ready');
      return;
    }
    await conv.sendAudio(result.blob, result.mimeType);
  }

  async function endSession() {
    const id = await conv.end();
    router.push(id ? `/summary/${id}` : '/home');
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const busy = conv.phase === 'thinking' || conv.phase === 'connecting';

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col px-6 py-6">
      <header className="flex items-center justify-between">
        <button onClick={endSession} className="text-sm opacity-60">
          结束
        </button>
        <span className="font-mono text-sm opacity-60">
          {mm}:{ss}
        </span>
        <button onClick={() => setSubtitles((s) => !s)} className="text-sm opacity-60">
          {subtitles ? '隐藏字幕' : '显示字幕'}
        </button>
      </header>

      <div className="mt-4 flex items-center justify-center">
        <div
          className={`flex h-24 w-24 items-center justify-center rounded-full bg-black/5 text-3xl font-semibold transition-all dark:bg-white/10 ${
            conv.phase === 'speaking' ? 'scale-110 ring-4 ring-emerald-400/50' : ''
          } ${conv.phase === 'recording' ? 'ring-4 ring-red-400/60' : ''}`}
        >
          🗣️
        </div>
      </div>

      <div ref={scrollRef} className="mt-4 flex-1 space-y-3 overflow-y-auto">
        {subtitles &&
          conv.transcript.map((entry, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed ${
                entry.role === 'user'
                  ? 'ml-auto bg-foreground text-background'
                  : 'bg-black/5 dark:bg-white/10'
              }`}
            >
              {entry.text}
            </div>
          ))}
        {conv.error && <p className="text-center text-sm text-red-500">{conv.error}</p>}
      </div>

      <div className="pb-4 pt-4">
        {conv.phase === 'idle' ? (
          <button
            onClick={conv.begin}
            className="w-full rounded-2xl bg-foreground py-4 text-lg font-medium text-background"
          >
            开始对话
          </button>
        ) : (
          <button
            onPointerDown={pressStart}
            onPointerUp={pressEnd}
            onPointerLeave={pressEnd}
            disabled={busy || conv.phase === 'ended'}
            className={`w-full select-none rounded-2xl py-4 text-lg font-medium transition ${
              conv.phase === 'recording'
                ? 'bg-red-500 text-white'
                : 'bg-foreground text-background'
            } disabled:opacity-50`}
            style={{ touchAction: 'none' }}
          >
            {PHASE_LABEL[conv.phase]}
          </button>
        )}
        {recorder.permissionError && (
          <p className="mt-2 text-center text-sm text-red-500">
            需要麦克风权限,请在浏览器设置中允许
          </p>
        )}
      </div>
    </main>
  );
}

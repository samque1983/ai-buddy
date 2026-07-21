'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useConversation } from '@/components/talk/useConversation';
import { useHandsFree } from '@/components/talk/useHandsFree';
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
  const [hint, setHint] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether the pointer is still down across the async mic-permission gap.
  const pressedRef = useRef(false);
  const phaseRef = useRef(conv.phase);
  phaseRef.current = conv.phase;

  const handsFree = useHandsFree((blob, mimeType) => {
    if (phaseRef.current === 'ready') void conv.sendAudio(blob, mimeType);
  });

  // In hands-free mode, listen only when it's the user's turn.
  useEffect(() => {
    if (!handsFree.enabled) return;
    handsFree.setListening(conv.phase === 'ready');
  }, [conv.phase, handsFree]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('subtitles_enabled')
        .eq('id', user.id)
        .single<{ subtitles_enabled: boolean }>();
      if (data) setSubtitles(data.subtitles_enabled);
    });
  }, []);

  useEffect(() => {
    if (conv.phase === 'idle' || conv.phase === 'ended') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [conv.phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conv.transcript]);

  async function pressStart(e: React.PointerEvent<HTMLButtonElement>) {
    // Keep receiving pointer events even if the finger drifts off the button —
    // without capture, a tiny movement fires pointerleave and kills the turn.
    e.currentTarget.setPointerCapture(e.pointerId);
    if (conv.phase === 'speaking') conv.interrupt();
    if (conv.phase !== 'ready' && conv.phase !== 'speaking') return;
    setHint(null);
    pressedRef.current = true;
    const ok = await recorder.start();
    if (!ok) return;
    // The permission dialog can outlive the press: if the pointer was released
    // while getUserMedia() was pending, stop immediately instead of recording
    // with no pointer-up left to end it.
    if (!pressedRef.current) {
      await recorder.stop();
      conv.setPhase('ready');
      setHint('已授权麦克风,现在按住说话吧');
      return;
    }
    conv.setPhase('recording');
  }

  async function pressEnd() {
    pressedRef.current = false;
    if (conv.phase !== 'recording') return;
    const result = await recorder.stop();
    if (!result || result.durationMs < 300) {
      conv.setPhase('ready');
      setHint('太短了,按住说完一句话再松开');
      return;
    }
    await conv.sendAudio(result.blob, result.mimeType);
  }

  async function pressAbort() {
    // pointercancel: the system stole the gesture (scroll, alert...). Discard.
    pressedRef.current = false;
    if (conv.phase === 'recording') {
      await recorder.stop();
      conv.setPhase('ready');
    }
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
        ) : handsFree.enabled ? (
          <>
            <button
              onClick={() => {
                if (conv.phase === 'speaking') conv.interrupt();
              }}
              disabled={busy || conv.phase === 'ended'}
              className={`w-full rounded-2xl py-4 text-lg font-medium transition ${
                conv.phase === 'ready'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-foreground text-background'
              } disabled:opacity-50`}
            >
              {conv.phase === 'ready'
                ? '🎙️ 聆听中…说完自动发送'
                : conv.phase === 'speaking'
                  ? '正在说话…(点击打断)'
                  : PHASE_LABEL[conv.phase]}
            </button>
            <button
              onClick={handsFree.disable}
              className="mt-2 w-full py-1 text-center text-sm opacity-60"
            >
              退出连续对话,改用按住说话
            </button>
          </>
        ) : (
          <>
            <button
              onPointerDown={pressStart}
              onPointerUp={pressEnd}
              onPointerCancel={pressAbort}
              onContextMenu={(e) => e.preventDefault()}
              disabled={busy || conv.phase === 'ended'}
              className={`w-full select-none rounded-2xl py-4 text-lg font-medium transition ${
                conv.phase === 'recording'
                  ? 'bg-red-500 text-white'
                  : 'bg-foreground text-background'
              } disabled:opacity-50`}
              style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
            >
              {PHASE_LABEL[conv.phase]}
            </button>
            {(conv.phase === 'ready' || conv.phase === 'speaking') && (
              <button
                onClick={() => void handsFree.enable()}
                disabled={handsFree.starting}
                className="mt-2 w-full py-1 text-center text-sm opacity-60"
              >
                {handsFree.starting ? '正在开启连续对话…' : '🎙️ 开启连续对话(免提,像 GPT 那样)'}
              </button>
            )}
            {handsFree.failed && (
              <p className="mt-1 text-center text-xs text-red-500">
                连续对话开启失败,请继续使用按住说话
              </p>
            )}
          </>
        )}
        {hint && <p className="mt-2 text-center text-sm opacity-70">{hint}</p>}
        {busy && (
          <button
            onClick={conv.cancel}
            className="mt-2 w-full py-1 text-center text-sm opacity-60"
          >
            等太久了?点此取消重试
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

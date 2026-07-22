'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Conversation, Correction, Expression } from '@/lib/types';

interface SummaryData {
  conversation: Conversation;
  corrections: Correction[];
  expressions: Expression[];
  streak: number;
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 24; // ~1 minute

export default function SummaryPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = use(params);
  const [data, setData] = useState<SummaryData | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let polls = 0;
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      polls++;
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        if (res.ok) {
          const payload = (await res.json()) as SummaryData;
          setData(payload);
          const status = payload.conversation.status;
          if (status === 'finalized' || status === 'failed') return;
        }
      } catch {
        // transient — keep polling
      }
      if (polls >= MAX_POLLS) {
        setTimedOut(true);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const summary = data?.conversation.summary;
  const processing =
    !timedOut && data !== null && !summary && data.conversation.status !== 'failed';

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold">今日学习总结</h1>
      {data && data.streak > 0 && (
        <p className="mt-1 text-sm opacity-60">🔥 已连续学习 {data.streak} 天</p>
      )}

      {!data && <p className="mt-8 text-center text-sm opacity-60">加载中…</p>}

      {processing && (
        <div className="mt-8 rounded-2xl border border-black/10 p-5 text-center dark:border-white/15">
          <p className="text-sm opacity-70">正在为你整理总结,大约需要十几秒…</p>
        </div>
      )}

      {summary && (
        <>
          <section className="mt-6 rounded-2xl bg-emerald-500/10 p-5">
            <p className="text-[15px] leading-relaxed">{summary.encouragement}</p>
            {summary.highlights.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm opacity-80">
                {summary.highlights.map((h, i) => (
                  <li key={i}>✨ {h}</li>
                ))}
              </ul>
            )}
          </section>

          {data!.corrections.filter((c) => !c.is_upgrade).length > 0 && (
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
                今日重点纠错
              </h2>
              <div className="mt-3 space-y-3">
                {data!.corrections
                  .filter((c) => !c.is_upgrade)
                  .map((c) => (
                    <div key={c.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
                      <p className="text-sm line-through opacity-50">{c.original}</p>
                      <p className="mt-1 font-medium">{c.improved}</p>
                      <p className="mt-1 text-sm opacity-70">{c.explanation}</p>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {data!.corrections.filter((c) => c.is_upgrade).length > 0 && (
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
                💡 更地道的说法
              </h2>
              <div className="mt-3 space-y-3">
                {data!.corrections
                  .filter((c) => c.is_upgrade)
                  .map((c) => (
                    <div key={c.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <p className="text-sm opacity-60">{c.original}</p>
                      <p className="mt-1 font-medium">↑ {c.improved}</p>
                      {c.explanation && <p className="mt-1 text-sm opacity-70">{c.explanation}</p>}
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      )}

      {data && data.expressions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            今日五个表达
          </h2>
          <div className="mt-3 space-y-3">
            {data.expressions.map((e) => (
              <div key={e.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
                <p className="font-medium">{e.english}</p>
                <p className="text-sm opacity-70">{e.chinese}</p>
                <p className="mt-1 text-sm italic opacity-60">“{e.example_sentence}”</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {summary?.tomorrow_preview && (
        <p className="mt-6 rounded-2xl bg-black/5 p-4 text-sm opacity-80 dark:bg-white/10">
          明日预告:{summary.tomorrow_preview}
        </p>
      )}

      {(timedOut || data?.conversation.status === 'failed') && !summary && (
        <p className="mt-8 text-center text-sm opacity-60">
          总结生成得有点慢,稍后可以在学习记录里查看。
        </p>
      )}

      <Link
        href="/home"
        className="mt-8 block w-full rounded-xl bg-foreground py-3 text-center font-medium text-background"
      >
        回到首页
      </Link>
    </main>
  );
}

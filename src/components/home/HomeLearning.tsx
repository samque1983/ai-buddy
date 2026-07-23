'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ContentPicker } from '@/components/ContentPicker';
import { normalizeActivePacks } from '@/lib/learning/content-packs';
import { sessionModeFromPacks, type Expression } from '@/lib/types';

/**
 * Home learning block: the content picker + today's expressions, wired so switching
 * content live-reconciles today's words.
 *
 *   pick content ─► save active_packs ─► POST /regenerate ─► refresh list
 *   freechat ─────► save ─────────────► show chat state (no words)
 */
export function HomeLearning({
  userId,
  initialActivePacks,
}: {
  userId: string;
  initialActivePacks: string[];
}) {
  const [activePacks, setActivePacks] = useState(() => normalizeActivePacks(initialActivePacks));
  const [expressions, setExpressions] = useState<Expression[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const isFreechat = sessionModeFromPacks(activePacks) === 'freechat';

  // Initial load of today's expressions (skip in free-chat — no words there).
  useEffect(() => {
    if (isFreechat) {
      setExpressions([]);
      return;
    }
    let cancelled = false;
    fetch('/api/expressions/daily')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { expressions: Expression[] }) => {
        if (!cancelled) setExpressions(d.expressions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Only on mount — switches are handled explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchContent(next: string[]) {
    const normalized = normalizeActivePacks(next);
    if (busy || normalized[0] === activePacks[0]) return;
    setBusy(true);
    setFailed(false);
    setActivePacks(normalized); // optimistic

    // Persist the choice (same field Settings writes → auto-synced).
    await createClient()
      .from('profiles')
      .update({ active_packs: normalized, updated_at: new Date().toISOString() })
      .eq('id', userId);

    const freechatNow = sessionModeFromPacks(normalized) === 'freechat';
    if (freechatNow) {
      setExpressions([]);
      setBusy(false);
      return;
    }

    setExpressions(null); // loading
    try {
      const res = await fetch('/api/expressions/daily/regenerate', { method: 'POST' });
      if (!res.ok) throw new Error('regenerate failed');
      const data = (await res.json()) as { expressions: Expression[] };
      setExpressions(data.expressions);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">学习内容</h2>
      <div className="mt-3">
        <ContentPicker value={activePacks} onChange={switchContent} disabled={busy} />
      </div>

      {isFreechat ? (
        <div className="mt-5 rounded-xl border border-black/10 px-4 py-4 text-sm dark:border-white/15">
          <div className="font-medium">今天自由畅聊 💬</div>
          <div className="mt-1 opacity-70">不刷词,直接和外国朋友聊天,聊到哪学到哪。</div>
        </div>
      ) : (
        <>
          <h2 className="mt-5 text-xs font-semibold uppercase tracking-widest opacity-50">
            今日五个表达
          </h2>
          {failed ? (
            <p className="mt-3 text-center text-xs text-red-500">
              内容没准备好,刷新或稍后再试
            </p>
          ) : expressions === null ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
              ))}
              <p className="text-center text-xs opacity-50">
                {busy ? '正在换成新内容…' : '正在为你准备今天的内容…'}
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {expressions.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
                >
                  <span className="font-medium">{e.english}</span>
                  <span className="shrink-0 text-sm opacity-60">{e.chinese}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

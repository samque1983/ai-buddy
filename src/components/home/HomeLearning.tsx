'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ContentPicker } from '@/components/ContentPicker';
import { readCachedExpressions, writeCachedExpressions } from '@/lib/cache/expressions-cache';
import { readCachedProfile, writeCachedProfile } from '@/lib/cache/profile-cache';
import { normalizeActivePacks } from '@/lib/learning/content-packs';
import { sessionModeFromPacks, type Expression } from '@/lib/types';

/**
 * Home learning block: the content picker + today's expressions, SWR-cached so the
 * main flow never waits on the network when we already know the answer.
 *
 *   mount ──► cached list? paint instantly ──► revalidate in background
 *   switch ─► save packs ─► cached list for that content? paint instantly
 *             └─► regenerate ALWAYS fires (it reconciles the DB — the cache is
 *                 only the fast first paint, never the source of truth)
 *   freechat ► chat-state card (no words, no fetch)
 */
export function HomeLearning({
  userId,
  initialActivePacks,
}: {
  userId: string;
  initialActivePacks: string[];
}) {
  const [activePacks, setActivePacks] = useState(() => normalizeActivePacks(initialActivePacks));
  const [expressions, setExpressions] = useState<Expression[] | null>(() =>
    sessionModeFromPacks(normalizeActivePacks(initialActivePacks)) === 'freechat'
      ? []
      : readCachedExpressions(userId, normalizeActivePacks(initialActivePacks)),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Ignore out-of-order responses when the user switches quickly.
  const requestSeq = useRef(0);
  const isFreechat = sessionModeFromPacks(activePacks) === 'freechat';

  // Mount: revalidate in the background (cache, if any, already painted above).
  useEffect(() => {
    if (isFreechat) return;
    const seq = ++requestSeq.current;
    const hadContent = expressions !== null;
    fetch('/api/expressions/daily')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { expressions: Expression[] }) => {
        if (requestSeq.current !== seq) return; // superseded by a switch
        setExpressions(d.expressions);
        writeCachedExpressions(userId, activePacks, d.expressions);
      })
      .catch(() => {
        // Background refresh failed — only surface it if we had nothing to show.
        if (requestSeq.current === seq && !hadContent) setFailed(true);
      });
    // Only on mount — switches are handled explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchContent(next: string[]) {
    const normalized = normalizeActivePacks(next);
    // Fully optimistic: never block or gray the picker while the server reconciles.
    // Rapid re-switches are fine — requestSeq drops out-of-order responses, and the
    // server converges on the profile's latest value (backend wins; low-freq flow).
    if (normalized[0] === activePacks[0]) return;
    setBusy(true);
    setFailed(false);
    setActivePacks(normalized); // optimistic
    const seq = ++requestSeq.current;

    // Instant paint from cache while the server reconciles (falls back to skeleton).
    const freechatNow = sessionModeFromPacks(normalized) === 'freechat';
    const painted = freechatNow ? [] : readCachedExpressions(userId, normalized);
    setExpressions(painted);

    // Persist the choice (same field Settings writes → auto-synced). Keep the local
    // profile cache in step so the talk page's SWR paint reads the right content.
    const cachedProfile = readCachedProfile();
    if (cachedProfile && cachedProfile.id === userId) {
      writeCachedProfile({ ...cachedProfile, active_packs: normalized });
    }
    await createClient()
      .from('profiles')
      .update({ active_packs: normalized, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (freechatNow) {
      if (requestSeq.current === seq) setBusy(false);
      return;
    }

    // Regenerate ALWAYS runs — it reconciles today's words in the DB (what the talk
    // session will teach). The cached paint above just hides the wait.
    try {
      const res = await fetch('/api/expressions/daily/regenerate', { method: 'POST' });
      if (!res.ok) throw new Error('regenerate failed');
      const data = (await res.json()) as { expressions: Expression[] };
      if (requestSeq.current === seq) {
        setExpressions(data.expressions);
        writeCachedExpressions(userId, normalized, data.expressions);
      }
    } catch {
      // Keep whatever is on screen (cached list is still valid content); only
      // surface an error when we had nothing to show at all.
      if (requestSeq.current === seq && painted === null) setFailed(true);
    } finally {
      if (requestSeq.current === seq) setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">学习内容</h2>
      <div className="mt-3">
        <ContentPicker value={activePacks} onChange={switchContent} />
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
                  className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{e.english}</span>
                    <span className="shrink-0 text-sm opacity-60">{e.chinese}</span>
                  </div>
                  {e.example_sentence && (
                    <p className="mt-1 text-sm leading-snug opacity-60">{e.example_sentence}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

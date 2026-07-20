'use client';

import { useEffect, useState } from 'react';
import type { Expression } from '@/lib/types';

/** Fetches (and lazily generates) today's 5 expressions for the home teaser. */
export function DailyExpressions() {
  const [expressions, setExpressions] = useState<Expression[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/expressions/daily')
      .then(async (res) => {
        if (!res.ok) throw new Error('failed');
        const data = (await res.json()) as { expressions: Expression[] };
        if (!cancelled) setExpressions(data.expressions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">今日五个表达</h2>
      {!expressions ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
          ))}
          <p className="text-center text-xs opacity-50">正在为你准备今天的内容…</p>
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
    </section>
  );
}

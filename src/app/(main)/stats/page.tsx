import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Correction, ExpressionStatus, Profile } from '@/lib/types';

interface ReviewRow {
  expression_id: string;
  status: ExpressionStatus;
  last_score: number | null;
}

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { count: learned }, { data: progress }, { data: corrections }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single<Profile>(),
      supabase
        .from('expressions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('expression_progress')
        .select('expression_id, status, last_score')
        .eq('user_id', user.id)
        .returns<ReviewRow[]>(),
      supabase
        .from('corrections')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)
        .returns<Correction[]>(),
    ]);

  const rows = progress ?? [];
  const mastered = rows.filter((p) => p.status === 'mastered').length;
  const needsReview = rows.filter((p) => p.status === 'needs_review');

  // Fetch the English text for the to-review expressions.
  let reviewList: { id: string; english: string; last_score: number | null }[] = [];
  if (needsReview.length > 0) {
    const { data: exprs } = await supabase
      .from('expressions')
      .select('id, english')
      .in(
        'id',
        needsReview.map((p) => p.expression_id),
      )
      .returns<{ id: string; english: string }[]>();
    const scoreById = new Map(needsReview.map((p) => [p.expression_id, p.last_score]));
    reviewList = (exprs ?? []).map((e) => ({
      id: e.id,
      english: e.english,
      last_score: scoreById.get(e.id) ?? null,
    }));
  }

  const minutes = Math.round((profile?.total_talk_seconds ?? 0) / 60);

  const stats = [
    { label: '连续天数', value: `${profile?.streak_current ?? 0} 天` },
    { label: '最长连续', value: `${profile?.streak_longest ?? 0} 天` },
    { label: '开口时长', value: `${minutes} 分钟` },
    { label: '学过的表达', value: `${learned ?? 0} 个` },
    { label: '已掌握', value: `${mastered ?? 0} 个` },
  ];

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">你的成长</h1>
        <Link href="/home" className="text-sm opacity-60">
          返回
        </Link>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-black/10 p-4 dark:border-white/15"
          >
            <div className="text-xl font-semibold">{s.value}</div>
            <div className="mt-0.5 text-xs opacity-60">{s.label}</div>
          </div>
        ))}
      </div>

      {reviewList.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            🔴 待复习(下次对话搭子会主动带你练)
          </h2>
          <div className="mt-3 space-y-2">
            {reviewList.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <span className="font-medium">{e.english}</span>
                {e.last_score !== null && (
                  <span className="shrink-0 text-sm opacity-60">{e.last_score}/10</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(corrections?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            最近的纠错
          </h2>
          <div className="mt-3 space-y-3">
            {corrections!.map((c) => (
              <div key={c.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
                <p className="text-sm line-through opacity-50">{c.original}</p>
                <p className="mt-1 font-medium">{c.improved}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { groupCorrections } from '@/lib/learning/knowledge-groups';
import type { LearningSummaryContent } from '@/lib/learning/schemas';
import type { Correction, ExpressionStatus, Profile } from '@/lib/types';

interface ReviewRow {
  expression_id: string;
  status: ExpressionStatus;
  last_score: number | null;
}

function Bilingual({ point }: { point: { zh: string; en: string } }) {
  return (
    <div>
      <p className="text-sm leading-relaxed">{point.zh}</p>
      <p className="mt-0.5 text-xs leading-relaxed opacity-60">{point.en}</p>
    </div>
  );
}

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { count: learned }, { data: progress }, { data: corrections }, summaryRes] =
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
      // Full correction history (newest first) — this IS the learned-knowledge record,
      // and in free-chat mode it's the only learning artifact there is.
      supabase
        .from('corrections')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200)
        .returns<Correction[]>(),
      // Graceful when the table doesn't exist yet (code can deploy before db push).
      supabase
        .from('learning_summaries')
        .select('content, updated_at')
        .eq('user_id', user.id)
        .maybeSingle<{ content: LearningSummaryContent; updated_at: string }>()
        .then(
          (r) => r,
          () => ({ data: null }),
        ),
    ]);
  const summary = summaryRes?.data?.content ?? null;
  const knowledgeGroups = groupCorrections(corrections ?? []);

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

      {summary && (
        <section className="mt-6 rounded-2xl border border-black/10 p-5 dark:border-white/15">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">学习总结</h2>
          <div className="mt-3">
            <Bilingual point={summary.overall} />
          </div>
          {summary.strengths.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold opacity-60">✅ 进步点 · Wins</div>
              <div className="mt-2 space-y-2.5">
                {summary.strengths.map((p, i) => (
                  <Bilingual key={i} point={p} />
                ))}
              </div>
            </div>
          )}
          {summary.improvements.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold opacity-60">🎯 待改进 · Focus next</div>
              <div className="mt-2 space-y-2.5">
                {summary.improvements.map((p, i) => (
                  <Bilingual key={i} point={p} />
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 text-xs opacity-40">每次对话后自动更新</p>
        </section>
      )}

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

      {knowledgeGroups.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            📚 学到的知识点(共 {corrections!.length} 条)
          </h2>
          <p className="mt-1 text-xs opacity-50">
            历史以来所有被纠正过的点和学到的更地道说法,按类别整理,自由畅聊学到的也都在。
          </p>
          <div className="mt-3 space-y-2">
            {knowledgeGroups.map((group, gi) => (
              <details
                key={group.key}
                open={gi === 0}
                className="rounded-2xl border border-black/10 dark:border-white/15"
              >
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                  {group.label}
                  <span className="ml-2 text-xs opacity-50">{group.items.length} 条</span>
                </summary>
                <div className="space-y-3 border-t border-black/5 px-4 py-3 dark:border-white/10">
                  {group.items.map((c) => (
                    <div key={c.id}>
                      <p className="text-sm line-through opacity-50">{c.original}</p>
                      <p className="mt-0.5 font-medium">{c.improved}</p>
                      {c.explanation && (
                        <p className="mt-0.5 text-xs leading-relaxed opacity-60">{c.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

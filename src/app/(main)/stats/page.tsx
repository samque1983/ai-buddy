import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Correction, Profile } from '@/lib/types';

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { count: learned }, { count: mastered }, { data: corrections }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single<Profile>(),
      supabase
        .from('expressions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('expression_progress')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'mastered'),
      supabase
        .from('corrections')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)
        .returns<Correction[]>(),
    ]);

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

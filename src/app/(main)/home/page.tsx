import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseLearningStore } from '@/lib/learning/supabase-store';
import { resolveLandingRoute } from '@/lib/routing';
import { todayInTimezone } from '@/lib/streak';
import { HomeLearning } from '@/components/home/HomeLearning';
import type { Character, Profile } from '@/lib/types';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>();

  const landing = resolveLandingRoute(profile);
  if (landing !== '/home') redirect(landing);

  const store = new SupabaseLearningStore(supabase);
  const [{ data: character }, dueReviews] = await Promise.all([
    supabase
      .from('characters')
      .select('*')
      .eq('id', profile!.selected_character_id!)
      .single<Character>(),
    // Spaced-review words due today — surfaced here so the memory curve is visible,
    // not just an invisible scheduler.
    store.getDueReviewsWithProgress(user.id, todayInTimezone(profile!.timezone)),
  ]);

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Hi, {profile!.nickname} 👋</h1>
          <p className="mt-1 text-sm opacity-60">
            {profile!.streak_current > 0
              ? `已连续学习 ${profile!.streak_current} 天`
              : '今天开始你的第一次对话吧'}
          </p>
        </div>
        <Link href="/settings" className="text-sm opacity-60">
          设置
        </Link>
      </header>

      <section className="mt-8 rounded-2xl border border-black/10 p-5 dark:border-white/15">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-xl font-semibold dark:bg-white/10">
            {character?.name[0]}
          </div>
          <div>
            <div className="font-semibold">{character?.name}</div>
            <div className="text-sm opacity-60">{character?.tagline}</div>
          </div>
        </div>
        <Link
          href="/talk"
          className="mt-5 block w-full rounded-xl bg-foreground py-3 text-center font-medium text-background"
        >
          开始今天的对话
        </Link>
      </section>

      {dueReviews.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            🔁 今日复习({dueReviews.length})
          </h2>
          <p className="mt-1 text-xs opacity-50">按记忆曲线到期的词,下次对话搭子会自动带你练。</p>
          <div className="mt-3 space-y-2">
            {dueReviews.map(({ expression, progress }) => (
              <div
                key={expression.id}
                className="flex items-baseline justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <div>
                  <span className="font-medium">{expression.english}</span>
                  <span className="ml-2 text-sm opacity-60">{expression.chinese}</span>
                </div>
                {progress.status === 'needs_review' && (
                  <span className="shrink-0 text-xs text-red-500">要加强</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <HomeLearning userId={user.id} initialActivePacks={profile!.active_packs ?? []} />
    </main>
  );
}

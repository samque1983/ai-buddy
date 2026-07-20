import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveLandingRoute } from '@/lib/routing';
import { DailyExpressions } from '@/components/home/DailyExpressions';
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

  const { data: character } = await supabase
    .from('characters')
    .select('*')
    .eq('id', profile!.selected_character_id!)
    .single<Character>();

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

      <DailyExpressions />
    </main>
  );
}

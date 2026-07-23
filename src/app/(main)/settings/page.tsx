'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ContentPicker } from '@/components/ContentPicker';
import type { CorrectionPreference, Profile } from '@/lib/types';

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single<Profile>();
      setProfile(data);
    });
  }, [router]);

  async function save(patch: Partial<Profile>) {
    if (!profile) return;
    setProfile({ ...profile, ...patch });
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
    setSaving(false);
  }

  async function logout() {
    await createClient().auth.signOut();
    router.replace('/login');
  }

  if (!profile) {
    return <main className="p-10 text-center text-sm opacity-60">加载中…</main>;
  }

  const seg = (selected: boolean) =>
    `flex-1 rounded-xl border py-2.5 text-sm font-medium transition ${
      selected ? 'border-foreground bg-foreground text-background' : 'border-black/15 dark:border-white/20'
    }`;

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">设置</h1>
        <Link href="/home" className="text-sm opacity-60">
          返回
        </Link>
      </header>
      {saving && <p className="mt-1 text-xs opacity-50">保存中…</p>}

      <section className="mt-6 space-y-6">
        <div>
          <div className="mb-2 font-medium">学习内容</div>
          <ContentPicker
            value={profile.active_packs}
            onChange={(next) => save({ active_packs: next })}
          />
          <p className="mt-2 text-xs opacity-50">选一个方向。也可以在首页直接切换。</p>
        </div>

        <div>
          <div className="mb-2 font-medium">纠错偏好</div>
          <div className="flex gap-2">
            {(
              [
                ['light', '轻度'],
                ['balanced', '平衡'],
                ['strict', '严格'],
              ] as [CorrectionPreference, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => save({ correction_preference: value })}
                className={seg(profile.correction_preference === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium">语速</div>
          <div className="flex gap-2">
            {(
              [
                [0.85, '慢一点'],
                [1.0, '正常'],
                [1.15, '快一点'],
              ] as [number, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => save({ speech_speed: value })}
                className={seg(profile.speech_speed === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between">
          <span className="font-medium">对话时默认显示字幕</span>
          <input
            type="checkbox"
            checked={profile.subtitles_enabled}
            onChange={(e) => save({ subtitles_enabled: e.target.checked })}
            className="h-5 w-5"
          />
        </label>
      </section>

      <section className="mt-8 space-y-2">
        {[
          { href: '/characters', label: '更换搭子' },
          { href: '/memories', label: 'TA 记得的事' },
          { href: '/stats', label: '你的成长' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-xl border border-black/10 px-4 py-3 font-medium dark:border-white/15"
          >
            {item.label}
          </Link>
        ))}
      </section>

      <button onClick={logout} className="mt-8 w-full py-3 text-sm text-red-500">
        退出登录
      </button>
    </main>
  );
}

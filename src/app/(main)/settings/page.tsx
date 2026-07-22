'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
          <div className="space-y-2">
            {(
              [
                ['daily-core', '日常地道表达', '最常用的日常口语,高频优先', 'pack'],
                ['ielts', '雅思', 'IELTS 口语/写作提分表达与搭配', 'pack'],
                ['freechat', '自由畅聊', '不刷词,纯聊天,顺口教你更地道的说法', 'mode'],
              ] as [string, string, string, 'pack' | 'mode'][]
            ).map(([pack, label, desc, kind]) => {
              const active = profile.active_packs?.includes(pack) ?? false;
              return (
                <button
                  key={pack}
                  onClick={() => {
                    const current = profile.active_packs ?? ['daily-core'];
                    let next: string[];
                    if (pack === 'freechat') {
                      // Free chat is its own mode — turning it on clears the packs.
                      next = active ? ['daily-core'] : ['freechat'];
                    } else {
                      // Selecting a curriculum pack turns free chat off.
                      const base = current.filter((p) => p !== 'freechat');
                      next = active ? base.filter((p) => p !== pack) : [...base, pack];
                    }
                    save({ active_packs: next.length > 0 ? next : ['daily-core'] });
                  }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-black/15 dark:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{label}</span>
                    <span className="text-sm">{active ? '✓ 进行中' : '未启用'}</span>
                  </div>
                  <div className="mt-0.5 text-sm opacity-70">{desc}</div>
                  {kind === 'mode' && (
                    <div className="mt-0.5 text-xs opacity-50">与词库互斥,选它就不刷词</div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs opacity-50">
            词库可多选,下次对话生效。自由畅聊立即生效。
          </p>
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

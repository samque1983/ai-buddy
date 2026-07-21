'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Stage = 'email' | 'sent';

function LoginForm() {
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') ? '登录链接无效或已过期,请重新发送' : null,
  );

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? '发送太频繁了,请一小时后再试(免费邮件服务限流)'
          : '发送失败,请检查邮箱地址后重试',
      );
      return;
    }
    setStage('sent');
  }

  async function signInWithGoogle() {
    setError(null);
    await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">AI English Buddy</h1>
        <p className="mt-2 text-sm opacity-70">每天陪你说十分钟英语、真正记得你的外国朋友</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {stage === 'email' ? (
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱地址"
              className="w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 text-base outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-foreground py-3 font-medium text-background disabled:opacity-50"
            >
              {busy ? '发送中…' : '发送登录链接'}
            </button>
          </form>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-4xl">📬</p>
            <p className="font-medium">登录链接已发送到</p>
            <p className="text-sm opacity-70">{email}</p>
            <p className="rounded-xl bg-black/5 px-4 py-3 text-sm leading-relaxed opacity-80 dark:bg-white/10">
              打开邮件,点击里面的登录链接即可。
              <br />
              注意:请用<b>当前这个浏览器</b>打开链接(找不到邮件时看看垃圾箱)。
            </p>
            <button
              type="button"
              onClick={() => setStage('email')}
              className="w-full py-1 text-sm opacity-60"
            >
              换个邮箱 / 重新发送
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs opacity-50">
          <div className="h-px flex-1 bg-current" />
          或
          <div className="h-px flex-1 bg-current" />
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full rounded-xl border border-black/15 py-3 font-medium dark:border-white/20"
        >
          使用 Google 登录
        </button>

        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

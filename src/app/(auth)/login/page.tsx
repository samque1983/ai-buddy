'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Stage = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({ email });
    setBusy(false);
    if (error) {
      setError('发送失败,请检查邮箱地址后重试');
      return;
    }
    setStage('code');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email, token: code, type: 'email' });
    setBusy(false);
    if (error) {
      setError('验证码不正确或已过期');
      return;
    }
    router.replace('/');
    router.refresh();
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
          <form onSubmit={sendCode} className="space-y-3">
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
              {busy ? '发送中…' : '发送验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-sm opacity-70">验证码已发送到 {email}</p>
            <input
              type="text"
              inputMode="numeric"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位验证码"
              className="w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-foreground py-3 font-medium text-background disabled:opacity-50"
            >
              {busy ? '验证中…' : '登录'}
            </button>
            <button
              type="button"
              onClick={() => setStage('email')}
              className="w-full py-1 text-sm opacity-60"
            >
              换个邮箱
            </button>
          </form>
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

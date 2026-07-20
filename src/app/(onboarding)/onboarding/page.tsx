'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ONBOARDING_STEPS,
  emptyDraft,
  canProceed,
  GOAL_OPTIONS,
  INTEREST_OPTIONS,
  LEVEL_OPTIONS,
  type OnboardingDraft,
} from '@/lib/onboarding';

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = ONBOARDING_STEPS[stepIndex];
  const isLast = stepIndex === ONBOARDING_STEPS.length - 1;

  async function next() {
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        nickname: draft.nickname.trim(),
        english_level: draft.english_level,
        goals: draft.goals,
        interests: draft.interests,
        correction_preference: draft.correction_preference,
        speech_speed: draft.speech_speed,
        subtitles_enabled: draft.subtitles_enabled,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    setBusy(false);
    if (error) {
      setError('保存失败,请重试');
      return;
    }
    router.replace('/characters');
  }

  const chip = (selected: boolean) =>
    `rounded-full border px-4 py-2 text-sm transition ${
      selected
        ? 'border-foreground bg-foreground text-background'
        : 'border-black/15 dark:border-white/20'
    }`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 py-10">
      <div className="mb-8 flex gap-1.5">
        {ONBOARDING_STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-foreground' : 'bg-black/10 dark:bg-white/15'}`}
          />
        ))}
      </div>

      <div className="flex-1">
        {step === 'nickname' && (
          <section>
            <h1 className="text-2xl font-semibold">怎么称呼你?</h1>
            <p className="mt-1 text-sm opacity-60">你的搭子会用这个名字叫你</p>
            <input
              autoFocus
              value={draft.nickname}
              onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
              placeholder="昵称或英文名"
              className="mt-6 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 text-base outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
            />
          </section>
        )}

        {step === 'level' && (
          <section>
            <h1 className="text-2xl font-semibold">你现在的英语口语水平?</h1>
            <p className="mt-1 text-sm opacity-60">凭感觉选就好,聊天中会自动调整</p>
            <div className="mt-6 space-y-3">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDraft({ ...draft, english_level: opt.value })}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    draft.english_level === opt.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-black/15 dark:border-white/20'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-sm opacity-70">{opt.description}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'goals' && (
          <section>
            <h1 className="text-2xl font-semibold">你想达成什么?</h1>
            <p className="mt-1 text-sm opacity-60">可多选</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {GOAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDraft({ ...draft, goals: toggle(draft.goals, opt.value) })}
                  className={chip(draft.goals.includes(opt.value))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'interests' && (
          <section>
            <h1 className="text-2xl font-semibold">你平时喜欢聊什么?</h1>
            <p className="mt-1 text-sm opacity-60">聊天话题和每日表达都会围绕这些,可多选</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setDraft({ ...draft, interests: toggle(draft.interests, opt.value) })
                  }
                  className={chip(draft.interests.includes(opt.value))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'preferences' && (
          <section className="space-y-8">
            <div>
              <h1 className="text-2xl font-semibold">最后几个偏好</h1>
              <p className="mt-1 text-sm opacity-60">随时可以在设置里改</p>
            </div>
            <div>
              <div className="mb-2 font-medium">希望怎么纠错?</div>
              <div className="flex gap-2">
                {(
                  [
                    ['light', '轻度', '只纠影响理解的'],
                    ['balanced', '平衡', '重要的即时纠'],
                    ['strict', '严格', '尽量都指出来'],
                  ] as const
                ).map(([value, label, desc]) => (
                  <button
                    key={value}
                    onClick={() => setDraft({ ...draft, correction_preference: value })}
                    className={`flex-1 rounded-xl border px-2 py-3 text-center transition ${
                      draft.correction_preference === value
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-black/15 dark:border-white/20'
                    }`}
                  >
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-0.5 text-xs opacity-70">{desc}</div>
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
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setDraft({ ...draft, speech_speed: value })}
                    className={`flex-1 rounded-xl border py-3 text-sm font-medium transition ${
                      draft.speech_speed === value
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-black/15 dark:border-white/20'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between">
              <span className="font-medium">对话时显示字幕</span>
              <input
                type="checkbox"
                checked={draft.subtitles_enabled}
                onChange={(e) => setDraft({ ...draft, subtitles_enabled: e.target.checked })}
                className="h-5 w-5"
              />
            </label>
          </section>
        )}
      </div>

      {error && <p className="mb-3 text-center text-sm text-red-500">{error}</p>}

      <div className="flex gap-3">
        {stepIndex > 0 && (
          <button
            onClick={() => setStepIndex((i) => i - 1)}
            className="rounded-xl border border-black/15 px-6 py-3 font-medium dark:border-white/20"
          >
            上一步
          </button>
        )}
        <button
          onClick={next}
          disabled={!canProceed(step, draft) || busy}
          className="flex-1 rounded-xl bg-foreground py-3 font-medium text-background disabled:opacity-40"
        >
          {busy ? '保存中…' : isLast ? '完成,去选搭子' : '下一步'}
        </button>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MemoryType, UserMemory } from '@/lib/types';

const TYPE_LABELS: Record<MemoryType, string> = {
  profile: '关于你',
  event: '生活近况',
  learning: '学习情况',
  relationship: '相处偏好',
};

export default function MemoriesPage() {
  const [memories, setMemories] = useState<UserMemory[] | null>(null);

  useEffect(() => {
    fetch('/api/memories')
      .then((r) => r.json())
      .then((d: { memories: UserMemory[] }) => setMemories(d.memories))
      .catch(() => setMemories([]));
  }, []);

  async function remove(id: string) {
    if (!confirm('确定要让 TA 忘掉这条记忆吗?')) return;
    setMemories((m) => m?.filter((x) => x.id !== id) ?? null);
    await fetch(`/api/memories?id=${id}`, { method: 'DELETE' }).catch(() => {});
  }

  const groups = (['profile', 'event', 'learning', 'relationship'] as MemoryType[])
    .map((type) => ({ type, items: (memories ?? []).filter((m) => m.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">TA 记得的事</h1>
        <Link href="/settings" className="text-sm opacity-60">
          返回
        </Link>
      </header>
      <p className="mt-1 text-sm opacity-60">这些记忆让对话有延续性。你可以随时删除任何一条。</p>

      {memories === null && <p className="mt-8 text-center text-sm opacity-60">加载中…</p>}
      {memories?.length === 0 && (
        <p className="mt-8 text-center text-sm opacity-60">
          还没有记忆——多聊几次,TA 就会慢慢了解你。
        </p>
      )}

      {groups.map((g) => (
        <section key={g.type} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
            {TYPE_LABELS[g.type]}
          </h2>
          <div className="mt-2 space-y-2">
            {g.items.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <p className="text-sm leading-relaxed">{m.content}</p>
                <button
                  onClick={() => remove(m.id)}
                  className="shrink-0 text-xs opacity-40 hover:opacity-80"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

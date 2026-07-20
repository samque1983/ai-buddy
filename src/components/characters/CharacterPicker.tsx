'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Character } from '@/lib/types';

export function CharacterPicker({ characters }: { characters: Character[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function togglePreview(character: Character) {
    setSelectedId(character.id);
    const audio = audioRef.current;
    if (!audio || !character.preview_audio_url) return;

    if (playingId === character.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = character.preview_audio_url;
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(character.id);
  }

  async function confirm() {
    if (!selectedId) return;
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
      .update({ selected_character_id: selectedId, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    setBusy(false);
    if (error) {
      setError('保存失败,请重试');
      return;
    }
    router.replace('/home');
  }

  return (
    <div className="mt-6">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      <div className="space-y-4">
        {characters.map((c) => {
          const selected = selectedId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => togglePreview(c)}
              className={`w-full rounded-2xl border p-4 text-left transition ${
                selected
                  ? 'border-foreground shadow-sm'
                  : 'border-black/10 dark:border-white/15'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-black/5 text-xl font-semibold dark:bg-white/10">
                  {c.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    {playingId === c.id && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        ● 试听中
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-sm opacity-70">{c.tagline}</div>
                  <div className="mt-0.5 text-xs opacity-50">适合:{c.suited_for}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-500">{error}</p>}

      <button
        onClick={confirm}
        disabled={!selectedId || busy}
        className="mt-6 w-full rounded-xl bg-foreground py-3 font-medium text-background disabled:opacity-40"
      >
        {busy ? '保存中…' : selectedId ? '就选 TA 了' : '先选一个搭子'}
      </button>
    </div>
  );
}

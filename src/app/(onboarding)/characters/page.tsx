import { createClient } from '@/lib/supabase/server';
import type { Character } from '@/lib/types';
import { CharacterPicker } from '@/components/characters/CharacterPicker';

export default async function CharactersPage() {
  const supabase = await createClient();
  const { data: characters } = await supabase
    .from('characters')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .returns<Character[]>();

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold">选择你的英语搭子</h1>
      <p className="mt-1 text-sm opacity-60">点击卡片试听声音——声音比头像更重要</p>
      <CharacterPicker characters={characters ?? []} />
    </main>
  );
}

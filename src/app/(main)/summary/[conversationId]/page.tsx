import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Conversation, Message } from '@/lib/types';

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single<Conversation>();
  if (!conversation) redirect('/home');

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('seq')
    .returns<Message[]>();

  const userTurns = (messages ?? []).filter((m) => m.role === 'user').length;

  return (
    <main className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold">今天聊得不错 🎉</h1>
      <p className="mt-1 text-sm opacity-60">你一共开口说了 {userTurns} 次</p>

      <section className="mt-6 space-y-3">
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-foreground text-background'
                : 'bg-black/5 dark:bg-white/10'
            }`}
          >
            {m.content}
          </div>
        ))}
      </section>

      <Link
        href="/home"
        className="mt-8 block w-full rounded-xl bg-foreground py-3 text-center font-medium text-background"
      >
        回到首页
      </Link>
    </main>
  );
}

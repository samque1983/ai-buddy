import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { UserMemory } from '@/lib/types';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_memories')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<UserMemory[]>();
  return NextResponse.json({ memories: data ?? [] });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { error } = await supabase
    .from('user_memories')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

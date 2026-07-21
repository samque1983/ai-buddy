import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServices } from '@/lib/services/factory';
import { SessionProcessor } from '@/lib/learning/session-processor';
import { SupabaseLearningStore } from '@/lib/learning/supabase-store';

export const maxDuration = 120;

/** Ends a conversation and runs post-session analysis in the background. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // CAS transition: only the request that actually flips active -> ended may
  // schedule processing. Zero rows updated = not owned, or already ended.
  const { data: updated, error } = await supabase
    .from('conversations')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .select('id');
  if (error) return NextResponse.json({ error: 'update_failed' }, { status: 500 });

  if (!updated || updated.length === 0) {
    const { data: owned } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // Already ended/processing — idempotent success, no duplicate job.
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      const store = new SupabaseLearningStore(createAdminClient());
      const processor = new SessionProcessor(getServices().llm, store);
      await processor.finalize(id);
    } catch (err) {
      console.error('finalize failed', id, err);
    }
  });

  return NextResponse.json({ ok: true });
}

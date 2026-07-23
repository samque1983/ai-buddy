import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServices } from '@/lib/services/factory';
import { ExpressionService } from '@/lib/learning/expression-service';
import { SupabaseLearningStore } from '@/lib/learning/supabase-store';
import { todayInTimezone } from '@/lib/streak';
import type { Profile } from '@/lib/types';

export const maxDuration = 60;

/**
 * Reconcile today's expressions to the user's CURRENT content selection — called when
 * they switch content on the Home picker (the client saves active_packs first, then
 * hits this). Keeps practiced words, swaps untouched ones. See regenerateDaily.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>();
  if (!profile?.onboarding_completed_at) {
    return NextResponse.json({ error: 'setup_incomplete' }, { status: 400 });
  }

  const service = new ExpressionService(getServices().llm, new SupabaseLearningStore(supabase));
  try {
    const expressions = await service.regenerateDaily(user.id, todayInTimezone(profile.timezone));
    return NextResponse.json({ expressions });
  } catch (err) {
    console.error('regenerate expressions failed', err);
    return NextResponse.json({ error: 'generation_failed' }, { status: 500 });
  }
}

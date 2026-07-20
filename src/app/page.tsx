import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveLandingRoute } from '@/lib/routing';
import type { Profile } from '@/lib/types';

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>();

  redirect(resolveLandingRoute(profile));
}

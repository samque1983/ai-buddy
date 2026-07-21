import type { SupabaseClient } from '@supabase/supabase-js';

/** Max AI-turn attempts per user per day (greetings + voice turns, incl. failed STT). */
export const DAILY_TURN_LIMIT = 200;

/**
 * Atomically charges one AI-turn attempt via the increment_turn_attempts RPC
 * BEFORE any paid provider call. Fails open if the RPC isn't deployed yet so a
 * missing migration degrades to "unlimited" rather than an outage.
 */
export async function chargeTurnAttempt(
  supabase: SupabaseClient,
  date: string,
): Promise<'ok' | 'limited'> {
  const { data, error } = await supabase.rpc('increment_turn_attempts', { p_date: date });
  if (error) {
    console.error('turn accounting unavailable:', error.message);
    return 'ok';
  }
  return typeof data === 'number' && data > DAILY_TURN_LIMIT ? 'limited' : 'ok';
}

import type { Profile } from './types';

/** Where a logged-in user should land, given their setup progress. */
export function resolveLandingRoute(profile: Profile | null): '/onboarding' | '/characters' | '/home' {
  if (!profile || !profile.onboarding_completed_at) return '/onboarding';
  if (!profile.selected_character_id) return '/characters';
  return '/home';
}

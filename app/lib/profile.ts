import type { User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  github_username: string;
  avatar_url: string;
  ready_packs: number;
  bonus_packs: number;
  last_regen_at: string;
  total_points: number;
  shared_on_x: boolean;
  referral_code: string;
  referred_by: string | null;
  last_seen_at: string | null;
}

/**
 * Get or auto-create a user profile. Returns null if creation fails.
 */
export async function getOrCreateProfile(
  supabase: any,
  user: User,
  select = 'id, github_username, avatar_url, ready_packs, bonus_packs, last_regen_at'
): Promise<Profile | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select(select)
    .eq('id', user.id)
    .single();

  if (profile) return profile as unknown as Profile;

  const meta = user.user_metadata || {};
  const username = meta.user_name || meta.preferred_username || '';
  await supabase.from('profiles').upsert(
    {
      id: user.id,
      github_username: username,
      avatar_url: meta.avatar_url || '',
      bonus_packs: 10,
      referral_code: username || undefined,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  const { data: newProfile } = await supabase
    .from('profiles')
    .select(select)
    .eq('id', user.id)
    .single();

  return (newProfile as unknown as Profile) || null;
}

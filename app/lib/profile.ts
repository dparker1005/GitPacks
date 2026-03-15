import type { User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  github_username: string;
  avatar_url: string;
  ready_packs: number;
  last_regen_at: string;
}

/**
 * Get or auto-create a user profile. Returns null if creation fails.
 */
export async function getOrCreateProfile(
  supabase: any,
  user: User,
  select = 'id, github_username, avatar_url, ready_packs, last_regen_at'
): Promise<Profile | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select(select)
    .eq('id', user.id)
    .single();

  if (profile) return profile as unknown as Profile;

  const meta = user.user_metadata || {};
  await supabase.from('profiles').upsert(
    {
      id: user.id,
      github_username: meta.user_name || meta.preferred_username || '',
      avatar_url: meta.avatar_url || '',
      ready_packs: 10,
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

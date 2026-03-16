import type { SupabaseClient } from '@supabase/supabase-js';

export const RARITY_POINTS: Record<string, number> = {
  common: 1,
  rare: 2,
  epic: 5,
  legendary: 15,
  mythic: 50,
};

/**
 * Trigger a full score refresh for a user via the refresh_user_scores RPC.
 * Call this after pack opening, achievement claims, or any card-granting event.
 */
export async function refreshUserScores(
  supabase: SupabaseClient,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('refresh_user_scores', {
    p_user_id: userId,
  });
  return { error: error ? error.message : null };
}

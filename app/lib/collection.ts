import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Atomically add cards to a user's collection using the add_cards RPC.
 * Cards are aggregated by login before sending to minimize DB work.
 */
export async function addCards(
  supabase: SupabaseClient,
  userId: string,
  ownerRepo: string,
  cardLogins: string[]
): Promise<{ error: string | null }> {
  // Aggregate duplicate logins into counts
  const counts: Record<string, number> = {};
  for (const login of cardLogins) {
    counts[login] = (counts[login] || 0) + 1;
  }

  const cards = Object.entries(counts).map(([login, count]) => ({
    login,
    count,
  }));

  const { error } = await supabase.rpc('add_cards', {
    p_user_id: userId,
    p_owner_repo: ownerRepo,
    p_cards: cards,
  });

  return { error: error ? error.message : null };
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);
export const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Get cached repo data from Supabase
export async function getCachedRepo(ownerRepo: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('repo_cache')
    .select('data, fetched_at')
    .eq('owner_repo', ownerRepo)
    .single();

  if (error || !data) return null;

  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age >= CACHE_TTL) return null;

  return data.data;
}

// Store repo data in Supabase
export async function setCachedRepo(ownerRepo: string, repoData: any): Promise<void> {
  const contributorLogins = Array.isArray(repoData)
    ? repoData.map((c: any) => c.login?.toLowerCase()).filter(Boolean)
    : [];
  await supabase
    .from('repo_cache')
    .upsert(
      {
        owner_repo: ownerRepo,
        data: repoData,
        card_count: Array.isArray(repoData) ? repoData.length : 0,
        contributor_logins: contributorLogins,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'owner_repo' }
    );
}

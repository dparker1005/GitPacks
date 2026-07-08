import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Cache-first reads: return any row we have for this repo, regardless of age.
 * The UI decides whether to offer a refresh button based on fetched_at.
 */
export async function getCachedRepo(
  ownerRepo: string
): Promise<{ data: any; fetchedAt: string } | null> {
  const { data, error } = await supabase
    .from('repo_cache')
    .select('data, fetched_at')
    .eq('owner_repo', ownerRepo)
    .single();
  if (error || !data) return null;
  return { data: data.data, fetchedAt: data.fetched_at };
}

/**
 * Convenience wrapper that returns just the contributor array — most consumers
 * (pack opening, achievements, sprints, recycling) don't care about the
 * timestamp, they just need to look up contributors.
 */
export async function getCachedRepoData(ownerRepo: string): Promise<any | null> {
  const row = await getCachedRepo(ownerRepo);
  return row?.data ?? null;
}

export async function setCachedRepo(
  ownerRepo: string,
  repoData: any,
  commitSha?: string | null,
  issueNumber?: number | null,
): Promise<void> {
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
        last_commit_sha: commitSha ?? null,
        last_issue_number: issueNumber ?? null,
      },
      { onConflict: 'owner_repo' }
    );
}

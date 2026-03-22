import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

const CACHE_TTL = 72 * 60 * 60 * 1000; // 72 hours — skip smart check if younger
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days hard max — always refresh

function getGitHubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token
    ? { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    : { Accept: 'application/vnd.github.v3+json' };
}

/**
 * Check if a repo has changed by comparing latest commit SHA and latest issue number.
 * Returns true if the repo has changed (or we can't tell), false if unchanged.
 * Costs 2 API calls instead of 10+ for a full refresh.
 */
async function hasRepoChanged(
  ownerRepo: string,
  cachedCommitSha: string | null,
  cachedIssueNumber: number | null
): Promise<{ changed: boolean; commitSha: string | null; issueNumber: number | null }> {
  // If we have no baseline, assume changed
  if (!cachedCommitSha && !cachedIssueNumber) {
    return { changed: true, commitSha: null, issueNumber: null };
  }

  const headers = getGitHubHeaders();
  let commitSha: string | null = null;
  let issueNumber: number | null = null;

  try {
    const [commitRes, issueRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${ownerRepo}/commits?per_page=1`, { headers }),
      fetch(`https://api.github.com/repos/${ownerRepo}/issues?per_page=1&state=all&sort=created&direction=desc`, { headers }),
    ]);

    if (commitRes.ok) {
      const commits = await commitRes.json();
      if (Array.isArray(commits) && commits.length > 0) {
        commitSha = commits[0].sha;
      }
    }

    if (issueRes.ok) {
      const issues = await issueRes.json();
      if (Array.isArray(issues) && issues.length > 0) {
        issueNumber = issues[0].number;
      }
    }
  } catch {
    // API error — assume changed to be safe
    return { changed: true, commitSha: null, issueNumber: null };
  }

  const changed = commitSha !== cachedCommitSha || issueNumber !== cachedIssueNumber;
  return { changed, commitSha, issueNumber };
}

export async function getCachedRepo(ownerRepo: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('repo_cache')
    .select('data, fetched_at, last_commit_sha, last_issue_number')
    .eq('owner_repo', ownerRepo)
    .single();

  if (error || !data) return null;

  const age = Date.now() - new Date(data.fetched_at).getTime();

  // Hard max — always refresh after 7 days
  if (age >= MAX_CACHE_AGE) return null;

  // Fresh enough — serve without checking GitHub at all (0 API calls)
  if (age < CACHE_TTL) return data.data;

  // Between 72h and 7d — smart check: see if repo actually changed (2 API calls)
  const { changed, commitSha, issueNumber } = await hasRepoChanged(
    ownerRepo,
    data.last_commit_sha,
    data.last_issue_number
  );

  if (!changed) {
    // Repo unchanged — update fetched_at to extend cache, return cached data
    await supabase
      .from('repo_cache')
      .update({ fetched_at: new Date().toISOString() })
      .eq('owner_repo', ownerRepo);
    return data.data;
  }

  // Repo changed — return null to trigger full refresh
  return null;
}

export async function setCachedRepo(ownerRepo: string, repoData: any, commitSha?: string | null, issueNumber?: number | null): Promise<void> {
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

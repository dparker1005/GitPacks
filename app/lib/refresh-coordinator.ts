// Site-wide background refresh coordinator.
//
// Whenever a request serves a cache hit, it tries to claim the global refresh
// slot. At most one refresh runs every COOLDOWN_MINUTES across the entire
// site, regardless of which repo is requested. The slot is held in a single
// `system_state` row; the claim is one atomic UPDATE ... WHERE updated_at < ...
// RETURNING — if 0 rows return, someone else just claimed it.
//
// Once claimed, we refresh the STALEST cached repo (oldest fetched_at), not
// the repo that was visited. Every pass bumps that row's fetched_at, so the
// "oldest" pointer advances round-robin through the whole cache — with steady
// traffic every repo gets checked once per (cache size × cooldown) and stays
// up to date without anyone having to visit it.
//
// Each pass does the cheap probe (latest commit SHA + latest issue number,
// 2 REST calls). If those match what we have cached, we just bump fetched_at
// silently. If anything changed, we kick the existing
// /api/repo/{owner}/{repo}?refresh=true streaming path so the full stats
// fetch + process + cache write reuses the one canonical pipeline.

import { gitHubHeaders } from './github-token';
import { supabase } from './repo-cache';

const COOLDOWN_MINUTES = 5;
const COOLDOWN_KEY = 'last_repo_refresh';

/**
 * Atomically claim the site-wide refresh slot. Returns true if we won the
 * race; false if another request claimed it within the cooldown window.
 *
 * The UPDATE ... WHERE ... RETURNING pattern is the concurrency primitive:
 * Postgres serializes the writes, and only the first one whose `lt` predicate
 * matches gets a row back.
 */
export async function tryClaimRefreshSlot(): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('system_state')
    .update({ updated_at: new Date().toISOString() })
    .eq('key', COOLDOWN_KEY)
    .lt('updated_at', cutoffIso)
    .select('key');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/**
 * The stalest cache row — the next candidate in the round-robin rotation.
 */
async function getOldestCachedRepo(): Promise<
  { ownerRepo: string; lastCommitSha: string | null; lastIssueNumber: number | null } | null
> {
  const { data, error } = await supabase
    .from('repo_cache')
    .select('owner_repo, last_commit_sha, last_issue_number')
    .order('fetched_at', { ascending: true })
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    ownerRepo: data.owner_repo,
    lastCommitSha: data.last_commit_sha ?? null,
    lastIssueNumber: data.last_issue_number ?? null,
  };
}

/**
 * Cheap change detection. Two REST calls (~300ms total). Returns the freshly-
 * observed markers along with a `changed` flag so we can bump fetched_at
 * even on a no-change result (so the dashboard "Updated N min ago" stays
 * accurate without a full refresh).
 */
async function probeForChanges(
  owner: string,
  repo: string,
  ghToken: string | undefined,
  cached: { lastCommitSha: string | null; lastIssueNumber: number | null },
): Promise<{ ok: true; changed: boolean; commitSha: string | null; issueNumber: number | null } | { ok: false }> {
  const headers = gitHubHeaders(ghToken);
  let commitRes: Response;
  let issueRes: Response;
  try {
    [commitRes, issueRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/issues?per_page=1&state=all&sort=created&direction=desc`, { headers }),
    ]);
  } catch {
    return { ok: false };
  }
  if (!commitRes.ok || !issueRes.ok) return { ok: false };

  let commitSha: string | null = null;
  let issueNumber: number | null = null;
  try {
    const commits = await commitRes.json();
    if (Array.isArray(commits) && commits.length > 0) commitSha = commits[0].sha ?? null;
  } catch { /* leave null */ }
  try {
    const issues = await issueRes.json();
    if (Array.isArray(issues) && issues.length > 0) issueNumber = issues[0].number ?? null;
  } catch { /* leave null */ }

  const changed =
    (commitSha !== null && commitSha !== cached.lastCommitSha) ||
    (issueNumber !== null && issueNumber !== cached.lastIssueNumber);

  return { ok: true, changed, commitSha, issueNumber };
}

/**
 * No-change touch: bump fetched_at + record the freshly-observed markers
 * without rewriting the contributor data. Keeps "last refreshed N minutes
 * ago" accurate so the UI doesn't keep nudging users to manually refresh.
 */
async function touchCacheRow(
  ownerRepo: string,
  commitSha: string | null,
  issueNumber: number | null,
): Promise<void> {
  await supabase
    .from('repo_cache')
    .update({
      fetched_at: new Date().toISOString(),
      last_commit_sha: commitSha,
      last_issue_number: issueNumber,
    })
    .eq('owner_repo', ownerRepo);
}

/**
 * Advance the rotation without touching the change-detection markers. Used
 * when the probe fails (repo deleted, rate limit) or before a full refresh:
 * either way the row must stop being "oldest" so one bad repo can't jam the
 * site-wide rotation, but the stale markers must survive so change detection
 * retries on the next lap.
 */
async function bumpFetchedAt(ownerRepo: string): Promise<void> {
  await supabase
    .from('repo_cache')
    .update({ fetched_at: new Date().toISOString() })
    .eq('owner_repo', ownerRepo);
}

/**
 * Full refresh: re-enter our own /api/repo route with ?refresh=true. The
 * route writes to cache as a side effect of the stream, so we just have to
 * drain the body to keep the producer alive to completion.
 *
 * Going through HTTP rather than calling the pipeline directly keeps a single
 * canonical fetch path — the same code that serves user-facing refreshes runs
 * here, and any future fix to that path automatically benefits the coordinator.
 */
async function triggerFullRefresh(origin: string, owner: string, repo: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${origin}/api/repo/${owner}/${repo}?refresh=true`, {
      headers: { Accept: 'application/x-ndjson' },
    });
  } catch {
    return;
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  // Drain — discard all bytes; we only care about the side effect (cache write).
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/**
 * Background refresh entry point: refresh the stalest cached repo. Caller is
 * responsible for having claimed the slot via tryClaimRefreshSlot first.
 * ghToken is the visiting user's token (if any) — spends their rate limit
 * quota rather than the shared server token.
 */
export async function runBackgroundRefresh(
  origin: string,
  ghToken: string | undefined,
): Promise<void> {
  try {
    const oldest = await getOldestCachedRepo();
    if (!oldest) return;
    const [owner, repo] = oldest.ownerRepo.split('/');
    if (!owner || !repo) return;

    const probe = await probeForChanges(owner, repo, ghToken, oldest);
    if (!probe.ok) {
      // Probe failed (deleted repo, rate limit, network) — advance the
      // rotation anyway; markers stay stale so we re-check next lap.
      await bumpFetchedAt(oldest.ownerRepo);
      return;
    }

    if (!probe.changed) {
      await touchCacheRow(oldest.ownerRepo, probe.commitSha, probe.issueNumber);
      return;
    }

    // Advance rotation before the full refresh: on success setCachedRepo
    // rewrites fetched_at + markers anyway; on failure the old markers are
    // still in place, so the change is picked up again on the next lap
    // instead of this repo monopolizing every slot.
    await bumpFetchedAt(oldest.ownerRepo);
    await triggerFullRefresh(origin, owner, repo);
  } catch (err) {
    // Background work; never throw.
    console.error('[refresh-coordinator] background refresh failed:', err);
  }
}

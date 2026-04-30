// GitHub commit-stats reconstruction via the GraphQL API.
//
// Replaces the broken /repos/{owner}/{repo}/stats/contributors endpoint
// (github/community#192970, 202-forever since 2026-04-12) and its now-flaky
// /graphs/contributors-data fallback. We paginate `repository.history`
// directly, bucket by author × Sunday-aligned UTC week, and emit the same
// `{ author: { login, avatar_url }, total, weeks: [{w, c}] }` shape that
// processAllContributors already consumes — so scoring code is untouched.

const GRAPHQL_URL = 'https://api.github.com/graphql';
const PAGE_SIZE = 100;
const FANOUT_BUCKETS = 8;
const SECONDS_PER_WEEK = 604800;

export type ProbeResult =
  | { ok: true; totalCommits: number; createdAt: string; isFork: false }
  | { ok: true; totalCommits: number; createdAt: string; isFork: true; parentFullName: string | null }
  | { ok: false; status: number; message: string };

export type StatsContributor = {
  author: { login: string; avatar_url: string };
  total: number;
  weeks: Array<{ w: number; c: number }>;
};

type GqlCommit = {
  committedDate: string;
  author: {
    user: { login: string; databaseId: number | null } | null;
  } | null;
};

function authHeader(token: string | undefined): Record<string, string> {
  const t = token || process.env.GITHUB_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function gqlRequest(query: string, variables: Record<string, any>, token: string | undefined): Promise<{ ok: boolean; status: number; data?: any; errors?: any[]; message?: string }> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader(token) },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e: any) {
    return { ok: false, status: 0, message: `Network error contacting GitHub GraphQL: ${e?.message || 'unknown'}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: `GitHub returned ${res.status} (auth/rate-limit) for GraphQL query` };
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return { ok: false, status: res.status, message: `GitHub GraphQL is temporarily unavailable (${res.status}). Try again shortly.` };
  }
  let body: any;
  try { body = await res.json(); } catch { return { ok: false, status: res.status, message: `GitHub GraphQL returned non-JSON body (${res.status})` }; }
  if (body.errors && body.errors.length) {
    return { ok: false, status: res.status, errors: body.errors, message: body.errors[0]?.message || 'GraphQL error' };
  }
  return { ok: true, status: res.status, data: body.data };
}

// Probe: one cheap query gets fork status, totalCount, and createdAt — enough to
// decide block (fork), reject (>50K), or proceed, plus the time bound we need
// for the date-range fanout below.
const PROBE_QUERY = `
  query Probe($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      createdAt
      isFork
      parent { nameWithOwner }
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 0) { totalCount }
          }
        }
      }
    }
  }
`;

export async function probeRepo(owner: string, repo: string, token: string | undefined): Promise<ProbeResult> {
  const r = await gqlRequest(PROBE_QUERY, { owner, name: repo }, token);
  if (!r.ok) return { ok: false, status: r.status, message: r.message || 'probe failed' };
  const repoNode = r.data?.repository;
  if (!repoNode) return { ok: false, status: 404, message: 'Repository not found' };
  const totalCommits = repoNode.defaultBranchRef?.target?.history?.totalCount ?? 0;
  if (repoNode.isFork) {
    return { ok: true, totalCommits, createdAt: repoNode.createdAt, isFork: true, parentFullName: repoNode.parent?.nameWithOwner ?? null };
  }
  return { ok: true, totalCommits, createdAt: repoNode.createdAt, isFork: false };
}

const HISTORY_QUERY = `
  query History($owner: String!, $name: String!, $since: GitTimestamp, $until: GitTimestamp, $cursor: String) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: ${PAGE_SIZE}, after: $cursor, since: $since, until: $until) {
              pageInfo { hasNextPage endCursor }
              nodes {
                committedDate
                author { user { login databaseId } }
              }
            }
          }
        }
      }
    }
  }
`;

export type CommitsResult =
  | { ok: true; commits: GqlCommit[] }
  | { ok: false; status: number; message: string };

// Time-bucket fanout: split [createdAt, now] into FANOUT_BUCKETS equal time
// ranges, paginate each in parallel. Cursor pagination is sequential within a
// bucket but the buckets run concurrently. For 50K commits at 8 buckets we
// expect ~63 pages per bucket * ~500ms = ~30s wall-clock — fits Hobby's 60s
// cap with margin for the issues/contributors fetches running alongside.
//
// onProgress is called after every page completes with the running total of
// commits fetched across all buckets — used to drive the client progress bar.
export async function fetchCommitsViaGraphQL(
  owner: string,
  repo: string,
  token: string | undefined,
  createdAt: string,
  onProgress?: (fetched: number) => void,
): Promise<CommitsResult> {
  const start = new Date(createdAt).getTime();
  const end = Date.now();
  const span = Math.max(end - start, 1000);

  // Add a 1-day cushion on the upper bound to make sure we don't miss commits
  // landing during the fetch, and on the lower bound for any backdated commits.
  const ranges: Array<{ since: string; until: string }> = [];
  for (let i = 0; i < FANOUT_BUCKETS; i++) {
    const sinceMs = start + Math.floor((span * i) / FANOUT_BUCKETS);
    const untilMs = i === FANOUT_BUCKETS - 1 ? end + 86_400_000 : start + Math.floor((span * (i + 1)) / FANOUT_BUCKETS);
    ranges.push({ since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() });
  }

  let totalFetched = 0;
  let firstError: { status: number; message: string } | null = null as { status: number; message: string } | null;
  const all: GqlCommit[] = [];

  await Promise.all(
    ranges.map(async (range) => {
      let cursor: string | null = null;
      while (true) {
        if (firstError) return;
        const r = await gqlRequest(HISTORY_QUERY, { owner, name: repo, since: range.since, until: range.until, cursor }, token);
        if (!r.ok) {
          if (!firstError) firstError = { status: r.status, message: r.message || 'history fetch failed' };
          return;
        }
        const history = r.data?.repository?.defaultBranchRef?.target?.history;
        if (!history) return;
        for (const node of history.nodes as GqlCommit[]) all.push(node);
        totalFetched += history.nodes.length;
        if (onProgress) onProgress(totalFetched);
        if (!history.pageInfo.hasNextPage) return;
        cursor = history.pageInfo.endCursor;
      }
    }),
  );

  if (firstError) return { ok: false, status: firstError.status, message: firstError.message };
  return { ok: true, commits: all };
}

// Sunday-aligned UTC week start, in seconds — matches GitHub's /stats/contributors
// week.w convention exactly.
function weekStartSec(date: Date): number {
  const day = date.getUTCDay();
  const sunday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
  return Math.floor(sunday / 1000);
}

// Aggregate commits → per-contributor weekly buckets, in the exact shape
// /stats/contributors used to return. Bots ([bot]-suffixed logins) and commits
// without a resolved GitHub user (raw email-only authors) are dropped, matching
// the existing pipeline's behavior.
//
// Every contributor's `weeks` array spans [earliestWeek, latestWeek] inclusive
// with zero-fill — processAllContributors uses weeks.length to compute streak
// and consistency windows, so all contributors must share the same length.
export function bucketCommitsByContributor(commits: GqlCommit[]): StatsContributor[] {
  const byLogin = new Map<string, { databaseId: number | null; weekly: Map<number, number>; total: number }>();
  let earliestWeek = Infinity;
  let latestWeek = 0;

  for (const commit of commits) {
    const login = commit.author?.user?.login;
    if (!login) continue;
    if (login.endsWith('[bot]')) continue;
    const d = new Date(commit.committedDate);
    const week = weekStartSec(d);
    if (week < earliestWeek) earliestWeek = week;
    if (week > latestWeek) latestWeek = week;
    let entry = byLogin.get(login);
    if (!entry) {
      entry = { databaseId: commit.author?.user?.databaseId ?? null, weekly: new Map(), total: 0 };
      byLogin.set(login, entry);
    }
    entry.total++;
    entry.weekly.set(week, (entry.weekly.get(week) || 0) + 1);
  }

  if (byLogin.size === 0 || earliestWeek === Infinity) return [];

  const weeks: number[] = [];
  for (let w = earliestWeek; w <= latestWeek; w += SECONDS_PER_WEEK) weeks.push(w);

  return Array.from(byLogin.entries()).map(([login, entry]) => ({
    author: {
      login,
      // Avatar by databaseId is the canonical CDN URL GitHub uses everywhere.
      // Falls back to the login-based redirect form if databaseId is missing.
      avatar_url: entry.databaseId != null
        ? `https://avatars.githubusercontent.com/u/${entry.databaseId}?v=4`
        : `https://github.com/${login}.png`,
    },
    total: entry.total,
    weeks: weeks.map((w) => ({ w, c: entry.weekly.get(w) || 0 })),
  }));
}

export const ELIGIBLE_DAILY_EVENTS: Record<string, { label: string; actionFilter?: string }> = {
  PushEvent: { label: 'Push a commit' },
  IssuesEvent: { label: 'Open an issue', actionFilter: 'opened' },
  PullRequestEvent: { label: 'Open a pull request', actionFilter: 'opened' },
  IssueCommentEvent: { label: 'Comment on an issue' },
  PullRequestReviewEvent: { label: 'Review a pull request' },
};

export const MAX_DAILY_CLAIMS = 3;

export function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getMidnightUTC(): string {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString();
}

export async function detectGitHubEvents(username: string, ghToken?: string): Promise<string[]> {
  const token = ghToken || process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `token ${token}`;

  const todayUTC = getTodayUTC();
  const detected = new Set<string>();

  try {
    const res = await fetch(
      `https://api.github.com/users/${username}/events/public?per_page=100`,
      { headers }
    );
    if (!res.ok) return [];
    const events = await res.json();
    if (!Array.isArray(events)) return [];

    for (const event of events) {
      const eventDate = event.created_at?.slice(0, 10);
      if (eventDate !== todayUTC) continue;

      const type = event.type;
      const def = ELIGIBLE_DAILY_EVENTS[type];
      if (!def) continue;

      if (def.actionFilter && event.payload?.action !== def.actionFilter) continue;

      detected.add(type);
    }
  } catch {
    // GitHub API failure — return empty
  }

  return Array.from(detected);
}

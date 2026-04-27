import { NextRequest, NextResponse } from 'next/server';
import { getCachedRepo, setCachedRepo } from '@/app/lib/repo-cache';
import { invalidateOgCache } from '@/app/lib/og-cache';
import { MIN_REPO_CONTRIBUTORS } from '@/app/lib/constants';
import { gitHubHeaders, gitHubGraphsHeaders, getGitHubToken } from '@/app/lib/github-token';
import { getSupabaseServer } from '@/app/lib/supabase-server';

// ===== Helpers =====
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

// Strip the token from a GitHub API URL for safe logging in error payloads.
function publicUrl(u: string) {
  return u.replace(/[?&]access_token=[^&]+/gi, '');
}

type AttemptLog = { status: number; waitedMs: number };

export type StepFailure = {
  step: 'stats' | 'issues' | 'contributors' | 'repo';
  endpoint: string;
  attempts: AttemptLog[];
  totalWaitedMs: number;
  lastStatus: number | null;
  message: string;
};

type StepOk<T> = { ok: true; step: StepFailure['step']; data: T; attempts: AttemptLog[] };
type StepErr = { ok: false } & StepFailure;
type StepResult<T> = StepOk<T> | StepErr;

// ===== fetchWithRetry =====
// Returns a structured result so callers can surface per-attempt status codes.
// Retries on 202 (GitHub's async-computing signal) with increasing backoff,
// and gives one slow retry on 429 (rate-limited) before surfacing a friendly
// error. Schedule is intentionally sparse — per-IP rate limits on the
// github.com graphs-data workaround endpoint don't expose any X-RateLimit-*
// headers, so we err on the side of fewer requests.
async function fetchWithRetry(
  step: StepFailure['step'],
  url: string,
  ghToken?: string,
  customHeaders?: Record<string, string>,
): Promise<StepResult<any>> {
  const headers = customHeaders || gitHubHeaders(ghToken);
  // 5 attempts total over ~115s. Spaced wider than the prior [3,8,15,25,40]
  // schedule so we hit GitHub less often per repo load — that matters because
  // the graphs-data fallback shares an opaque per-IP budget across all users.
  const retry202 = [5000, 15000, 35000, 60000];
  // One 30s pause on 429, then bail. Hammering further just deepens the lockout.
  const retry429Wait = 30000;
  const attempts: AttemptLog[] = [];
  let totalWaitedMs = 0;
  let lastStatus: number | null = null;
  let retries202 = 0;
  let used429Retry = false;

  while (true) {
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e: any) {
      attempts.push({ status: 0, waitedMs: totalWaitedMs });
      return {
        ok: false,
        step,
        endpoint: publicUrl(url),
        attempts,
        totalWaitedMs,
        lastStatus: 0,
        message: `Network error contacting GitHub: ${e?.message || 'unknown'}`,
      };
    }
    lastStatus = res.status;
    attempts.push({ status: res.status, waitedMs: totalWaitedMs });

    if (res.status === 202) {
      if (retries202 >= retry202.length) break;
      await sleep(retry202[retries202]);
      totalWaitedMs += retry202[retries202];
      retries202++;
      continue;
    }

    if (res.status === 429) {
      if (!used429Retry) {
        used429Retry = true;
        await sleep(retry429Wait);
        totalWaitedMs += retry429Wait;
        continue;
      }
      return {
        ok: false,
        step,
        endpoint: publicUrl(url),
        attempts,
        totalWaitedMs,
        lastStatus,
        message: `GitHub is rate-limiting requests right now. Please try again in a few minutes.`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        step,
        endpoint: publicUrl(url),
        attempts,
        totalWaitedMs,
        lastStatus,
        message: `GitHub returned ${res.status} for ${step}`,
      };
    }
    const data = await res.json();
    return { ok: true, step, data, attempts };
  }

  return {
    ok: false,
    step,
    endpoint: publicUrl(url),
    attempts,
    totalWaitedMs,
    lastStatus,
    message:
      step === 'stats'
        ? `GitHub is still computing contributor stats after ${attempts.length} attempts (${Math.round(totalWaitedMs / 1000)}s). For large/active repos this can take 2 minutes or fail repeatedly.`
        : `GitHub kept returning 202 after ${attempts.length} attempts.`,
  };
}

async function fetchAllIssues(
  owner: string,
  repo: string,
  ghToken?: string,
): Promise<StepResult<Record<string, { prsMerged: number; issues: number; avatar: string }>>> {
  const headers = gitHubHeaders(ghToken);
  const stats: Record<string, { prsMerged: number; issues: number; avatar: string }> = {};
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/issues`;

  const ensure = (login: string, avatar: string) => {
    if (!stats[login]) stats[login] = { prsMerged: 0, issues: 0, avatar: avatar || '' };
    else if (avatar && !stats[login].avatar) stats[login].avatar = avatar;
  };

  const processPage = (data: any[]) => {
    data.forEach((item: any) => {
      if (!item.user || !item.user.login) return;
      const login = item.user.login;
      ensure(login, item.user.avatar_url);
      if (item.pull_request) {
        if (item.pull_request.merged_at) stats[login].prsMerged++;
      } else {
        stats[login].issues++;
      }
    });
  };

  // Fetch pages in parallel batches of 10, up to 50 pages (5000 issues)
  let page = 1;
  let done = false;
  let rateLimitedFirstPage = false;
  let firstPageStatus: number | null = null;

  while (!done && page <= 50) {
    const batch = [];
    for (let i = 0; i < 10 && page + i <= 50; i++) {
      const p = page + i;
      batch.push(
        fetch(`${endpoint}?state=all&per_page=100&page=${p}`, { headers })
          .then(async (res) => {
            if (res.status === 403 || res.status === 429) return { page: p, data: null, rateLimited: true, status: res.status };
            if (!res.ok) return { page: p, data: null, rateLimited: false, status: res.status };
            const data = await res.json();
            return { page: p, data, rateLimited: false, status: res.status };
          })
      );
    }
    const results = await Promise.all(batch);
    for (const r of results.sort((a, b) => a.page - b.page)) {
      if (r.page === 1) firstPageStatus = r.status;
      if (r.rateLimited) {
        if (r.page === 1) { rateLimitedFirstPage = true; done = true; break; }
        done = true; break;
      }
      if (!r.data || !r.data.length) { done = true; break; }
      processPage(r.data);
    }
    page += 10;
  }

  if (rateLimitedFirstPage) {
    return {
      ok: false,
      step: 'issues',
      endpoint,
      attempts: [{ status: firstPageStatus ?? 429, waitedMs: 0 }],
      totalWaitedMs: 0,
      lastStatus: firstPageStatus ?? 429,
      message: 'Rate limited fetching issues on first page. Sign in to use your own GitHub token for higher limits.',
    };
  }

  return {
    ok: true,
    step: 'issues',
    data: stats,
    attempts: [{ status: firstPageStatus ?? 200, waitedMs: 0 }],
  };
}

async function fetchPaginatedContributors(
  owner: string,
  repo: string,
  ghToken?: string,
): Promise<StepResult<Array<{ login: string; avatar: string; contributions: number }>>> {
  const headers = gitHubHeaders(ghToken);
  const all: Array<{ login: string; avatar: string; contributions: number }> = [];
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/contributors`;

  // Fetch all 10 pages in parallel
  const batch = [];
  for (let p = 1; p <= 10; p++) {
    batch.push(
      fetch(`${endpoint}?per_page=100&page=${p}`, { headers })
        .then(async (res) => {
          if (!res.ok) return { page: p, data: null as any[] | null, status: res.status };
          const data = await res.json();
          return { page: p, data: Array.isArray(data) ? data : null, status: res.status };
        })
        .catch(() => ({ page: p, data: null as any[] | null, status: 0 }))
    );
  }
  const results = await Promise.all(batch);
  const sorted = results.sort((a, b) => a.page - b.page);
  const firstPageStatus = sorted[0]?.status ?? 0;

  for (const r of sorted) {
    if (!r.data || r.data.length === 0) break;
    r.data.forEach((c: any) => {
      if (c.login && c.type !== 'Bot') {
        all.push({ login: c.login, avatar: c.avatar_url, contributions: c.contributions });
      }
    });
    if (r.data.length < 100) break; // last page
  }

  // Only treat as a failure if page 1 itself errored — partial pagination is fine.
  if (!sorted[0]?.data && firstPageStatus !== 0 && (firstPageStatus < 200 || firstPageStatus >= 300)) {
    return {
      ok: false,
      step: 'contributors',
      endpoint,
      attempts: [{ status: firstPageStatus, waitedMs: 0 }],
      totalWaitedMs: 0,
      lastStatus: firstPageStatus,
      message: `GitHub returned ${firstPageStatus} for /contributors on page 1`,
    };
  }

  return {
    ok: true,
    step: 'contributors',
    data: all,
    attempts: [{ status: firstPageStatus || 200, waitedMs: 0 }],
  };
}

// ===== getBestCharacteristic =====
function getBestCharacteristic(p: any): string {
  const stats = [
    { key: 'streak', val: p.streak },
    { key: 'consistency', val: p.consistency },
    { key: 'peak', val: p.peak },
    { key: 'recent', val: p.recent },
    { key: 'prs', val: p.prsMerged },
    { key: 'issues', val: p.issues },
  ];
  const best = stats.reduce((a, b) => (b.val > a.val ? b : a));
  const avg = stats.reduce((s, x) => s + x.val, 0) / stats.length;
  if (best.val < avg + 0.08) return 'balanced';
  return best.key;
}

// ===== getBestStat =====
function getBestStat(p: any): string {
  const stats = [
    { key: 'streak', val: p.streak },
    { key: 'consistency', val: p.consistency },
    { key: 'peak', val: p.peak },
    { key: 'prs', val: p.prsMerged },
    { key: 'issues', val: p.issues },
  ];
  return stats.reduce((a, b) => (b.val > a.val ? b : a)).key;
}

// ===== getTitle =====
function getTitle(c: any, p: any, isFirstCommitter: boolean, rarity: string): string {
  if (isFirstCommitter) {
    return (
      ({ mythic: 'Supreme Leader', legendary: 'Founding Flame', epic: 'First Flame', rare: 'Pioneer', common: 'Trailblazer' } as any)[rarity] || 'Founding Flame'
    );
  }

  if (c.inactive) {
    return ({ mythic: 'Eternal Legend', legendary: 'Eternal', epic: 'Cornerstone', rare: 'Foundation', common: 'Legacy' } as any)[rarity];
  }

  const hasNonCommitActivity = c.prsMerged > 0 || c.issues > 0;
  if (c.commits <= 1 && !hasNonCommitActivity) return 'Newcomer';
  if (c.commits > 1 && p.commits < 0.15 && !hasNonCommitActivity) return 'Explorer';

  const dom =
    rarity === 'mythic' || rarity === 'legendary' || rarity === 'epic'
      ? getBestStat(p)
      : getBestCharacteristic(p);

  const titles: any = {
    streak: { mythic: 'Unstoppable Force', legendary: 'Relentless Force', epic: 'Streak Demon', rare: 'Hot Streak', common: 'Tenacious' },
    consistency: { mythic: 'The Inevitable', legendary: 'Unwavering', epic: 'Juggernaut', rare: 'Ironclad', common: 'Clockwork' },
    peak: { mythic: 'Cataclysm', legendary: 'Supernova', epic: 'Lightning Strike', rare: 'Blitz', common: 'Spark' },
    recent: { rare: 'Rising Star', common: 'Recent Contributor' },
    prs: { mythic: 'The Unbound', legendary: 'PR Overlord', epic: 'PR Titan', rare: 'PR Machine', common: 'Pull Requester' },
    issues: { mythic: 'The Oracle', legendary: 'The Seer', epic: 'Issue Hunter', rare: 'Bug Spotter', common: 'Reporter' },
    balanced: { mythic: 'Transcendent', legendary: 'Mastermind', epic: 'Titan', rare: 'Veteran', common: 'Contributor' },
  };

  return titles[dom]?.[rarity] || titles.balanced[rarity];
}

// ===== getAbility =====
function getAbility(c: any, p: any, isFirstCommitter: boolean, rarity: string): any {
  if (isFirstCommitter)
    return ({
      mythic: { name: 'Primordial Force', desc: 'The commit that forged a project from nothing', icon: '\u{1F451}', color: '#ff0040' },
      legendary: { name: 'First Spark', desc: 'There from the very beginning', icon: '\u{1F525}', color: '#ffd700' },
      epic: { name: 'Trailblazer', desc: 'Wrote the code that started it all', icon: '\u{1F525}', color: '#f59e0b' },
      rare: { name: 'Groundbreaker', desc: 'Among the very first contributors', icon: '\u2B50', color: '#60a5fa' },
      common: { name: 'Early Bird', desc: 'One of the original contributors', icon: '\u{1F331}', color: '#888' },
    } as any)[rarity];

  if (c.inactive) {
    return ({
      mythic: { name: 'Eternal Flame', desc: `${fmt(c.commits)} commits forged the foundation`, icon: '\u{1F3DB}\uFE0F', color: '#ff0040' },
      legendary: { name: 'Enshrined', desc: `${fmt(c.commits)} commits still shaping this project`, icon: '\u{1F3DB}\uFE0F', color: '#c084fc' },
      epic: { name: 'Deep Roots', desc: 'Contributions woven into the codebase', icon: '\u{1F33F}', color: '#94a3b8' },
      rare: { name: 'Echo', desc: 'Past contributions still resonate', icon: '\u{1F50A}', color: '#60a5fa' },
      common: { name: 'Bedrock', desc: 'Early contributions that shaped the project', icon: '\u{1FAA8}', color: '#666' },
    } as any)[rarity];
  }

  const hasNonCommitActivity = c.prsMerged > 0 || c.issues > 0;
  if (c.commits <= 1 && !hasNonCommitActivity)
    return { name: 'Debut', desc: 'One commit \u2014 the journey begins', icon: '\u{1F48E}', color: '#888' };
  if (c.commits > 1 && p.commits < 0.15 && !hasNonCommitActivity)
    return { name: 'First Steps', desc: `${c.commits} commits so far`, icon: '\u{1F463}', color: '#999' };

  const best = getBestStat(p);

  if (best === 'streak')
    return ({
      mythic: { name: 'Infinite Chain', desc: `${c.maxStreak} weeks \u2014 the streak that never dies`, icon: '\u{1F525}', color: '#ff0040' },
      legendary: { name: 'Undying Flame', desc: `${c.maxStreak} weeks without stopping`, icon: '\u26A1', color: '#ffd700' },
      epic: { name: 'Unbreakable', desc: `${c.maxStreak}-week streak \u2014 iron will`, icon: '\u26A1', color: '#4ade80' },
      rare: { name: 'On a Roll', desc: `${c.maxStreak}-week streak`, icon: '\u{1F3B2}', color: '#60a5fa' },
      common: { name: 'Persistent', desc: `${c.maxStreak}-week best streak`, icon: '\u2728', color: '#7dd3fc' },
    } as any)[rarity];

  if (best === 'consistency')
    return ({
      mythic: { name: 'Eternal Engine', desc: `${c.activeWeeks} of ${c.totalWeeks} weeks \u2014 never stops`, icon: '\u267E\uFE0F', color: '#ff0040' },
      legendary: { name: 'Perpetual Motion', desc: `Active ${c.activeWeeks} of ${c.totalWeeks} weeks`, icon: '\u267E\uFE0F', color: '#a78bfa' },
      epic: { name: 'Iron Rhythm', desc: `${c.activeWeeks} of ${c.totalWeeks} weeks active`, icon: '\u{1F525}', color: '#f59e0b' },
      rare: { name: 'Metronome', desc: `Reliable across ${c.activeWeeks} weeks`, icon: '\u{1F504}', color: '#60a5fa' },
      common: { name: 'Steady Pulse', desc: `Active for ${c.activeWeeks} weeks`, icon: '\u{1F499}', color: '#60a5fa' },
    } as any)[rarity];

  if (best === 'peak')
    return ({
      mythic: { name: 'Extinction Event', desc: `${c.peak} commits in one week \u2014 off the charts`, icon: '\u2604\uFE0F', color: '#ff0040' },
      legendary: { name: 'Hyperdrive', desc: `${c.peak} commits in a single week`, icon: '\u{1F680}', color: '#ff6ec7' },
      epic: { name: 'Burst Mode', desc: `${c.peak} in one week \u2014 devastating`, icon: '\u{1F4AB}', color: '#60a5fa' },
      rare: { name: 'Quick Strike', desc: `Peaked at ${c.peak} in a week`, icon: '\u2694\uFE0F', color: '#fb923c' },
      common: { name: 'Flash', desc: `${c.peak} in their best week`, icon: '\u{1F538}', color: '#fb923c' },
    } as any)[rarity];

  if (best === 'prs')
    return ({
      mythic: { name: 'Reality Warp', desc: `${fmt(c.prsMerged)} PRs merged \u2014 the code bends to their will`, icon: '\u{1F300}', color: '#ff0040' },
      legendary: { name: 'Merge Overlord', desc: `${fmt(c.prsMerged)} PRs merged \u2014 shapes the codebase`, icon: '\u{1F500}', color: '#4ade80' },
      epic: { name: 'PR Juggernaut', desc: `${fmt(c.prsMerged)} pull requests merged`, icon: '\u{1F500}', color: '#4ade80' },
      rare: { name: 'Code Courier', desc: `${fmt(c.prsMerged)} PRs delivered`, icon: '\u{1F4EC}', color: '#34d399' },
      common: { name: 'PR Contributor', desc: `${fmt(c.prsMerged)} pull requests merged`, icon: '\u{1F4DD}', color: '#6ee7b7' },
    } as any)[rarity];

  if (best === 'issues')
    return ({
      mythic: { name: 'All-Seeing Eye', desc: `${fmt(c.issues)} issues \u2014 nothing escapes their gaze`, icon: '\u{1F52E}', color: '#ff0040' },
      legendary: { name: 'Visionary', desc: `${fmt(c.issues)} issues \u2014 sees what others miss`, icon: '\u{1F50D}', color: '#f472b6' },
      epic: { name: 'Issue Magnet', desc: `${fmt(c.issues)} issues surfaced`, icon: '\u{1F3AF}', color: '#fb7185' },
      rare: { name: 'Scout', desc: `${fmt(c.issues)} issues reported`, icon: '\u{1F50E}', color: '#f9a8d4' },
      common: { name: 'Watchful Eye', desc: `${fmt(c.issues)} issues filed`, icon: '\u{1F441}\uFE0F', color: '#fda4af' },
    } as any)[rarity];

  return { name: 'Contributor', desc: `${fmt(c.commits)} commits`, icon: '\u{1F527}', color: '#999' };
}

// ===== processAllContributors =====
function processAllContributors(
  all: any[],
  issueStats: Record<string, any>,
  extraContributors: Array<{ login: string; avatar: string; contributions: number }>
): any[] {
  issueStats = issueStats || {};
  extraContributors = extraContributors || [];
  const hasIssueData = Object.keys(issueStats).length > 0;
  const maxC = Math.max(...all.map((x: any) => x.total), 1);

  // First pass: compute raw stats for everyone
  const rawEntries: any[] = all.map((c: any) => {
    const weeks = c.weeks || [];
    const totalCommits = c.total;
    let activeWeeks = 0,
      curStreak = 0,
      maxStreak = 0,
      streakOn = false,
      peak = 0,
      recent = 0,
      firstCommitTs = Infinity;
    const recentWindow = Math.min(52, Math.ceil(weeks.length / 2));
    const recTh = weeks.length - recentWindow;
    const inactiveWindow = Math.max(52, Math.ceil(weeks.length / 2));
    const inactiveTh = weeks.length - inactiveWindow;
    let inactiveRecent = 0;
    weeks.forEach((w: any, i: number) => {
      if (w.c > 0) {
        activeWeeks++;
        if (streakOn) curStreak++;
        else {
          curStreak = 1;
          streakOn = true;
        }
        maxStreak = Math.max(maxStreak, curStreak);
        peak = Math.max(peak, w.c);
        if (w.w < firstCommitTs) firstCommitTs = w.w;
      } else {
        streakOn = false;
        curStreak = 0;
      }
      if (i >= recTh) recent += w.c;
      if (i >= inactiveTh) inactiveRecent += w.c;
    });
    const share = maxC > 0 ? totalCommits / maxC : 0;
    const consistency = activeWeeks / Math.max(weeks.length, 1);
    const recentShare = totalCommits > 0 ? recent / totalCommits : 0;
    const is = issueStats[c.author.login] || { prsMerged: 0, issues: 0 };
    return {
      login: c.author.login,
      // `avatar_url` from /stats/contributors, `avatar` from the graphs-data
      // workaround endpoint — see github/community#192970 note at fetch site.
      avatar: c.author.avatar_url || c.author.avatar,
      commits: totalCommits,
      activeWeeks,
      totalWeeks: weeks.length,
      maxStreak,
      peak,
      recent,
      share,
      consistency,
      recentShare,
      firstCommitTs,
      inactive: inactiveRecent === 0,
      prsMerged: is.prsMerged,
      issues: is.issues,
    };
  });

  // Add contributors from paginated endpoint that aren't in stats
  const statsLogins = new Set(rawEntries.map((e: any) => e.login));
  extraContributors.forEach((ec: any) => {
    if (statsLogins.has(ec.login)) return;
    const is = issueStats[ec.login] || { prsOpened: 0, prsMerged: 0, issues: 0, avatar: '' };
    rawEntries.push({
      login: ec.login,
      avatar: ec.avatar || is.avatar || '',
      commits: ec.contributions || 0,
      activeWeeks: 0,
      totalWeeks: 0,
      maxStreak: 0,
      peak: 0,
      recent: 0,
      share: 0,
      consistency: 0,
      recentShare: 0,
      firstCommitTs: Infinity,
      inactive: false,
      prsMerged: is.prsMerged,
      issues: is.issues,
    });
    statsLogins.add(ec.login);
  });

  // Add issue/PR-only contributors (no commits, not in stats or paginated list)
  if (hasIssueData) {
    Object.entries(issueStats).forEach(([login, is]: [string, any]) => {
      if (statsLogins.has(login)) return;
      if (is.prsMerged === 0 && is.issues === 0) return;
      rawEntries.push({
        login,
        avatar: is.avatar || '',
        commits: 0,
        activeWeeks: 0,
        totalWeeks: 0,
        maxStreak: 0,
        peak: 0,
        recent: 0,
        share: 0,
        consistency: 0,
        recentShare: 0,
        firstCommitTs: Infinity,
        inactive: false,
        prsMerged: is.prsMerged,
        issues: is.issues,
      });
    });
  }

  // Cap at 100 contributors — keep highest activity
  if (rawEntries.length > 100) {
    rawEntries.sort((a: any, b: any) => b.commits + b.prsMerged + b.issues - (a.commits + a.prsMerged + a.issues));
    rawEntries.length = 100;
  }

  // Build percentile rank function: returns 0-1 where 1 = best in repo
  function pctRank(arr: number[]) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return (val: number) => {
      let below = 0;
      for (let i = 0; i < n; i++) {
        if (s[i] < val) below++;
        else break;
      }
      return n > 1 ? below / (n - 1) : val > 0 ? 1 : 0;
    };
  }

  const ranks = {
    commits: pctRank(rawEntries.map((e: any) => e.commits)),
    streak: pctRank(rawEntries.map((e: any) => e.maxStreak)),
    activeWeeks: pctRank(rawEntries.map((e: any) => e.activeWeeks)),
    peak: pctRank(rawEntries.map((e: any) => e.peak)),
    recent: pctRank(rawEntries.map((e: any) => e.recent)),
    consistency: pctRank(rawEntries.map((e: any) => e.consistency)),
    prsMerged: pctRank(rawEntries.map((e: any) => e.prsMerged)),
    issues: pctRank(rawEntries.map((e: any) => e.issues)),
  };

  // Raw maxes for log-scaled power calculation
  const mx = {
    streak: Math.max(...rawEntries.map((e: any) => e.maxStreak), 1),
    peak: Math.max(...rawEntries.map((e: any) => e.peak), 1),
    prsMerged: Math.max(...rawEntries.map((e: any) => e.prsMerged), 1),
    issues: Math.max(...rawEntries.map((e: any) => e.issues), 1),
  };

  // Find the first person to ever commit to the repo
  const earliestTs = Math.min(...rawEntries.map((e: any) => e.firstCommitTs));

  // Power weights — shift weight to PRs/issues when data is available
  const W = hasIssueData
    ? { commits: 28, prs: 14, issues: 8, consistency: 22, streak: 16, peak: 12 }
    : { commits: 45, prs: 0, issues: 0, consistency: 25, streak: 18, peak: 12 };

  // First pass: compute percentile scores and raw blended power
  const preEntries = rawEntries.map((c: any) => {
    const pctScores = {
      commits: ranks.commits(c.commits),
      streak: ranks.streak(c.maxStreak),
      activeWeeks: ranks.activeWeeks(c.activeWeeks),
      peak: ranks.peak(c.peak),
      recent: ranks.recent(c.recent),
      consistency: ranks.consistency(c.consistency),
      prsMerged: ranks.prsMerged(c.prsMerged),
      issues: ranks.issues(c.issues),
    };

    // Blend percentile rank (fair distribution) with log-scaled actual values (rewards real output)
    const logCommits = maxC > 1 ? Math.log(c.commits + 1) / Math.log(maxC + 1) : 0;
    const logStreak = mx.streak > 1 ? Math.log(c.maxStreak + 1) / Math.log(mx.streak + 1) : 0;
    const logPeak = mx.peak > 1 ? Math.log(c.peak + 1) / Math.log(mx.peak + 1) : 0;
    const logPrsMerged = mx.prsMerged > 1 ? Math.log(c.prsMerged + 1) / Math.log(mx.prsMerged + 1) : 0;
    const logIssues = mx.issues > 1 ? Math.log(c.issues + 1) / Math.log(mx.issues + 1) : 0;

    const pctPower =
      pctScores.commits * W.commits +
      pctScores.prsMerged * W.prs +
      pctScores.issues * W.issues +
      pctScores.consistency * W.consistency +
      pctScores.streak * W.streak +
      pctScores.peak * W.peak;
    const rawPower =
      logCommits * W.commits +
      logPrsMerged * W.prs +
      logIssues * W.issues +
      c.consistency * W.consistency +
      logStreak * W.streak +
      logPeak * W.peak;
    const blended = (pctPower + rawPower) / 2;

    return { ...c, blended, pctScores };
  });

  // Second pass: normalize power so top = 99, then assign rarity from power rank
  const maxBlended = Math.max(...preEntries.map((e: any) => e.blended), 1);
  const withPower = preEntries.map((e: any) => {
    const power = Math.max(1, Math.round((e.blended / maxBlended) * 99));
    const { blended, ...rest } = e;
    return { ...rest, power };
  });

  // Sort by power descending to assign rarity by rank
  // Target distribution for 100 cards: 3 mythic, 7 legendary, 15 epic, 25 rare, 50 common
  // Scale proportionally for smaller sets
  const byPower = [...withPower].sort((a: any, b: any) => b.power - a.power);
  const n = byPower.length;
  const mythicSlots = Math.max(0, Math.round(n * (3 / 100)));
  const legendarySlots = Math.max(0, Math.round(n * (7 / 100)));
  const epicSlots = Math.max(0, Math.round(n * (15 / 100)));
  const rareSlots = Math.max(0, Math.round(n * (25 / 100)));
  byPower.forEach((e: any, i: number) => {
    if (i < mythicSlots) e.rarity = 'mythic';
    else if (i < mythicSlots + legendarySlots) e.rarity = 'legendary';
    else if (i < mythicSlots + legendarySlots + epicSlots) e.rarity = 'epic';
    else if (i < mythicSlots + legendarySlots + epicSlots + rareSlots) e.rarity = 'rare';
    else e.rarity = 'common';
  });

  // Third pass: assign titles, abilities, and dominant stat (now that rarity is known)
  const entries = withPower.map((c: any) => {
    const isFirstCommitter = c.firstCommitTs === earliestTs;
    const rarity = c.rarity;
    const title = getTitle(c, c.pctScores, isFirstCommitter, rarity);
    const ability = getAbility(c, c.pctScores, isFirstCommitter, rarity);

    let dominantStat: string | null = null;
    const hasActivity = c.commits > 1 || c.prsMerged > 0 || c.issues > 0;
    if (!isFirstCommitter && !c.inactive && hasActivity) {
      const dom =
        rarity === 'mythic' || rarity === 'legendary' || rarity === 'epic'
          ? getBestStat(c.pctScores)
          : getBestCharacteristic(c.pctScores);
      dominantStat = dom === 'balanced' ? null : dom;
    }

    return { ...c, title, ability, dominantStat };
  });

  return entries.sort((a: any, b: any) => b.power - a.power);
}

/** Serialize a StepFailure for the client — keeps the shape tight and predictable. */
function failureToJson(f: StepFailure) {
  return {
    step: f.step,
    endpoint: f.endpoint,
    lastStatus: f.lastStatus,
    attempts: f.attempts,
    totalWaitedMs: f.totalWaitedMs,
    message: f.message,
  };
}

/**
 * Do the actual GitHub fetch → process → cache → respond flow.
 * Called only on cache miss or explicit ?refresh=true — never on the hot path.
 */
async function fetchAndCacheRepo(owner: string, repo: string, ghToken: string | undefined) {
  const cacheKey = `${owner}/${repo}`.toLowerCase();

  // Block forked repos — forks share contributors with the parent and are exploitable.
  // Only runs during a refresh, so we pay the fork-check cost at most once per repo.
  try {
    const headers = gitHubHeaders(ghToken);
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (repoRes.ok) {
      const repoData = await repoRes.json();
      if (repoData.fork) {
        const parent = repoData.parent?.full_name;
        return NextResponse.json(
          { error: `This is a fork. Search for the original repo${parent ? `: ${parent}` : ''} instead.` },
          { status: 400 }
        );
      }
    }
  } catch { /* non-critical — allow through if check fails */ }

  // Fetch all three data sources in parallel. We require ALL to succeed — partial
  // data produces broken cards (missing weekly stats collapse streaks/peak/consistency
  // to 0, and every contributor ends up tagged as first committer).
  //
  // TEMP WORKAROUND — github/community#192970
  //   Since 2026-04-12, GitHub's /repos/.../stats/contributors API returns 202
  //   forever and never produces data. We've swapped to the undocumented endpoint
  //   github.com's own contributors graph uses, which returns the same
  //   {author, total, weeks[]} shape but requires `Bearer` auth + `application/json`
  //   Accept (other header combinations 202 forever, same as the broken API).
  //
  //   Why a stopgap and not a full migration: the GraphQL alternative requires
  //   paginating commit history and bucketing by week ourselves — different code
  //   path, different scoring inputs, ongoing maintenance. This swap keeps the
  //   one-and-only scoring path intact.
  //
  //   To revert when the API is fixed, undo ONLY this call site (URL + 4th arg).
  //   The two adapter sites below are revert-safe and can stay:
  //     - the [bot] login filter at line ~728 (works on API responses too)
  //     - the avatar field fallback at line ~436 (avatar_url is preferred)
  const [statsRes, issuesRes, contribRes] = await Promise.all([
    fetchWithRetry(
      'stats',
      `https://github.com/${owner}/${repo}/graphs/contributors-data`,
      ghToken,
      gitHubGraphsHeaders(ghToken),
    ),
    fetchAllIssues(owner, repo, ghToken),
    fetchPaginatedContributors(owner, repo, ghToken),
  ]);

  const failures = [statsRes, issuesRes, contribRes].filter((r) => !r.ok) as StepErr[];

  if (failures.length > 0) {
    // Don't overwrite or create a cache row with incomplete data. If the user is
    // refreshing an already-cached repo, hand back the existing cache unchanged
    // so they keep seeing good data; otherwise surface the error.
    const existing = await getCachedRepo(cacheKey);
    const partialMeta = Buffer.from(JSON.stringify({ failures: failures.map(failureToJson) })).toString('base64');
    if (existing) {
      return NextResponse.json(existing.data, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Gitpacks-Source': 'cache-refresh-failed',
          'X-Gitpacks-Fetched-At': existing.fetchedAt,
          'X-Gitpacks-Refresh-Failed': failures[0].step,
          'X-Gitpacks-Partial-Meta': partialMeta,
        },
      });
    }
    return NextResponse.json(
      {
        error: failures[0].message || 'Failed to fetch complete data from GitHub.',
        details: { failures: failures.map(failureToJson) },
      },
      { status: 502 }
    );
  }

  // Past the failure gate — all three are ok. Narrow the union so we can read .data.
  if (!statsRes.ok || !issuesRes.ok || !contribRes.ok) throw new Error('unreachable');

  // Bot filter — see github/community#192970 note at fetch site. The graphs-data
  // endpoint omits author.type, so we detect bots by GitHub's '[bot]' login
  // suffix (dependabot[bot], github-actions[bot], etc.). This convention also
  // applies to /stats/contributors responses, so this filter is revert-safe.
  const validStats: any[] = Array.isArray(statsRes.data)
    ? statsRes.data.filter((c: any) => c.author && c.author.login && !c.author.login.endsWith('[bot]'))
    : [];

  const result = processAllContributors(validStats, issuesRes.data, contribRes.data);

  if (result.length < MIN_REPO_CONTRIBUTORS) {
    return NextResponse.json(
      { error: `This repo only has ${result.length} contributor${result.length === 1 ? '' : 's'}. Collections require at least ${MIN_REPO_CONTRIBUTORS}.` },
      { status: 400 }
    );
  }

  // Capture latest commit SHA + issue number — used to detect change if we later
  // re-add automatic refresh. Cheap, two calls, non-critical if they fail.
  let commitSha: string | null = null;
  let issueNumber: number | null = null;
  try {
    const ghHeaders = gitHubHeaders(ghToken);
    const [commitRes, issueRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers: ghHeaders }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/issues?per_page=1&state=all&sort=created&direction=desc`, { headers: ghHeaders }),
    ]);
    if (commitRes.ok) {
      const commits = await commitRes.json();
      if (Array.isArray(commits) && commits.length > 0) commitSha = commits[0].sha;
    }
    if (issueRes.ok) {
      const issues = await issueRes.json();
      if (Array.isArray(issues) && issues.length > 0) issueNumber = issues[0].number;
    }
  } catch { /* non-critical */ }

  await setCachedRepo(cacheKey, result, commitSha, issueNumber);
  invalidateOgCache(owner, repo).catch(() => {});

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Gitpacks-Source': 'fresh',
      'X-Gitpacks-Fetched-At': new Date().toISOString(),
    },
  });
}

// ===== GET handler =====
// Cache-first: any existing row is returned immediately, no GitHub call.
// Refresh is explicit (?refresh=true), triggered by the user via a UI button.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;

  if (!owner || !repo) {
    return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
  }

  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

  // Resolve user's GitHub token — only needed for the refresh path.
  let ghToken: string | undefined;
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) ghToken = await getGitHubToken(supabase, user.id);
  } catch { /* anonymous — server token */ }

  if (!refresh) {
    const cached = await getCachedRepo(cacheKey);
    if (cached) {
      return NextResponse.json(cached.data, {
        headers: {
          // Our Supabase cache is the source of truth. Browser caching would
          // mask fetched-at updates and pin users to pre-header-change responses
          // for up to 24h after any deploy.
          'Cache-Control': 'no-store',
          'X-Gitpacks-Source': 'cache',
          'X-Gitpacks-Fetched-At': cached.fetchedAt,
        },
      });
    }
  }

  return fetchAndCacheRepo(owner, repo, ghToken);
}

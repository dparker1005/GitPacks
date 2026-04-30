import { NextRequest, NextResponse, after } from 'next/server';
import { getCachedRepo, setCachedRepo } from '@/app/lib/repo-cache';
import { invalidateOgCache } from '@/app/lib/og-cache';
import { MIN_REPO_CONTRIBUTORS } from '@/app/lib/constants';
import { gitHubHeaders, getGitHubToken } from '@/app/lib/github-token';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import {
  probeRepo,
  fetchCommitsViaGraphQL,
  bucketCommitsByContributor,
  type StatsContributor,
} from '@/app/lib/github-stats';
import { tryClaimRefreshSlot, runBackgroundRefresh } from '@/app/lib/refresh-coordinator';

// Hobby plan caps function duration at 60s. Set explicitly so the GraphQL
// fanout + REST issues/contributors can run alongside without an unrelated
// default cutting them short.
export const maxDuration = 60;

const COMMIT_LIMIT = 50_000;

// ===== Helpers =====
function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
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
    if (r.data.length < 100) break;
  }

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
      rare: { name: 'Groundbreaker', desc: 'Among the very first contributors', icon: '⭐', color: '#60a5fa' },
      common: { name: 'Early Bird', desc: 'One of the original contributors', icon: '\u{1F331}', color: '#888' },
    } as any)[rarity];

  if (c.inactive) {
    return ({
      mythic: { name: 'Eternal Flame', desc: `${fmt(c.commits)} commits forged the foundation`, icon: '\u{1F3DB}️', color: '#ff0040' },
      legendary: { name: 'Enshrined', desc: `${fmt(c.commits)} commits still shaping this project`, icon: '\u{1F3DB}️', color: '#c084fc' },
      epic: { name: 'Deep Roots', desc: 'Contributions woven into the codebase', icon: '\u{1F33F}', color: '#94a3b8' },
      rare: { name: 'Echo', desc: 'Past contributions still resonate', icon: '\u{1F50A}', color: '#60a5fa' },
      common: { name: 'Bedrock', desc: 'Early contributions that shaped the project', icon: '\u{1FAA8}', color: '#666' },
    } as any)[rarity];
  }

  const hasNonCommitActivity = c.prsMerged > 0 || c.issues > 0;
  if (c.commits <= 1 && !hasNonCommitActivity)
    return { name: 'Debut', desc: 'One commit — the journey begins', icon: '\u{1F48E}', color: '#888' };
  if (c.commits > 1 && p.commits < 0.15 && !hasNonCommitActivity)
    return { name: 'First Steps', desc: `${c.commits} commits so far`, icon: '\u{1F463}', color: '#999' };

  const best = getBestStat(p);

  if (best === 'streak')
    return ({
      mythic: { name: 'Infinite Chain', desc: `${c.maxStreak} weeks — the streak that never dies`, icon: '\u{1F525}', color: '#ff0040' },
      legendary: { name: 'Undying Flame', desc: `${c.maxStreak} weeks without stopping`, icon: '⚡', color: '#ffd700' },
      epic: { name: 'Unbreakable', desc: `${c.maxStreak}-week streak — iron will`, icon: '⚡', color: '#4ade80' },
      rare: { name: 'On a Roll', desc: `${c.maxStreak}-week streak`, icon: '\u{1F3B2}', color: '#60a5fa' },
      common: { name: 'Persistent', desc: `${c.maxStreak}-week best streak`, icon: '✨', color: '#7dd3fc' },
    } as any)[rarity];

  if (best === 'consistency')
    return ({
      mythic: { name: 'Eternal Engine', desc: `${c.activeWeeks} of ${c.totalWeeks} weeks — never stops`, icon: '♾️', color: '#ff0040' },
      legendary: { name: 'Perpetual Motion', desc: `Active ${c.activeWeeks} of ${c.totalWeeks} weeks`, icon: '♾️', color: '#a78bfa' },
      epic: { name: 'Iron Rhythm', desc: `${c.activeWeeks} of ${c.totalWeeks} weeks active`, icon: '\u{1F525}', color: '#f59e0b' },
      rare: { name: 'Metronome', desc: `Reliable across ${c.activeWeeks} weeks`, icon: '\u{1F504}', color: '#60a5fa' },
      common: { name: 'Steady Pulse', desc: `Active for ${c.activeWeeks} weeks`, icon: '\u{1F499}', color: '#60a5fa' },
    } as any)[rarity];

  if (best === 'peak')
    return ({
      mythic: { name: 'Extinction Event', desc: `${c.peak} commits in one week — off the charts`, icon: '☄️', color: '#ff0040' },
      legendary: { name: 'Hyperdrive', desc: `${c.peak} commits in a single week`, icon: '\u{1F680}', color: '#ff6ec7' },
      epic: { name: 'Burst Mode', desc: `${c.peak} in one week — devastating`, icon: '\u{1F4AB}', color: '#60a5fa' },
      rare: { name: 'Quick Strike', desc: `Peaked at ${c.peak} in a week`, icon: '⚔️', color: '#fb923c' },
      common: { name: 'Flash', desc: `${c.peak} in their best week`, icon: '\u{1F538}', color: '#fb923c' },
    } as any)[rarity];

  if (best === 'prs')
    return ({
      mythic: { name: 'Reality Warp', desc: `${fmt(c.prsMerged)} PRs merged — the code bends to their will`, icon: '\u{1F300}', color: '#ff0040' },
      legendary: { name: 'Merge Overlord', desc: `${fmt(c.prsMerged)} PRs merged — shapes the codebase`, icon: '\u{1F500}', color: '#4ade80' },
      epic: { name: 'PR Juggernaut', desc: `${fmt(c.prsMerged)} pull requests merged`, icon: '\u{1F500}', color: '#4ade80' },
      rare: { name: 'Code Courier', desc: `${fmt(c.prsMerged)} PRs delivered`, icon: '\u{1F4EC}', color: '#34d399' },
      common: { name: 'PR Contributor', desc: `${fmt(c.prsMerged)} pull requests merged`, icon: '\u{1F4DD}', color: '#6ee7b7' },
    } as any)[rarity];

  if (best === 'issues')
    return ({
      mythic: { name: 'All-Seeing Eye', desc: `${fmt(c.issues)} issues — nothing escapes their gaze`, icon: '\u{1F52E}', color: '#ff0040' },
      legendary: { name: 'Visionary', desc: `${fmt(c.issues)} issues — sees what others miss`, icon: '\u{1F50D}', color: '#f472b6' },
      epic: { name: 'Issue Magnet', desc: `${fmt(c.issues)} issues surfaced`, icon: '\u{1F3AF}', color: '#fb7185' },
      rare: { name: 'Scout', desc: `${fmt(c.issues)} issues reported`, icon: '\u{1F50E}', color: '#f9a8d4' },
      common: { name: 'Watchful Eye', desc: `${fmt(c.issues)} issues filed`, icon: '\u{1F441}️', color: '#fda4af' },
    } as any)[rarity];

  return { name: 'Contributor', desc: `${fmt(c.commits)} commits`, icon: '\u{1F527}', color: '#999' };
}

// ===== processAllContributors =====
function processAllContributors(
  all: StatsContributor[],
  issueStats: Record<string, any>,
  extraContributors: Array<{ login: string; avatar: string; contributions: number }>
): any[] {
  issueStats = issueStats || {};
  extraContributors = extraContributors || [];
  const hasIssueData = Object.keys(issueStats).length > 0;
  const maxC = Math.max(...all.map((x: any) => x.total), 1);

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
      avatar: c.author.avatar_url,
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

  if (rawEntries.length > 100) {
    rawEntries.sort((a: any, b: any) => b.commits + b.prsMerged + b.issues - (a.commits + a.prsMerged + a.issues));
    rawEntries.length = 100;
  }

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

  const mx = {
    streak: Math.max(...rawEntries.map((e: any) => e.maxStreak), 1),
    peak: Math.max(...rawEntries.map((e: any) => e.peak), 1),
    prsMerged: Math.max(...rawEntries.map((e: any) => e.prsMerged), 1),
    issues: Math.max(...rawEntries.map((e: any) => e.issues), 1),
  };

  const earliestTs = Math.min(...rawEntries.map((e: any) => e.firstCommitTs));

  const W = hasIssueData
    ? { commits: 28, prs: 14, issues: 8, consistency: 22, streak: 16, peak: 12 }
    : { commits: 45, prs: 0, issues: 0, consistency: 25, streak: 18, peak: 12 };

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

  const maxBlended = Math.max(...preEntries.map((e: any) => e.blended), 1);
  const withPower = preEntries.map((e: any) => {
    const power = Math.max(1, Math.round((e.blended / maxBlended) * 99));
    const { blended, ...rest } = e;
    return { ...rest, power };
  });

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

// ===== Streaming response =====
//
// All responses are NDJSON: one JSON object per line, terminated by '\n'.
// Events the client may see, in order:
//   { stage: 'probe', totalCommits }
//   { stage: 'commits', fetched, total }   (many — one per GraphQL page)
//   { stage: 'issues',   ok }               (once)
//   { stage: 'contributors', ok }           (once)
//   { stage: 'done', data, source, fetchedAt, refreshFailed?, partialMeta? }
//   { stage: 'error', code, message, details? }
//
// `done` is always the last event on a successful flow; `error` ends the
// stream on failure. `source` is one of: 'cache', 'fresh', 'cache-refresh-failed'.

type StreamEvent =
  | { stage: 'probe'; totalCommits: number }
  | { stage: 'commits'; fetched: number; total: number }
  | { stage: 'issues'; ok: boolean }
  | { stage: 'contributors'; ok: boolean }
  | { stage: 'done'; data: any; source: 'cache' | 'fresh' | 'cache-refresh-failed'; fetchedAt: string; refreshFailed?: string; partialMeta?: any }
  | { stage: 'error'; code: string; message: string; details?: any };

function ndjsonResponse(stream: ReadableStream<Uint8Array>, status = 200): Response {
  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Disable buffering on Vercel/Cloudflare so progress events flush in real time
      'X-Accel-Buffering': 'no',
    },
  });
}

function singleEventStream(event: StreamEvent): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      controller.close();
    },
  });
}

function buildFetchStream(owner: string, repo: string, ghToken: string | undefined, cacheKey: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const write = (event: StreamEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* stream closed */ }
      };

      try {
        // Probe: gets totalCount, fork status, and createdAt in one cheap call.
        const probe = await probeRepo(owner, repo, ghToken);
        if (!probe.ok) {
          write({ stage: 'error', code: 'probe-failed', message: probe.message });
          controller.close();
          return;
        }

        if (probe.isFork) {
          const parent = probe.parentFullName;
          write({
            stage: 'error',
            code: 'fork',
            message: `This is a fork. Search for the original repo${parent ? `: ${parent}` : ''} instead.`,
          });
          controller.close();
          return;
        }

        if (probe.totalCommits > COMMIT_LIMIT) {
          write({
            stage: 'error',
            code: 'too-large',
            message: `This repo has ${fmt(probe.totalCommits)} commits — too many to score live (limit ${fmt(COMMIT_LIMIT)}). Try a smaller repo.`,
            details: { totalCommits: probe.totalCommits, limit: COMMIT_LIMIT },
          });
          controller.close();
          return;
        }

        write({ stage: 'probe', totalCommits: probe.totalCommits });

        // Fan out: commits via GraphQL (with progress callback) + issues + contributors.
        const [commitsRes, issuesRes, contribRes] = await Promise.all([
          fetchCommitsViaGraphQL(owner, repo, ghToken, probe.createdAt, (fetched) => {
            write({ stage: 'commits', fetched, total: probe.totalCommits });
          }),
          fetchAllIssues(owner, repo, ghToken).then((r) => {
            write({ stage: 'issues', ok: r.ok });
            return r;
          }),
          fetchPaginatedContributors(owner, repo, ghToken).then((r) => {
            write({ stage: 'contributors', ok: r.ok });
            return r;
          }),
        ]);

        // Failure gate. If a refresh fails but we have a cached row, hand back
        // the cached data so the user keeps seeing good cards.
        const failures: StepErr[] = [];
        if (!commitsRes.ok) {
          failures.push({
            ok: false,
            step: 'stats',
            endpoint: 'graphql:repository.history',
            attempts: [{ status: commitsRes.status, waitedMs: 0 }],
            totalWaitedMs: 0,
            lastStatus: commitsRes.status,
            message: commitsRes.message,
          });
        }
        if (!issuesRes.ok) failures.push(issuesRes as StepErr);
        if (!contribRes.ok) failures.push(contribRes as StepErr);

        if (failures.length > 0) {
          const existing = await getCachedRepo(cacheKey);
          if (existing) {
            write({
              stage: 'done',
              data: existing.data,
              source: 'cache-refresh-failed',
              fetchedAt: existing.fetchedAt,
              refreshFailed: failures[0].step,
              partialMeta: { failures: failures.map(failureToJson) },
            });
            controller.close();
            return;
          }
          write({
            stage: 'error',
            code: 'fetch-failed',
            message: failures[0].message || 'Failed to fetch complete data from GitHub.',
            details: { failures: failures.map(failureToJson) },
          });
          controller.close();
          return;
        }

        if (!commitsRes.ok || !issuesRes.ok || !contribRes.ok) throw new Error('unreachable');

        const stats = bucketCommitsByContributor(commitsRes.commits);
        const result = processAllContributors(stats, issuesRes.data, contribRes.data);

        if (result.length < MIN_REPO_CONTRIBUTORS) {
          write({
            stage: 'error',
            code: 'too-few-contributors',
            message: `This repo only has ${result.length} contributor${result.length === 1 ? '' : 's'}. Collections require at least ${MIN_REPO_CONTRIBUTORS}.`,
          });
          controller.close();
          return;
        }

        // Capture latest commit SHA + issue number for change-detection on later
        // refreshes. Cheap, two REST calls, non-critical if they fail.
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

        write({
          stage: 'done',
          data: result,
          source: 'fresh',
          fetchedAt: new Date().toISOString(),
        });
        controller.close();
      } catch (e: any) {
        write({ stage: 'error', code: 'unexpected', message: e?.message || 'Unexpected error during repo fetch.' });
        controller.close();
      }
    },
  });
}

// ===== GET handler =====
// Cache-first: any existing row streams as a single done event.
// Refresh is explicit (?refresh=true), triggered by the user.
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

  let ghToken: string | undefined;
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) ghToken = await getGitHubToken(supabase, user.id);
  } catch { /* anonymous — server token */ }

  if (!refresh) {
    const cached = await getCachedRepo(cacheKey);
    if (cached) {
      // Site-wide background refresh: every cache-hit serve attempts to claim
      // a global 5-min cooldown slot. If we win, run the cheap probe + maybe
      // full refresh after the response is sent. Cooldown is shared across
      // all repos and all users — one refresh per 5 min for the whole site.
      const claimed = await tryClaimRefreshSlot();
      if (claimed) {
        const origin = request.nextUrl.origin;
        after(runBackgroundRefresh(origin, owner, repo, ghToken));
      }

      return ndjsonResponse(
        singleEventStream({
          stage: 'done',
          data: cached.data,
          source: 'cache',
          fetchedAt: cached.fetchedAt,
        }),
      );
    }
  }

  return ndjsonResponse(buildFetchStream(owner, repo, ghToken, cacheKey));
}

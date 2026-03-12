import { NextRequest, NextResponse } from 'next/server';
import { getCachedRepo, setCachedRepo } from '../../cache';

// ===== Helpers =====
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function getHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `token ${token}` } : {};
}

// ===== fetchWithRetry =====
async function fetchWithRetry(url: string): Promise<any> {
  const headers = getHeaders();
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 202) {
      await sleep(3000 + i * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    return res.json();
  }
  throw new Error('GitHub is still computing stats for this repo. Please try again in a minute.');
}

// ===== fetchAllIssues =====
async function fetchAllIssues(
  owner: string,
  repo: string,
  onProgress: (total: number, page: number) => void
): Promise<Record<string, { prsMerged: number; issues: number; avatar: string }>> {
  const headers = getHeaders();
  const stats: Record<string, { prsMerged: number; issues: number; avatar: string }> = {};

  const ensure = (login: string, avatar: string) => {
    if (!stats[login]) stats[login] = { prsMerged: 0, issues: 0, avatar: avatar || '' };
    else if (avatar && !stats[login].avatar) stats[login].avatar = avatar;
  };

  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
      if (page === 1) throw new Error('Rate limited fetching issues. Add a GitHub token for higher limits.');
      break;
    }
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
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
    const totalItems = Object.values(stats).reduce((s, v) => s + v.prsMerged + v.issues, 0);
    onProgress(totalItems, page);
    page++;
    if (page > 50) break;
  }

  return stats;
}

// ===== fetchPaginatedContributors =====
async function fetchPaginatedContributors(
  owner: string,
  repo: string,
  onProgress: (total: number, page: number) => void
): Promise<Array<{ login: string; avatar: string; contributions: number }>> {
  const headers = getHeaders();
  const all: Array<{ login: string; avatar: string; contributions: number }> = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    data.forEach((c: any) => {
      if (c.login && c.type !== 'Bot') {
        all.push({ login: c.login, avatar: c.avatar_url, contributions: c.contributions });
      }
    });
    onProgress(all.length, page);
  }
  return all;
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
    return ({ mythic: 'Eternal Legend', legendary: 'Legacy Guardian', epic: 'Phantom', rare: 'Dormant', common: 'Time Capsule' } as any)[rarity];
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
    consistency: { mythic: 'The Immortal', legendary: 'The Eternal', epic: 'Juggernaut', rare: 'Ironclad', common: 'Clockwork' },
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
      legendary: { name: 'Immortalized', desc: `${fmt(c.commits)} commits still shaping this project`, icon: '\u{1FAA6}', color: '#c084fc' },
      epic: { name: 'Ghost in the Code', desc: `${fmt(c.commits)} commits, then vanished`, icon: '\u{1F47B}', color: '#94a3b8' },
      rare: { name: 'Echo', desc: 'Past contributions still resonate', icon: '\u{1F50A}', color: '#60a5fa' },
      common: { name: 'Faded', desc: 'Contributions from another time', icon: '\u2601\uFE0F', color: '#666' },
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
  const sorted = all.map((x: any) => x.total).sort((a: number, b: number) => b - a);

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
    const inactiveWindow = Math.max(52, Math.ceil(weeks.length / 3));
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

  // Cap at 500 contributors — keep highest activity
  if (rawEntries.length > 500) {
    rawEntries.sort((a: any, b: any) => b.commits + b.prsMerged + b.issues - (a.commits + a.prsMerged + a.issues));
    rawEntries.length = 500;
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
  const byPower = [...withPower].sort((a: any, b: any) => b.power - a.power);
  const n = byPower.length;
  byPower.forEach((e: any, i: number) => {
    const pct = i / Math.max(n - 1, 1);
    // Mythic: 1 per 100 contributors, only if 100+ exist
    const mythicSlots = Math.floor(n / 100);
    if (mythicSlots > 0 && i < mythicSlots) e.rarity = 'mythic';
    else if (pct <= 0.05) e.rarity = 'legendary';
    else if (pct <= 0.15) e.rarity = 'epic';
    else if (pct <= 0.43) e.rarity = 'rare';
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

// ===== GET handler =====
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;

  if (!owner || !repo) {
    return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
  }

  const cacheKey = `${owner}/${repo}`.toLowerCase();

  // Check for refresh bypass
  const refresh = request.nextUrl.searchParams.get('refresh') === 'true';

  // Check cache
  if (!refresh) {
    const cached = await getCachedRepo(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  try {
    const noop = () => {};

    // Fetch all three data sources in parallel
    const [statsData, issueStats, extraContributors] = await Promise.all([
      fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/stats/contributors`),
      fetchAllIssues(owner, repo, noop),
      fetchPaginatedContributors(owner, repo, noop),
    ]);

    if (!Array.isArray(statsData)) {
      return NextResponse.json({ error: 'Failed to fetch contributor stats from GitHub' }, { status: 502 });
    }

    // Filter out deleted accounts and bots (author can be null for deleted GitHub users)
    const validStats = statsData.filter((c: any) => c.author && c.author.login && c.author.type !== 'Bot');

    if (validStats.length === 0 && extraContributors.length === 0) {
      return NextResponse.json({ error: 'No contributor data found' }, { status: 404 });
    }

    // Process into card data
    const result = processAllContributors(validStats, issueStats, extraContributors);

    // Cache result
    await setCachedRepo(cacheKey, result);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

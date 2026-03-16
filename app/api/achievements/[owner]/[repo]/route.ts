import { NextRequest, NextResponse } from 'next/server';
import { getCachedRepo } from '@/app/lib/repo-cache';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getOrCreateProfile } from '@/app/lib/profile';
import { selectPackCards, Contributor } from '@/app/lib/pack-cards';
import { addCards } from '@/app/lib/collection';
import { refreshUserScores } from '@/app/lib/scoring';

const MILESTONE_DEFS: Record<string, { fixed: number[]; increment: number; breakpoint?: number; increment2?: number; statKey: string }> = {
  commits:      { fixed: [1, 10, 50, 100, 500],       increment: 0,   statKey: 'commits' },
  prs_merged:   { fixed: [1, 5, 10, 25, 50, 100],     increment: 50,  breakpoint: 500,  increment2: 100, statKey: 'prsMerged' },
  issues:       { fixed: [1, 5, 10, 25, 50],           increment: 25,  statKey: 'issues' },
  active_weeks: { fixed: [1, 4, 12, 26, 52],           increment: 26,  breakpoint: 104,  increment2: 52,  statKey: 'activeWeeks' },
  streak:       { fixed: [1, 2, 4, 8, 12],             increment: 4,   statKey: 'maxStreak' },
  peak_week:    { fixed: [1, 3, 5, 10, 20],            increment: 10,  statKey: 'peak' },
};

const REPO_SIZE_TIERS = [10, 20, 40, 60, 100];

function getMaxMilestonesPerStat(cardCount: number): number {
  let cap = 0;
  for (const tier of REPO_SIZE_TIERS) {
    if (cardCount >= tier) cap++;
    else break;
  }
  return cap;
}

function getEarnedThresholds(statValue: number, def: { fixed: number[]; increment: number; breakpoint?: number; increment2?: number }): number[] {
  const { fixed, increment, breakpoint, increment2 } = def;
  const thresholds: number[] = [];
  for (const t of fixed) {
    if (statValue >= t) thresholds.push(t);
  }
  if (increment > 0 && fixed.length > 0 && statValue >= fixed[fixed.length - 1]) {
    let next = fixed[fixed.length - 1] + increment;
    while (statValue >= next) {
      thresholds.push(next);
      const inc = (breakpoint && increment2 && next >= breakpoint) ? increment2 : increment;
      next += inc;
    }
  }
  return thresholds;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const { owner, repo } = await params;
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
    }

    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const profile = await getOrCreateProfile(supabase, user);
    if (!profile) {
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    const githubUsername = profile.github_username;
    if (!githubUsername) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    const ownerRepo = `${owner}/${repo}`.toLowerCase();
    const cached = await getCachedRepo(ownerRepo);
    if (!cached || !Array.isArray(cached)) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    const allContributors: Contributor[] = cached;
    const contributor = allContributors.find(
      (c) => c.login.toLowerCase() === githubUsername.toLowerCase()
    );

    if (!contributor) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    // Self-card grant (only side effect in GET)
    let selfCard: Contributor | null = null;

    const { data: existingSelfCard } = await supabase
      .from('user_self_cards')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo)
      .single();

    if (!existingSelfCard) {
      await supabase
        .from('user_self_cards')
        .upsert(
          { user_id: user.id, owner_repo: ownerRepo },
          { onConflict: 'user_id, owner_repo', ignoreDuplicates: true }
        );

      await addCards(supabase, user.id, ownerRepo, [contributor.login]);
      selfCard = contributor;
      await refreshUserScores(supabase, user.id);
    }

    // Compute milestones with per-stat cap
    const cardCount = allContributors.length;
    const maxPerStat = getMaxMilestonesPerStat(cardCount);
    const milestones: Record<string, { earned: number[]; claimed: number[]; claimable: number[]; locked: number[]; maxSlots: number }> = {};

    for (const [statType, def] of Object.entries(MILESTONE_DEFS)) {
      const statValue = (contributor as any)[def.statKey] ?? 0;
      const allEarned = getEarnedThresholds(statValue, def);
      const available = allEarned.slice(0, maxPerStat);
      const locked = allEarned.slice(maxPerStat);
      milestones[statType] = { earned: available, claimed: [], claimable: [], locked, maxSlots: maxPerStat };
    }

    const { data: existingAchievements } = await supabase
      .from('user_achievements')
      .select('stat_type, threshold')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo);

    const claimedSet = new Set(
      (existingAchievements || []).map((a) => `${a.stat_type}:${a.threshold}`)
    );

    for (const [statType, m] of Object.entries(milestones)) {
      for (const t of m.earned) {
        if (claimedSet.has(`${statType}:${t}`)) {
          m.claimed.push(t);
        } else {
          m.claimable.push(t);
        }
      }
    }

    return NextResponse.json({
      isContributor: true,
      selfCard,
      contributor: {
        commits: contributor.commits,
        prsMerged: contributor.prsMerged,
        issues: contributor.issues,
        activeWeeks: contributor.activeWeeks,
        maxStreak: contributor.maxStreak,
        peak: contributor.peak,
      },
      milestones,
      maxPerStat,
      cardCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const { owner, repo } = await params;
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
    }

    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, github_username')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.github_username) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const ownerRepo = `${owner}/${repo}`.toLowerCase();
    const cached = await getCachedRepo(ownerRepo);
    if (!cached || !Array.isArray(cached)) {
      return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
    }

    const allContributors: Contributor[] = cached;
    const contributor = allContributors.find(
      (c) => c.login.toLowerCase() === profile.github_username.toLowerCase()
    );

    if (!contributor) {
      return NextResponse.json({ error: 'Not a contributor to this repo' }, { status: 403 });
    }

    const cardCount = allContributors.length;
    const maxPerStat = getMaxMilestonesPerStat(cardCount);
    let milestonesToClaim: { stat_type: string; threshold: number }[] = [];

    if (body.claim_all) {
      const { data: existingAchievements } = await supabase
        .from('user_achievements')
        .select('stat_type, threshold')
        .eq('user_id', user.id)
        .eq('owner_repo', ownerRepo);

      const claimedSet = new Set(
        (existingAchievements || []).map((a: any) => `${a.stat_type}:${a.threshold}`)
      );

      for (const [statType, def] of Object.entries(MILESTONE_DEFS)) {
        const statValue = (contributor as any)[def.statKey] ?? 0;
        const earned = getEarnedThresholds(statValue, def).slice(0, maxPerStat);
        for (const t of earned) {
          if (!claimedSet.has(`${statType}:${t}`)) {
            milestonesToClaim.push({ stat_type: statType, threshold: t });
          }
        }
      }
    } else {
      const { stat_type, threshold } = body;
      if (!stat_type || typeof threshold !== 'number') {
        return NextResponse.json({ error: 'Missing stat_type or threshold' }, { status: 400 });
      }
      const def = MILESTONE_DEFS[stat_type];
      if (!def) {
        return NextResponse.json({ error: 'Invalid stat_type' }, { status: 400 });
      }
      const statValue = (contributor as any)[def.statKey] ?? 0;
      const earned = getEarnedThresholds(statValue, def).slice(0, maxPerStat);
      if (!earned.includes(threshold)) {
        return NextResponse.json({ error: 'Milestone not earned or locked' }, { status: 403 });
      }
      milestonesToClaim = [{ stat_type, threshold }];
    }

    if (milestonesToClaim.length === 0) {
      return NextResponse.json({ cards: [], milestones: [] });
    }

    // Insert achievements (check for errors to avoid granting cards on duplicate claims)
    const { error: insertErr } = await supabase.from('user_achievements').insert(
      milestonesToClaim.map(m => ({
        user_id: user.id,
        owner_repo: ownerRepo,
        stat_type: m.stat_type,
        threshold: m.threshold,
      }))
    );

    if (insertErr) {
      return NextResponse.json({ error: 'Failed to claim milestones' }, { status: 409 });
    }

    // Draw cards: 5 per milestone
    const allDrawnCards: Contributor[] = [];
    for (let i = 0; i < milestonesToClaim.length; i++) {
      allDrawnCards.push(...selectPackCards(allContributors, 5));
    }

    const cardLogins = allDrawnCards.map(c => c.login);
    await addCards(supabase, user.id, ownerRepo, cardLogins);

    // Refresh scores after granting achievement cards
    await refreshUserScores(supabase, user.id);

    return NextResponse.json({
      cards: allDrawnCards,
      milestones: milestonesToClaim,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

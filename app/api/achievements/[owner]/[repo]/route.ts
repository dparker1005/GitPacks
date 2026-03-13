import { NextRequest, NextResponse } from 'next/server';
import { getCachedRepo } from '../../../repo/cache';
import { getSupabaseServer } from '../../../../lib/supabase-server';

interface Contributor {
  login: string;
  rarity: string;
  commits: number;
  prsMerged: number;
  issues: number;
  activeWeeks: number;
  maxStreak: number;
  peak: number;
  [key: string]: any;
}

const MILESTONE_DEFS: Record<string, { fixed: number[]; increment: number; breakpoint?: number; increment2?: number; statKey: string }> = {
  commits:      { fixed: [1, 5, 10, 25, 50, 100, 250],  increment: 250, breakpoint: 1500, increment2: 500, statKey: 'commits' },
  prs_merged:   { fixed: [1, 5, 10, 25, 50, 100],     increment: 50,  breakpoint: 500,  increment2: 100, statKey: 'prsMerged' },
  issues:       { fixed: [1, 5, 10, 25, 50],            increment: 25,  statKey: 'issues' },
  active_weeks: { fixed: [1, 4, 12, 26, 52],     increment: 26,  breakpoint: 104,  increment2: 52,  statKey: 'activeWeeks' },
  streak:       { fixed: [1, 2, 4, 8, 12],       increment: 4,   statKey: 'maxStreak' },
  peak_week:    { fixed: [1, 3, 5, 10, 20],      increment: 10,  statKey: 'peak' },
};

function getEarnedThresholds(statValue: number, def: { fixed: number[]; increment: number; breakpoint?: number; increment2?: number }): number[] {
  const { fixed, increment, breakpoint, increment2 } = def;
  const thresholds: number[] = [];
  for (const t of fixed) {
    if (statValue >= t) thresholds.push(t);
  }
  if (fixed.length > 0 && statValue >= fixed[fixed.length - 1]) {
    let next = fixed[fixed.length - 1] + increment;
    while (statValue >= next) {
      thresholds.push(next);
      const inc = (breakpoint && increment2 && next >= breakpoint) ? increment2 : increment;
      next += inc;
    }
  }
  return thresholds;
}

function selectPackCards(
  allContributors: Contributor[],
  count: number
): Contributor[] {
  const defaultWeights: Record<string, number> = { mythic: 1, legendary: 3, epic: 9, rare: 24, common: 63 };
  const w = defaultWeights;
  const byRarity: Record<string, Contributor[]> = { mythic: [], legendary: [], epic: [], rare: [], common: [] };
  allContributors.forEach((c) => byRarity[c.rarity].push(c));

  function rollRarity(): string {
    const available: Record<string, number> = {};
    let totalW = 0;
    for (const r of ['mythic', 'legendary', 'epic', 'rare', 'common']) {
      if (byRarity[r].length > 0) {
        available[r] = w[r];
        totalW += w[r];
      }
    }
    let roll = Math.random() * totalW;
    for (const [r, rw] of Object.entries(available)) {
      roll -= rw;
      if (roll <= 0) return r;
    }
    return 'common';
  }

  const picks: Contributor[] = [];

  // Guarantee at least one rare+ card per pack
  const rareOrBetter = [...byRarity.rare, ...byRarity.epic, ...byRarity.legendary, ...byRarity.mythic];
  if (rareOrBetter.length > 0) {
    const guarWeights: Record<string, number> = {
      mythic: w.mythic,
      legendary: w.legendary,
      epic: w.epic,
      rare: Math.max(w.rare, 20)
    };
    const guarAvail: Record<string, number> = {};
    let guarTotal = 0;
    for (const r of ['mythic', 'legendary', 'epic', 'rare']) {
      if (byRarity[r].length > 0) {
        guarAvail[r] = guarWeights[r];
        guarTotal += guarWeights[r];
      }
    }
    let roll = Math.random() * guarTotal;
    let guarRarity = 'rare';
    for (const [r, rw] of Object.entries(guarAvail)) {
      roll -= rw;
      if (roll <= 0) {
        guarRarity = r;
        break;
      }
    }
    const pool = byRarity[guarRarity];
    picks.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  // Fill remaining slots with weighted random
  while (picks.length < count) {
    const rarity = rollRarity();
    const pool = byRarity[rarity];
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (picks.includes(c) && picks.length < allContributors.length) continue;
    picks.push(c);
  }

  // Shuffle
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks;
}

// ===== GET — read-only achievement status (no auto-claim, self-card grant only) =====
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

    // Get or auto-create profile
    let { data: profile } = await supabase
      .from('profiles')
      .select('id, github_username, ready_packs')
      .eq('id', user.id)
      .single();

    if (!profile) {
      const meta = user.user_metadata || {};
      await supabase.from('profiles').upsert({
        id: user.id,
        github_username: meta.user_name || meta.preferred_username || '',
        avatar_url: meta.avatar_url || '',
        ready_packs: 10,
      }, { onConflict: 'id', ignoreDuplicates: true });

      const { data: newProfile } = await supabase
        .from('profiles')
        .select('id, github_username, ready_packs')
        .eq('id', user.id)
        .single();

      if (!newProfile) {
        return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
      }
      profile = newProfile;
    }

    const githubUsername = profile.github_username;
    if (!githubUsername) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    // Load repo data from cache
    const ownerRepo = `${owner}/${repo}`.toLowerCase();
    const cached = await getCachedRepo(ownerRepo);
    if (!cached || !Array.isArray(cached)) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    const allContributors: Contributor[] = cached;

    // Find contributor matching username (case-insensitive)
    const contributor = allContributors.find(
      (c) => c.login.toLowerCase() === githubUsername.toLowerCase()
    );

    if (!contributor) {
      return NextResponse.json({ isContributor: false, selfCard: null, milestones: {} });
    }

    // --- Self-card check (only side effect in GET) ---
    let selfCard: Contributor | null = null;

    const { data: existingSelfCard } = await supabase
      .from('user_self_cards')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo)
      .single();

    if (!existingSelfCard) {
      // Grant self-card
      await supabase
        .from('user_self_cards')
        .upsert(
          { user_id: user.id, owner_repo: ownerRepo },
          { onConflict: 'user_id, owner_repo', ignoreDuplicates: true }
        );

      // Add card to user_collections
      const { data: existing } = await supabase
        .from('user_collections')
        .select('count')
        .eq('user_id', user.id)
        .eq('owner_repo', ownerRepo)
        .eq('contributor_login', contributor.login)
        .single();

      if (existing) {
        await supabase
          .from('user_collections')
          .update({ count: existing.count + 1 })
          .eq('user_id', user.id)
          .eq('owner_repo', ownerRepo)
          .eq('contributor_login', contributor.login);
      } else {
        await supabase
          .from('user_collections')
          .insert({ user_id: user.id, owner_repo: ownerRepo, contributor_login: contributor.login, count: 1 });
      }

      selfCard = contributor;
    }

    // --- Compute milestones (read-only, no inserts) ---
    const milestones: Record<string, { earned: number[]; claimed: number[]; claimable: number[] }> = {};

    for (const [statType, def] of Object.entries(MILESTONE_DEFS)) {
      const statValue = (contributor as any)[def.statKey] ?? 0;
      const earned = getEarnedThresholds(statValue, def);
      milestones[statType] = { earned, claimed: [], claimable: [] };
    }

    // Query existing achievements for this user+repo
    const { data: existingAchievements } = await supabase
      .from('user_achievements')
      .select('stat_type, threshold')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo);

    const claimedSet = new Set(
      (existingAchievements || []).map((a) => `${a.stat_type}:${a.threshold}`)
    );

    // Split earned into claimed vs claimable
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
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

// ===== POST — claim a single milestone and draw a pack =====
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

    // Parse body
    let body: { stat_type: string; threshold: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { stat_type, threshold } = body;
    if (!stat_type || typeof threshold !== 'number') {
      return NextResponse.json({ error: 'Missing stat_type or threshold' }, { status: 400 });
    }

    // Validate stat_type
    const def = MILESTONE_DEFS[stat_type];
    if (!def) {
      return NextResponse.json({ error: 'Invalid stat_type' }, { status: 400 });
    }

    // Get profile for github_username
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, github_username')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.github_username) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Load repo data
    const ownerRepo = `${owner}/${repo}`.toLowerCase();
    const cached = await getCachedRepo(ownerRepo);
    if (!cached || !Array.isArray(cached)) {
      return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
    }

    const allContributors: Contributor[] = cached;

    // Find contributor
    const contributor = allContributors.find(
      (c) => c.login.toLowerCase() === profile.github_username.toLowerCase()
    );

    if (!contributor) {
      return NextResponse.json({ error: 'Not a contributor to this repo' }, { status: 403 });
    }

    // Verify the milestone is actually earned
    const statValue = (contributor as any)[def.statKey] ?? 0;
    const earned = getEarnedThresholds(statValue, def);
    if (!earned.includes(threshold)) {
      return NextResponse.json({ error: 'Milestone not earned' }, { status: 403 });
    }

    // Verify not already claimed
    const { data: existingClaim } = await supabase
      .from('user_achievements')
      .select('id')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo)
      .eq('stat_type', stat_type)
      .eq('threshold', threshold)
      .single();

    if (existingClaim) {
      return NextResponse.json({ error: 'Milestone already claimed' }, { status: 409 });
    }

    // Insert achievement
    await supabase.from('user_achievements').insert({
      user_id: user.id,
      owner_repo: ownerRepo,
      stat_type,
      threshold,
    });

    // Draw a pack of 5 cards
    const cards = selectPackCards(allContributors, 5);

    // Save drawn cards to user_collections
    for (const card of cards) {
      const { data: existing } = await supabase
        .from('user_collections')
        .select('count')
        .eq('user_id', user.id)
        .eq('owner_repo', ownerRepo)
        .eq('contributor_login', card.login)
        .single();

      if (existing) {
        await supabase
          .from('user_collections')
          .update({ count: existing.count + 1 })
          .eq('user_id', user.id)
          .eq('owner_repo', ownerRepo)
          .eq('contributor_login', card.login);
      } else {
        await supabase
          .from('user_collections')
          .insert({ user_id: user.id, owner_repo: ownerRepo, contributor_login: card.login, count: 1 });
      }
    }

    return NextResponse.json({
      cards,
      milestone: { stat_type, threshold },
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

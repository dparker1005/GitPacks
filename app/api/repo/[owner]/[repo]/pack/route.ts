import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCachedRepo } from '../../../cache';
import { getSupabaseServer } from '../../../../../lib/supabase-server';

interface Contributor {
  rarity: string;
  login: string;
  [key: string]: any;
}

const REGEN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_PACKS = 2;

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;

  if (!owner || !repo) {
    return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
  }

  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = await getCachedRepo(cacheKey);

  if (!cached) {
    return NextResponse.json(
      { error: 'Repo data not cached. Fetch /api/repo/[owner]/[repo] first.' },
      { status: 404 }
    );
  }

  const allContributors: Contributor[] = cached;

  if (!Array.isArray(allContributors) || allContributors.length === 0) {
    return NextResponse.json({ error: 'No contributor data available' }, { status: 404 });
  }

  const countParam = request.nextUrl.searchParams.get('count');
  const count = countParam ? Math.max(1, Math.min(parseInt(countParam, 10) || 5, 30)) : 5;

  // Check auth — if logged in, apply pack limits and pity
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Logged-out: limited to 5 packs via cookie
    const cookieStore = await cookies();
    const packsOpenedCookie = cookieStore.get('gp_packs_opened');
    const guestPacksOpened = packsOpenedCookie ? parseInt(packsOpenedCookie.value, 10) || 0 : 0;

    if (guestPacksOpened >= 5) {
      return NextResponse.json(
        { error: 'Sign in to open more packs', requiresAuth: true, guestPacksRemaining: 0 },
        { status: 429 }
      );
    }

    const cards = selectPackCards(allContributors, count);
    const remaining = 5 - (guestPacksOpened + 1);

    const response = NextResponse.json({ cards, guestPacksRemaining: remaining });
    response.cookies.set('gp_packs_opened', String(guestPacksOpened + 1), {
      httpOnly: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    return response;
  }

  // --- Authenticated flow ---

  // 1. Check/regen pack count (auto-create profile if missing)
  let { data: profile } = await supabase
    .from('profiles')
    .select('ready_packs, last_regen_at')
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
    // Re-fetch with defaults applied
    const { data: newProfile } = await supabase
      .from('profiles')
      .select('ready_packs, last_regen_at')
      .eq('id', user.id)
      .single();
    profile = newProfile;
    if (!profile) {
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }
  }

  let readyPacks = profile.ready_packs;
  let lastRegenAt = new Date(profile.last_regen_at).getTime();

  // Compute regen
  while (readyPacks < MAX_PACKS) {
    const elapsed = Date.now() - lastRegenAt;
    if (elapsed >= REGEN_INTERVAL_MS) {
      readyPacks++;
      lastRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
    } else {
      break;
    }
  }
  if (readyPacks > MAX_PACKS) readyPacks = MAX_PACKS;

  if (readyPacks <= 0) {
    // Calculate next regen time for the response
    const nextRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
    return NextResponse.json(
      { error: 'No packs available', nextRegenAt, readyPacks: 0 },
      { status: 429 }
    );
  }

  // 2. Get pity state for this repo
  const { data: pityData } = await supabase
    .from('user_packs')
    .select('packs_opened, packs_since_legendary, packs_since_mythic')
    .eq('user_id', user.id)
    .eq('owner_repo', cacheKey)
    .single();

  const packsOpened = pityData?.packs_opened ?? 0;
  const packsSinceLegendary = pityData?.packs_since_legendary ?? 0;
  const packsSinceMythic = pityData?.packs_since_mythic ?? 0;

  // 3. Draw cards with default weights
  const cards = selectPackCards(allContributors, count);

  // 4. Hard guarantees: force-replace lowest rarity card if thresholds met
  const rarityOrder = ['common', 'rare', 'epic', 'legendary', 'mythic'];

  // Mythic guarantee: 20th pack without mythic
  if (packsSinceMythic >= 19 && !cards.some(c => c.rarity === 'mythic')) {
    const mythicPool = allContributors.filter(c => c.rarity === 'mythic');
    if (mythicPool.length > 0) {
      // Find index of lowest-rarity card
      let lowestIdx = 0;
      let lowestRank = rarityOrder.indexOf(cards[0].rarity);
      for (let i = 1; i < cards.length; i++) {
        const rank = rarityOrder.indexOf(cards[i].rarity);
        if (rank < lowestRank) { lowestRank = rank; lowestIdx = i; }
      }
      cards[lowestIdx] = mythicPool[Math.floor(Math.random() * mythicPool.length)];
    }
  }
  // Legendary guarantee: 10th pack without legendary+
  else if (packsSinceLegendary >= 9 && !cards.some(c => c.rarity === 'legendary' || c.rarity === 'mythic')) {
    const legendaryPool = allContributors.filter(c => c.rarity === 'legendary');
    if (legendaryPool.length > 0) {
      let lowestIdx = 0;
      let lowestRank = rarityOrder.indexOf(cards[0].rarity);
      for (let i = 1; i < cards.length; i++) {
        const rank = rarityOrder.indexOf(cards[i].rarity);
        if (rank < lowestRank) { lowestRank = rank; lowestIdx = i; }
      }
      cards[lowestIdx] = legendaryPool[Math.floor(Math.random() * legendaryPool.length)];
    }
  }

  // 5. Check if we pulled legendary or mythic (after guarantees)
  const gotLegendary = cards.some(c => c.rarity === 'legendary' || c.rarity === 'mythic');
  const gotMythic = cards.some(c => c.rarity === 'mythic');

  // 6. Update pity counters
  const newPityData = {
    user_id: user.id,
    owner_repo: cacheKey,
    packs_opened: packsOpened + 1,
    packs_since_legendary: gotLegendary ? 0 : packsSinceLegendary + 1,
    packs_since_mythic: gotMythic ? 0 : packsSinceMythic + 1,
  };

  await supabase
    .from('user_packs')
    .upsert(newPityData, { onConflict: 'user_id, owner_repo' });

  // 7. Decrement pack count and update regen timer
  readyPacks--;
  const regenUpdate: any = { ready_packs: readyPacks };
  // If this brings us below max for the first time, start the regen timer
  if (readyPacks < MAX_PACKS && profile.ready_packs >= MAX_PACKS) {
    regenUpdate.last_regen_at = new Date().toISOString();
    lastRegenAt = Date.now();
  } else {
    regenUpdate.last_regen_at = new Date(lastRegenAt).toISOString();
  }
  await supabase
    .from('profiles')
    .update(regenUpdate)
    .eq('id', user.id);

  // 8. Save cards to collection
  for (const card of cards) {
    const { data: existing } = await supabase
      .from('user_collections')
      .select('count')
      .eq('user_id', user.id)
      .eq('owner_repo', cacheKey)
      .eq('login', card.login)
      .single();

    if (existing) {
      await supabase
        .from('user_collections')
        .update({ count: existing.count + 1 })
        .eq('user_id', user.id)
        .eq('owner_repo', cacheKey)
        .eq('login', card.login);
    } else {
      await supabase
        .from('user_collections')
        .insert({ user_id: user.id, owner_repo: cacheKey, login: card.login, count: 1 });
    }
  }

  // Return cards + pack state
  const nextRegenAt = readyPacks < MAX_PACKS ? lastRegenAt + REGEN_INTERVAL_MS : null;
  return NextResponse.json({
    cards,
    packState: {
      readyPacks,
      maxPacks: MAX_PACKS,
      nextRegenAt,
    },
  });
}

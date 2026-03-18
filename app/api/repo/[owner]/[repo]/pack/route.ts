import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCachedRepo } from '@/app/lib/repo-cache';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getOrCreateProfile } from '@/app/lib/profile';
import { selectPackCards, Contributor } from '@/app/lib/pack-cards';
import { addCards } from '@/app/lib/collection';
import { refreshUserScores } from '@/app/lib/scoring';
import { REGEN_INTERVAL_MS, MAX_PACKS, calculateRegen } from '@/app/lib/constants';

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
    // Logged-out: limited to 1 pack via cookie
    const cookieStore = await cookies();
    const packsOpenedCookie = cookieStore.get('gp_packs_opened');
    const guestPacksOpened = packsOpenedCookie ? parseInt(packsOpenedCookie.value, 10) || 0 : 0;

    if (guestPacksOpened >= 1) {
      return NextResponse.json(
        { error: 'Sign in to open more packs', requiresAuth: true, guestPacksRemaining: 0 },
        { status: 429 }
      );
    }

    const cards = selectPackCards(allContributors, count);
    const remaining = 1 - (guestPacksOpened + 1);

    const response = NextResponse.json({ cards, guestPacksRemaining: remaining });
    response.cookies.set('gp_packs_opened', String(guestPacksOpened + 1), {
      httpOnly: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    return response;
  }

  // --- Authenticated flow ---

  // 1. Fetch profile and pity state in parallel, then apply regen and decrement
  const [profileResult, pityResult] = await Promise.all([
    getOrCreateProfile(supabase, user, 'ready_packs, bonus_packs, last_regen_at'),
    supabase
      .from('user_packs')
      .select('total_opened, packs_since_legendary, packs_since_mythic')
      .eq('user_id', user.id)
      .eq('owner_repo', cacheKey)
      .single(),
  ]);

  const profile = profileResult;
  if (!profile) {
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }

  const regen = calculateRegen(
    profile.ready_packs,
    new Date(profile.last_regen_at).getTime()
  );

  if (regen.updated) {
    await supabase
      .from('profiles')
      .update({ ready_packs: regen.readyPacks, last_regen_at: new Date(regen.lastRegenAt).toISOString() })
      .eq('id', user.id);
  }

  // Atomically decrement pack count (race-safe)
  const { data: decrementResult, error: decrementError } = await supabase.rpc('decrement_pack', {
    p_user_id: user.id,
    p_max_packs: MAX_PACKS,
  });

  if (decrementError) {
    return NextResponse.json({ error: 'Failed to decrement pack' }, { status: 500 });
  }

  const result = Array.isArray(decrementResult) ? decrementResult[0] : decrementResult;
  if (!result?.success) {
    const nextRegenAt = regen.lastRegenAt + REGEN_INTERVAL_MS;
    return NextResponse.json(
      { error: 'No packs available', nextRegenAt, readyPacks: 0, bonusPacks: 0 },
      { status: 429 }
    );
  }

  const readyPacks = result.new_ready_packs;
  const bonusPacks = result.new_bonus_packs;
  const lastRegenAt = new Date(result.new_last_regen_at).getTime();

  // 2. Use pity state fetched in parallel above
  const { data: pityData } = pityResult;

  const packsOpened = pityData?.total_opened ?? 0;
  const packsSinceLegendary = pityData?.packs_since_legendary ?? 0;
  const packsSinceMythic = pityData?.packs_since_mythic ?? 0;

  // 3. Draw cards with default weights
  const cards = selectPackCards(allContributors, count);

  // 4. Hard guarantees: force-replace lowest rarity card if thresholds met
  const rarityOrder = ['common', 'rare', 'epic', 'legendary', 'mythic'];

  if (packsSinceMythic >= 19 && !cards.some(c => c.rarity === 'mythic')) {
    const mythicPool = allContributors.filter(c => c.rarity === 'mythic');
    if (mythicPool.length > 0) {
      let lowestIdx = 0;
      let lowestRank = rarityOrder.indexOf(cards[0].rarity);
      for (let i = 1; i < cards.length; i++) {
        const rank = rarityOrder.indexOf(cards[i].rarity);
        if (rank < lowestRank) { lowestRank = rank; lowestIdx = i; }
      }
      cards[lowestIdx] = mythicPool[Math.floor(Math.random() * mythicPool.length)];
    }
  } else if (packsSinceLegendary >= 9 && !cards.some(c => c.rarity === 'legendary' || c.rarity === 'mythic')) {
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
    total_opened: packsOpened + 1,
    packs_since_legendary: gotLegendary ? 0 : packsSinceLegendary + 1,
    packs_since_mythic: gotMythic ? 0 : packsSinceMythic + 1,
  };

  const { error: pityErr } = await supabase
    .from('user_packs')
    .upsert(newPityData, { onConflict: 'user_id, owner_repo' });

  // 7. Save cards to collection atomically
  const cardLogins = cards.map(c => c.login);
  const { error: saveErr } = await addCards(supabase, user.id, cacheKey, cardLogins);

  // 8. Refresh scores (non-blocking — don't fail the pack open if scoring errors)
  const { error: scoreErr } = await refreshUserScores(supabase, user.id);

  const nextRegenAt = readyPacks < MAX_PACKS ? lastRegenAt + REGEN_INTERVAL_MS : null;
  const dbErrors = [
    pityErr ? `pity: ${pityErr.message}` : null,
    saveErr ? `cards: ${saveErr}` : null,
    scoreErr ? `score: ${scoreErr}` : null,
  ].filter(Boolean);

  return NextResponse.json({
    cards,
    packState: {
      readyPacks,
      bonusPacks,
      maxPacks: MAX_PACKS,
      nextRegenAt,
    },
    ...(dbErrors.length > 0 ? { _dbErrors: dbErrors } : {}),
  });
}

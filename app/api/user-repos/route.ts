import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase as anonSupabase } from '@/app/lib/repo-cache';
import { refreshUserScores } from '@/app/lib/scoring';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Fetch all rows — Supabase default limit is 1000, so paginate to avoid truncation
  let collections: any[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  let error: any = null;
  while (true) {
    const { data, error: pageError } = await supabase
      .from('user_collections')
      .select('owner_repo, contributor_login')
      .eq('user_id', user.id)
      .range(from, from + PAGE_SIZE - 1);
    if (pageError) { error = pageError; break; }
    if (!data || data.length === 0) break;
    collections = collections.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const repoMap: Record<string, number> = {};
  (collections || []).forEach((row: any) => {
    repoMap[row.owner_repo] = (repoMap[row.owner_repo] || 0) + 1;
  });

  const repoNames = Object.keys(repoMap);
  if (repoNames.length === 0) {
    return NextResponse.json([]);
  }

  // Get the user's GitHub username for contributor rarity lookup
  const meta = user.user_metadata || {};
  const githubUsername = meta.user_name || meta.preferred_username || '';

  // Fetch repo cache card counts + timestamps, scores + timestamps, stars, completions, and contributor rarities in parallel
  const [cacheResult, scoresResult, starsResult, completionsResult, rarityResult] = await Promise.all([
    anonSupabase
      .from('repo_cache')
      .select('owner_repo, card_count, fetched_at')
      .in('owner_repo', repoNames),
    anonSupabase
      .from('leaderboard_scores')
      .select('owner_repo, base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo, updated_at')
      .eq('user_id', user.id)
      .in('owner_repo', repoNames),
    supabase
      .from('user_stars')
      .select('owner_repo, balance')
      .eq('user_id', user.id)
      .in('owner_repo', repoNames),
    supabase
      .from('collection_completions')
      .select('owner_repo, is_complete, insured')
      .eq('user_id', user.id)
      .in('owner_repo', repoNames),
    githubUsername
      ? anonSupabase.rpc('get_user_contributor_rarities', { github_login: githubUsername })
      : Promise.resolve({ data: [] }),
  ]);

  const cacheData = cacheResult.data;
  let scoresData = scoresResult.data;
  const starsData = starsResult.data;

  // Lazy refresh: if any repo's score is older than its cache, recalculate all scores
  const isStale = (cacheData || []).some((cache: any) => {
    const score = (scoresData || []).find((s: any) => s.owner_repo === cache.owner_repo);
    return !score || new Date(score.updated_at) < new Date(cache.fetched_at);
  });
  if (isStale) {
    await refreshUserScores(supabase, user.id);
    const refreshed = await anonSupabase
      .from('leaderboard_scores')
      .select('owner_repo, base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo, updated_at')
      .eq('user_id', user.id)
      .in('owner_repo', repoNames);
    scoresData = refreshed.data;
  }
  const starsMap: Record<string, number> = {};
  (starsData || []).forEach((s: any) => {
    starsMap[s.owner_repo] = s.balance || 0;
  });
  const completionsMap: Record<string, { is_complete: boolean; insured: boolean }> = {};
  (completionsResult.data || []).forEach((c: any) => {
    completionsMap[c.owner_repo] = { is_complete: c.is_complete, insured: c.insured };
  });
  const rarityMap: Record<string, string> = {};
  (rarityResult.data || []).forEach((r: any) => {
    rarityMap[r.owner_repo] = r.rarity;
  });

  const result = repoNames.map(name => {
    const cached = cacheData?.find((r: any) => r.owner_repo === name);
    const totalCards = cached?.card_count || 0;
    const score = scoresData?.find((s: any) => s.owner_repo === name);
    const comp = completionsMap[name];
    // unique_cards stays in sync with the current contributor list; raw row count drifts after a reshuffle.
    const collected = score?.unique_cards ?? repoMap[name];
    return {
      name,
      collected,
      cards: totalCards,
      pct: totalCards > 0 ? collected / totalCards : 0,
      base_points: score?.base_points || 0,
      completion_bonus: score?.completion_bonus || 0,
      total_points: score?.total_points || 0,
      my_rarity: rarityMap[name] || null,
      stars: starsMap[name] || 0,
      was_complete: comp && !comp.is_complete ? true : false,
    };
  });

  result.sort((a, b) => b.pct - a.pct || b.cards - a.cards);

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, no-cache' },
  });
}

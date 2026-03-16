import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { refreshUserScores } from '@/app/lib/scoring';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  if (!owner || !repo) {
    return NextResponse.json({ error: 'Missing owner or repo' }, { status: 400 });
  }

  const supabase = await getSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ownerRepo = `${owner}/${repo}`.toLowerCase();

  // Lazy refresh: check if score is stale compared to repo cache
  const { data: repoCache } = await supabase
    .from('repo_cache')
    .select('fetched_at')
    .eq('owner_repo', ownerRepo)
    .single();

  const { data: existingScore } = await supabase
    .from('leaderboard_scores')
    .select('updated_at')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo)
    .single();

  if (repoCache && (!existingScore || new Date(existingScore.updated_at) < new Date(repoCache.fetched_at))) {
    await refreshUserScores(supabase, user.id);
  }

  // Fetch score
  const { data: score } = await supabase
    .from('leaderboard_scores')
    .select('base_points, completion_bonus, total_points, unique_cards, total_cards_in_repo')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo)
    .single();

  // Fetch completion status
  const { data: completion } = await supabase
    .from('collection_completions')
    .select('is_complete, insured')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo)
    .single();

  const basePoints = score?.base_points || 0;

  return NextResponse.json({
    base_points: basePoints,
    completion_bonus: score?.completion_bonus || 0,
    total_points: score?.total_points || 0,
    unique_cards: score?.unique_cards || 0,
    total_cards_in_repo: score?.total_cards_in_repo || 0,
    is_complete: completion?.is_complete || false,
    insured: completion?.insured || false,
    points_if_complete: basePoints + Math.floor(basePoints * 0.5),
  });
}

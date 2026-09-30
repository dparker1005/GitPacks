import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';
import { getCachedRepoData } from '@/app/lib/repo-cache';
import { refreshUserRepoScores } from '@/app/lib/scoring';
import { CHERRY_PICK_COST } from '@/app/lib/recycling';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ownerRepo = `${owner}/${repo}`.toLowerCase();

  // Fetch repo data for rarity lookup
  const repoData = await getCachedRepoData(ownerRepo);
  if (!repoData || !Array.isArray(repoData)) {
    return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
  }

  // Fetch user's collection
  const { data: collection, error: colErr } = await supabase
    .from('user_collections')
    .select('contributor_login, count')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo);

  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }

  const owned = new Set((collection || []).map((c: any) => c.contributor_login));

  // Build list of missing cards with costs
  const missingCards = repoData
    .filter((c: any) => !owned.has(c.login))
    .map((c: any) => ({
      login: c.login,
      cost: CHERRY_PICK_COST[c.rarity] || 5,
    }));

  if (missingCards.length === 0) {
    return NextResponse.json({ error: 'No missing cards' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc('cherry_pick_all', {
    p_user_id: user.id,
    p_owner_repo: ownerRepo,
    p_cards: missingCards,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    return NextResponse.json(
      { error: 'Insufficient stars', balance: result?.new_balance ?? 0 },
      { status: 400 }
    );
  }

  await refreshUserRepoScores(user.id, [ownerRepo]);

  return NextResponse.json({
    success: true,
    newBalance: result.new_balance,
    cardsAcquired: result.cards_acquired,
  });
}

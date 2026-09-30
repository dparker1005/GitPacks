import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';
import { getCachedRepoData } from '@/app/lib/repo-cache';
import { refreshUserScores } from '@/app/lib/scoring';
import { REVERT_YIELD, getContributorRarity } from '@/app/lib/recycling';

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

  // Fetch user's collection for this repo
  const { data: collection, error: colErr } = await supabase
    .from('user_collections')
    .select('contributor_login, count')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo);

  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }

  // Find all cards with count > 1
  const duplicates = (collection || []).filter((c: any) => c.count > 1);
  if (duplicates.length === 0) {
    return NextResponse.json({ starsEarned: 0, cardsReverted: 0 });
  }

  // Look up rarity server-side
  const repoData = await getCachedRepoData(ownerRepo);
  if (!repoData || !Array.isArray(repoData)) {
    return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
  }

  const rpcCards = duplicates.map((c: any) => {
    const rarity = getContributorRarity(repoData, c.contributor_login);
    return {
      login: c.contributor_login,
      count: c.count - 1, // Keep 1 copy
      yield: rarity ? (REVERT_YIELD[rarity] || 1) : 1,
    };
  });

  const totalCardsReverted = rpcCards.reduce((sum: number, c: any) => sum + c.count, 0);

  const { data: starsEarned, error } = await getSupabaseAdmin().rpc('revert_cards', {
    p_user_id: user.id,
    p_owner_repo: ownerRepo,
    p_cards: rpcCards,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await refreshUserScores(user.id);

  return NextResponse.json({
    starsEarned: starsEarned ?? 0,
    cardsReverted: totalCardsReverted,
  });
}

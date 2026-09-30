import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';
import { getCachedRepoData } from '@/app/lib/repo-cache';
import { refreshUserScores } from '@/app/lib/scoring';
import { REVERT_YIELD, getContributorRarity } from '@/app/lib/recycling';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const body = await request.json();
  const cards: { login: string; count: number }[] = body.cards;

  if (!Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: 'No cards provided' }, { status: 400 });
  }

  // Look up rarity server-side from repo_cache
  const repoData = await getCachedRepoData(ownerRepo);
  if (!repoData || !Array.isArray(repoData)) {
    return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
  }

  const rpcCards = cards.map(c => {
    const rarity = getContributorRarity(repoData, c.login);
    return {
      login: c.login,
      count: Math.max(1, Math.floor(c.count)),
      yield: rarity ? (REVERT_YIELD[rarity] || 1) : 1,
    };
  });

  const { data: starsEarned, error } = await getSupabaseAdmin().rpc('revert_cards', {
    p_user_id: user.id,
    p_owner_repo: ownerRepo,
    p_cards: rpcCards,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await refreshUserScores(user.id);

  return NextResponse.json({ starsEarned: starsEarned ?? 0 });
}

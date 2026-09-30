import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';
import { getCachedRepoData } from '@/app/lib/repo-cache';
import { refreshUserScores } from '@/app/lib/scoring';
import { CHERRY_PICK_COST, getContributorRarity } from '@/app/lib/recycling';

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
  const login: string = body.login;

  if (!login) {
    return NextResponse.json({ error: 'No login provided' }, { status: 400 });
  }

  // Look up rarity server-side
  const repoData = await getCachedRepoData(ownerRepo);
  if (!repoData || !Array.isArray(repoData)) {
    return NextResponse.json({ error: 'Repo data not cached' }, { status: 404 });
  }

  const rarity = getContributorRarity(repoData, login);
  if (!rarity) {
    return NextResponse.json({ error: 'Contributor not found in repo' }, { status: 404 });
  }

  const cost = CHERRY_PICK_COST[rarity];
  if (!cost) {
    return NextResponse.json({ error: 'Invalid rarity' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc('cherry_pick_card', {
    p_user_id: user.id,
    p_owner_repo: ownerRepo,
    p_login: login,
    p_cost: cost,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    if (result?.new_balance === -1) {
      return NextResponse.json({ error: 'Card already owned' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Insufficient stars', balance: result?.new_balance ?? 0 },
      { status: 400 }
    );
  }

  await refreshUserScores(user.id);

  return NextResponse.json({
    success: true,
    newBalance: result.new_balance,
  });
}

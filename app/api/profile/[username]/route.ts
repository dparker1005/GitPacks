import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!username || username.length > 39) {
    return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('get_public_profile', {
    p_username: username,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Fetch contributor rarities for this user
  const { data: rarities } = await supabase.rpc('get_user_contributor_rarities', {
    github_login: username,
  });
  const rarityMap: Record<string, string> = {};
  (rarities || []).forEach((r: any) => {
    rarityMap[r.owner_repo] = r.rarity;
  });

  // Merge completion data and contributor rarity into repos array
  const completionsSet = new Set(
    (data.completions || []).map((c: any) => c.owner_repo)
  );
  const insuredSet = new Set(
    (data.completions || []).filter((c: any) => c.insured).map((c: any) => c.owner_repo)
  );

  const repos = (data.repos || []).map((r: any) => ({
    ...r,
    is_complete: completionsSet.has(r.owner_repo),
    is_insured: insuredSet.has(r.owner_repo),
    contributor_rarity: rarityMap[r.owner_repo] || null,
  }));

  const profile = {
    username: data.username,
    avatar_url: data.avatar_url,
    total_points: data.total_points,
    created_at: data.created_at,
    global_rank: data.global_rank,
    repos_collected: repos.length,
    repos_completed: data.completions?.length || 0,
    repos,
    achievements: data.achievements || [],
  };

  return NextResponse.json(profile, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

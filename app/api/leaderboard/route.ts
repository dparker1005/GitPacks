import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get('repo');
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50, 100);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0;

  const ownerRepo = repo ? repo.toLowerCase() : '__global__';

  const { data, error, count } = await supabase
    .from('leaderboard_scores')
    .select(`
      user_id,
      base_points,
      completion_bonus,
      total_points,
      unique_cards,
      total_cards_in_repo,
      profiles!inner(github_username, avatar_url)
    `, { count: 'exact' })
    .eq('owner_repo', ownerRepo)
    .gt('total_points', 0)
    .order('total_points', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data || []).map((row: any, i: number) => ({
    rank: offset + i + 1,
    github_username: row.profiles?.github_username || '',
    avatar_url: row.profiles?.avatar_url || '',
    total_points: row.total_points,
    base_points: row.base_points,
    completion_bonus: row.completion_bonus,
    unique_cards: row.unique_cards,
    total_cards_in_repo: row.total_cards_in_repo,
  }));

  return NextResponse.json({
    entries,
    total_entries: count || 0,
    repo: repo || null,
  });
}

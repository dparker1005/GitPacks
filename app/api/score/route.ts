import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Get global score
  const { data: globalScore } = await supabase
    .from('leaderboard_scores')
    .select('total_points')
    .eq('user_id', user.id)
    .eq('owner_repo', '__global__')
    .single();

  // Get per-repo stats
  const { data: repoScores } = await supabase
    .from('leaderboard_scores')
    .select('owner_repo, total_points, unique_cards, total_cards_in_repo, completion_bonus')
    .eq('user_id', user.id)
    .neq('owner_repo', '__global__')
    .gt('total_points', 0);

  const repos = repoScores || [];
  const reposCompleted = repos.filter(r => r.unique_cards === r.total_cards_in_repo && r.total_cards_in_repo > 0).length;

  // Get insured count
  const { count: reposInsured } = await supabase
    .from('collection_completions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('insured', true);

  return NextResponse.json({
    total_points: globalScore?.total_points || 0,
    repos_collected: repos.length,
    repos_completed: reposCompleted,
    repos_insured: reposInsured || 0,
  });
}

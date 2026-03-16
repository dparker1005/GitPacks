import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Look up the profile user's ID
  const { data: profileUser } = await supabase
    .from('profiles')
    .select('id')
    .ilike('github_username', username)
    .single();

  if (!profileUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Don't compare with self
  if (profileUser.id === user.id) {
    return NextResponse.json({ shared_repos: [] });
  }

  // Get profile user's repo scores
  const { data: profileScores } = await supabase
    .from('leaderboard_scores')
    .select('owner_repo, total_points, unique_cards, total_cards_in_repo')
    .eq('user_id', profileUser.id)
    .neq('owner_repo', '__global__')
    .gt('total_points', 0);

  if (!profileScores || profileScores.length === 0) {
    return NextResponse.json({ shared_repos: [] });
  }

  // Get viewer's scores for matching repos
  const profileRepos = profileScores.map(s => s.owner_repo);
  const { data: viewerScores } = await supabase
    .from('leaderboard_scores')
    .select('owner_repo, total_points, unique_cards, total_cards_in_repo')
    .eq('user_id', user.id)
    .in('owner_repo', profileRepos)
    .gt('total_points', 0);

  const viewerMap = new Map(
    (viewerScores || []).map(s => [s.owner_repo, s])
  );

  const shared_repos = profileScores
    .filter(s => viewerMap.has(s.owner_repo))
    .map(s => {
      const v = viewerMap.get(s.owner_repo)!;
      return {
        owner_repo: s.owner_repo,
        viewer: { cards: v.unique_cards, points: v.total_points },
        profile: { cards: s.unique_cards, points: s.total_points },
      };
    })
    .sort((a, b) => b.profile.points - a.profile.points);

  return NextResponse.json({ shared_repos });
}

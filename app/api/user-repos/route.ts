import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase as anonSupabase } from '@/app/lib/repo-cache';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: collections, error } = await supabase
    .from('user_collections')
    .select('owner_repo, contributor_login')
    .eq('user_id', user.id);

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

  const { data: cacheData } = await anonSupabase
    .from('repo_cache')
    .select('owner_repo, data')
    .in('owner_repo', repoNames);

  const result = repoNames.map(name => {
    const cached = cacheData?.find((r: any) => r.owner_repo === name);
    const totalCards = cached?.data ? (Array.isArray(cached.data) ? cached.data.length : 0) : 0;
    return {
      name,
      collected: repoMap[name],
      cards: totalCards,
      pct: totalCards > 0 ? repoMap[name] / totalCards : 0,
    };
  });

  result.sort((a, b) => b.pct - a.pct || b.cards - a.cards);

  return NextResponse.json(result);
}

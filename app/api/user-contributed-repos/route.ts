import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../lib/supabase-server';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('github_username')
    .eq('id', user.id)
    .single();

  if (!profile?.github_username) {
    return NextResponse.json([]);
  }

  const username = profile.github_username;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `token ${token}`;

  try {
    // Fetch up to 300 events (3 pages of 100)
    const repoMap = new Map<string, { name: string; description: string; stars: number }>();

    for (let page = 1; page <= 3; page++) {
      const res = await fetch(
        `https://api.github.com/users/${username}/events/public?per_page=100&page=${page}`,
        { headers }
      );
      if (!res.ok) break;
      const events = await res.json();
      if (!events.length) break;

      for (const event of events) {
        const repo = event.repo;
        if (!repo?.name) continue;
        if (repoMap.has(repo.name)) continue;

        // We'll filter forks below via repo metadata if available
        repoMap.set(repo.name, {
          name: repo.name,
          description: '',
          stars: 0,
        });
      }
    }

    // Fetch repo details to filter forks and get metadata
    // Only fetch for repos we don't have details for (batch in parallel, max 20)
    const repoNames = Array.from(repoMap.keys()).slice(0, 30);
    const detailed = await Promise.all(
      repoNames.map(async (name) => {
        try {
          const res = await fetch(`https://api.github.com/repos/${name}`, { headers });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
    );

    const results = detailed
      .filter((r): r is any => r !== null && !r.fork)
      .map((r) => ({
        name: r.full_name,
        description: r.description || '',
        stars: r.stargazers_count || 0,
      }));

    results.sort((a, b) => b.stars - a.stars);

    return NextResponse.json(results);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

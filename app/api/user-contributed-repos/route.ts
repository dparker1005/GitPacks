import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase as anonSupabase } from '@/app/lib/repo-cache';

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
  const usernameLower = username.toLowerCase();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `token ${token}`;

  try {
    // Source 1: Search cached repos where user is a contributor (fast GIN index lookup)
    const { data: cachedMatches } = await anonSupabase
      .from('repo_cache')
      .select('owner_repo, card_count')
      .contains('contributor_logins', [usernameLower]);

    const results: { name: string; description: string; stars: number; cards: number; cached: boolean }[] = [];
    const seenNames = new Set<string>();

    if (cachedMatches) {
      for (const r of cachedMatches) {
        seenNames.add(r.owner_repo.toLowerCase());
        results.push({
          name: r.owner_repo,
          description: '',
          stars: 0,
          cards: r.card_count || 0,
          cached: true,
        });
      }
    }

    // Source 2: GitHub events API for recent activity (catches uncached repos)
    const repoSet = new Set<string>();

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
        if (seenNames.has(repo.name.toLowerCase())) continue;
        repoSet.add(repo.name);
      }
    }

    // Fetch details for uncached repos (filter forks, get metadata)
    const uncachedNames = Array.from(repoSet).slice(0, 20);
    if (uncachedNames.length > 0) {
      const detailed = await Promise.all(
        uncachedNames.map(async (name) => {
          try {
            const res = await fetch(`https://api.github.com/repos/${name}`, { headers });
            if (!res.ok) return null;
            return await res.json();
          } catch {
            return null;
          }
        })
      );

      for (const r of detailed) {
        if (!r || r.fork) continue;
        results.push({
          name: r.full_name,
          description: r.description || '',
          stars: r.stargazers_count || 0,
          cards: 0,
          cached: false,
        });
      }
    }

    results.sort((a, b) => {
      if (a.cached && !b.cached) return -1;
      if (!a.cached && b.cached) return 1;
      return b.stars - a.stars;
    });

    return NextResponse.json(results);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

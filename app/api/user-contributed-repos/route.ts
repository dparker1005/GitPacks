import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase as anonSupabase } from '@/app/lib/repo-cache';

const EVENTS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

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

    // Source 2: GitHub events API — check DB cache first to avoid 3 API calls
    const repoSet = new Set<string>();

    const { data: eventsCache } = await supabase
      .from('user_contributed_repos_cache')
      .select('repo_names, last_fetched_at')
      .eq('user_id', user.id)
      .single();

    const cacheAge = eventsCache?.last_fetched_at
      ? Date.now() - new Date(eventsCache.last_fetched_at).getTime()
      : Infinity;

    if (eventsCache && cacheAge < EVENTS_CACHE_TTL) {
      // Use cached event repos
      for (const name of eventsCache.repo_names) {
        if (!seenNames.has(name.toLowerCase())) {
          repoSet.add(name);
        }
      }
    } else {
      // Fetch fresh from GitHub events API (3 pages)
      const allEventRepos: string[] = [];

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
          allEventRepos.push(repo.name);
          if (!seenNames.has(repo.name.toLowerCase())) {
            repoSet.add(repo.name);
          }
        }
      }

      // Cache the discovered repos for next time
      const uniqueRepos = [...new Set(allEventRepos)];
      await supabase
        .from('user_contributed_repos_cache')
        .upsert({
          user_id: user.id,
          repo_names: uniqueRepos,
          last_fetched_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    // Check which uncached repos already exist in repo_cache (avoid GitHub API calls)
    const uncachedNames = Array.from(repoSet).slice(0, 20);
    if (uncachedNames.length > 0) {
      // First check repo_cache for any we already have
      const { data: cachedUncached } = await anonSupabase
        .from('repo_cache')
        .select('owner_repo, card_count')
        .in('owner_repo', uncachedNames.map(n => n.toLowerCase()));

      const cachedUncachedSet = new Set((cachedUncached || []).map((r: any) => r.owner_repo));
      for (const r of (cachedUncached || [])) {
        results.push({
          name: r.owner_repo,
          description: '',
          stars: 0,
          cards: r.card_count || 0,
          cached: true,
        });
      }

      // Only fetch from GitHub for repos not in cache at all
      const trulyUncached = uncachedNames.filter(n => !cachedUncachedSet.has(n.toLowerCase()));
      if (trulyUncached.length > 0) {
        const detailed = await Promise.all(
          trulyUncached.map(async (name) => {
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
    }

    results.sort((a, b) => {
      if (a.cached && !b.cached) return -1;
      if (!a.cached && b.cached) return 1;
      return b.stars - a.stars;
    });

    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

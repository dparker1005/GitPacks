import { NextResponse } from 'next/server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('repo_cache')
      .select('owner_repo, card_count, fetched_at');

    if (!error && data) {
      const repos = data.map((row: any) => ({
        name: row.owner_repo,
        cards: row.card_count ?? 0,
        fetched_at: row.fetched_at,
      }));
      repos.sort((a: any, b: any) => b.cards - a.cards);
      return NextResponse.json(repos, {
        // Was 1h CDN cache — but card counts here drive the dashboard's "X/Y"
        // display, and a stale entry made completed sets read as e.g. 36/37
        // for up to an hour after the contributor list shifted. Fresh-every-
        // request is cheap (one small Supabase query) and prevents that drift.
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // Fallback: fetch with data column and compute count
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('repo_cache')
      .select('owner_repo, data, fetched_at');

    if (fallbackError || !fallbackData) {
      return NextResponse.json([]);
    }

    const repos = fallbackData.map((row: any) => ({
      name: row.owner_repo,
      cards: Array.isArray(row.data) ? row.data.length : 0,
      fetched_at: row.fetched_at,
    }));

    repos.sort((a: any, b: any) => b.cards - a.cards);
    return NextResponse.json(repos, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json([]);
  }
}

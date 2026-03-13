import { NextResponse } from 'next/server';
import { supabase } from '../repo/cache';

export async function GET() {
  try {
    // Try with card_count column first (lightweight)
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
      return NextResponse.json(repos);
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
    return NextResponse.json(repos);
  } catch {
    return NextResponse.json([]);
  }
}

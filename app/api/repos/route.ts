import { NextResponse } from 'next/server';
import { supabase } from '../repo/cache';

export async function GET() {
  const { data, error } = await supabase
    .from('repo_cache')
    .select('owner_repo, data, fetched_at');

  if (error || !data) {
    return NextResponse.json([]);
  }

  const repos = data.map((row: any) => ({
    name: row.owner_repo,
    cards: Array.isArray(row.data) ? row.data.length : 0,
    fetched_at: row.fetched_at,
  }));

  repos.sort((a: any, b: any) => b.cards - a.cards);

  return NextResponse.json(repos);
}

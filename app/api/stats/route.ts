import { NextResponse } from 'next/server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET() {
  // Sum unique_cards across all per-repo rows (exclude __global__ which doesn't track unique_cards)
  const { data, error } = await supabase
    .from('leaderboard_scores')
    .select('unique_cards')
    .neq('owner_repo', '__global__')
    .gt('unique_cards', 0);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cards_collected = (data || []).reduce((sum, row) => sum + (row.unique_cards || 0), 0);

  return NextResponse.json(
    { cards_collected },
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
  );
}

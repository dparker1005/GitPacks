import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase as anonSupabase } from '@/app/lib/repo-cache';
import { withCompetitionRankScores } from '@/app/lib/competition-ranks';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ login: string }> }
) {
  const { login } = await params;
  if (!login || login.length > 39) {
    return NextResponse.json({ error: 'Invalid login' }, { status: 400 });
  }

  const loginLower = login.toLowerCase();

  // GIN-indexed lookup: every cached repo where this login appears as a contributor.
  const { data: rows, error } = await anonSupabase
    .from('repo_cache')
    .select('owner_repo, data, card_count')
    .contains('contributor_logins', [loginLower]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const ownedMap = new Map<string, number>();
  if (user) {
    const { data: owned } = await supabase
      .from('user_collections')
      .select('owner_repo, count')
      .eq('user_id', user.id)
      .ilike('contributor_login', login);
    for (const row of owned || []) {
      ownedMap.set(row.owner_repo, row.count || 0);
    }
  }

  type CardRow = {
    owner_repo: string;
    card_num: number;
    total_cards: number;
    contributor: Record<string, unknown>;
    owned_count: number;
  };
  const cards: CardRow[] = [];
  for (const row of rows || []) {
    if (!Array.isArray(row.data)) continue;
    const rankedData = withCompetitionRankScores(row.data);
    const idx = rankedData.findIndex(
      (c: { login?: string }) => c?.login && c.login.toLowerCase() === loginLower
    );
    if (idx < 0) continue;
    cards.push({
      owner_repo: row.owner_repo,
      card_num: idx + 1,
      total_cards: row.card_count || row.data.length,
      contributor: rankedData[idx],
      owned_count: ownedMap.get(row.owner_repo) || 0,
    });
  }

  cards.sort(
    (a, b) =>
      ((b.contributor.power as number) || 0) - ((a.contributor.power as number) || 0)
  );

  // Pull a canonical login + avatar from any card so the page header matches GitHub case.
  const sample = cards[0]?.contributor;
  const meta = sample
    ? { login: sample.login as string, avatar: (sample.avatar as string | null) ?? null }
    : { login, avatar: null };

  return NextResponse.json(
    { meta, cards, viewer_authenticated: !!user },
    {
      headers: {
        'Cache-Control': user
          ? 'private, no-cache'
          : 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  );
}

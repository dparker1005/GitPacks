import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../../lib/supabase-server';

// GET: Load user's collection for a repo
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const { data, error } = await supabase
    .from('user_collections')
    .select('login, count')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Convert to { login: count } map
  const collection: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    collection[row.login] = row.count;
  });

  return NextResponse.json(collection);
}

// POST: Save cards from a pack opening
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const body = await request.json();
  const cards: string[] = body.cards; // Array of login strings

  if (!Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: 'No cards provided' }, { status: 400 });
  }

  // Upsert each card (increment count)
  for (const login of cards) {
    const { data: existing } = await supabase
      .from('user_collections')
      .select('count')
      .eq('user_id', user.id)
      .eq('owner_repo', ownerRepo)
      .eq('login', login)
      .single();

    if (existing) {
      await supabase
        .from('user_collections')
        .update({ count: existing.count + 1 })
        .eq('user_id', user.id)
        .eq('owner_repo', ownerRepo)
        .eq('login', login);
    } else {
      await supabase
        .from('user_collections')
        .insert({ user_id: user.id, owner_repo: ownerRepo, login, count: 1 });
    }
  }

  return NextResponse.json({ ok: true });
}

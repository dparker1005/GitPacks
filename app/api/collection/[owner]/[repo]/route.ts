import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { addCards } from '@/app/lib/collection';

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
    .select('contributor_login, count')
    .eq('user_id', user.id)
    .eq('owner_repo', ownerRepo);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const collection: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    collection[row.contributor_login] = row.count;
  });

  return NextResponse.json(collection);
}

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
  const cards: string[] = body.cards;

  if (!Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: 'No cards provided' }, { status: 400 });
  }

  const { error } = await addCards(supabase, user.id, ownerRepo, cards);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

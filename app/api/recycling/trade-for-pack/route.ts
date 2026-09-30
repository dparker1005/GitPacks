import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';

const TRADE_COST = 100;

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { owner_repo } = body;
    if (!owner_repo) {
      return NextResponse.json({ error: 'Missing owner_repo' }, { status: 400 });
    }

    const { data: result, error: rpcError } = await getSupabaseAdmin().rpc('trade_stars_for_pack', {
      p_user_id: user.id,
      p_owner_repo: owner_repo.toLowerCase(),
      p_cost: TRADE_COST,
    });

    if (rpcError) {
      return NextResponse.json({ error: 'Trade failed', detail: rpcError.message }, { status: 500 });
    }

    const row = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: row?.success ?? false,
      newBalance: row?.new_balance ?? 0,
      newBonusPacks: row?.new_bonus_packs ?? 0,
      cost: TRADE_COST,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

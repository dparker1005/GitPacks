import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';

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

    const { entryId } = body;
    if (!entryId) {
      return NextResponse.json({ error: 'Missing entryId' }, { status: 400 });
    }

    const { data: result, error: rpcError } = await getSupabaseAdmin().rpc('claim_sprint_reward', {
      p_user_id: user.id,
      p_entry_id: entryId,
    });

    if (rpcError) {
      return NextResponse.json({ error: 'Failed to claim', detail: rpcError.message }, { status: 500 });
    }

    const row = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: row?.success ?? false,
      newBonusPacks: row?.new_bonus_packs ?? 0,
      packsAwarded: row?.packs_awarded ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

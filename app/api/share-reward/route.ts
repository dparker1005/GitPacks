import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getSupabaseAdmin } from '@/app/lib/supabase-admin';

export async function POST() {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: result, error: rpcError } = await getSupabaseAdmin().rpc('claim_share_reward', {
      p_user_id: user.id,
    });

    if (rpcError) {
      return NextResponse.json({ error: 'Failed to claim reward', detail: rpcError.message }, { status: 500 });
    }

    const row = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: row?.success ?? false,
      newBonusPacks: row?.new_bonus_packs ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

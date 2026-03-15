import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getOrCreateProfile } from '@/app/lib/profile';
import { REGEN_INTERVAL_MS, MAX_PACKS, calculateRegen } from '@/app/lib/constants';

export async function GET() {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated', detail: authError?.message }, { status: 401 });
    }

    const profile = await getOrCreateProfile(supabase, user, 'ready_packs, last_regen_at');
    if (!profile) {
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    const regen = calculateRegen(
      profile.ready_packs,
      new Date(profile.last_regen_at).getTime()
    );

    if (regen.updated) {
      await supabase
        .from('profiles')
        .update({ ready_packs: regen.readyPacks, last_regen_at: new Date(regen.lastRegenAt).toISOString() })
        .eq('id', user.id);
    }

    const nextRegenAt = regen.readyPacks < MAX_PACKS
      ? regen.lastRegenAt + REGEN_INTERVAL_MS
      : null;

    return NextResponse.json({
      readyPacks: regen.readyPacks,
      maxPacks: MAX_PACKS,
      nextRegenAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

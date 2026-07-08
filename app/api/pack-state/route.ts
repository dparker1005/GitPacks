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

    const profile = await getOrCreateProfile(supabase, user, 'ready_packs, bonus_packs, last_regen_at, created_at, last_seen_at');
    if (!profile) {
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    const regen = calculateRegen(
      profile.ready_packs,
      new Date(profile.last_regen_at).getTime()
    );

    // Touch last_seen_at at most once per hour. Every logged-in session loads
    // pack state, so this is the reliable "who still plays?" signal
    // (auth.users.last_sign_in_at goes stale on long-lived sessions).
    const updates: Record<string, any> = {};
    if (regen.updated) {
      updates.ready_packs = regen.readyPacks;
      updates.last_regen_at = new Date(regen.lastRegenAt).toISOString();
    }
    if (!profile.last_seen_at || Date.now() - new Date(profile.last_seen_at).getTime() > 3600_000) {
      updates.last_seen_at = new Date().toISOString();
    }
    if (Object.keys(updates).length) {
      await supabase.from('profiles').update(updates).eq('id', user.id);
    }

    const nextRegenAt = regen.readyPacks < MAX_PACKS
      ? regen.lastRegenAt + REGEN_INTERVAL_MS
      : null;

    const isNewUser = (Date.now() - new Date(profile.last_regen_at).getTime()) < 60000
      && profile.bonus_packs >= 10;

    return NextResponse.json({
      readyPacks: regen.readyPacks,
      bonusPacks: profile.bonus_packs,
      maxPacks: MAX_PACKS,
      nextRegenAt,
      isNewUser,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

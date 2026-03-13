import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../lib/supabase-server';

const REGEN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_PACKS = 2;

export async function GET() {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated', detail: authError?.message }, { status: 401 });
    }

    let { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('ready_packs, last_regen_at')
      .eq('id', user.id)
      .single();

    if (!profile) {
      // Auto-create profile
      const meta = user.user_metadata || {};
      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: user.id,
        github_username: meta.user_name || meta.preferred_username || '',
        avatar_url: meta.avatar_url || '',
        ready_packs: 10,
      }, { onConflict: 'id', ignoreDuplicates: true });

      if (upsertError) {
        return NextResponse.json({
          error: 'Profile creation failed',
          detail: upsertError.message,
          code: upsertError.code,
          userId: user.id,
        }, { status: 500 });
      }

      const { data: newProfile, error: refetchError } = await supabase
        .from('profiles')
        .select('ready_packs, last_regen_at')
        .eq('id', user.id)
        .single();

      if (!newProfile) {
        return NextResponse.json({
          error: 'Profile created but fetch failed',
          detail: refetchError?.message,
          profileError: profileError?.message,
          userId: user.id,
        }, { status: 500 });
      }
      profile = newProfile;
    }

    let readyPacks = profile.ready_packs;
    let lastRegenAt = new Date(profile.last_regen_at).getTime();
    let updated = false;

    // Only regen if below MAX_PACKS (don't touch starter/bonus packs above cap)
    if (readyPacks < MAX_PACKS) {
      while (readyPacks < MAX_PACKS) {
        const elapsed = Date.now() - lastRegenAt;
        if (elapsed >= REGEN_INTERVAL_MS) {
          readyPacks++;
          lastRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
          updated = true;
        } else {
          break;
        }
      }
      if (updated) {
        await supabase
          .from('profiles')
          .update({ ready_packs: readyPacks, last_regen_at: new Date(lastRegenAt).toISOString() })
          .eq('id', user.id);
      }
    }

    let nextRegenAt: number | null = null;
    if (readyPacks < MAX_PACKS) {
      nextRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
    }

    return NextResponse.json({
      readyPacks,
      maxPacks: MAX_PACKS,
      nextRegenAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

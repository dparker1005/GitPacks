import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../lib/supabase-server';

const REGEN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_PACKS = 2;

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let { data: profile } = await supabase
    .from('profiles')
    .select('ready_packs, last_regen_at')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // Auto-create profile
    const meta = user.user_metadata || {};
    await supabase.from('profiles').upsert({
      id: user.id,
      github_username: meta.user_name || meta.preferred_username || '',
      avatar_url: meta.avatar_url || '',
    }, { onConflict: 'id' });
    const { data: newProfile } = await supabase
      .from('profiles')
      .select('ready_packs, last_regen_at')
      .eq('id', user.id)
      .single();
    profile = newProfile;
    if (!profile) {
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }
  }

  let readyPacks = profile.ready_packs;
  let lastRegenAt = new Date(profile.last_regen_at).getTime();
  let updated = false;

  // Compute regen: if below max, check timer
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

  // Cap and persist if changed
  if (readyPacks > MAX_PACKS) readyPacks = MAX_PACKS;
  if (updated) {
    await supabase
      .from('profiles')
      .update({ ready_packs: readyPacks, last_regen_at: new Date(lastRegenAt).toISOString() })
      .eq('id', user.id);
  }

  // Calculate next regen time
  let nextRegenAt: number | null = null;
  if (readyPacks < MAX_PACKS) {
    nextRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
  }

  return NextResponse.json({
    readyPacks,
    maxPacks: MAX_PACKS,
    nextRegenAt,
  });
}

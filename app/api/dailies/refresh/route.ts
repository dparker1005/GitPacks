import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getOrCreateProfile } from '@/app/lib/profile';
import { detectGitHubEvents, getTodayUTC, getMidnightUTC, MAX_DAILY_CLAIMS } from '@/app/lib/dailies';
import { getGitHubToken } from '@/app/lib/github-token';

export async function POST() {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const profile = await getOrCreateProfile(supabase, user, 'id, github_username');
    if (!profile?.github_username) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const todayUTC = getTodayUTC();

    // Always fresh fetch on manual refresh
    const ghToken = await getGitHubToken(supabase, user.id);
    const detected = await detectGitHubEvents(profile.github_username, ghToken);
    const lastCheckedAt = new Date().toISOString();

    await supabase
      .from('daily_detections')
      .upsert({
        user_id: user.id,
        detected_types: detected,
        check_date: todayUTC,
        last_checked_at: lastCheckedAt,
      }, { onConflict: 'user_id' });

    // Fetch today's claims
    const { data: claims } = await supabase
      .from('daily_claims')
      .select('event_type')
      .eq('user_id', user.id)
      .eq('claim_date', todayUTC);

    const claimedTypes = (claims || []).map((c: { event_type: string }) => c.event_type);

    return NextResponse.json({
      detected,
      claims: claimedTypes,
      claimsCount: claimedTypes.length,
      maxClaims: MAX_DAILY_CLAIMS,
      resetAt: getMidnightUTC(),
      lastCheckedAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

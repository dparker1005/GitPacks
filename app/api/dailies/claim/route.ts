import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { getOrCreateProfile } from '@/app/lib/profile';
import { detectGitHubEvents, ELIGIBLE_DAILY_EVENTS } from '@/app/lib/dailies';
import { getGitHubToken } from '@/app/lib/github-token';

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

    const { event_type } = body;
    if (!event_type || !ELIGIBLE_DAILY_EVENTS[event_type]) {
      return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
    }

    const profile = await getOrCreateProfile(supabase, user, 'id, github_username');
    if (!profile?.github_username) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Always do a fresh check on claim to prevent cheating
    const ghToken = await getGitHubToken(supabase, user.id);
    const detected = await detectGitHubEvents(profile.github_username, ghToken);

    if (!detected.includes(event_type)) {
      return NextResponse.json(
        { error: 'Event not detected today', detected },
        { status: 403 }
      );
    }

    // Update detection cache with fresh results
    const todayUTC = new Date().toISOString().slice(0, 10);
    await supabase
      .from('daily_detections')
      .upsert({
        user_id: user.id,
        detected_types: detected,
        check_date: todayUTC,
        last_checked_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // Atomic claim
    const { data: claimResult, error: claimError } = await supabase.rpc('claim_daily', {
      p_user_id: user.id,
      p_event_type: event_type,
    });

    if (claimError) {
      return NextResponse.json({ error: 'Failed to claim', detail: claimError.message }, { status: 500 });
    }

    const result = Array.isArray(claimResult) ? claimResult[0] : claimResult;

    return NextResponse.json({
      success: result?.success ?? false,
      newBonusPacks: result?.new_bonus_packs ?? 0,
      claimsToday: result?.claims_today ?? 0,
      detected,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

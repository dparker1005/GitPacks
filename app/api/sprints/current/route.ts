import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET() {
  try {
    const now = new Date().toISOString();

    // Get active sprints (public data)
    const { data: sprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select('id, repo_owner, repo_name, type, starts_at, ends_at')
      .lte('starts_at', now)
      .gt('ends_at', now)
      .in('type', ['daily', 'weekly']);

    if (sprintsErr) {
      return NextResponse.json({ error: sprintsErr.message }, { status: 500 });
    }

    const daily = sprints?.find((s: any) => s.type === 'daily') || null;
    const weekly = sprints?.find((s: any) => s.type === 'weekly') || null;

    // Automatic participants are stored as entries with their participation timestamp.
    const sprintIds = [daily?.id, weekly?.id].filter(Boolean);
    let participantCounts: Record<string, number> = {};

    if (sprintIds.length > 0) {
      for (const sid of sprintIds) {
        const { count } = await supabase
          .from('sprint_entries')
          .select('id', { count: 'exact', head: true })
          .eq('sprint_id', sid)
          .not('committed_at', 'is', null);
        participantCounts[sid] = count || 0;
      }
    }

    // Try to get the current user's automatically managed entries.
    let userEntries: Record<string, any> = {};
    let unclaimedCount = 0;

    try {
      const authSupabase = await getSupabaseServer();
      const { data: { user } } = await authSupabase.auth.getUser();

      if (user) {
        if (sprintIds.length > 0) {
          const { data: entries } = await authSupabase
            .from('sprint_entries')
            .select('sprint_id, card_common, card_rare, card_epic, card_legendary, card_mythic, total_power, committed_at')
            .eq('user_id', user.id)
            .in('sprint_id', sprintIds);

          if (entries) {
            for (const e of entries) {
              userEntries[e.sprint_id] = e;
            }
          }
        }

        // Check for unclaimed rewards
        const { count } = await authSupabase
          .from('sprint_entries')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('packs_claimed', false)
          .not('packs_won', 'is', null)
          .gt('packs_won', 0)
          .not('committed_at', 'is', null);

        unclaimedCount = count || 0;
      }
    } catch {
      // Not authenticated — that's fine, sprints are viewable by everyone
    }

    const formatSprint = (s: any) => s ? {
      id: s.id,
      repoOwner: s.repo_owner,
      repoName: s.repo_name,
      type: s.type,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      participants: participantCounts[s.id] || 0,
      myEntry: userEntries[s.id] ? {
        totalPower: userEntries[s.id].total_power,
        participatedAt: userEntries[s.id].committed_at,
        cardCommon: userEntries[s.id].card_common,
        cardRare: userEntries[s.id].card_rare,
        cardEpic: userEntries[s.id].card_epic,
        cardLegendary: userEntries[s.id].card_legendary,
        cardMythic: userEntries[s.id].card_mythic,
      } : null,
    } : null;

    return NextResponse.json({
      daily: formatSprint(daily),
      weekly: formatSprint(weekly),
      unclaimedCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

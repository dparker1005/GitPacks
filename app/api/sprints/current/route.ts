import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';
import { supabase, getCachedRepoData } from '@/app/lib/repo-cache';

// Best possible lineup power for a repo: fill slots top-down (mythic-or-lower
// down to common-only) with the strongest unused card, same as live scoring.
function maxLineupPower(contributors: any[]): number {
  const RARITY_IDX: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  const sorted = [...contributors].sort((a, b) => (b.power || 0) - (a.power || 0));
  const used = new Set<string>();
  let total = 0;
  for (const maxIdx of [4, 3, 2, 1, 0]) {
    const pick = sorted.find(c => !used.has(c.login) && RARITY_IDX[c.rarity] <= maxIdx);
    if (pick) { used.add(pick.login); total += pick.power || 0; }
  }
  return total;
}

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

    // Power and participant counts are derived live from collections — nothing
    // is written to sprint_entries until the sprint is finalized.
    const sprintIds = [daily?.id, weekly?.id].filter(Boolean);
    const liveStatus: Record<string, any> = {};
    const maxPower: Record<string, number> = {};
    let unclaimedCount = 0;

    // Everything below is independent — run it all in parallel
    const loadMaxPower = [daily, weekly].filter(Boolean).map(async (s: any) => {
      const data = await getCachedRepoData(`${s.repo_owner}/${s.repo_name}`);
      maxPower[s.id] = Array.isArray(data) ? maxLineupPower(data) : 0;
    });

    const loadUserState = (async () => {
      try {
        const authSupabase = await getSupabaseServer();

        await Promise.all([
          ...sprintIds.map(async (sid) => {
            const { data } = await authSupabase.rpc('sprint_live_status', { p_sprint_id: sid });
            liveStatus[sid] = Array.isArray(data) ? data[0] : data;
          }),
          (async () => {
            const { data: { user } } = await authSupabase.auth.getUser();
            if (!user) return;
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
          })(),
        ]);
      } catch {
        // Not authenticated — that's fine, sprints are viewable by everyone
      }
    })();

    await Promise.all([...loadMaxPower, loadUserState]);

    const formatSprint = (s: any) => s ? {
      id: s.id,
      repoOwner: s.repo_owner,
      repoName: s.repo_name,
      type: s.type,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      participants: liveStatus[s.id]?.participants || 0,
      myPower: liveStatus[s.id]?.total_power || 0,
      maxPower: maxPower[s.id] || 0,
      myLineup: liveStatus[s.id] ? {
        cardCommon: liveStatus[s.id].card_common,
        cardRare: liveStatus[s.id].card_rare,
        cardEpic: liveStatus[s.id].card_epic,
        cardLegendary: liveStatus[s.id].card_legendary,
        cardMythic: liveStatus[s.id].card_mythic,
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

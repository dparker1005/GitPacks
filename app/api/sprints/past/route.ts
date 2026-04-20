import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/app/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const typeParam = request.nextUrl.searchParams.get('type');
    const type = typeParam === 'weekly' ? 'weekly' : 'daily';
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '20', 10) || 20, 50);
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0;

    // List all finished sprints of this type (any user may or may not have participated)
    const { data: sprints, error: sprintsErr, count } = await supabase
      .from('sprints')
      .select('id, repo_owner, repo_name, type, starts_at, ends_at', { count: 'exact' })
      .eq('type', type)
      .lt('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sprintsErr) {
      return NextResponse.json({ error: sprintsErr.message }, { status: 500 });
    }

    const sprintIds = (sprints || []).map((s: any) => s.id);

    // Fetch user's entries for these sprints (if any)
    let userEntries: Record<string, any> = {};
    if (sprintIds.length > 0) {
      const { data: entries } = await supabase
        .from('sprint_entries')
        .select(`
          id,
          sprint_id,
          total_power,
          committed_at,
          rank,
          percentile,
          packs_won,
          packs_claimed,
          card_common,
          card_rare,
          card_epic,
          card_legendary,
          card_mythic
        `)
        .eq('user_id', user.id)
        .in('sprint_id', sprintIds);

      for (const e of entries || []) {
        userEntries[(e as any).sprint_id] = e;
      }
    }

    // Fetch participant counts per sprint (committed entries)
    const participantCounts: Record<string, number> = {};
    for (const sid of sprintIds) {
      const { count: c } = await supabase
        .from('sprint_entries')
        .select('id', { count: 'exact', head: true })
        .eq('sprint_id', sid)
        .not('committed_at', 'is', null);
      participantCounts[sid] = c || 0;
    }

    const results = (sprints || []).map((s: any) => {
      const entry = userEntries[s.id];
      return {
        sprintId: s.id,
        repoOwner: s.repo_owner,
        repoName: s.repo_name,
        type: s.type,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        participants: participantCounts[s.id] || 0,
        // User-specific fields — null/0/false when the user didn't participate
        id: entry?.id ?? null,
        totalPower: entry?.total_power ?? 0,
        committedAt: entry?.committed_at ?? null,
        rank: entry?.rank ?? null,
        percentile: entry?.percentile ?? null,
        packsWon: entry?.packs_won ?? 0,
        packsClaimed: entry?.packs_claimed ?? false,
        cardCommon: entry?.card_common ?? null,
        cardRare: entry?.card_rare ?? null,
        cardEpic: entry?.card_epic ?? null,
        cardLegendary: entry?.card_legendary ?? null,
        cardMythic: entry?.card_mythic ?? null,
      };
    });

    return NextResponse.json({
      entries: results,
      total: count || 0,
      type,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

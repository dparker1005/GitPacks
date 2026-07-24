import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/app/lib/repo-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing sprint id' }, { status: 400 });
    }

    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50, 100);
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0;

    // Verify sprint exists and is finalized
    const { data: sprint, error: sprintErr } = await supabase
      .from('sprints')
      .select('id, repo_owner, repo_name, type, starts_at, ends_at')
      .eq('id', id)
      .single();

    if (sprintErr || !sprint) {
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
    }

    if (new Date() < new Date(sprint.ends_at)) {
      return NextResponse.json({ error: 'Sprint has not ended yet' }, { status: 400 });
    }

    // Get finalized rankings for automatic participants.
    const { data: entries, error: entriesErr, count } = await supabase
      .from('sprint_entries')
      .select(`
        rank,
        total_power,
        percentile,
        packs_won,
        profiles(github_username, avatar_url)
      `, { count: 'exact' })
      .eq('sprint_id', id)
      .not('committed_at', 'is', null)
      .not('rank', 'is', null)
      .order('rank', { ascending: true })
      .range(offset, offset + limit - 1);

    if (entriesErr) {
      return NextResponse.json({ error: entriesErr.message }, { status: 500 });
    }

    const rows = (entries || []).map((e: any) => ({
      rank: e.rank,
      githubUsername: e.profiles?.github_username || '',
      avatarUrl: e.profiles?.avatar_url || '',
      totalPower: e.total_power,
      percentile: e.percentile,
      packsWon: e.packs_won,
    }));

    return NextResponse.json({
      sprint: {
        id: sprint.id,
        repoOwner: sprint.repo_owner,
        repoName: sprint.repo_name,
        type: sprint.type,
        startsAt: sprint.starts_at,
        endsAt: sprint.ends_at,
      },
      entries: rows,
      total: count || 0,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

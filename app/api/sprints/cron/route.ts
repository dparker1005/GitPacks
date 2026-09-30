import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { triggerFullRefresh } from '@/app/lib/refresh-coordinator';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getServiceSupabase();
    const results: string[] = [];
    const now = new Date();
    const newSprintIds: string[] = [];

    // 1. Finalize recently ended sprints (within last 48h to avoid scanning all history)
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const { data: endedSprints } = await supabase
      .from('sprints')
      .select('id, type, repo_owner, repo_name')
      .lt('ends_at', now.toISOString())
      .gt('ends_at', cutoff);

    if (endedSprints) {
      for (const sprint of endedSprints) {
        // Check if already finalized (has any ranked entries)
        const { count } = await supabase
          .from('sprint_entries')
          .select('id', { count: 'exact', head: true })
          .eq('sprint_id', sprint.id)
          .not('rank', 'is', null);

        if (count === 0) {
          const { error } = await supabase.rpc('finalize_sprint', { p_sprint_id: sprint.id });
          if (error) {
            results.push(`finalize ${sprint.type} ${sprint.repo_owner}/${sprint.repo_name}: ERROR ${error.message}`);
          } else {
            results.push(`finalize ${sprint.type} ${sprint.repo_owner}/${sprint.repo_name}: OK`);
          }
        }
      }
    }

    // 2. Create new daily sprint if none is active
    const { data: activeDaily } = await supabase
      .from('sprints')
      .select('id')
      .eq('type', 'daily')
      .lte('starts_at', now.toISOString())
      .gt('ends_at', now.toISOString())
      .limit(1);

    if (!activeDaily || activeDaily.length === 0) {
      // Daily sprint: starts now, ends at next midnight UTC
      const nextMidnight = new Date(now);
      nextMidnight.setUTCHours(24, 0, 0, 0);

      const { data: newId, error } = await supabase.rpc('create_sprint', {
        p_type: 'daily',
        p_starts_at: now.toISOString(),
        p_ends_at: nextMidnight.toISOString(),
      });

      if (error) {
        results.push(`create daily: ERROR ${error.message}`);
      } else if (newId) {
        results.push(`create daily: OK (${newId})`);
        newSprintIds.push(newId);
      } else {
        results.push('create daily: no eligible repo found');
      }
    } else {
      results.push('create daily: already active');
    }

    // 3. Create new weekly sprint if none is active
    const { data: activeWeekly } = await supabase
      .from('sprints')
      .select('id')
      .eq('type', 'weekly')
      .lte('starts_at', now.toISOString())
      .gt('ends_at', now.toISOString())
      .limit(1);

    if (!activeWeekly || activeWeekly.length === 0) {
      // Weekly sprint: starts now, ends next Monday midnight UTC
      const nextMonday = new Date(now);
      const dayOfWeek = nextMonday.getUTCDay(); // 0=Sun, 1=Mon, ...
      const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
      nextMonday.setUTCHours(0, 0, 0, 0);

      const { data: newId, error } = await supabase.rpc('create_sprint', {
        p_type: 'weekly',
        p_starts_at: now.toISOString(),
        p_ends_at: nextMonday.toISOString(),
      });

      if (error) {
        results.push(`create weekly: ERROR ${error.message}`);
      } else if (newId) {
        results.push(`create weekly: OK (${newId})`);
        newSprintIds.push(newId);
      } else {
        results.push('create weekly: no eligible repo found');
      }
    } else {
      results.push('create weekly: already active');
    }

    // 4. Pull fresh GitHub data for newly featured repos so the sprint is
    // scored on current contributor stats rather than an old cache row.
    if (newSprintIds.length > 0) {
      const { data: newSprints } = await supabase
        .from('sprints')
        .select('repo_owner, repo_name')
        .in('id', newSprintIds);
      const origin = request.nextUrl.origin;
      await Promise.all((newSprints || []).map(async (s: any) => {
        await triggerFullRefresh(origin, s.repo_owner, s.repo_name);
        results.push(`refresh ${s.repo_owner}/${s.repo_name}: done`);
      }));
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: 'Unexpected error', detail: e?.message }, { status: 500 });
  }
}

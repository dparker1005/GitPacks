import { NextRequest, NextResponse } from 'next/server';

const WARM_SECRET = process.env.WARM_SECRET;

// /api/repo/[owner]/[repo] streams NDJSON. The warmer doesn't care about
// progress — only the final `done` event (or an `error` if the stream
// surfaces one). Read line-by-line, pick the last result.
async function consumeRepoStream(url: string): Promise<{ ok: true; cards: number } | { ok: false; status: number; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'fetch failed' };
  }
  if (!res.ok || !res.body) {
    let msg = `Repo fetch failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* non-JSON */ }
    return { ok: false, status: res.status, message: msg };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: any = null;
  let error: { code?: string; message: string } | null = null;

  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.stage === 'done') done = event;
      else if (event.stage === 'error') error = { code: event.code, message: event.message };
    }
  }

  if (error) return { ok: false, status: 502, message: error.message };
  if (!done) return { ok: false, status: 502, message: 'Stream ended without result' };
  return { ok: true, cards: Array.isArray(done.data) ? done.data.length : 0 };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const auth = request.headers.get('authorization');
  if (!WARM_SECRET || auth !== `Bearer ${WARM_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { owner, repo } = await params;
  const origin = request.nextUrl.origin;

  const result = await consumeRepoStream(`${origin}/api/repo/${owner}/${repo}`);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status || 500 });
  }
  return NextResponse.json({ ok: true, cards: result.cards });
}

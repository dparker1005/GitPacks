import { Resvg } from '@resvg/resvg-js';
import { buildCardSvg, fetchAvatarBase64 } from '@/app/lib/card-svg';

export const maxDuration = 10;

async function getContributor(owner: string, repo: string, login: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/repo_cache?owner_repo=eq.${encodeURIComponent(ownerRepo)}&select=data`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length || !Array.isArray(rows[0].data)) return null;

  const all = rows[0].data;
  const contributor = all.find((c: any) => c.login.toLowerCase() === login.toLowerCase());
  if (!contributor) return null;
  return { contributor, cardNum: all.indexOf(contributor) + 1, total: all.length };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;
  const result = await getContributor(owner, repo, login);
  if (!result) return new Response('Card not found', { status: 404 });

  const { contributor, cardNum, total } = result;
  const repoName = `${owner}/${repo}`;

  // Fetch avatar and convert to base64 for embedding
  const avatarDataUri = await fetchAvatarBase64(contributor.avatar);

  const url = new URL(request.url);
  const format = url.searchParams.get('format');

  if (format === 'png') {
    const svg = buildCardSvg(contributor, cardNum, total, repoName, avatarDataUri, { animated: false });
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 960 },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    return new Response(new Uint8Array(pngBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  }

  // Default: animated SVG
  const svg = buildCardSvg(contributor, cardNum, total, repoName, avatarDataUri, { animated: true });
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}

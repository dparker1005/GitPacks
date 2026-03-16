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
    const og = url.searchParams.get('og') === '1';

    if (og) {
      // OG preview: 1200x630 landscape with card centered on branded background
      const cardSvg = buildCardSvg(contributor, cardNum, total, repoName, avatarDataUri, { animated: false });
      const cardResvg = new Resvg(cardSvg, { fitTo: { mode: 'height', value: 570 } });
      const cardPng = cardResvg.render();
      const cardBase64 = Buffer.from(cardPng.asPng()).toString('base64');
      const cardW = Math.round(570 * 480 / 720); // maintain 2:3 aspect = 380
      const cardX = Math.round((1200 - cardW) / 2);

      const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a0a1a" />
            <stop offset="100%" stop-color="#0f0f2a" />
          </linearGradient>
          <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#7873f5" />
            <stop offset="100%" stop-color="#4adede" />
          </linearGradient>
          <radialGradient id="cardGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#7873f5" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#7873f5" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="630" fill="url(#bg)" />
        <ellipse cx="600" cy="315" rx="400" ry="300" fill="url(#cardGlow)" />
        <image href="data:image/png;base64,${cardBase64}" x="${cardX}" y="30" width="${cardW}" height="570" />
        <text x="600" y="624" fill="url(#glow)" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" letter-spacing="3" opacity="0.6">GITPACKS.COM</text>
      </svg>`;

      const ogResvg = new Resvg(ogSvg, { fitTo: { mode: 'width', value: 1200 } });
      const ogPng = ogResvg.render();
      return new Response(new Uint8Array(ogPng.asPng()), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    }

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

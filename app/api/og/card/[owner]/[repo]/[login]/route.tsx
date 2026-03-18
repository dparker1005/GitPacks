import { Resvg } from '@resvg/resvg-js';
import { buildCardSvg, fetchAvatarBase64 } from '@/app/lib/card-svg';
import fs from 'fs';
import path from 'path';

export const maxDuration = 10;

const fontDir = path.join(process.cwd(), 'app/lib/fonts');
const _fontTrace = [
  fs.readFileSync(path.join(fontDir, 'Orbitron.ttf')),
  fs.readFileSync(path.join(fontDir, 'Rajdhani-Bold.ttf')),
  fs.readFileSync(path.join(fontDir, 'Rajdhani-Medium.ttf')),
];
const fontOpts = {
  fontFiles: [
    path.join(fontDir, 'Orbitron.ttf'),
    path.join(fontDir, 'Rajdhani-Bold.ttf'),
    path.join(fontDir, 'Rajdhani-Medium.ttf'),
  ],
  loadSystemFonts: false,
  defaultFontFamily: 'Rajdhani',
};

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
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;
  const result = await getContributor(owner, repo, login);
  if (!result) return new Response('Card not found', { status: 404 });

  const { contributor, cardNum, total } = result;
  const repoName = `${owner}/${repo}`;

  const avatarDataUri = await fetchAvatarBase64(contributor.avatar);
  const cardSvg = buildCardSvg(contributor, cardNum, total, repoName, avatarDataUri, { animated: false });
  const cardResvg = new Resvg(cardSvg, { fitTo: { mode: 'height', value: 570 }, font: fontOpts });
  const cardPng = cardResvg.render();
  const cardBase64 = Buffer.from(cardPng.asPng()).toString('base64');
  const cardW = Math.round(570 * 480 / 720);
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

  const ogResvg = new Resvg(ogSvg, { fitTo: { mode: 'width', value: 1200 }, font: fontOpts });
  const ogPng = ogResvg.render();
  return new Response(new Uint8Array(ogPng.asPng()), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}

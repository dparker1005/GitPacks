import { Resvg } from '@resvg/resvg-js';
import { buildCardSvg, fetchAvatarBase64 } from '@/app/lib/card-svg';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const maxDuration = 10;

const BUCKET = 'og-images';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function getStorageClient() {
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function storagePath(owner: string, repo: string, login: string) {
  return `cards/${owner}/${repo}/${login}.png`.toLowerCase();
}

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

async function fetchEmojiBase64(emoji: string | undefined): Promise<string | null> {
  if (!emoji) return null;
  try {
    const codepoint = [...emoji].map(c => c.codePointAt(0)!.toString(16)).join('-');
    const res = await fetch(`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoint}.png`);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
  } catch {
    return null;
  }
}

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
  const filePath = storagePath(owner, repo, login);

  // Check for cached image in Supabase Storage
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}`;
  const cached = await fetch(publicUrl, { method: 'HEAD' });
  if (cached.ok) {
    return Response.redirect(publicUrl, 302);
  }

  const result = await getContributor(owner, repo, login);
  if (!result) return new Response('Card not found', { status: 404 });

  const { contributor, cardNum, total } = result;
  const repoName = `${owner}/${repo}`;

  // Fetch avatar (smaller 200px) and emoji icon in parallel
  const avatarSmall = contributor.avatar + (contributor.avatar.includes('?') ? '&' : '?') + 's=200';
  const [avatarDataUri, emojiDataUri] = await Promise.all([
    fetchAvatarBase64(avatarSmall),
    fetchEmojiBase64(contributor.ability?.icon),
  ]);
  const cardSvg = buildCardSvg(contributor, cardNum, total, repoName, avatarDataUri, { animated: false });

  // Replace emoji <text> with Twemoji <image> so resvg can render it
  let processedCardSvg = cardSvg;
  if (emojiDataUri) {
    processedCardSvg = processedCardSvg.replace(
      /<text x="52" y="(\d+)" font-size="22" text-anchor="middle">[^<]*<\/text>/,
      `<image href="${emojiDataUri}" x="40" y="$1" width="22" height="22" transform="translate(0, -18)" />`
    );
  }

  // Nest the card SVG directly inside the OG SVG (single resvg render instead of two)
  const cardW = Math.round(570 * 480 / 720);
  const cardX = Math.round((1200 - cardW) / 2);
  const cardSvgInner = processedCardSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="og_bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0a0a1a" />
        <stop offset="100%" stop-color="#0f0f2a" />
      </linearGradient>
      <linearGradient id="og_glow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7873f5" />
        <stop offset="100%" stop-color="#4adede" />
      </linearGradient>
      <radialGradient id="og_cardGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#7873f5" stop-opacity="0.15" />
        <stop offset="100%" stop-color="#7873f5" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#og_bg)" />
    <ellipse cx="600" cy="315" rx="400" ry="300" fill="url(#og_cardGlow)" />
    <svg x="${cardX}" y="30" width="${cardW}" height="570" viewBox="0 0 480 720">${cardSvgInner}</svg>
    <text x="600" y="624" fill="url(#og_glow)" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" letter-spacing="3" opacity="0.6">GITPACKS.COM</text>
  </svg>`;

  const ogResvg = new Resvg(ogSvg, { fitTo: { mode: 'width', value: 1200 }, font: fontOpts });
  const ogPng = ogResvg.render();
  const pngBuffer = ogPng.asPng();

  // Upload to Supabase Storage (fire-and-forget, don't block response)
  const supabase = getStorageClient();
  supabase.storage.from(BUCKET).upload(filePath, pngBuffer, {
    contentType: 'image/png',
    upsert: true,
  }).catch(() => {});

  return new Response(new Uint8Array(pngBuffer), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': pngBuffer.length.toString(),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      'Vary': 'Accept-Encoding',
    },
  });
}

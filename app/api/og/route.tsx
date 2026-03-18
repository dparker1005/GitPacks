import { Resvg } from '@resvg/resvg-js';
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

const rarities = [
  { label: 'COMMON', color: '#888888', border: '#555555', glow: 'rgba(136,136,136,0.15)' },
  { label: 'RARE', color: '#60a5fa', border: '#3b82f6', glow: 'rgba(59,130,246,0.15)' },
  { label: 'EPIC', color: '#c084fc', border: '#a855f7', glow: 'rgba(168,85,247,0.15)' },
  { label: 'LEGENDARY', color: '#ffd700', border: '#ffc800', glow: 'rgba(255,215,0,0.15)' },
  { label: 'MYTHIC', color: '#ff0040', border: '#ff0040', glow: 'rgba(255,0,64,0.2)' },
];

function buildOgSvg(): string {
  const W = 1200;
  const H = 630;

  // Card dimensions and positioning
  const cardW = 120;
  const cardH = 160;
  const cardGap = 20;
  const totalCardsW = rarities.length * cardW + (rarities.length - 1) * cardGap;
  const cardsStartX = (W - totalCardsW) / 2;
  const cardsY = 320;

  const cards = rarities.map((r, i) => {
    const x = cardsStartX + i * (cardW + cardGap);
    const cx = x + cardW / 2;
    return `
      <!-- ${r.label} card -->
      <rect x="${x}" y="${cardsY}" width="${cardW}" height="${cardH}" rx="12" fill="rgba(20,20,40,0.9)" stroke="${r.border}" stroke-width="1.5" stroke-opacity="0.5" />
      <circle cx="${cx}" cy="${cardsY + 55}" r="26" fill="none" stroke="${r.border}" stroke-width="1.5" stroke-opacity="0.4" />
      <circle cx="${cx}" cy="${cardsY + 55}" r="16" fill="${r.glow}" />
      <text x="${cx}" y="${cardsY + 110}" font-family="Orbitron" font-size="8" font-weight="700" fill="${r.color}" text-anchor="middle" letter-spacing="1.5">${r.label}</text>
      <rect x="${x + 30}" y="${cardsY + 125}" width="${cardW - 60}" height="3" rx="1.5" fill="${r.border}" fill-opacity="0.4" />
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0a0a1a" />
        <stop offset="50%" stop-color="#0f0f2a" />
        <stop offset="100%" stop-color="#0a0a1a" />
      </linearGradient>
      <linearGradient id="title-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#7873f5" />
        <stop offset="100%" stop-color="#4adede" />
      </linearGradient>
      <linearGradient id="accent-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7873f5" />
        <stop offset="100%" stop-color="#4adede" />
      </linearGradient>
      <radialGradient id="glow1" cx="30%" cy="40%" r="50%">
        <stop offset="0%" stop-color="#7873f5" stop-opacity="0.08" />
        <stop offset="100%" stop-color="#7873f5" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="glow2" cx="70%" cy="60%" r="50%">
        <stop offset="0%" stop-color="#4adede" stop-opacity="0.06" />
        <stop offset="100%" stop-color="#4adede" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- Background -->
    <rect width="${W}" height="${H}" fill="url(#bg)" />
    <rect width="${W}" height="${H}" fill="url(#glow1)" />
    <rect width="${W}" height="${H}" fill="url(#glow2)" />

    <!-- Logo icon (stacked cards) -->
    <g transform="translate(${W / 2 - 260}, 95)">
      <rect x="0" y="0" width="36" height="52" rx="6" fill="none" stroke="url(#accent-grad)" stroke-width="2" opacity="0.3" transform="rotate(-6 18 26)" />
      <rect x="8" y="2" width="36" height="52" rx="6" fill="none" stroke="url(#accent-grad)" stroke-width="2" opacity="0.6" transform="rotate(3 26 28)" />
      <rect x="4" y="1" width="36" height="52" rx="6" fill="none" stroke="url(#accent-grad)" stroke-width="2.5" />
      <text x="22" y="36" font-family="Orbitron" font-weight="900" font-size="28" fill="url(#accent-grad)" text-anchor="middle">G</text>
    </g>

    <!-- Title -->
    <text x="${W / 2}" y="148" font-family="Orbitron" font-size="64" font-weight="900" fill="url(#title-grad)" text-anchor="middle" letter-spacing="4">GITPACKS</text>

    <!-- Beta tag -->
    <g transform="translate(${W / 2 + 270}, 118)">
      <rect width="52" height="18" rx="4" fill="rgba(120,115,245,0.15)" stroke="rgba(120,115,245,0.3)" stroke-width="1" />
      <text x="26" y="13" font-family="Orbitron" font-size="7" font-weight="700" fill="#7873f5" text-anchor="middle" letter-spacing="2">BETA</text>
    </g>

    <!-- Tagline -->
    <text x="${W / 2}" y="200" font-family="Rajdhani" font-size="28" font-weight="700" fill="#888888" text-anchor="middle" letter-spacing="1.5">Collect the contributors behind the code</text>

    <!-- Divider line -->
    <rect x="${W / 2 - 60}" y="230" width="120" height="1" rx="0.5" fill="url(#accent-grad)" fill-opacity="0.3" />

    <!-- Feature text -->
    <text x="${W / 2}" y="275" font-family="Rajdhani" font-size="18" font-weight="500" fill="#666666" text-anchor="middle" letter-spacing="1">Open packs · Discover contributors · Complete collections · Climb the leaderboard</text>

    <!-- Rarity cards -->
    ${cards}

    <!-- Bottom URL -->
    <text x="${W / 2}" y="${H - 22}" font-family="Orbitron" font-size="13" font-weight="700" fill="url(#accent-grad)" text-anchor="middle" letter-spacing="4" opacity="0.5">GITPACKS.COM</text>
  </svg>`;
}

export async function GET() {
  const svg = buildOgSvg();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: fontOpts,
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

// Shared SVG card generator — produces an animated SVG string for a contributor card

const RARITY_COLORS: Record<string, string> = {
  mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888',
};
const RARITY_BORDER_COLORS: Record<string, string[]> = {
  mythic: ['#ff0040', '#ff6600', '#ff00ff'],
  legendary: ['#ffd700', '#ff6ec7'],
  epic: ['#a855f7', '#6366f1'],
  rare: ['#3b82f6', '#06b6d4'],
  common: ['#3a3a5a', '#4a4a6a'],
};
const INNER_BG_COLORS: Record<string, [string, string, string]> = {
  mythic: ['#1a0a0a', '#200810', '#1a0508'],
  legendary: ['#1a1420', '#201530', '#150f24'],
  epic: ['#161428', '#1a1538', '#110f24'],
  rare: ['#121428', '#151a35', '#0f1224'],
  common: ['#141428', '#1a1a35', '#0f0f24'],
};
const POWER_GRAD_COLORS: Record<string, string[]> = {
  mythic: ['#ff0040', '#ff6600', '#ff00ff'],
  legendary: ['#ffd700', '#ff6ec7'],
  epic: ['#a855f7', '#6366f1'],
  rare: ['#3b82f6', '#06b6d4'],
  common: ['#555', '#777'],
};
const BADGE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  mythic: { bg: 'rgba(255,0,64,0.4)', color: '#ff0040', border: 'rgba(255,0,64,0.6)' },
  legendary: { bg: 'rgba(255,215,0,0.3)', color: '#ffd700', border: 'rgba(255,215,0,0.4)' },
  epic: { bg: 'rgba(168,85,247,0.25)', color: '#c084fc', border: 'rgba(168,85,247,0.4)' },
  rare: { bg: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: 'rgba(59,130,246,0.4)' },
  common: { bg: 'rgba(100,100,130,0.3)', color: '#888', border: 'rgba(100,100,130,0.4)' },
};

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Fetch avatar and convert to base64 data URI for embedding in SVG.
 */
export async function fetchAvatarBase64(avatarUrl: string): Promise<string> {
  try {
    const res = await fetch(avatarUrl);
    if (!res.ok) return avatarUrl; // fallback to URL
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${base64}`;
  } catch {
    return avatarUrl; // fallback to URL
  }
}

export function buildCardSvg(
  c: any,
  cardNum: number,
  total: number,
  repoName: string,
  avatarDataUri: string,
  options: { animated?: boolean } = {}
): string {
  const { animated = true } = options;
  const W = 480;
  const H = 720;
  const rc = RARITY_COLORS[c.rarity] || '#888';
  const borderColors = RARITY_BORDER_COLORS[c.rarity] || RARITY_BORDER_COLORS.common;
  const innerBg = INNER_BG_COLORS[c.rarity] || INNER_BG_COLORS.common;
  const powerColors = POWER_GRAD_COLORS[c.rarity] || POWER_GRAD_COLORS.common;
  const badge = BADGE_STYLES[c.rarity] || BADGE_STYLES.common;
  const isHighRarity = c.rarity === 'mythic' || c.rarity === 'legendary' || c.rarity === 'epic';
  const borderWidth = c.rarity === 'mythic' ? 5 : c.rarity === 'common' ? 2 : 3;

  const stats = [
    { label: 'Commits', value: fmt(c.commits), color: rc },
    { label: 'PRs Merged', value: fmt(c.prsMerged), color: '#4ade80' },
    { label: 'Issues', value: fmt(c.issues), color: '#f472b6' },
    { label: 'Active Wks', value: String(c.activeWeeks), color: '#4adede' },
    { label: 'Peak Week', value: String(c.peak), color: '#c084fc' },
    { label: 'Streak', value: `${c.maxStreak}w`, color: '#facc15' },
  ];

  const animationCSS = animated ? `
    @keyframes shimmer {
      0% { opacity: 0; }
      50% { opacity: 0.06; }
      100% { opacity: 0; }
    }
    @keyframes borderGlow {
      0% { opacity: 0.85; }
      50% { opacity: 1; }
      100% { opacity: 0.85; }
    }
    @keyframes rainbowSweep {
      0% { transform: translateX(-200%) rotate(25deg); }
      100% { transform: translateX(300%) rotate(25deg); }
    }
    .border-glow { animation: borderGlow 3s ease-in-out infinite; }
    .shimmer-overlay { animation: shimmer 4s ease-in-out infinite; }
    .rainbow-sweep { animation: rainbowSweep 4s ease-in-out infinite; }
  ` : '';

  const sparklesHtml = '';

  // Rainbow sweep — a colorful diagonal band that sweeps across the card
  const rainbowSweep = isHighRarity && animated ? `
    <defs>
      <linearGradient id="rainbowGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,0,64,0)" />
        <stop offset="30%" stop-color="rgba(255,0,64,0)" />
        <stop offset="40%" stop-color="rgba(255,0,128,0.04)" />
        <stop offset="45%" stop-color="rgba(120,115,245,0.06)" />
        <stop offset="50%" stop-color="rgba(74,222,222,0.06)" />
        <stop offset="55%" stop-color="rgba(255,215,0,0.04)" />
        <stop offset="60%" stop-color="rgba(255,110,199,0.04)" />
        <stop offset="70%" stop-color="rgba(255,0,64,0)" />
        <stop offset="100%" stop-color="rgba(255,0,64,0)" />
      </linearGradient>
    </defs>
    <rect class="rainbow-sweep" x="-200" y="-200" width="400" height="${H + 400}" fill="url(#rainbowGrad)" />
  ` : '';

  // Stats grid
  const statW = 140;
  const statH = 58;
  const statGap = 12;
  const statsStartX = (W - (statW * 3 + statGap * 2)) / 2;
  const statsStartY = 406;

  const statsHtml = stats.map((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = statsStartX + col * (statW + statGap);
    const y = statsStartY + row * (statH + statGap);
    return `
      <rect x="${x}" y="${y}" width="${statW}" height="${statH}" rx="10" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
      <text x="${x + statW / 2}" y="${y + 26}" fill="${s.color}" font-family="'Orbitron',sans-serif" font-size="21" font-weight="700" text-anchor="middle">${escapeXml(s.value)}</text>
      <text x="${x + statW / 2}" y="${y + 44}" fill="#666" font-family="'Rajdhani',sans-serif" font-size="12" text-anchor="middle" letter-spacing="1">${escapeXml(s.label.toUpperCase())}</text>
    `;
  }).join('');

  // Ability section Y position
  const abilityY = statsStartY + statH * 2 + statGap + 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&amp;family=Rajdhani:wght@500;700&amp;display=swap');
    ${animationCSS}
  </style>

  <defs>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      ${borderColors.map((c, i) => `<stop offset="${i * 100 / Math.max(borderColors.length - 1, 1)}%" stop-color="${c}" />`).join('')}
    </linearGradient>
    <linearGradient id="innerBg" x1="0%" y1="0%" x2="50%" y2="100%">
      ${innerBg.map((c, i) => `<stop offset="${i * 50}%" stop-color="${c}" />`).join('')}
    </linearGradient>
    <linearGradient id="powerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      ${powerColors.map((c, i) => `<stop offset="${i * 100 / Math.max(powerColors.length - 1, 1)}%" stop-color="${c}" />`).join('')}
    </linearGradient>
    <radialGradient id="innerGlow" cx="50%" cy="0%" rx="60%" ry="40%">
      <stop offset="0%" stop-color="${rc}" stop-opacity="0.12" />
      <stop offset="70%" stop-color="${rc}" stop-opacity="0.02" />
      <stop offset="100%" stop-color="${rc}" stop-opacity="0" />
    </radialGradient>
    <clipPath id="avatarClip"><circle cx="${W / 2}" cy="230" r="50" /></clipPath>
    <clipPath id="innerClip"><rect x="${borderWidth}" y="${borderWidth}" width="${W - borderWidth * 2}" height="${H - borderWidth * 2}" rx="${18 - borderWidth}" /></clipPath>
    <filter id="avatarBlur"><feGaussianBlur stdDeviation="20" /></filter>
  </defs>

  <!-- Border -->
  <rect class="${animated ? 'border-glow' : ''}" width="${W}" height="${H}" rx="20" fill="url(#borderGrad)" />

  <!-- Inner card -->
  <rect x="${borderWidth}" y="${borderWidth}" width="${W - borderWidth * 2}" height="${H - borderWidth * 2}" rx="${18 - borderWidth}" fill="url(#innerBg)" />

  <!-- Inner glow -->
  <rect x="${borderWidth}" y="${borderWidth}" width="${W - borderWidth * 2}" height="${H - borderWidth * 2}" rx="${18 - borderWidth}" fill="url(#innerGlow)" />

  <g clip-path="url(#innerClip)">

    <!-- Blurred avatar background -->
    <image href="${escapeXml(avatarDataUri)}" x="0" y="30" width="${W}" height="200" preserveAspectRatio="xMidYMid slice" filter="url(#avatarBlur)" opacity="0.35" />

    <!-- Top fade -->
    <defs>
      <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="20%" stop-color="${innerBg[2]}" stop-opacity="0" />
        <stop offset="100%" stop-color="${innerBg[2]}" stop-opacity="1" />
      </linearGradient>
    </defs>
    <rect x="0" y="30" width="${W}" height="200" fill="url(#topFade)" />

    <!-- Shimmer -->
    <rect class="${animated ? 'shimmer-overlay' : ''}" x="0" y="0" width="${W}" height="${H}" fill="${rc}" opacity="0" />

    <!-- Repo header -->
    <rect x="${borderWidth}" y="${borderWidth}" width="${W - borderWidth * 2}" height="34" fill="rgba(0,0,0,0.7)" />
    <line x1="${borderWidth}" y1="${borderWidth + 34}" x2="${W - borderWidth}" y2="${borderWidth + 34}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="${W / 2}" y="${borderWidth + 23}" fill="rgba(255,255,255,0.7)" font-family="'Orbitron',sans-serif" font-size="11" font-weight="700" text-anchor="middle" letter-spacing="2">${escapeXml(repoName.toUpperCase())}</text>

    <!-- Title chip -->
    <rect x="18" y="52" width="${Math.min(c.title.length * 11 + 24, 300)}" height="28" rx="6" fill="rgba(0,0,0,0.65)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="30" y="70" fill="${rc}" font-family="'Orbitron',sans-serif" font-size="12" font-weight="700" letter-spacing="1.5">${escapeXml(c.title.toUpperCase())}</text>

    <!-- Rarity badge -->
    <rect x="${W - 18 - c.rarity.length * 10.5 - 24}" y="52" width="${c.rarity.length * 10.5 + 24}" height="28" rx="6" fill="${badge.bg}" stroke="${badge.border}" stroke-width="1" />
    <text x="${W - 18 - (c.rarity.length * 10.5 + 24) / 2}" y="70" fill="${badge.color}" font-family="'Orbitron',sans-serif" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="2">${escapeXml(c.rarity.toUpperCase())}</text>

    <!-- Avatar -->
    <circle cx="${W / 2}" cy="230" r="56" fill="url(#borderGrad)" />
    <circle cx="${W / 2}" cy="230" r="52" fill="${innerBg[2]}" />
    <image href="${escapeXml(avatarDataUri)}" x="${W / 2 - 50}" y="${230 - 50}" width="100" height="100" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice" />

    <!-- Name -->
    <text x="${W / 2}" y="312" fill="#fff" font-family="'Orbitron',sans-serif" font-size="24" font-weight="700" text-anchor="middle" letter-spacing="1">${escapeXml(c.login)}</text>

    <!-- Subtitle -->
    <text x="${W / 2}" y="338" fill="#888" font-family="'Rajdhani',sans-serif" font-size="19" text-anchor="middle" letter-spacing="1">${escapeXml(c.title.toUpperCase())}</text>

    <!-- Power bar -->
    <text x="${W / 2 - 130}" y="380" fill="#555" font-family="'Orbitron',sans-serif" font-size="12" letter-spacing="2">PWR</text>
    <rect x="${W / 2 - 85}" y="371" width="170" height="9" rx="4" fill="#1a1a35" />
    <rect x="${W / 2 - 85}" y="371" width="${Math.round(170 * c.power / 100)}" height="9" rx="4" fill="url(#powerGrad)" />
    <text x="${W / 2 + 130}" y="382" fill="${rc}" font-family="'Orbitron',sans-serif" font-size="20" font-weight="900" text-anchor="end">${c.power}</text>

    <!-- Stats -->
    ${statsHtml}

    <!-- Ability -->
    <rect x="24" y="${abilityY}" width="${W - 48}" height="56" rx="12" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
    <text x="52" y="${abilityY + 36}" font-size="22" text-anchor="middle">${c.ability.icon}</text>
    <text x="80" y="${abilityY + 24}" fill="${escapeXml(c.ability.color)}" font-family="'Orbitron',sans-serif" font-size="13" font-weight="700" letter-spacing="1">${escapeXml(c.ability.name)}</text>
    <text x="80" y="${abilityY + 43}" fill="#777" font-family="'Rajdhani',sans-serif" font-size="15">${escapeXml(c.ability.desc.length > 48 ? c.ability.desc.substring(0, 46) + '...' : c.ability.desc)}</text>

    <!-- Sparkles -->
    ${sparklesHtml}

    <!-- Rainbow sweep -->
    ${rainbowSweep}

  </g>

  <!-- Footer -->
  <rect x="${borderWidth}" y="${H - borderWidth - 34}" width="${W - borderWidth * 2}" height="34" fill="rgba(0,0,0,0.35)" />
  <line x1="${borderWidth}" y1="${H - borderWidth - 34}" x2="${W - borderWidth}" y2="${H - borderWidth - 34}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
  <text x="${borderWidth + 20}" y="${H - borderWidth - 12}" fill="#888" font-family="'Orbitron',sans-serif" font-size="11" letter-spacing="1.5">#${String(cardNum).padStart(3, '0')} / ${total}</text>
  <text x="${W - borderWidth - 20}" y="${H - borderWidth - 12}" fill="#7873f5" font-family="'Orbitron',sans-serif" font-size="12" font-weight="700" text-anchor="end">GitPacks</text>
</svg>`;
}

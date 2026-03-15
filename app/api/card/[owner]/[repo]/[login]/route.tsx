import { ImageResponse } from '@vercel/og';

export const runtime = 'edge';

const RARITY_COLORS: Record<string, string> = {
  mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888',
};
const RARITY_BORDER_GRADS: Record<string, string> = {
  mythic: 'linear-gradient(135deg, #ff0040, #ff6600, #ff00ff)',
  legendary: 'linear-gradient(135deg, #ffd700, #ff6ec7)',
  epic: 'linear-gradient(135deg, #a855f7, #6366f1)',
  rare: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  common: '#3a3a5a',
};
const INNER_BGS: Record<string, string> = {
  mythic: 'linear-gradient(165deg, #1a0a0a, #200810, #1a0508)',
  legendary: 'linear-gradient(165deg, #1a1420, #201530, #150f24)',
  epic: 'linear-gradient(165deg, #161428, #1a1538, #110f24)',
  rare: 'linear-gradient(165deg, #121428, #151a35, #0f1224)',
  common: 'linear-gradient(165deg, #141428, #1a1a35, #0f0f24)',
};
const INNER_GLOWS: Record<string, string> = {
  mythic: 'radial-gradient(ellipse at 50% 0%, rgba(255,0,64,0.18) 0%, rgba(255,100,0,0.06) 40%, transparent 70%)',
  legendary: 'radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.1) 0%, transparent 60%)',
  epic: 'radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.08) 0%, transparent 60%)',
  rare: 'radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.06) 0%, transparent 60%)',
  common: '',
};
const BADGE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  mythic: { bg: 'linear-gradient(135deg, rgba(255,0,64,0.4), rgba(255,100,0,0.4))', color: '#ff0040', border: 'rgba(255,0,64,0.6)' },
  legendary: { bg: 'linear-gradient(135deg, rgba(255,215,0,0.3), rgba(255,110,199,0.3))', color: '#ffd700', border: 'rgba(255,215,0,0.4)' },
  epic: { bg: 'rgba(168,85,247,0.25)', color: '#c084fc', border: 'rgba(168,85,247,0.4)' },
  rare: { bg: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: 'rgba(59,130,246,0.4)' },
  common: { bg: 'rgba(100,100,130,0.3)', color: '#888', border: 'rgba(100,100,130,0.4)' },
};
const POWER_GRADS: Record<string, string> = {
  mythic: 'linear-gradient(90deg, #ff0040, #ff6600, #ff00ff)',
  legendary: 'linear-gradient(90deg, #ffd700, #ff6ec7)',
  epic: 'linear-gradient(90deg, #a855f7, #6366f1)',
  rare: 'linear-gradient(90deg, #3b82f6, #06b6d4)',
  common: 'linear-gradient(90deg, #555, #777)',
};

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
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

const orbitronBold = fetch(
  'https://fonts.gstatic.com/s/orbitron/v35/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1ny_Cmxpg.ttf'
).then((res) => res.arrayBuffer());
const rajdhaniMedium = fetch(
  'https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pb0EMOs.ttf'
).then((res) => res.arrayBuffer());
const rajdhaniBold = fetch(
  'https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pa8FsOs.ttf'
).then((res) => res.arrayBuffer());

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;
  const result = await getContributor(owner, repo, login);
  if (!result) return new Response('Card not found', { status: 404 });

  const { contributor: c, cardNum, total } = result;
  const rc = RARITY_COLORS[c.rarity] || '#888';
  const borderGrad = RARITY_BORDER_GRADS[c.rarity] || RARITY_BORDER_GRADS.common;
  const innerBg = INNER_BGS[c.rarity] || INNER_BGS.common;
  const innerGlow = INNER_GLOWS[c.rarity] || '';
  const badge = BADGE_STYLES[c.rarity] || BADGE_STYLES.common;
  const powerGrad = POWER_GRADS[c.rarity] || POWER_GRADS.common;
  const repoName = `${owner}/${repo}`;
  // Overlay gradient fades to the dominant color of the inner background
  const overlayTargets: Record<string, string> = {
    mythic: '#1a0508', legendary: '#150f24', epic: '#110f24', rare: '#0f1224', common: '#0f0f24',
  };
  const overlayTarget = overlayTargets[c.rarity] || '#0f0f24';

  const [orbitronData, rajdhaniData, rajdhaniBoldData] = await Promise.all([orbitronBold, rajdhaniMedium, rajdhaniBold]);

  const stats = [
    { label: 'Commits', value: fmt(c.commits), color: rc },
    { label: 'PRs Merged', value: fmt(c.prsMerged), color: '#4ade80' },
    { label: 'Issues', value: fmt(c.issues), color: '#f472b6' },
    { label: 'Active Wks', value: String(c.activeWeeks), color: '#4adede' },
    { label: 'Peak Week', value: String(c.peak), color: '#c084fc' },
    { label: 'Streak', value: `${c.maxStreak}w`, color: '#facc15' },
  ];

  return new ImageResponse(
    (
      // Outer border (matches .card::before)
      <div style={{ width: '100%', height: '100%', display: 'flex', padding: c.rarity === 'mythic' ? '5px' : c.rarity === 'common' ? '2px' : '3px', background: borderGrad, borderRadius: '22px' }}>
        {/* Card inner */}
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: innerBg, borderRadius: '18px', overflow: 'hidden', position: 'relative' }}>
          {/* Inner rarity glow (matches .card-inner::before) */}
          {innerGlow && <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: innerGlow }} />}

          {/* Repo header bar (matches .card-header-repo) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 14px', fontFamily: 'Orbitron', fontSize: '10px', color: 'rgba(255,255,255,0.75)', letterSpacing: '2px', background: 'rgba(0,0,0,0.7)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {repoName.toUpperCase()}
          </div>

          {/* Top section (matches .card-top at 155px height, scaled to 200px at 480w) */}
          <div style={{ display: 'flex', position: 'relative', height: '200px' }}>
            {/* Blurred avatar background */}
            <img src={c.avatar} width={480} height={200} style={{ position: 'absolute', top: 0, left: 0, width: '480px', height: '200px', objectFit: 'cover', opacity: 0.25 }} />
            {/* Gradient overlay (matches .card-top-overlay) */}
            <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: `linear-gradient(180deg, transparent 30%, ${overlayTarget} 100%)` }} />

            {/* Title chip (matches .title-chip) */}
            <div style={{ display: 'flex', position: 'absolute', top: '38px', left: '16px', fontFamily: 'Orbitron', fontSize: '11px', fontWeight: 700, color: rc, letterSpacing: '1.5px', textTransform: 'uppercase' as const, padding: '5px 12px', borderRadius: '6px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {c.title}
            </div>

            {/* Rarity badge (matches exact rarity badge styles) */}
            <div style={{ display: 'flex', position: 'absolute', top: '38px', right: '16px', fontFamily: 'Orbitron', fontSize: '11px', fontWeight: 700, color: badge.color, letterSpacing: '2px', textTransform: 'uppercase' as const, padding: '5px 12px', borderRadius: '6px', background: badge.bg, border: `1px solid ${badge.border}` }}>
              {c.rarity}
            </div>

            {/* Avatar with rarity ring (matches .avatar-container + .avatar-ring) */}
            <div style={{ display: 'flex', position: 'absolute', bottom: '-42px', left: 0, right: 0, justifyContent: 'center' }}>
              <div style={{ display: 'flex', width: '104px', height: '104px', borderRadius: '50%', padding: '4px', background: borderGrad }}>
                <img src={c.avatar} width={96} height={96} style={{ borderRadius: '50%', border: `3px solid ${overlayTarget}` }} />
              </div>
            </div>
          </div>

          {/* Card body (matches .card-body padding) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '50px 20px 0', flex: 1 }}>
            {/* Name */}
            <div style={{ fontFamily: 'Orbitron', fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '1px' }}>
              {c.login}
            </div>
            {/* Title */}
            <div style={{ fontFamily: 'Rajdhani', fontSize: '15px', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' as const, marginTop: '2px', marginBottom: '10px' }}>
              {c.title}
            </div>

            {/* Power bar (matches .power-bar) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '12px' }}>
              <span style={{ fontFamily: 'Orbitron', fontSize: '9px', color: '#666', letterSpacing: '2px' }}>PWR</span>
              <div style={{ display: 'flex', flex: 1, height: '6px', background: '#1a1a35', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${c.power}%`, height: '100%', background: powerGrad, borderRadius: '3px' }} />
              </div>
              <span style={{ fontFamily: 'Orbitron', fontSize: '16px', fontWeight: 700, color: rc, minWidth: '32px', textAlign: 'right' as const }}>{c.power}</span>
            </div>

            {/* Stats grid (matches .stats-grid with .stat-box) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%', gap: '6px', marginBottom: '10px' }}>
              {stats.map((stat) => (
                <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '31%', padding: '7px 2px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <div style={{ fontFamily: 'Orbitron', fontSize: '16px', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontFamily: 'Rajdhani', fontSize: '9px', color: '#666', letterSpacing: '1px', textTransform: 'uppercase' as const, marginTop: '2px' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Ability (matches .ability-trait) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', background: `${c.ability.color}18`, flexShrink: 0 }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.ability.color }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: 'Orbitron', fontSize: '11px', fontWeight: 700, color: c.ability.color, letterSpacing: '1px' }}>{c.ability.name}</div>
                <div style={{ fontFamily: 'Rajdhani', fontSize: '13px', color: '#777' }}>{c.ability.desc}</div>
              </div>
            </div>
          </div>

          {/* Footer (matches .card-footer) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 16px', fontFamily: 'Orbitron', fontSize: '9px', color: '#888', letterSpacing: '1.5px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span>#{String(cardNum).padStart(3, '0')} / {total}</span>
            <span style={{ color: '#7873f5', fontWeight: 700 }}>GitPacks</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 480,
      height: 720,
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
      fonts: [
        { name: 'Orbitron', data: orbitronData, weight: 700, style: 'normal' as const },
        { name: 'Rajdhani', data: rajdhaniData, weight: 500, style: 'normal' as const },
        { name: 'Rajdhani', data: rajdhaniBoldData, weight: 700, style: 'normal' as const },
      ],
    }
  );
}

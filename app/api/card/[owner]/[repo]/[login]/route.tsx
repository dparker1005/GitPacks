import { ImageResponse } from '@vercel/og';

export const runtime = 'edge';

const RARITY_COLORS: Record<string, string> = {
  mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888',
};
const RARITY_BORDERS: Record<string, string> = {
  mythic: 'linear-gradient(135deg, #ff0040, #ff6600, #ff00ff)',
  legendary: 'linear-gradient(135deg, #ffd700, #ff6ec7)',
  epic: 'linear-gradient(135deg, #a855f7, #6366f1)',
  rare: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  common: 'linear-gradient(135deg, #3a3a5a, #4a4a6a)',
};
const RARITY_GLOWS: Record<string, string> = {
  mythic: 'radial-gradient(ellipse at 50% 30%, rgba(255,0,64,0.35) 0%, rgba(255,102,0,0.15) 40%, transparent 70%)',
  legendary: 'radial-gradient(ellipse at 50% 30%, rgba(255,215,0,0.3) 0%, rgba(255,110,199,0.12) 40%, transparent 70%)',
  epic: 'radial-gradient(ellipse at 50% 30%, rgba(168,85,247,0.25) 0%, rgba(99,102,241,0.1) 40%, transparent 70%)',
  rare: 'radial-gradient(ellipse at 50% 30%, rgba(59,130,246,0.2) 0%, rgba(6,182,212,0.08) 40%, transparent 70%)',
  common: 'radial-gradient(ellipse at 50% 30%, rgba(100,100,130,0.1) 0%, transparent 50%)',
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
  'https://fonts.gstatic.com/s/rajdhani/v17/LDIxapCSOBg7S-QT7pasEcOsc-bGkqIw.ttf'
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
  const borderGrad = RARITY_BORDERS[c.rarity] || RARITY_BORDERS.common;
  const glowBg = RARITY_GLOWS[c.rarity] || RARITY_GLOWS.common;
  const powerGrad = POWER_GRADS[c.rarity] || POWER_GRADS.common;
  const repoName = `${owner}/${repo}`;

  const [orbitronData, rajdhaniData, rajdhaniBoldData] = await Promise.all([orbitronBold, rajdhaniMedium, rajdhaniBold]);

  const stats = [
    { label: 'Commits', value: fmt(c.commits), color: rc },
    { label: 'PRs', value: fmt(c.prsMerged), color: '#4ade80' },
    { label: 'Issues', value: fmt(c.issues), color: '#f472b6' },
    { label: 'Active', value: `${c.activeWeeks}w`, color: '#4adede' },
    { label: 'Peak', value: String(c.peak), color: '#c084fc' },
    { label: 'Streak', value: `${c.maxStreak}w`, color: '#facc15' },
  ];

  return new ImageResponse(
    (
      // Outer border frame
      <div style={{ width: '100%', height: '100%', display: 'flex', padding: '4px', background: borderGrad, borderRadius: '20px' }}>
        {/* Card body */}
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0c0c20', borderRadius: '17px', overflow: 'hidden', position: 'relative' }}>

          {/* Rarity glow overlay */}
          <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: glowBg }} />

          {/* Top section: avatar bg + chips */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', height: '200px' }}>
            {/* Avatar as blurred background */}
            <img src={c.avatar} width={480} height={200} style={{ position: 'absolute', top: 0, left: 0, width: '480px', height: '200px', objectFit: 'cover', opacity: 0.15 }} />
            {/* Gradient fade */}
            <div style={{ display: 'flex', position: 'absolute', bottom: 0, left: 0, right: 0, height: '100px', background: 'linear-gradient(transparent, #0c0c20)' }} />

            {/* Repo name */}
            <div style={{ display: 'flex', padding: '10px 0 0', fontFamily: 'Orbitron', fontSize: '11px', color: '#555', letterSpacing: '2px' }}>
              {repoName}
            </div>

            {/* Title chip */}
            <div style={{ display: 'flex', position: 'absolute', top: '34px', left: '14px', fontFamily: 'Orbitron', fontSize: '11px', color: rc, background: 'rgba(0,0,0,0.7)', padding: '3px 10px', borderRadius: '5px', letterSpacing: '1px' }}>
              {c.title}
            </div>

            {/* Rarity badge */}
            <div style={{ display: 'flex', position: 'absolute', top: '34px', right: '14px', fontFamily: 'Orbitron', fontSize: '9px', fontWeight: 700, color: c.rarity === 'legendary' ? '#000' : '#fff', background: rc, padding: '3px 8px', borderRadius: '5px', letterSpacing: '2px', textTransform: 'uppercase' as const }}>
              {c.rarity}
            </div>

            {/* Avatar circle */}
            <div style={{ display: 'flex', position: 'absolute', bottom: '-36px', width: '100px', height: '100px', borderRadius: '50%', padding: '3px', background: borderGrad, boxShadow: `0 0 30px ${rc}40` }}>
              <img src={c.avatar} width={94} height={94} style={{ borderRadius: '50%' }} />
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '44px 16px 0', flex: 1, gap: '2px' }}>
            {/* Name */}
            <div style={{ fontFamily: 'Orbitron', fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '1px' }}>
              {c.login}
            </div>
            {/* Subtitle */}
            <div style={{ fontFamily: 'Rajdhani', fontSize: '14px', color: '#777', letterSpacing: '2px', textTransform: 'uppercase' as const }}>
              {c.title}
            </div>

            {/* Power bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', marginTop: '10px', padding: '0 4px' }}>
              <span style={{ fontFamily: 'Orbitron', fontSize: '9px', color: '#444', letterSpacing: '2px' }}>PWR</span>
              <div style={{ display: 'flex', flex: 1, height: '6px', background: '#1a1a3a', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${c.power}%`, height: '100%', background: powerGrad, borderRadius: '3px' }} />
              </div>
              <span style={{ fontFamily: 'Orbitron', fontSize: '13px', fontWeight: 700, color: rc }}>{c.power}</span>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%', marginTop: '8px', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {stats.map((stat) => (
                <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '33.33%', padding: '5px 2px' }}>
                  <div style={{ fontFamily: 'Rajdhani', fontSize: '18px', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontFamily: 'Rajdhani', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' as const }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Ability */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginTop: '6px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', background: `${c.ability.color}18`, flexShrink: 0 }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.ability.color }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
                <div style={{ fontFamily: 'Orbitron', fontSize: '10px', fontWeight: 700, color: c.ability.color, letterSpacing: '1px' }}>{c.ability.name}</div>
                <div style={{ fontFamily: 'Rajdhani', fontSize: '12px', color: '#777' }}>{c.ability.desc}</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', fontFamily: 'Orbitron', fontSize: '9px', color: '#333', letterSpacing: '1px' }}>
            <span>#{String(cardNum).padStart(3, '0')} / {total}</span>
            <span style={{ color: '#555' }}>gitpacks.com</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 480,
      height: 680,
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
      fonts: [
        { name: 'Orbitron', data: orbitronData, weight: 700, style: 'normal' as const },
        { name: 'Rajdhani', data: rajdhaniData, weight: 500, style: 'normal' as const },
        { name: 'Rajdhani', data: rajdhaniBoldData, weight: 700, style: 'normal' as const },
      ],
    }
  );
}

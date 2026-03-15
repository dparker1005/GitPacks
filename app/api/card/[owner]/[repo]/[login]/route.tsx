import { ImageResponse } from '@vercel/og';
import { getCachedRepo } from '@/app/lib/repo-cache';

export const runtime = 'edge';

const RARITY_COLORS: Record<string, string> = {
  mythic: '#ff0040',
  legendary: '#ffd700',
  epic: '#c084fc',
  rare: '#60a5fa',
  common: '#888',
};

const RARITY_BORDERS: Record<string, string> = {
  mythic: 'linear-gradient(135deg, #ff0040, #ff6600, #ff00ff)',
  legendary: 'linear-gradient(135deg, #ffd700, #ff6ec7)',
  epic: 'linear-gradient(135deg, #a855f7, #6366f1)',
  rare: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  common: 'linear-gradient(135deg, #3a3a5a, #4a4a6a)',
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

// Load fonts
const orbitronBold = fetch(
  'https://fonts.gstatic.com/s/orbitron/v29/yMJRMIlzdpvBhQQL_Qq7dy0.ttf'
).then((res) => res.arrayBuffer());

const rajdhani = fetch(
  'https://fonts.gstatic.com/s/rajdhani/v15/LDIoaomQNQcsA88c7O9yZ4KMCoOg4w.ttf'
).then((res) => res.arrayBuffer());

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = await getCachedRepo(cacheKey);

  if (!cached || !Array.isArray(cached)) {
    return new Response('Repo not found', { status: 404 });
  }

  const contributor = cached.find(
    (c: any) => c.login.toLowerCase() === login.toLowerCase()
  );

  if (!contributor) {
    return new Response('Contributor not found', { status: 404 });
  }

  const c = contributor;
  const rc = RARITY_COLORS[c.rarity] || '#888';
  const borderGrad = RARITY_BORDERS[c.rarity] || RARITY_BORDERS.common;
  const powerGrad = POWER_GRADS[c.rarity] || POWER_GRADS.common;
  const cardNum = cached.indexOf(contributor) + 1;
  const total = cached.length;
  const repoName = `${owner}/${repo}`;

  const [orbitronData, rajdhaniData] = await Promise.all([orbitronBold, rajdhani]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          padding: '6px',
          background: borderGrad,
          borderRadius: '24px',
        }}
      >
        {/* Card inner */}
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(180deg, #12122a 0%, #0a0a1a 100%)',
            borderRadius: '20px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Repo header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 16px 6px',
              fontFamily: 'Orbitron',
              fontSize: '14px',
              color: '#555',
              letterSpacing: '2px',
              textTransform: 'uppercase' as const,
            }}
          >
            {repoName}
          </div>

          {/* Top section with avatar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              height: '260px',
              background: `linear-gradient(180deg, ${rc}15 0%, transparent 100%)`,
            }}
          >
            {/* Title chip */}
            <div
              style={{
                display: 'flex',
                position: 'absolute',
                top: '12px',
                left: '16px',
                fontFamily: 'Orbitron',
                fontSize: '13px',
                color: rc,
                background: 'rgba(0,0,0,0.6)',
                padding: '4px 12px',
                borderRadius: '6px',
                letterSpacing: '1px',
              }}
            >
              {c.title}
            </div>

            {/* Rarity badge */}
            <div
              style={{
                display: 'flex',
                position: 'absolute',
                top: '12px',
                right: '16px',
                fontFamily: 'Orbitron',
                fontSize: '11px',
                fontWeight: 700,
                color: c.rarity === 'legendary' ? '#000' : '#fff',
                background: rc,
                padding: '4px 10px',
                borderRadius: '6px',
                letterSpacing: '2px',
                textTransform: 'uppercase' as const,
              }}
            >
              {c.rarity}
            </div>

            {/* Avatar */}
            <div
              style={{
                display: 'flex',
                position: 'absolute',
                bottom: '-40px',
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                padding: '4px',
                background: borderGrad,
              }}
            >
              <img
                src={c.avatar}
                width={112}
                height={112}
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            </div>
          </div>

          {/* Body */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '50px 20px 0',
              flex: 1,
            }}
          >
            {/* Name */}
            <div
              style={{
                fontFamily: 'Orbitron',
                fontSize: '22px',
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '1px',
              }}
            >
              {c.login}
            </div>

            {/* Title */}
            <div
              style={{
                fontFamily: 'Rajdhani',
                fontSize: '16px',
                color: '#888',
                letterSpacing: '2px',
                textTransform: 'uppercase' as const,
                marginTop: '2px',
              }}
            >
              {c.title}
            </div>

            {/* Power bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                marginTop: '14px',
                padding: '0 8px',
              }}
            >
              <span
                style={{
                  fontFamily: 'Orbitron',
                  fontSize: '10px',
                  color: '#555',
                  letterSpacing: '2px',
                }}
              >
                PWR
              </span>
              <div
                style={{
                  display: 'flex',
                  flex: 1,
                  height: '8px',
                  background: '#1a1a3a',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${c.power}%`,
                    height: '100%',
                    background: powerGrad,
                    borderRadius: '4px',
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: 'Orbitron',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: rc,
                }}
              >
                {c.power}
              </span>
            </div>

            {/* Stats grid */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                width: '100%',
                marginTop: '14px',
                gap: '0',
              }}
            >
              {[
                { label: 'Commits', value: fmt(c.commits), color: rc },
                { label: 'PRs Merged', value: fmt(c.prsMerged), color: '#4ade80' },
                { label: 'Issues', value: fmt(c.issues), color: '#f472b6' },
                { label: 'Active Wks', value: String(c.activeWeeks), color: '#4adede' },
                { label: 'Peak Week', value: String(c.peak), color: '#c084fc' },
                { label: 'Streak', value: `${c.maxStreak}w`, color: '#facc15' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: '33.33%',
                    padding: '8px 4px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'Orbitron',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: stat.color,
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    style={{
                      fontFamily: 'Rajdhani',
                      fontSize: '11px',
                      color: '#666',
                      letterSpacing: '1px',
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Ability */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                marginTop: '10px',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span style={{ fontSize: '24px' }}>{c.ability.icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    fontFamily: 'Orbitron',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: c.ability.color,
                    letterSpacing: '1px',
                  }}
                >
                  {c.ability.name}
                </div>
                <div
                  style={{
                    fontFamily: 'Rajdhani',
                    fontSize: '13px',
                    color: '#888',
                  }}
                >
                  {c.ability.desc}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              fontFamily: 'Orbitron',
              fontSize: '10px',
              color: '#444',
              letterSpacing: '1px',
            }}
          >
            <span>#{String(cardNum).padStart(3, '0')} / {total}</span>
            <span>gitpacks.vercel.app</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 480,
      height: 720,
      emoji: 'twemoji',
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
      fonts: [
        { name: 'Orbitron', data: orbitronData, weight: 700, style: 'normal' },
        { name: 'Rajdhani', data: rajdhaniData, weight: 500, style: 'normal' },
      ],
    }
  );
}

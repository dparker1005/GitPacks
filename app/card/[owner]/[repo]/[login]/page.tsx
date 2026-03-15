import type { Metadata } from 'next';
import { getCachedRepo } from '@/app/lib/repo-cache';
import { redirect } from 'next/navigation';

interface Params {
  owner: string;
  repo: string;
  login: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { owner, repo, login } = await params;
  const ogUrl = `https://gitpacks.vercel.app/api/card/${owner}/${repo}/${login}`;
  const appUrl = `https://gitpacks.vercel.app?repo=${owner}/${repo}`;

  return {
    title: `${login} — ${owner}/${repo} | GitPacks`,
    description: `${login}'s contributor card for ${owner}/${repo}. Collect the contributors behind the code.`,
    openGraph: {
      title: `${login}'s GitPacks Card`,
      description: `Contributor card for ${owner}/${repo} on GitPacks`,
      images: [{ url: ogUrl, width: 480, height: 720 }],
      url: appUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${login}'s GitPacks Card`,
      description: `Contributor card for ${owner}/${repo} on GitPacks`,
      images: [ogUrl],
    },
  };
}

export default async function CardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo, login } = await params;
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = await getCachedRepo(cacheKey);

  if (!cached || !Array.isArray(cached)) {
    redirect(`/?repo=${owner}/${repo}`);
  }

  const contributor = cached.find(
    (c: any) => c.login.toLowerCase() === login.toLowerCase()
  );

  if (!contributor) {
    redirect(`/?repo=${owner}/${repo}`);
  }

  const cardImageUrl = `/api/card/${owner}/${repo}/${login}`;
  const appUrl = `/?repo=${owner}/${repo}`;
  const shareUrl = `https://gitpacks.vercel.app/card/${owner}/${repo}/${login}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out my GitPacks card for ${owner}/${repo}!`)}&url=${encodeURIComponent(shareUrl)}`;
  const markdownSnippet = `[![${login} on ${owner}/${repo}](https://gitpacks.vercel.app/api/card/${owner}/${repo}/${login})](https://gitpacks.vercel.app?repo=${owner}/${repo})`;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        gap: '24px',
      }}
    >
      <a href={appUrl}>
        <img
          src={cardImageUrl}
          alt={`${login}'s GitPacks card for ${owner}/${repo}`}
          width={320}
          height={480}
          style={{ borderRadius: '16px', maxWidth: '100%', height: 'auto' }}
        />
      </a>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          maxWidth: '500px',
          width: '100%',
        }}
      >
        <a
          href={appUrl}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 28px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #7873f5, #4adede)',
            color: '#fff',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '0.8rem',
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase' as const,
            textDecoration: 'none',
          }}
        >
          Open on GitPacks
        </a>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener"
            style={{
              padding: '8px 20px',
              border: '1px solid #3a3a5a',
              borderRadius: '8px',
              color: '#aaa',
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '0.65rem',
              letterSpacing: '1px',
              textTransform: 'uppercase' as const,
              textDecoration: 'none',
            }}
          >
            Share on X
          </a>
        </div>

        <details
          style={{
            width: '100%',
            border: '1px solid #2a2a4a',
            borderRadius: '10px',
            padding: '0',
            background: 'rgba(20,20,40,0.6)',
          }}
        >
          <summary
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              fontFamily: 'Orbitron, sans-serif',
              fontSize: '0.6rem',
              color: '#888',
              letterSpacing: '1px',
              textTransform: 'uppercase' as const,
            }}
          >
            Embed in GitHub README
          </summary>
          <pre
            style={{
              padding: '12px 16px',
              margin: 0,
              fontSize: '0.75rem',
              color: '#4adede',
              overflowX: 'auto',
              borderTop: '1px solid #2a2a4a',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {markdownSnippet}
          </pre>
        </details>
      </div>
    </div>
  );
}

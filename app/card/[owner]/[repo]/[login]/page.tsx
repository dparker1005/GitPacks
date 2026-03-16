import type { Metadata } from 'next';
import { getCachedRepo } from '@/app/lib/repo-cache';
import { redirect } from 'next/navigation';
import CardRedirect from './CardRedirect';

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
  const ogUrl = `https://www.gitpacks.com/api/card/${owner}/${repo}/${login}?format=png`;
  const cardUrl = `https://www.gitpacks.com/card/${owner}/${repo}/${login}`;

  return {
    title: `${login} — ${owner}/${repo} | GitPacks`,
    description: `${login}'s contributor card for ${owner}/${repo}. Collect the contributors behind the code.`,
    openGraph: {
      title: `${login}'s GitPacks Card`,
      description: `Contributor card for ${owner}/${repo} on GitPacks`,
      images: [{ url: ogUrl, width: 960, height: 1440 }],
      url: cardUrl,
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

  const deepLink = `/?repo=${owner}/${repo}&card=${login}`;

  return <CardRedirect href={deepLink} />;
}

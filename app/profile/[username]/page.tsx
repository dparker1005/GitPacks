import type { Metadata } from "next";
import ProfileClient from "./ProfileClient";

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `${username} — GitPacks`,
    description: `Check out ${username}'s GitPacks collection, stats, and achievements.`,
    openGraph: {
      title: `${username} — GitPacks`,
      description: `Check out ${username}'s GitPacks collection, stats, and achievements.`,
      siteName: "GitPacks",
    },
    twitter: {
      card: "summary",
      title: `${username} — GitPacks`,
      description: `Check out ${username}'s GitPacks collection, stats, and achievements.`,
    },
  };
}

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  return <ProfileClient username={username} />;
}

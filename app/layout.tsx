import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.gitpacks.com"),
  title: "GitPacks — Collect the Contributors Behind the Code",
  description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic. Earn packs through daily tasks, referrals, and achievements.",
  openGraph: {
    title: "GitPacks — Collect the Contributors Behind the Code",
    description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic.",
    siteName: "GitPacks",
    type: "website",
    images: [{ url: "https://www.gitpacks.com/api/og", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GitPacks — Collect the Contributors Behind the Code",
    description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic.",
    images: ["https://www.gitpacks.com/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitPacks — Collect the Contributors Behind the Code",
  description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic. Earn packs through daily tasks, referrals, and achievements.",
  openGraph: {
    title: "GitPacks — Collect the Contributors Behind the Code",
    description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic.",
    siteName: "GitPacks",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "GitPacks — Collect the Contributors Behind the Code",
    description: "Open packs, discover contributors, and complete your collection for any GitHub repo. 5 rarities from Common to Mythic.",
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

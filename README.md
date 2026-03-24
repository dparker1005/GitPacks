<p align="center">
  <img src="public/images/gitpacks-logo-512.png" alt="GitPacks" width="80" />
</p>

<h1 align="center">GitPacks</h1>

<p align="center">
  Collect the contributors behind the code.
</p>

<p align="center">
  <a href="https://www.gitpacks.com">gitpacks.com</a>
</p>

---

GitPacks turns GitHub contributors into collectible cards. Pick any public repo, open packs, discover the people behind the code, and complete your collection.

Every contributor gets a card with real stats pulled from GitHub — commits, PRs merged, issues filed, streaks, and consistency. Cards are ranked across 5 rarity tiers from Common to Mythic based on contribution power.

## Features

- **5-Card Packs** — Open packs to collect contributor cards. Packs regenerate every 12 hours (2 slots).
- **Real GitHub Stats** — Cards are generated from live GitHub data: commits, PRs, issues, streaks, peak weeks, and consistency.
- **5 Rarity Tiers** — Common, Rare, Epic, Legendary, and Mythic. Rarity is determined by a contributor's relative impact within their repo.
- **Collection Completion** — Collect every contributor in a repo for a 1.5x score bonus.
- **Recycling System** — Recycle duplicates into stars. Use stars to cherry-pick specific missing cards or trade for extra packs.
- **Daily Tasks** — Earn up to 3 bonus packs per day through GitHub activity (commits, PRs, issues).
- **Sprints** — Daily and weekly competitions on featured repos. Build a 5-card lineup and compete for bonus packs.
- **Leaderboard** — Global rankings based on card points and collection bonuses.
- **Achievements** — Milestone-based rewards for contribution stats.
- **Your Own Card** — Contribute to a repo and you become a collectible card in that collection.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org) 16 (App Router) with React 19 and TypeScript
- **Database & Auth:** [Supabase](https://supabase.com) (PostgreSQL, Auth with GitHub OAuth, Storage)
- **Deployment:** [Vercel](https://vercel.com)
- **Card Rendering:** SVG with [@resvg/resvg-js](https://github.com/niconi/resvg-js) for PNG generation
- **Data Source:** [GitHub REST API](https://docs.github.com/en/rest)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [GitHub OAuth App](https://github.com/settings/developers) (configured in Supabase Auth)

### Setup

1. Clone the repo:

```bash
git clone https://github.com/dparker1005/gitpacks.git
cd gitpacks
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env.local` with your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GITHUB_TOKEN=your_github_personal_access_token
CRON_SECRET=any_secret_for_cron_auth
WARM_SECRET=any_secret_for_cache_warming
```

4. Set up the database — apply the schema and migrations from `supabase/`:

```bash
# Using Supabase CLI
supabase db push
```

5. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/
├── api/              # API routes (packs, collections, scoring, sprints, OG images)
├── card/             # Shareable card pages with OG meta tags
├── lib/              # Shared utilities (card SVG, repo cache, scoring, fonts)
├── profile/          # Public user profile pages
├── auth/             # OAuth callback handler
├── gitpacks.js       # Client-side game logic
└── page.tsx          # Landing page
supabase/
├── schema.sql        # Database schema
└── migrations/       # Incremental migrations
```

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `GITHUB_TOKEN` | GitHub PAT for API rate limits |
| `CRON_SECRET` | Secret to authenticate the daily sprints cron job |
| `WARM_SECRET` | Secret for the cache-warming endpoint |

## Deployment

GitPacks is designed to deploy on [Vercel](https://vercel.com):

1. Connect your GitHub repo to Vercel
2. Add the environment variables above
3. Deploy

The `vercel.json` includes a daily cron job for sprints that runs at midnight UTC.

## License

[MIT](LICENSE)

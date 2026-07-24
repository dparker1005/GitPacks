export type Rarity = "mythic" | "legendary" | "epic" | "rare" | "common";

export interface CardData {
  login: string;
  avatar: string;
  rarity: Rarity;
  power: number;
  title: string;
  ability: { name: string; desc: string; icon: string; color: string };
  commits: number;
  prsMerged: number;
  issues: number;
  maxStreak: number;
  peak: number;
  activeWeeks: number;
  totalWeeks: number;
  pctScores?: Record<string, number>;
  rankPctScores?: Record<string, number>;
  dominantStat?: string | null;
  firstCommitTs?: number | null;
}

export function rarityColor(r: Rarity): string {
  return (
    { mythic: "#ff0040", legendary: "#ffd700", epic: "#c084fc", rare: "#60a5fa", common: "#888" }[
      r
    ] || "#888"
  );
}

export function powerGrad(r: Rarity): string {
  return (
    {
      mythic: "linear-gradient(90deg,#ff0040,#ff6600,#ff00ff)",
      legendary: "linear-gradient(90deg,#ffd700,#ff6ec7)",
      epic: "linear-gradient(90deg,#a855f7,#6366f1)",
      rare: "linear-gradient(90deg,#3b82f6,#06b6d4)",
      common: "linear-gradient(90deg,#555,#777)",
    }[r] || "linear-gradient(90deg,#555,#777)"
  );
}

export function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toString();
}

export function buildGalleryCard(
  c: CardData,
  idx: number,
  total: number,
  repoName: string
): string {
  const rc = rarityColor(c.rarity);
  let sparklesHTML = "";
  if (c.rarity === "mythic" || c.rarity === "legendary" || c.rarity === "epic") {
    const count = c.rarity === "mythic" ? 24 : c.rarity === "legendary" ? 16 : 8;
    sparklesHTML = '<div class="card-sparkles">';
    for (let i = 0; i < count; i++) {
      sparklesHTML += `<div class="sparkle" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;--dur:${1.5 + Math.random() * 2}s;--delay:${Math.random() * 3}s"></div>`;
    }
    sparklesHTML += "</div>";
  }

  const statsHTML = `
      <div class="stat-box"><div class="stat-value" style="color:${rc}">${fmt(c.commits)}</div><div class="stat-label">Commits</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#4ade80">${fmt(c.prsMerged)}</div><div class="stat-label">PRs Merged</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#f472b6">${fmt(c.issues)}</div><div class="stat-label">Issues</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#4adede">${c.activeWeeks}</div><div class="stat-label">Active Wks</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#c084fc">${c.peak}</div><div class="stat-label">Peak Week</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#facc15">${c.maxStreak}w</div><div class="stat-label">Streak</div></div>`;

  return `<div class="card" data-rarity="${c.rarity}"><div class="card-inner"><div class="card-shine"></div><div class="card-holo"></div><div class="card-rainbow"></div>${sparklesHTML}
    <div class="card-header-repo">${repoName}</div>
    <div class="card-top"><div class="card-top-bg"><img src="${c.avatar}" alt="" loading="lazy"/></div><div class="card-top-overlay"></div>
    <div class="title-chip" style="color:${rc}">${c.title}</div>
    <div class="rarity-badge ${c.rarity}">${c.rarity}</div>
    <div class="avatar-container"><div class="avatar-ring"><img src="${c.avatar}" alt="${c.login}" loading="lazy"/></div></div></div>
    <div class="card-body"><div class="card-name">${c.login}</div>
    <div class="card-title">${c.title}</div>
    <div class="power-bar"><span class="power-label">PWR</span><div class="power-track"><div class="power-fill" style="width:${c.power}%;background:${powerGrad(c.rarity)}"></div></div><span class="power-value" style="color:${rc}">${c.power}</span></div>
    <div class="stats-grid">${statsHTML}</div>
    <div class="ability-trait">
      <span class="ability-icon">${c.ability.icon}</span>
      <div class="ability-info"><div class="ability-name" style="color:${c.ability.color}">${c.ability.name}</div><div class="ability-desc">${c.ability.desc}</div></div>
    </div>
    </div>
    <div class="card-footer"><span>#${String(idx).padStart(3, "0")} / ${total}</span><span class="card-footer-brand">GitPacks</span></div></div>
    <div class="card-total-badge">${total} in set</div></div>`;
}

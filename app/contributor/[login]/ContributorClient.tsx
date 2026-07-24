"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGalleryCard,
  fmt,
  rarityColor,
  type CardData,
  type Rarity,
} from "@/app/lib/card-html";

interface CardEntry {
  owner_repo: string;
  card_num: number;
  total_cards: number;
  owned_count: number;
  contributor: CardData;
}

interface ApiResponse {
  meta: { login: string; avatar: string | null };
  cards: CardEntry[];
  viewer_authenticated: boolean;
}

const RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "common"];

type SortKey = "power" | "rarity" | "repo" | "owned";
type OwnedFilter = "all" | "owned" | "missing";

export default function ContributorClient({ login }: { login: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterRarity, setFilterRarity] = useState<"all" | Rarity>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("power");
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>("all");
  const [openCard, setOpenCard] = useState<CardEntry | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cards-by-contributor/${encodeURIComponent(login)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Not found" : "Failed to load");
        return r.json();
      })
      .then((d: ApiResponse) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [login]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let pool = [...data.cards];
    if (filterRarity !== "all") pool = pool.filter((c) => c.contributor.rarity === filterRarity);
    if (search) {
      const q = search.toLowerCase();
      pool = pool.filter((c) => c.owner_repo.toLowerCase().includes(q));
    }
    if (ownedFilter === "owned") pool = pool.filter((c) => c.owned_count > 0);
    if (ownedFilter === "missing") pool = pool.filter((c) => c.owned_count === 0);

    const rarityRank = (r: Rarity) => RARITY_ORDER.indexOf(r);
    const sorters: Record<SortKey, (a: CardEntry, b: CardEntry) => number> = {
      power: (a, b) => b.contributor.power - a.contributor.power,
      rarity: (a, b) =>
        rarityRank(a.contributor.rarity) - rarityRank(b.contributor.rarity) ||
        b.contributor.power - a.contributor.power,
      repo: (a, b) => a.owner_repo.localeCompare(b.owner_repo),
      owned: (a, b) => b.owned_count - a.owned_count || b.contributor.power - a.contributor.power,
    };
    pool.sort(sorters[sortBy]);
    return pool;
  }, [data, filterRarity, search, sortBy, ownedFilter]);

  // Hover tilt — mirrors the library's effect from gitpacks.js renderLibrary.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onMove = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
      if (!card) return;
      const last = (card as HTMLElement & { _lastMove?: number })._lastMove;
      if (last && Date.now() - last < 16) return;
      (card as HTMLElement & { _lastMove?: number })._lastMove = Date.now();
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.04)`;
      const shine = card.querySelector(".card-shine") as HTMLElement | null;
      if (shine)
        shine.style.background = `radial-gradient(circle at ${(x + 0.5) * 100}% ${(y + 0.5) * 100}%, rgba(255,255,255,0.15) 0%, transparent 60%)`;
    };
    const onLeave = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
      if (card) card.style.transform = "";
    };
    grid.addEventListener("mousemove", onMove);
    grid.addEventListener("mouseleave", onLeave, true);
    return () => {
      grid.removeEventListener("mousemove", onMove);
      grid.removeEventListener("mouseleave", onLeave, true);
    };
  }, [filtered.length]);

  const rarityCounts = useMemo(() => {
    const counts: Record<Rarity, number> = { mythic: 0, legendary: 0, epic: 0, rare: 0, common: 0 };
    if (data) for (const c of data.cards) counts[c.contributor.rarity]++;
    return counts;
  }, [data]);

  const ownedTotals = useMemo(() => {
    if (!data) return { unique: 0, total: 0 };
    let unique = 0;
    let total = 0;
    for (const c of data.cards) {
      if (c.owned_count > 0) {
        unique++;
        total += c.owned_count;
      }
    }
    return { unique, total };
  }, [data]);

  if (loading) {
    return (
      <div className="contributor-page">
        <div className="contributor-page-inner">
          <div className="contributor-loading">Loading cards...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="contributor-page">
        <div className="contributor-page-inner">
          <div className="contributor-error">{error || "No cards found"}</div>
          <a href="/" className="profile-back-link">Back to GitPacks</a>
        </div>
      </div>
    );
  }

  const displayLogin = data.meta.login || login;
  const avatar = data.meta.avatar;
  const totalRepos = data.cards.length;

  return (
    <div className="contributor-page">
      <div className="contributor-page-inner">
      <a href="/" className="profile-back-link">← Back to GitPacks</a>

      <div className="contributor-header">
        {avatar && <img src={avatar} alt={displayLogin} className="contributor-avatar" />}
        <div className="contributor-header-info">
          <h1 className="contributor-username">{displayLogin}</h1>
          <p className="contributor-subtitle">
            {totalRepos === 0
              ? "No cards in any tracked repos yet"
              : `${totalRepos} card${totalRepos === 1 ? "" : "s"} across tracked repos`}
          </p>
        </div>
        <div className="contributor-header-links">
          <a
            href={`https://github.com/${displayLogin}`}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-gh-link"
          >
            GitHub
          </a>
          <a href={`/profile/${encodeURIComponent(displayLogin)}`} className="profile-gh-link">
            Profile
          </a>
        </div>
      </div>

      {totalRepos > 0 && (
        <>
          <div className="contributor-stats">
            <div className="profile-stat-card">
              <div className="profile-stat-value">{totalRepos}</div>
              <div className="profile-stat-label">Repos</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-value mythic-text">{rarityCounts.mythic}</div>
              <div className="profile-stat-label">Mythic</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-value legendary-text">{rarityCounts.legendary}</div>
              <div className="profile-stat-label">Legendary</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-value epic-text">{rarityCounts.epic}</div>
              <div className="profile-stat-label">Epic</div>
            </div>
            {data.viewer_authenticated && (
              <div className="profile-stat-card">
                <div className="profile-stat-value">
                  {ownedTotals.unique}/{totalRepos}
                </div>
                <div className="profile-stat-label">You Own</div>
              </div>
            )}
          </div>

          <div className="contributor-controls">
            <input
              type="text"
              className="contributor-search"
              placeholder="Filter by repo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="contributor-select"
              value={filterRarity}
              onChange={(e) => setFilterRarity(e.target.value as "all" | Rarity)}
            >
              <option value="all">All rarities</option>
              <option value="mythic">Mythic</option>
              <option value="legendary">Legendary</option>
              <option value="epic">Epic</option>
              <option value="rare">Rare</option>
              <option value="common">Common</option>
            </select>
            <select
              className="contributor-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="power">Sort: Power</option>
              <option value="rarity">Sort: Rarity</option>
              <option value="repo">Sort: Repo name</option>
              {data.viewer_authenticated && <option value="owned">Sort: Owned</option>}
            </select>
            {data.viewer_authenticated && (
              <select
                className="contributor-select"
                value={ownedFilter}
                onChange={(e) => setOwnedFilter(e.target.value as OwnedFilter)}
              >
                <option value="all">All cards</option>
                <option value="owned">Owned only</option>
                <option value="missing">Missing only</option>
              </select>
            )}
          </div>

          {filtered.length === 0 && (
            <p className="profile-empty">No cards match the current filters.</p>
          )}
        </>
      )}
      </div>

      {totalRepos > 0 && filtered.length > 0 && (
        <div id="cards-grid" ref={gridRef}>
          {filtered.map((entry) => {
            const owned = entry.owned_count > 0;
            const html = buildGalleryCard(
              entry.contributor,
              entry.card_num,
              entry.total_cards,
              entry.owner_repo
            );
            return (
              <div
                key={entry.owner_repo}
                className={`card-wrapper clickable ${owned ? "" : "ghost-card"}`}
                data-rarity={entry.contributor.rarity}
                onClick={() => setOpenCard(entry)}
              >
                <div dangerouslySetInnerHTML={{ __html: html }} />
                {data.viewer_authenticated && entry.owned_count > 1 && (
                  <div className="card-qty">x{entry.owned_count}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openCard && (
        <CardFullscreen
          key={openCard.owner_repo}
          entry={openCard}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

function CardFullscreen({ entry, onClose }: { entry: CardEntry; onClose: () => void }) {
  const c = entry.contributor;
  const cardWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const wrapper = cardWrapperRef.current;
    if (!wrapper) return;
    const card = wrapper.querySelector(".card") as HTMLElement | null;
    if (!card) return;
    const onMove = (e: MouseEvent) => {
      const r = wrapper.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 20}deg) rotateX(${-y * 20}deg)`;
      const shine = card.querySelector(".card-shine") as HTMLElement | null;
      if (shine) {
        shine.style.background = `radial-gradient(circle at ${(x + 0.5) * 100}% ${(y + 0.5) * 100}%, rgba(255,255,255,0.18) 0%, transparent 60%)`;
        shine.style.opacity = "1";
      }
    };
    const onLeave = () => {
      card.style.transform = "";
      const shine = card.querySelector(".card-shine") as HTMLElement | null;
      if (shine) shine.style.opacity = "0";
    };
    wrapper.addEventListener("mousemove", onMove);
    wrapper.addEventListener("mouseleave", onLeave);
    return () => {
      wrapper.removeEventListener("mousemove", onMove);
      wrapper.removeEventListener("mouseleave", onLeave);
    };
  }, [entry]);

  const html = useMemo(
    () => buildGalleryCard(c, entry.card_num, entry.total_cards, entry.owner_repo),
    [c, entry.card_num, entry.total_cards, entry.owner_repo]
  );
  const rc = rarityColor(c.rarity);
  const dom = c.dominantStat;
  const pct = c.pctScores || {};
  const rankPct = c.rankPctScores || pct;
  const [weeksSinceFirst] = useState(() =>
    c.firstCommitTs && isFinite(c.firstCommitTs)
      ? Math.round((Date.now() / 1000 - c.firstCommitTs) / 604800)
      : 0
  );
  const isGhost = entry.owned_count === 0;

  function statRow(
    label: string,
    value: string,
    pctVal: number | null,
    rankPctVal: number | null,
    color: string | null,
    highlight: boolean
  ) {
    const p = Math.round((pctVal || 0) * 100);
    const hl = highlight ? " fs-highlight" : "";
    const topPct = Math.max(1, Math.ceil(100 - (rankPctVal || 0) * 100));
    const pctLabel = topPct > 80 ? "Bottom 20%" : `Top ${topPct}%`;
    const hlBorder =
      highlight && color
        ? { borderBottomColor: color + "30", borderLeftColor: color }
        : undefined;
    const hlText = highlight && color ? { color } : undefined;
    return (
      <div className={`fs-stat-row${hl}`} style={hlBorder}>
        <div className="fs-stat-top">
          <span className="fs-stat-label" style={hlText}>
            {label}
          </span>
          <span className="fs-stat-value">{value}</span>
        </div>
        {pctVal != null && color && (
          <div className="fs-pct-inline">
            <div className="fs-pct-track">
              <div className="fs-pct-fill" style={{ width: `${p}%`, background: color }} />
            </div>
            <span className="fs-pct-val" style={highlight ? { color } : undefined}>
              {pctLabel}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`fullscreen-overlay ${isGhost ? "fullscreen-ghost" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fullscreen-layout" onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-close" onClick={onClose}>
          CLOSE
        </div>
        <div className="fullscreen-card-container">
          <div
            ref={cardWrapperRef}
            className="card-wrapper"
            data-rarity={c.rarity}
            style={{ opacity: 1, animation: "none" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <div className="fullscreen-stats-panel">
          <h3>Details</h3>
          {statRow(
            "Total Commits",
            `${fmt(c.commits)} commits`,
            pct.commits ?? null,
            rankPct.commits ?? null,
            rc,
            false
          )}
          {statRow(
            "PRs Merged",
            `${fmt(c.prsMerged)} PRs`,
            pct.prsMerged ?? null,
            rankPct.prsMerged ?? null,
            "#4ade80",
            dom === "prs"
          )}
          {statRow(
            "Issues",
            `${fmt(c.issues)} issues`,
            pct.issues ?? null,
            rankPct.issues ?? null,
            "#f472b6",
            dom === "issues"
          )}
          <div className="fs-stat-row">
            <div className="fs-stat-top">
              <span className="fs-stat-label">Active Weeks</span>
              <span className="fs-stat-value">
                {c.activeWeeks} <span className="fs-stat-pct">/ {c.totalWeeks}</span> weeks
              </span>
            </div>
            {pct.activeWeeks != null && (
              <div className="fs-pct-inline">
                <div className="fs-pct-track">
                  <div
                    className="fs-pct-fill"
                    style={{ width: `${Math.round(pct.activeWeeks * 100)}%`, background: "#4adede" }}
                  />
                </div>
              </div>
            )}
          </div>
          {statRow(
            "Best Streak",
            `${c.maxStreak} weeks`,
            pct.streak ?? null,
            rankPct.streak ?? null,
            "#facc15",
            dom === "streak"
          )}
          {statRow(
            "Peak Week",
            `${c.peak} commits`,
            pct.peak ?? null,
            rankPct.peak ?? null,
            "#c084fc",
            dom === "peak"
          )}
          {statRow(
            "Tenure",
            weeksSinceFirst < 52
              ? `${weeksSinceFirst}w`
              : `${Math.round((weeksSinceFirst / 52) * 10) / 10}y`,
            null,
            null,
            null,
            false
          )}
          <div className="fs-stat-row">
            <div className="fs-stat-top">
              <span className="fs-stat-label">Repo</span>
              <span className="fs-stat-value">
                <a href={`/?repo=${entry.owner_repo}`} className="fs-repo-link">
                  {entry.owner_repo}
                </a>
              </span>
            </div>
          </div>
          <div className="fs-stat-row">
            <div className="fs-stat-top">
              <span className="fs-stat-label">Owned</span>
              <span className="fs-stat-value">{entry.owned_count}x</span>
            </div>
          </div>
        </div>
      </div>
      <div className="fullscreen-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-profile-links">
          <a
            className="fullscreen-profile"
            href={`https://github.com/${c.login}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            className="fullscreen-profile"
            href={`/?repo=${entry.owner_repo}&card=${encodeURIComponent(c.login)}`}
          >
            Open in Library
          </a>
          <a
            className="fullscreen-profile"
            href={`/card/${entry.owner_repo}/${encodeURIComponent(c.login)}`}
          >
            Share Card
          </a>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/app/lib/supabase-browser";

interface Repo {
  owner_repo: string;
  total_points: number;
  base_points: number;
  completion_bonus: number;
  unique_cards: number;
  total_cards_in_repo: number;
  is_complete: boolean;
  is_insured: boolean;
  contributor_rarity: string | null;
}

interface ProfileData {
  username: string;
  avatar_url: string;
  total_points: number;
  created_at: string;
  global_rank: number;
  repos_collected: number;
  repos_completed: number;
  repos: Repo[];
}

interface CompareRepo {
  owner_repo: string;
  viewer: { cards: number; points: number };
  profile: { cards: number; points: number };
}

export default function ProfileClient({ username }: { username: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState<{ id: string; username: string } | null>(null);
  const [compareData, setCompareData] = useState<CompareRepo[]>([]);

  // Check auth
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const meta = user.user_metadata;
        setViewer({
          id: user.id,
          username: meta.user_name || meta.preferred_username || "",
        });
      }
    });
  }, []);

  // Fetch profile
  useEffect(() => {
    fetch(`/api/profile/${encodeURIComponent(username)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "User not found" : "Failed to load profile");
        return r.json();
      })
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [username]);

  // Fetch comparison data when logged in and viewing another user
  useEffect(() => {
    if (!viewer || !profile) return;
    if (viewer.username.toLowerCase() === profile.username.toLowerCase()) return;

    fetch(`/api/profile/${encodeURIComponent(username)}/compare`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.shared_repos) setCompareData(data.shared_repos);
      })
      .catch(() => {});
  }, [viewer, profile, username]);

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">Loading profile...</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="profile-page">
        <div className="profile-error">{error || "User not found"}</div>
        <a href="/" className="profile-back-link">Back to GitPacks</a>
      </div>
    );
  }

  const joinDate = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function rarityBadge(repo: Repo) {
    if (!repo.contributor_rarity) return null;
    return (
      <a
        href={`/?repo=${repo.owner_repo}&card=${profile.username}`}
        className={`my-rarity-badge ${repo.contributor_rarity}`}
        onClick={(e) => e.stopPropagation()}
      >
        {repo.contributor_rarity}
      </a>
    );
  }

  const isOwnProfile = viewer?.username.toLowerCase() === profile.username.toLowerCase();
  const compareMap = new Map(compareData.map((c) => [c.owner_repo, c]));
  const sharedRepos = profile.repos.filter((r) => compareMap.has(r.owner_repo));
  const otherRepos = compareData.length > 0
    ? profile.repos.filter((r) => !compareMap.has(r.owner_repo))
    : profile.repos;

  return (
    <div className="profile-page">
      <a href="/" className="profile-back-link">Back to GitPacks</a>

      {/* Header */}
      <div className="profile-header">
        <img
          src={profile.avatar_url}
          alt={profile.username}
          className="profile-avatar"
        />
        <div className="profile-header-info">
          <h1 className="profile-username">{profile.username}</h1>
          <p className="profile-joined">Joined {joinDate}</p>
        </div>
        <a
          href={`https://github.com/${profile.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="profile-gh-link"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          GitHub Profile
        </a>
      </div>

      {/* Stats */}
      <div className="profile-stats">
        <div className="profile-stat-card">
          <div className="profile-stat-value">{profile.total_points.toLocaleString()}</div>
          <div className="profile-stat-label">Total Points</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">#{profile.global_rank}</div>
          <div className="profile-stat-label">Global Rank</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">{profile.repos_collected}</div>
          <div className="profile-stat-label">Repos Collected</div>
        </div>
        <div className="profile-stat-card">
          <div className="profile-stat-value">{profile.repos_completed}</div>
          <div className="profile-stat-label">Repos Completed</div>
        </div>
      </div>

      {/* Shared Repos */}
      {!isOwnProfile && sharedRepos.length > 0 && (
        <div className="profile-section">
          <h2 className="profile-section-title">Shared Repos</h2>
          <div className="profile-repos">
            {sharedRepos.map((repo) => {
              const compare = compareMap.get(repo.owner_repo)!;
              const pct = repo.total_cards_in_repo > 0
                ? (repo.unique_cards / repo.total_cards_in_repo) * 100
                : 0;
              const viewerPct = repo.total_cards_in_repo > 0
                ? (compare.viewer.cards / repo.total_cards_in_repo) * 100
                : 0;

              return (
                <a
                  key={repo.owner_repo}
                  href={`/?repo=${repo.owner_repo}`}
                  className="profile-repo-row"
                >
                  <div className="profile-repo-header">
                    <span className="profile-repo-name">{repo.owner_repo}{rarityBadge(repo)}</span>
                    <span className="profile-repo-points">
                      {repo.total_points.toLocaleString()}
                      <span className="profile-repo-pts-label">pts</span>
                    </span>
                  </div>
                  <div className="profile-repo-stacked-bars">
                    <div className="profile-stacked-row">
                      <span className="profile-stacked-label">{profile.username}</span>
                      <div className="profile-progress-bar">
                        <div className="profile-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="profile-repo-cards">{repo.unique_cards}/{repo.total_cards_in_repo}</span>
                    </div>
                    <div className="profile-stacked-row">
                      <span className="profile-stacked-label">You</span>
                      <div className="profile-progress-bar">
                        <div className="profile-progress-fill-viewer" style={{ width: `${viewerPct}%` }} />
                      </div>
                      <span className="profile-repo-cards">{compare.viewer.cards}/{repo.total_cards_in_repo}</span>
                    </div>
                  </div>
                  {repo.is_complete && (
                    <span className="profile-completion-badge">
                      Complete{repo.is_insured ? " (Insured)" : ""}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Other Repos */}
      <div className="profile-section">
        <h2 className="profile-section-title">
          {compareData.length > 0 ? `${profile.username}'s Other Repos` : "Repos"}
        </h2>
        {otherRepos.length === 0 && profile.repos.length === 0 ? (
          <p className="profile-empty">No repos collected yet.</p>
        ) : otherRepos.length === 0 ? (
          <p className="profile-empty">All repos are shared with you.</p>
        ) : (
          <div className="profile-repos">
            {otherRepos.map((repo) => {
              const pct = repo.total_cards_in_repo > 0
                ? (repo.unique_cards / repo.total_cards_in_repo) * 100
                : 0;

              return (
                <a
                  key={repo.owner_repo}
                  href={`/?repo=${repo.owner_repo}`}
                  className="profile-repo-row"
                >
                  <div className="profile-repo-header">
                    <span className="profile-repo-name">{repo.owner_repo}{rarityBadge(repo)}</span>
                    <span className="profile-repo-points">
                      {repo.total_points.toLocaleString()}
                      <span className="profile-repo-pts-label">pts</span>
                    </span>
                  </div>
                  <div className="profile-repo-progress">
                    <div className="profile-progress-bar">
                      <div className="profile-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="profile-repo-cards">
                      {repo.unique_cards}/{repo.total_cards_in_repo}
                    </span>
                  </div>
                  {repo.is_complete && (
                    <span className="profile-completion-badge">
                      Complete{repo.is_insured ? " (Insured)" : ""}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

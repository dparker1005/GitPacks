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
}

interface Achievement {
  owner_repo: string;
  stat_type: string;
  threshold: number;
  unlocked_at: string;
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
  achievements: Achievement[];
}

interface CompareRepo {
  owner_repo: string;
  viewer: { cards: number; points: number };
  profile: { cards: number; points: number };
}

const STAT_ICONS: Record<string, string> = {
  commits: "C",
  prs: "PR",
  issues: "I",
  active_weeks: "W",
  streak: "S",
  peak: "P",
  consistency: "~",
};

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

  const isOwnProfile = viewer?.username.toLowerCase() === profile.username.toLowerCase();
  const compareMap = new Map(compareData.map((c) => [c.owner_repo, c]));
  const viewerLeads = compareData.filter((c) => c.viewer.points > c.profile.points).length;
  const profileLeads = compareData.filter((c) => c.profile.points > c.viewer.points).length;

  // Group achievements by repo
  const achievementsByRepo: Record<string, Achievement[]> = {};
  for (const a of profile.achievements) {
    if (!achievementsByRepo[a.owner_repo]) achievementsByRepo[a.owner_repo] = [];
    achievementsByRepo[a.owner_repo].push(a);
  }

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

      {/* Comparison summary */}
      {!isOwnProfile && compareData.length > 0 && (
        <div className="profile-compare-summary">
          You share {compareData.length} repo{compareData.length !== 1 ? "s" : ""}
          {" — "}you lead in {viewerLeads}, they lead in {profileLeads}
        </div>
      )}

      {/* Repos */}
      <div className="profile-section">
        <h2 className="profile-section-title">Repos</h2>
        {profile.repos.length === 0 ? (
          <p className="profile-empty">No repos collected yet.</p>
        ) : (
          <div className="profile-repos">
            {profile.repos.map((repo) => {
              const compare = compareMap.get(repo.owner_repo);
              const pct = repo.total_cards_in_repo > 0
                ? (repo.unique_cards / repo.total_cards_in_repo) * 100
                : 0;
              const viewerPct = compare && repo.total_cards_in_repo > 0
                ? (compare.viewer.cards / repo.total_cards_in_repo) * 100
                : 0;

              return (
                <a
                  key={repo.owner_repo}
                  href={`/?repo=${repo.owner_repo}`}
                  className="profile-repo-row"
                >
                  <div className="profile-repo-header">
                    <span className="profile-repo-name">{repo.owner_repo}</span>
                    <span className="profile-repo-points">
                      {repo.total_points.toLocaleString()}
                      <span className="profile-repo-pts-label">pts</span>
                    </span>
                  </div>
                  <div className="profile-repo-progress">
                    <div className="profile-progress-bar">
                      <div
                        className="profile-progress-fill"
                        style={{ width: `${pct}%` }}
                      />
                      {compare && (
                        <div
                          className="profile-progress-fill-viewer"
                          style={{ width: `${viewerPct}%` }}
                        />
                      )}
                    </div>
                    <span className="profile-repo-cards">
                      {repo.unique_cards}/{repo.total_cards_in_repo}
                    </span>
                  </div>
                  {compare && (
                    <div className="profile-repo-compare">
                      <span className="profile-compare-viewer">
                        You: {compare.viewer.cards}/{repo.total_cards_in_repo} ({compare.viewer.points} pts)
                      </span>
                    </div>
                  )}
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

      {/* Non-shared repos hint */}
      {!isOwnProfile && compareData.length > 0 && (
        <div className="profile-section">
          {profile.repos.filter((r) => !compareMap.has(r.owner_repo)).length > 0 && (
            <p className="profile-start-collecting">
              {profile.username} has {profile.repos.filter((r) => !compareMap.has(r.owner_repo)).length} repo{profile.repos.filter((r) => !compareMap.has(r.owner_repo)).length !== 1 ? "s" : ""} you haven&apos;t started collecting.{" "}
              <a href="/">Start collecting</a>
            </p>
          )}
        </div>
      )}

      {/* Achievements */}
      {profile.achievements.length > 0 && (
        <div className="profile-section">
          <h2 className="profile-section-title">Achievements</h2>
          {Object.entries(achievementsByRepo).map(([repo, achievements]) => (
            <div key={repo} className="profile-achievement-group">
              <h3 className="profile-achievement-repo">{repo}</h3>
              <div className="profile-achievements">
                {achievements.map((a, i) => (
                  <div key={i} className="profile-achievement-badge">
                    <span className="profile-achievement-icon">
                      {STAT_ICONS[a.stat_type] || a.stat_type.charAt(0).toUpperCase()}
                    </span>
                    <span className="profile-achievement-value">{a.threshold}</span>
                    <span className="profile-achievement-date">
                      {new Date(a.unlocked_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

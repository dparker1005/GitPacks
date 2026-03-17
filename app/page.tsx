"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/app/lib/supabase-browser";

interface UserInfo {
  id: string;
  username: string;
  avatar: string;
}

export default function Home() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hasReferral, setHasReferral] = useState(false);

  // Store referral code from URL on first visit
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('gp_ref', ref);
    if (ref || localStorage.getItem('gp_ref')) setHasReferral(true);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    async function getUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const meta = authUser.user_metadata;
        setUser({
          id: authUser.id,
          username: meta.user_name || meta.preferred_username || '',
          avatar: meta.avatar_url || '',
        });
      }
      setAuthLoading(false);
    }

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const meta = session.user.user_metadata;
        setUser({
          id: session.user.id,
          username: meta.user_name || meta.preferred_username || '',
          avatar: meta.avatar_url || '',
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authLoading) return;

    import("./gitpacks.js").then(({ initGitPacks }) => {
      initGitPacks(user);
    });
  }, [authLoading, user]);

  function handleLogin() {
    const supabase = getSupabaseBrowser();
    const ref = localStorage.getItem('gp_ref');
    const callbackUrl = ref
      ? `${window.location.origin}/auth/callback?ref=${encodeURIComponent(ref)}`
      : `${window.location.origin}/auth/callback`;
    supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: callbackUrl },
    });
  }

  // Expose login for use by gitpacks.js (pack overlay sign-in button)
  useEffect(() => {
    (window as any).__gpLogin = handleLogin;
  });

  function handleLogout() {
    // Clear all guest/collection localStorage so logged-out view starts fresh
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('ghtc_lib_') || key.startsWith('gp_guest')) localStorage.removeItem(key);
    });
    const supabase = getSupabaseBrowser();
    supabase.auth.signOut().then(() => {
      window.location.href = window.location.pathname;
    });
  }

  return (
    <div id="gallery-screen">
      <div className="top-bar">
        <div className="top-bar-left">
        </div>
        <div className="top-bar-right">
          <a className="btn-feedback" href="mailto:gitpacksapp@gmail.com?subject=GitPacks%20Feedback">Feedback</a>
          <button className="btn-share" id="share-btn">Share</button>
          <div id="top-bar-packs"></div>
          {authLoading ? null : user ? (
            <div className="user-menu">
              <a href={`/profile/${encodeURIComponent(user.username)}`} className="user-menu-link">
                <img src={user.avatar} alt="" className="user-avatar" />
                <span className="user-name">{user.username}</span>
              </a>
              <button className="top-bar-btn" onClick={handleLogout}>Sign Out</button>
            </div>
          ) : (
            <button className="login-btn" onClick={handleLogin}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              Sign In
            </button>
          )}
        </div>
      </div>
      <header style={{ cursor: 'pointer' }} onClick={() => { window.location.href = window.location.pathname; }}>
        <h1>
          <svg viewBox="0 0 32 32">
            <defs>
              <linearGradient id="gp-title-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "#7873f5" }} />
                <stop offset="100%" style={{ stopColor: "#4adede" }} />
              </linearGradient>
            </defs>
            <rect x="4" y="2" width="18" height="26" rx="3" fill="none" stroke="url(#gp-title-grad)" strokeWidth="2" opacity="0.4" transform="rotate(-6 13 15)" />
            <rect x="8" y="3" width="18" height="26" rx="3" fill="none" stroke="url(#gp-title-grad)" strokeWidth="2" opacity="0.7" transform="rotate(3 17 16)" />
            <rect x="6" y="2.5" width="18" height="26" rx="3" fill="none" stroke="url(#gp-title-grad)" strokeWidth="2.5" />
            <text x="15" y="20.5" fontFamily="sans-serif" fontWeight="900" fontSize="14" fill="url(#gp-title-grad)" textAnchor="middle">G</text>
          </svg>
          GitPacks<span className="beta-tag">Beta</span>
        </h1>
        <p>Collect the contributors behind the code.</p>
      </header>
      {!user && !authLoading && (
        <div className="landing" id="landing-section">
          {hasReferral && (
            <div className="referral-banner">
              You were invited! Sign up to claim <strong>5 bonus packs</strong> for you and your referrer.
            </div>
          )}
          <div className="landing-hero">
            <h2>Collect the contributors behind the code</h2>
            <p>Open packs, discover contributors, and complete your collection for any GitHub repo.</p>
          </div>

          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-num">1</div>
              <h3>Open packs</h3>
              <p>Each pack contains 5 contributor cards across 5 rarities — from Common to Mythic</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">2</div>
              <h3>Complete your collection</h3>
              <p>Collect every contributor for a repo. Contribute to a repo and <strong>get your own card for free</strong>, plus earn bonus packs for your milestones.</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">3</div>
              <h3>Climb the leaderboard</h3>
              <p>Every card earns points. Complete a collection for a 1.5x bonus.</p>
            </div>
          </div>

          <div className="landing-ways">
            <h3>Ways to earn packs</h3>
            <div className="landing-ways-grid">
              <div className="landing-way"><strong>10 starter packs</strong> on signup</div>
              <div className="landing-way"><strong>3 daily task packs</strong> from GitHub activity</div>
              <div className="landing-way"><strong>Achievement packs</strong> for repos you contribute to</div>
              <div className="landing-way"><strong>Pack regen</strong> — 1 new pack every 12 hours</div>
            </div>
          </div>

          <div className="landing-starter">
            <button className="login-btn landing-cta" onClick={handleLogin}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              Sign In with GitHub
            </button>
          </div>

        </div>
      )}
      {!user && !authLoading && (
        <div className="landing-try">
          <p>Or try it first — open 5 guest packs on any repo below</p>
        </div>
      )}
      <div className="search-container" id="search-container">
        <input type="text" id="repo-input" placeholder="owner/repo" />
        <button id="generate-btn" className="btn-primary">Load Repo</button>
      </div>
      <div id="popular-repos"></div>
      <div id="error"></div>
      <div id="loading">
        <div className="progress-container">
          <div className="progress-steps">
            <div className="progress-step" id="step-commits"><div className="step-icon">1</div><span className="step-text">Fetching commit stats</span></div>
            <div className="progress-step" id="step-issues"><div className="step-icon">2</div><span className="step-text">Fetching issues &amp; PRs</span></div>
            <div className="progress-step" id="step-processing"><div className="step-icon">3</div><span className="step-text">Generating cards</span></div>
          </div>
          <div className="progress-bar-wrap"><div className="progress-bar-fill" id="progress-fill"></div></div>
          <p id="progress-detail" style={{ color: "#555", fontSize: "0.85rem", marginTop: "12px", letterSpacing: "0.5px" }}></p>
        </div>
      </div>
      <div id="repo-info"></div>
      <div id="cards-grid"></div>
      <footer className="site-footer">
        <a href="https://x.com/gitpacks" target="_blank" rel="noopener">@gitpacks</a>
        <span className="footer-sep">&middot;</span>
        <a href="mailto:gitpacksapp@gmail.com">gitpacksapp@gmail.com</a>
      </footer>
    </div>
  );
}

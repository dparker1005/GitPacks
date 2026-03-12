"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    import("./gitpacks.js").then(({ initGitPacks }) => {
      initGitPacks();
    });
  }, []);

  return (
    <div id="gallery-screen">
      <div className="top-bar">
        <button className="top-bar-btn repo-only" id="clear-cache-btn">Clear Cache</button>
        <button className="btn-share" id="share-btn">Share</button>
      </div>
      <header>
        <h1>
          <svg viewBox="0 0 32 32">
            <defs>
              <linearGradient id="gp-header" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "#7873f5" }} />
                <stop offset="100%" style={{ stopColor: "#4adede" }} />
              </linearGradient>
            </defs>
            <rect x="4" y="2" width="18" height="26" rx="3" fill="none" stroke="url(#gp-header)" strokeWidth="2" opacity="0.4" transform="rotate(-6 13 15)" />
            <rect x="8" y="3" width="18" height="26" rx="3" fill="none" stroke="url(#gp-header)" strokeWidth="2" opacity="0.7" transform="rotate(3 17 16)" />
            <rect x="6" y="2.5" width="18" height="26" rx="3" fill="none" stroke="url(#gp-header)" strokeWidth="2.5" />
            <text x="15" y="20.5" fontFamily="sans-serif" fontWeight="900" fontSize="14" fill="url(#gp-header)" textAnchor="middle">G</text>
          </svg>
          GitPacks<span className="alpha-tag">Alpha</span>
        </h1>
        <p>Collect the contributors behind the code.</p>
      </header>
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
    </div>
  );
}

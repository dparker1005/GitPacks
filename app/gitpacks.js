let _initialized = false;
let _currentUser = null;

export function initGitPacks(user) {
// Prevent double-init — just update user reference on re-calls
if (_initialized) {
  _currentUser = user || null;
  // Load pack state for top bar, re-render repo info if loaded
  loadPackState().then(() => { if (repoLoaded) renderRepoInfoFromCurrent(); });
  return;
}
_initialized = true;
_currentUser = user || null;

// Show welcome overlay for first-time logged-in users
if (_currentUser && !localStorage.getItem('gp_welcome_shown')) {
  // Defer to next tick so DOM is ready
  setTimeout(() => showWelcomeOverlay(), 0);
}

const GH_ICON = `<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const GP_ICON = `<svg viewBox="0 0 32 32"><defs><linearGradient id="gp-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#7873f5"/><stop offset="100%" style="stop-color:#4adede"/></linearGradient></defs><rect x="4" y="2" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2" opacity="0.4" transform="rotate(-6 13 15)"/><rect x="8" y="3" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2" opacity="0.7" transform="rotate(3 17 16)"/><rect x="6" y="2.5" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2.5"/><text x="15" y="20.5" font-family="sans-serif" font-weight="900" font-size="14" fill="url(#gp-grad)" text-anchor="middle">G</text></svg>`;

const input = document.getElementById('repo-input');
const btn = document.getElementById('generate-btn');
const grid = document.getElementById('cards-grid');
const loading = document.getElementById('loading');
const errorEl = document.getElementById('error');
const repoInfo = document.getElementById('repo-info');

let allContributors = [];
let library = {};
let repoLoaded = false;
let currentRepoName = '';
let filterRarity = 'all';
let viewMode = 'collected'; // 'collected', 'missing', 'all'
let sortBy = 'power'; // 'power', 'quantity', 'commits', 'prs', 'issues', 'streak', 'consistency', 'peak'
let cardSearch = '';

// Pack state for all users
let packState = null; // { readyPacks, maxPacks, nextRegenAt }
let packCountdownInterval = null;
let guestPacksRemaining = 5; // for logged-out users
let lastAchievementData = null; // achievement data for current repo
let starBalance = 0; // per-repo star balance for card recycling

// Global space handler — only one at a time, avoids stacking conflicts
let _spaceAction = null;
function _globalSpaceHandler(e) { if (e.code === 'Space' && _spaceAction) { e.preventDefault(); const action = _spaceAction; _spaceAction = null; action(); } }
document.addEventListener('keydown', _globalSpaceHandler);
function setSpaceAction(fn) { _spaceAction = fn; }
function clearSpaceAction() { _spaceAction = null; }

const searchContainer = document.getElementById('search-container');
const popularRepos = document.getElementById('popular-repos');

function getPackOddsHTML() {
  return `<div class="pack-odds-box">
    <div class="pack-odds-title">Pack Odds</div>
    <div class="pack-odds-section">
      <div class="pack-odds-label">Cards 1–4</div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#888">Common</span> <span class="odds-pct">60%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#60a5fa">Rare</span> <span class="odds-pct">22%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#c084fc">Epic</span> <span class="odds-pct">12%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#ffd700">Legendary</span> <span class="odds-pct">5%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#ff0040">Mythic</span> <span class="odds-pct">1%</span></div>
    </div>
    <div class="pack-odds-section">
      <div class="pack-odds-label">Card 5</div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#60a5fa">Rare</span> <span class="odds-pct">55%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#c084fc">Epic</span> <span class="odds-pct">30%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#ffd700">Legendary</span> <span class="odds-pct">12.5%</span></div>
      <div class="pack-odds-row"><span class="odds-rarity" style="color:#ff0040">Mythic</span> <span class="odds-pct">2.5%</span></div>
    </div>
    <div class="pack-odds-guarantee">Legendary guaranteed within 10 packs<br>Mythic guaranteed within 20 packs</div>
  </div>`;
}

// ===== WELCOME OVERLAY =====
function showWelcomeOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'welcome-overlay';
  overlay.innerHTML = `
    <div class="welcome-content">
      <div class="welcome-logo">${GP_ICON}</div>
      <div class="welcome-title">Welcome to GitPacks!</div>
      <div class="welcome-item">You start with <strong>10 packs</strong> to open on any repo</div>
      <div class="welcome-item">Packs regenerate: <strong>1 new pack every 12 hours</strong>, up to 2 at a time</div>
      <div class="welcome-item">Contribute to repos to earn <strong>bonus achievement packs</strong></div>
      <button class="welcome-start">Start Collecting</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.welcome-start').addEventListener('click', () => {
    localStorage.setItem('gp_welcome_shown', '1');
    overlay.remove();
  });
}

btn.addEventListener('click', () => loadRepo());
document.getElementById('share-btn').addEventListener('click', () => shareRepo());

input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });

function quickLoad(repo) { input.value = repo; loadRepo(); }

// ===== PACK STATE =====
async function loadPackState() {
  if (!_currentUser) {
    // Guest: check localStorage for remaining packs
    const stored = localStorage.getItem('gp_guest_packs_remaining');
    if (stored !== null) guestPacksRemaining = parseInt(stored, 10) || 0;
    packState = null;
    renderTopBarPacks();
    return;
  }
  try {
    const res = await fetch('/api/pack-state');
    if (res.ok) {
      packState = await res.json();
    }
  } catch { packState = null; }
  renderTopBarPacks();
}

function renderTopBarPacks() {
  const el = document.getElementById('top-bar-packs');
  if (!el) return;

  if (!_currentUser) {
    // Guest packs display
    const limitReached = localStorage.getItem('gp_guest_limit_reached');
    const count = limitReached ? 0 : guestPacksRemaining;
    el.innerHTML = `<div class="topbar-packs">
      <span class="topbar-packs-icon">${GP_ICON}</span>
      <span class="topbar-packs-count">${count}</span>
    </div>`;
    return;
  }

  if (!packState) { el.innerHTML = ''; return; }
  const { readyPacks, maxPacks, nextRegenAt } = packState;
  const timerHTML = readyPacks < maxPacks && nextRegenAt
    ? `<span class="topbar-pack-timer" id="topbar-pack-timer"></span>`
    : '';
  el.innerHTML = `<div class="topbar-packs">
    <span class="topbar-packs-icon">${GP_ICON}</span>
    <span class="topbar-packs-count">${readyPacks}</span>
    ${timerHTML}
  </div>`;
  if (readyPacks < maxPacks && nextRegenAt) startPackCountdown();
}

function formatCountdown(remaining) {
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

function startPackCountdown() {
  if (packCountdownInterval) clearInterval(packCountdownInterval);
  packCountdownInterval = setInterval(() => {
    if (!packState || !packState.nextRegenAt) {
      if (packCountdownInterval) clearInterval(packCountdownInterval);
      return;
    }
    const remaining = packState.nextRegenAt - Date.now();
    if (remaining <= 0) {
      // Regen happened — refresh state
      loadPackState().then(() => renderRepoInfoFromCurrent());
      clearInterval(packCountdownInterval);
      return;
    }
    const timeStr = formatCountdown(remaining);
    // Update both top bar and repo info countdowns
    const topbarEl = document.getElementById('topbar-pack-timer');
    if (topbarEl) topbarEl.textContent = timeStr;
    const repoEl = document.getElementById('pack-countdown');
    if (repoEl) repoEl.textContent = timeStr;
  }, 1000);
}

// ===== POPULAR REPOS =====
async function loadPopularRepos() {
  popularRepos.innerHTML = `<div style="text-align:center;padding:60px 20px"><div class="spinner"></div></div>`;
  try {
    const res = await fetch('/api/repos');
    if (!res.ok) return;
    const repos = await res.json();
    if (!repos.length) {
      popularRepos.innerHTML = `<div class="popular-section">
        <p class="popular-hint">Enter a GitHub repo above to get started!</p>
      </div>`;
      return;
    }

    // For logged-in users, fetch their repos from DB
    let userRepos = [];
    if (_currentUser) {
      try {
        const urRes = await fetch('/api/user-repos');
        if (urRes.ok) userRepos = await urRes.json();
      } catch { /* silent */ }
    }

    // For logged-out users, use localStorage
    if (!_currentUser) {
      repos.forEach(r => {
        try {
          const lib = JSON.parse(localStorage.getItem('ghtc_lib_' + r.name.toLowerCase()) || '{}');
          r.collected = Object.keys(lib).length;
        } catch { r.collected = 0; }
        r.pct = r.cards > 0 ? r.collected / r.cards : 0;
      });
    } else {
      // Merge user repo data (including scores) with all repos
      repos.forEach(r => {
        const ur = userRepos.find(u => u.name === r.name.toLowerCase());
        r.collected = ur ? ur.collected : 0;
        r.pct = r.cards > 0 ? r.collected / r.cards : 0;
        r.base_points = ur ? ur.base_points : 0;
        r.completion_bonus = ur ? ur.completion_bonus : 0;
        r.total_points = ur ? ur.total_points : 0;
      });
    }

    const yourRepos = repos.filter(r => r.collected > 0).sort((a, b) => b.pct - a.pct || b.cards - a.cards);
    const otherRepos = repos.filter(r => r.collected === 0).sort((a, b) => b.cards - a.cards);

    // Split yourRepos into completed and in-progress for logged-in dashboard
    const completedRepos = yourRepos.filter(r => r.cards > 0 && r.collected >= r.cards);
    const inProgressRepos = yourRepos.filter(r => r.collected > 0 && (r.cards === 0 || r.collected < r.cards))
      .sort((a, b) => b.pct - a.pct);

    function repoBtn(r, showProgressBar) {
      const pctNum = Math.round(r.pct * 100);
      const isComplete = r.cards > 0 && r.collected >= r.cards;
      const progressBar = showProgressBar && !isComplete && r.cards > 0
        ? `<div class="repo-progress-bar"><div class="repo-progress-fill" style="width:${pctNum}%"></div></div>`
        : '';
      return `<button class="popular-repo-btn${isComplete ? ' repo-complete' : ''}" data-repo="${r.name}">
          <span class="popular-repo-name">${r.name}${progressBar}</span>
          <span class="popular-repo-meta">
            <span class="popular-repo-progress">${r.collected}/${r.cards}</span>
            <span class="popular-repo-pct">${pctNum}%</span>
          </span>
        </button>`;
    }

    function repoBtnScored(r, showProgressBar) {
      const pctNum = Math.round(r.pct * 100);
      const isComplete = r.cards > 0 && r.collected >= r.cards;
      const progressBar = showProgressBar && !isComplete && r.cards > 0
        ? `<div class="repo-progress-bar"><div class="repo-progress-fill" style="width:${pctNum}%"></div></div>`
        : '';
      const bonusHTML = r.completion_bonus > 0
        ? `<span class="repo-bonus">+${r.completion_bonus.toLocaleString()} bonus</span>`
        : '';
      const pointsHTML = r.total_points > 0
        ? `<span class="repo-points">${r.base_points.toLocaleString()} pts${bonusHTML}</span>`
        : '';
      return `<button class="popular-repo-btn scored${isComplete ? ' repo-complete' : ''}" data-repo="${r.name}">
          <span class="popular-repo-name">${r.name}${progressBar}</span>
          <span class="popular-repo-meta-stacked">
            <span class="popular-repo-progress">${r.collected}/${r.cards} cards</span>
            ${pointsHTML}
          </span>
        </button>`;
    }

    let html = '';

    if (_currentUser) {
      // Dashboard layout for logged-in users
      html += `<div class="dashboard">`;

      // Left column: Your Collection (in progress + completed with points) + contributed repos
      html += `<div class="dashboard-col">`;

      const hasCollection = inProgressRepos.length || completedRepos.length;

      if (inProgressRepos.length) {
        html += `<div class="popular-section">
          <h3 class="popular-title">In Progress</h3>
          <div class="popular-grid">${inProgressRepos.map(r => repoBtnScored(r, true)).join('')}</div>
        </div>`;
      }

      if (completedRepos.length) {
        html += `<div class="popular-section">
          <h3 class="popular-title">Completed</h3>
          <div class="popular-grid">${completedRepos.map(r => repoBtnScored(r, false)).join('')}</div>
        </div>`;
      }

      if (!hasCollection) {
        html += `<div class="popular-section">
          <h3 class="popular-title">Your Collection</h3>
          <p class="popular-hint">Open packs on any repo to start collecting!</p>
        </div>`;
      }

      // Score total
      const totalPoints = yourRepos.reduce((sum, r) => sum + (r.total_points || 0), 0);
      if (totalPoints > 0) {
        const totalBase = yourRepos.reduce((sum, r) => sum + (r.base_points || 0), 0);
        const totalBonus = yourRepos.reduce((sum, r) => sum + (r.completion_bonus || 0), 0);
        html += `<div class="score-total">
          <span class="score-total-label">Total</span>
          <span class="score-total-value">${totalBase.toLocaleString()}${totalBonus > 0 ? `<span class="score-total-bonus">+${totalBonus.toLocaleString()}</span>` : ''}<span class="score-total-eq"> = ${totalPoints.toLocaleString()} pts</span></span>
        </div>`;
      }

      // Contributed repos load async
      html += `<div id="contributed-section" class="popular-section contributed-placeholder">
        <h3 class="popular-title">Your Repos</h3>
        <div class="popular-grid"><div class="contrib-loading-row"><span class="spinner-small"></span> Finding your repos...</div></div>
      </div>`;
      html += `</div>`;

      // Right column: Leaderboard + Discover
      html += `<div class="dashboard-col">`;
      html += `<div id="leaderboard-section" class="popular-section"></div>`;
      if (otherRepos.length) {
        html += `<div class="popular-section">
          <h3 class="popular-title">Discover</h3>
          <div class="popular-grid">${otherRepos.map(r => repoBtn(r, false)).join('')}</div>
        </div>`;
      }
      html += `</div>`;

      html += `</div>`; // close .dashboard
    } else {
      // Logged-out layout: two-column with collection/popular left, leaderboard right
      html += `<div class="dashboard">`;
      html += `<div class="dashboard-col">`;
      if (yourRepos.length) {
        html += `<div class="popular-section">
          <h3 class="popular-title">Your Collection</h3>
          <div class="popular-grid">${yourRepos.map(r => repoBtn(r, true)).join('')}</div>
        </div>`;
      }
      if (otherRepos.length) {
        html += `<div class="popular-section">
          <h3 class="popular-title">Popular Repos</h3>
          <div class="popular-grid">${otherRepos.map(r => repoBtn(r, false)).join('')}</div>
        </div>`;
      }
      html += `</div>`;
      html += `<div class="dashboard-col"><div id="leaderboard-section" class="popular-section"></div></div>`;
      html += `</div>`;
    }
    popularRepos.innerHTML = html;
    popularRepos.querySelectorAll('.popular-repo-btn').forEach(b => {
      b.addEventListener('click', () => quickLoad(b.dataset.repo));
    });

    // Lazy load contributed repos and leaderboard
    loadLeaderboard();
    if (_currentUser) {
      loadContributedRepos(yourRepos);
    }
  } catch { /* silent */ }
}

async function loadContributedRepos(yourRepos) {
  const section = document.getElementById('contributed-section');
  if (!section) return;

  let contributedRepos = [];
  try {
    const crRes = await fetch('/api/user-contributed-repos');
    if (crRes.ok) contributedRepos = await crRes.json();
  } catch { /* silent */ }

  const collectedNames = new Set((yourRepos || []).map(r => r.name.toLowerCase()));
  const newContributed = contributedRepos.filter(r => !collectedNames.has(r.name.toLowerCase()));

  if (newContributed.length === 0) {
    section.innerHTML = '';
    return;
  }

  function contribBtn(r) {
    if (r.cached) {
      return `<button class="popular-repo-btn contributed-repo-btn" data-repo="${r.name}">
        <span class="popular-repo-name">${r.name}</span>
        <span class="popular-repo-meta">
          <span class="popular-repo-progress">0/${r.cards}</span>
          <span class="popular-repo-pct">0%</span>
        </span>
      </button>`;
    }
    return `<button class="popular-repo-btn contributed-repo-btn" data-repo="${r.name}" data-preload="true">
        <span class="popular-repo-name">${r.name}</span>
        <span class="popular-repo-meta">
          <span class="contrib-loading"><span class="spinner-small"></span></span>
        </span>
      </button>`;
  }

  section.className = 'popular-section';
  section.innerHTML = `
    <h3 class="popular-title">Your Repos</h3>
    <div class="popular-grid">${newContributed.map(contribBtn).join('')}</div>
  `;

  section.querySelectorAll('.popular-repo-btn').forEach(b => {
    b.addEventListener('click', () => quickLoad(b.dataset.repo));
  });

  // Preload uncached repos in background
  for (const r of newContributed.filter(r => !r.cached)) {
    const [ow, rp] = r.name.split('/');
    if (!ow || !rp) continue;
    fetch(`/api/repo/${ow}/${rp}`).then(async res => {
      if (!res.ok) return;
      const data = await res.json();
      const cardCount = Array.isArray(data) ? data.length : 0;
      const btn = section.querySelector(`[data-repo="${r.name}"][data-preload]`);
      if (btn) {
        btn.removeAttribute('data-preload');
        const meta = btn.querySelector('.popular-repo-meta');
        if (meta) meta.innerHTML = `<span class="popular-repo-progress">0/${cardCount}</span><span class="popular-repo-pct">0%</span>`;
      }
    }).catch(() => {
      const btn = section.querySelector(`[data-repo="${r.name}"][data-preload]`);
      if (btn) {
        btn.removeAttribute('data-preload');
        const meta = btn.querySelector('.popular-repo-meta');
        if (meta) meta.innerHTML = '';
      }
    });
  }
}

// ===== LEADERBOARD =====
async function loadLeaderboard() {
  const section = document.getElementById('leaderboard-section');
  if (!section) return;

  try {
    const [lbRes, scoreRes] = await Promise.all([
      fetch('/api/leaderboard?limit=10'),
      _currentUser ? fetch('/api/score') : Promise.resolve(null),
    ]);

    let entries = [];
    if (lbRes.ok) {
      const data = await lbRes.json();
      entries = data.entries || [];
    }

    let userScore = null;
    if (scoreRes && scoreRes.ok) {
      userScore = await scoreRes.json();
    }

    if (entries.length === 0 && !userScore) {
      section.innerHTML = '';
      return;
    }

    let html = `<h3 class="popular-title">Leaderboard</h3>`;

    // User score summary
    if (userScore && userScore.total_points > 0) {
      html += `<div class="score-summary">
        <div class="score-summary-points">${userScore.total_points.toLocaleString()}<span class="score-summary-label">pts</span></div>
        <div class="score-summary-stats">
          <span>${userScore.repos_collected} repo${userScore.repos_collected !== 1 ? 's' : ''}</span>
          <span class="score-summary-dot">&middot;</span>
          <span>${userScore.repos_completed} complete</span>
        </div>
      </div>`;
    }

    if (entries.length > 0) {
      html += `<div class="leaderboard-list">`;
      entries.forEach((e, i) => {
        const rank = e.rank;
        const isCurrentUser = _currentUser && e.github_username.toLowerCase() === _currentUser.username.toLowerCase();
        const rankClass = rank === 1 ? 'lb-rank-1' : rank === 2 ? 'lb-rank-2' : rank === 3 ? 'lb-rank-3' : '';
        const medalIcon = rank === 1 ? '<span class="lb-medal">🥇</span>' : rank === 2 ? '<span class="lb-medal">🥈</span>' : rank === 3 ? '<span class="lb-medal">🥉</span>' : '';

        html += `<a href="https://github.com/${encodeURIComponent(e.github_username)}" target="_blank" rel="noopener" class="lb-row ${rankClass}${isCurrentUser ? ' lb-you' : ''}">
          <span class="lb-rank">${medalIcon}${rank}</span>
          <img src="${e.avatar_url}" alt="" class="lb-avatar" loading="lazy" />
          <span class="lb-info">
            <span class="lb-name">${e.github_username}</span>
            <span class="lb-detail">${e.repos_completed > 0 ? e.repos_completed + ' collection' + (e.repos_completed !== 1 ? 's' : '') + ' complete' : 'collecting'}</span>
          </span>
          <span class="lb-points">${e.total_points.toLocaleString()}<span class="lb-pts-label">pts</span></span>
        </a>`;
      });
      html += `</div>`;
    }

    section.innerHTML = html;
  } catch { /* silent */ }
}

// Load pack state for top bar (all users)
loadPackState();

// Auto-load from URL param, otherwise show repo browser
const urlRepo = new URLSearchParams(window.location.search).get('repo');
if (urlRepo) {
  input.value = urlRepo;
  loadRepo();
} else {
  loadPopularRepos();
}

function saveLibrary() {
  if (!currentRepoName) return;
  // Always save to localStorage (works for both logged-in and logged-out)
  try { localStorage.setItem('ghtc_lib_' + currentRepoName.toLowerCase(), JSON.stringify(library)); } catch { }
}

function loadLibrary() {
  if (!currentRepoName) return;
  const libKey = 'ghtc_lib_' + currentRepoName.toLowerCase();
  const libData = localStorage.getItem(libKey);
  if (libData) {
    try { library = JSON.parse(libData); } catch { library = {}; }
  }
}

async function loadLibraryFromDB() {
  if (!_currentUser || !currentRepoName) return;
  const [owner, repo] = currentRepoName.split('/');
  try {
    const res = await fetch(`/api/collection/${owner}/${repo}`);
    if (res.ok) {
      library = await res.json();
      // Also sync to localStorage for fast access
      saveLibrary();
    }
  } catch { /* fall back to localStorage */ }
}

async function loadStarBalance() {
  if (!_currentUser || !currentRepoName) { starBalance = 0; return; }
  const [owner, repo] = currentRepoName.split('/');
  try {
    const res = await fetch(`/api/recycling/${owner}/${repo}/stars`);
    if (res.ok) {
      const data = await res.json();
      starBalance = data.balance || 0;
    } else { starBalance = 0; }
  } catch { starBalance = 0; }
}

const REVERT_YIELD = { common: 1, rare: 3, epic: 10, legendary: 30, mythic: 100 };
const CHERRY_PICK_COST = { common: 5, rare: 15, epic: 50, legendary: 150, mythic: 500 };

async function loadRepo() {
  const repoInput = input.value.trim().replace(/^https?:\/\/github\.com\//, '');
  const match = repoInput.match(/^([^/]+)\/([^/]+)/);
  if (!match) return showError('Enter a valid repo like owner/repo');
  const [, owner, repo] = match;
  showError(''); grid.innerHTML = ''; repoInfo.style.display = 'none';
  popularRepos.style.display = 'none';
  loading.style.display = 'block'; btn.disabled = true;
  try {
    loading.innerHTML = `<div style="text-align:center;padding:60px 20px">
      <div class="spinner"></div>
      <p style="color:#888;font-family:'Orbitron',sans-serif;font-size:0.8rem;letter-spacing:2px;margin-top:20px">Loading contributors...</p>
      <p style="color:#555;font-size:0.75rem;margin-top:8px">This may take a moment</p>
    </div>`;

    const response = await fetch(`/api/repo/${owner}/${repo}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to load repo');
    }
    allContributors = await response.json();

    library = {};
    repoLoaded = true;
    currentRepoName = `${owner}/${repo}`;

    // Load collection: DB for logged-in, localStorage for logged-out
    if (_currentUser) {
      await loadLibraryFromDB();
    } else {
      loadLibrary();
    }

    // Load pack state and star balance for logged-in users
    if (_currentUser) {
      await loadPackState();
      await loadStarBalance();
    }

    // Check achievements for logged-in users
    lastAchievementData = null;
    if (_currentUser) {
      try {
        const achRes = await fetch(`/api/achievements/${owner}/${repo}`);
        if (achRes.ok) lastAchievementData = await achRes.json();
      } catch { /* silent */ }
    }

    // Capture card param before replaceState strips it
    const urlCard = new URLSearchParams(window.location.search).get('card');

    loading.style.display = 'none';
    searchContainer.style.display = 'none';
    document.getElementById('gallery-screen').classList.add('repo-loaded');
    history.replaceState(null, '', `?repo=${owner}/${repo}`);
    renderRepoInfo(owner, repo);
    renderLibrary();

    // Self-card reveal (still auto-grants on GET)
    if (lastAchievementData && lastAchievementData.selfCard) {
      revealSelfCard(lastAchievementData.selfCard, () => {
        // Refresh library since self-card was added to collection
        if (_currentUser) loadLibraryFromDB().then(() => { renderRepoInfoFromCurrent(); renderLibrary(); });
      });
    }

    // Auto-open card from URL param (e.g. ?repo=owner/repo&card=login)
    if (urlCard) {
      const target = allContributors.find(c => c.login.toLowerCase() === urlCard.toLowerCase());
      if (target) openFullscreenCard(target);
    }
  } catch (err) { console.error('[GHTC] loadRepo error:', err.message, err.stack); showError(err.message); loading.style.display = 'none'; }
  btn.disabled = false;
}

function renderRepoInfo(owner, repo) {
  repoInfo.style.display = 'block';
  const collected = Object.keys(library).length;
  const total = allContributors.length;

  // Pack state UI for logged-in users
  let packHTML = '';
  if (_currentUser && packState) {
    const { readyPacks, maxPacks, nextRegenAt } = packState;
    packHTML = `<div class="pack-state">
      <div class="pack-count">
        <span class="pack-count-icon">${GP_ICON}</span>
        <span class="pack-count-num">${readyPacks}</span>
        <span class="pack-count-label">pack${readyPacks !== 1 ? 's' : ''} <span class="pack-any-repo">usable on any repo</span></span>
      </div>
      ${readyPacks < maxPacks && nextRegenAt ? `<div class="pack-regen"><span class="pack-regen-label">Next pack in</span><span class="pack-regen-time" id="pack-countdown">--:--</span></div>` : ''}
    </div>`;
  }

  // Sign-in nudge for logged-out users
  let authNudge = '';
  if (!_currentUser) {
    authNudge = `<div class="auth-nudge"><span class="auth-nudge-icon">&#x1f512;</span> Sign in to save your cards</div>`;
  }

  // Achievement panel for contributors
  let achievementHTML = '';
  if (_currentUser && lastAchievementData && lastAchievementData.isContributor) {
    const stats = lastAchievementData.contributor;
    const milestones = lastAchievementData.milestones;
    const maxPerStat = lastAchievementData.maxPerStat || 8;
    const statLabels = {
      commits: { label: 'Commits', color: '#7873f5', value: stats.commits },
      prs_merged: { label: 'PRs Merged', color: '#4ade80', value: stats.prsMerged },
      issues: { label: 'Issues', color: '#f472b6', value: stats.issues },
      active_weeks: { label: 'Active Weeks', color: '#4adede', value: stats.activeWeeks },
      streak: { label: 'Streak', color: '#facc15', value: stats.maxStreak },
      peak_week: { label: 'Peak Week', color: '#c084fc', value: stats.peak },
    };
    const milestoneDefClient = {
      commits: { fixed: [1,10,50,100,500], increment: 0 },
      prs_merged: { fixed: [1,5,10,25,50,100], increment: 50, breakpoint: 500, increment2: 100 },
      issues: { fixed: [1,5,10,25,50], increment: 25 },
      active_weeks: { fixed: [1,4,12,26,52], increment: 26, breakpoint: 104, increment2: 52 },
      streak: { fixed: [1,2,4,8,12], increment: 4 },
      peak_week: { fixed: [1,3,5,10,20], increment: 10 },
    };

    // Compute all thresholds for each stat (up to maxSlots) to show the full grid
    function getAllThresholds(def, maxSlots) {
      const all = [...def.fixed];
      if (def.increment > 0 && all.length > 0) {
        let next = all[all.length - 1] + def.increment;
        while (all.length < maxSlots) {
          all.push(next);
          const inc = (def.breakpoint && def.increment2 && next >= def.breakpoint) ? def.increment2 : def.increment;
          next += inc;
        }
      }
      return all.slice(0, maxSlots);
    }

    let rows = '';
    let totalClaimable = 0;

    for (const [key, info] of Object.entries(statLabels)) {
      const m = milestones[key];
      if (!m) continue;

      const def = milestoneDefClient[key];
      const allThresholds = getAllThresholds(def, 5);
      const claimedSet = new Set(m.claimed);
      const claimableSet = new Set(m.claimable);
      const lockedSet = new Set(m.locked || []);

      let slots = '';
      allThresholds.forEach((t, i) => {
        const slotNum = i + 1;
        const isLocked = slotNum > maxPerStat;
        const isClaimed = claimedSet.has(t);
        const isClaimable = claimableSet.has(t);
        const isEarned = info.value >= t;

        if (isLocked) {
          const repoSizeTiers = [1, 20, 40, 60, 100];
          const neededCards = repoSizeTiers[i] || '?';
          slots += `<span class="ach-slot locked" title="Unlock with ${neededCards}+ card repo">
            <span class="ach-slot-lock">&#x1f512;</span>
            <span class="ach-slot-req">${neededCards}+</span>
          </span>`;
        } else if (isClaimed) {
          slots += `<span class="ach-slot claimed" style="border-color:${info.color}40" title="Claimed: ${t}">
            <span class="ach-slot-val" style="color:${info.color}">${t}</span>
          </span>`;
        } else if (isClaimable) {
          totalClaimable++;
          slots += `<button class="ach-slot claimable" data-claim="${key}-${t}" title="Claim pack for reaching ${t}">
            <span class="ach-slot-val">${t}</span>
          </button>`;
        } else if (!isEarned) {
          slots += `<span class="ach-slot unearned" title="Reach ${t} to unlock">
            <span class="ach-slot-val">${t}</span>
          </span>`;
        }
      });

      rows += `<div class="ach-row">
        <div class="ach-stat-info">
          <span class="ach-dot" style="background:${info.color}"></span>
          <span class="ach-label">${info.label}</span>
          <span class="ach-value" style="color:${info.color}">${info.value}</span>
        </div>
        <div class="ach-slots">${slots}</div>
      </div>`;
    }

    const claimAllBtn = totalClaimable > 1 ? `<button class="ach-claim-all" id="ach-claim-all">Open All (${totalClaimable} packs)</button>` : '';
    const slotsHint = maxPerStat < 5 ? 'More slots unlock as the repo grows' : '';

    achievementHTML = `<div class="achievement-panel">
      <div class="ach-slots-info">
        <span class="ach-slots-label">${maxPerStat}/5 slots unlocked</span>
        ${slotsHint ? `<span class="ach-slots-hint">${slotsHint}</span>` : ''}
      </div>
      ${rows}
      ${claimAllBtn}
    </div>`;
  }

  const isComplete = total > 0 && collected >= total;

  const ghLink = `<a class="repo-gh-link" href="https://github.com/${owner}/${repo}" target="_blank" rel="noopener">${GH_ICON} View on GitHub</a>`;

  // Points breakdown by rarity
  const rarityPts = { mythic: 50, legendary: 15, epic: 5, rare: 2, common: 1 };
  const rarityColors = { mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888' };
  const rarityOrder = ['mythic', 'legendary', 'epic', 'rare', 'common'];
  let breakdownHTML = '';
  if (_currentUser && collected > 0) {
    let totalBase = 0;
    const rows = rarityOrder.map(rarity => {
      const allOfRarity = allContributors.filter(c => c.rarity === rarity);
      const collectedOfRarity = allOfRarity.filter(c => library[c.login]);
      const pts = collectedOfRarity.length * rarityPts[rarity];
      totalBase += pts;
      return { rarity, collected: collectedOfRarity.length, total: allOfRarity.length, ptsEach: rarityPts[rarity], pts };
    });
    const completionBonus = isComplete ? Math.floor(totalBase * 0.5) : 0;
    const grandTotal = totalBase + completionBonus;

    breakdownHTML = `<div class="points-breakdown">
      <div class="pb-rows">
        ${rows.map(r => `<div class="pb-row">
          <span class="pb-rarity" style="color:${rarityColors[r.rarity]}">${r.rarity}</span>
          <span class="pb-calc">${r.collected}/${r.total} &times; ${r.ptsEach}</span>
          <span class="pb-pts">${r.pts}</span>
        </div>`).join('')}
        <div class="pb-divider"></div>
        <div class="pb-row pb-subtotal">
          <span class="pb-rarity">Base</span>
          <span class="pb-calc"></span>
          <span class="pb-pts">${totalBase}</span>
        </div>
        ${isComplete
          ? `<div class="pb-row pb-bonus">
              <span class="pb-rarity">Completion</span>
              <span class="pb-calc">&times; 1.5</span>
              <span class="pb-pts">+${completionBonus}</span>
            </div>`
          : `<div class="pb-row pb-bonus-locked">
              <span class="pb-rarity">Completion</span>
              <span class="pb-calc">collect all ${total}</span>
              <span class="pb-pts">&times;1.5</span>
            </div>`}
        <div class="pb-divider"></div>
        <div class="pb-row pb-total">
          <span class="pb-rarity">Total</span>
          <span class="pb-calc"></span>
          <span class="pb-pts">${grandTotal}</span>
        </div>
      </div>
    </div>`;
  }

  repoInfo.innerHTML = `<div class="repo-info-row">
      <div class="repo-info-inner${isComplete ? ' repo-info-complete' : ''}">
        <h2><span>${owner || ''}</span> / <span>${repo || ''}</span></h2>
        ${ghLink}
        <div class="repo-info-sep"></div>
        <div class="collection-progress"><span>${collected}</span> / <span>${total}</span> collected</div>
      </div>
      <button class="switch-repo-btn" id="switch-repo-btn">Switch Repo</button>
    </div>
    ${authNudge}
    <div class="repo-action-row">
      <div class="action-buttons">
        <button class="btn-secondary" id="open-pack-btn" ${total === 0 ? 'disabled' : ''} ${_currentUser && packState && packState.readyPacks <= 0 ? 'disabled' : ''} ${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? 'disabled' : ''}>${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? 'Sign In to Open Packs' : 'Open Pack'}</button>
        ${packHTML}
      </div>
    </div>
    ${(() => {
      let starsHTML = '';
      if (_currentUser) {
        const hasDupes = Object.values(library).some(c => c > 1);
        const dupeCount = Object.values(library).reduce((sum, c) => sum + Math.max(0, c - 1), 0);
        const rarityList = ['common','rare','epic','legendary','mythic'];
        const rarityClrs = {common:'#888',rare:'#60a5fa',epic:'#c084fc',legendary:'#ffd700',mythic:'#ff0040'};
        // Compute per-rarity revert/cherry-pick stats
        let totalRevertStars = 0;
        let totalCherryStars = 0;
        const perRarity = rarityList.map(r => {
          const allOfR = allContributors.filter(c => c.rarity === r);
          const dupesOfR = allOfR.reduce((sum, c) => sum + Math.max(0, (library[c.login] || 0) - 1), 0);
          const missingOfR = allOfR.filter(c => !library[c.login]).length;
          const revertStars = dupesOfR * REVERT_YIELD[r];
          const cherryStars = missingOfR * CHERRY_PICK_COST[r];
          totalRevertStars += revertStars;
          totalCherryStars += cherryStars;
          return { rarity: r, dupes: dupesOfR, missing: missingOfR, revertYield: REVERT_YIELD[r], cherryCost: CHERRY_PICK_COST[r], revertStars, cherryStars };
        });

        starsHTML = `<details class="repo-panel-collapse" id="stars-panel"><summary class="repo-panel-toggle">Stars <span class="panel-summary">&starf; ${starBalance}${hasDupes ? ` &middot; ${dupeCount} dupe${dupeCount !== 1 ? 's' : ''} to revert` : ' &middot; revert dupes, cherry-pick cards'}</span></summary>
          <div class="stars-panel-body">
            <div class="stars-balance-display">&starf; ${starBalance} Stars</div>
            <div class="stars-rates">
              <div class="stars-rates-header"><span>Rarity</span><span>Revert</span><span>Dupes</span><span>Cherry-pick</span><span>Missing</span></div>
              ${perRarity.map(r => `<div class="stars-rates-row"><span style="color:${rarityClrs[r.rarity]}">${r.rarity}</span><span>+${r.revertYield}</span><span>${r.dupes > 0 ? r.dupes : '—'}</span><span>${r.cherryCost}</span><span>${r.missing > 0 ? r.missing : '—'}</span></div>`).join('')}
              <div class="stars-rates-totals"><span></span><span></span><span class="stars-total-revert">${totalRevertStars > 0 ? '+' + totalRevertStars + ' &starf;' : ''}</span><span></span><span class="stars-total-cherry">${totalCherryStars > 0 ? totalCherryStars + ' &starf;' : ''}</span></div>
            </div>
            ${hasDupes ? `<button class="stars-revert-all-btn" id="revert-all-btn">Revert All Duplicates (${dupeCount} cards &rarr; +${totalRevertStars} &starf;)</button>` : '<div class="stars-no-dupes">No duplicate cards to revert</div>'}
            ${totalCherryStars > 0 && starBalance >= totalCherryStars ? `<button class="stars-cherry-all-btn" id="cherry-pick-all-btn">Cherry-pick All Missing (${perRarity.reduce((s,r) => s + r.missing, 0)} cards for ${totalCherryStars} &starf;)</button>` : ''}
          </div>
        </details>`;
      }
      const leftCol = achievementHTML ? `<details class="repo-panel-collapse" id="achievements-panel"><summary class="repo-panel-toggle">Your Achievements</summary>${achievementHTML}</details>` : '';
      const pointsTotal = breakdownHTML ? (() => {
        let tb = 0;
        rarityOrder.forEach(r => { tb += allContributors.filter(c => c.rarity === r && library[c.login]).length * rarityPts[r]; });
        const cb = isComplete ? Math.floor(tb * 0.5) : 0;
        return tb + cb;
      })() : 0;
      const rightPanels = [
        breakdownHTML ? `<details class="repo-panel-collapse" id="points-panel"><summary class="repo-panel-toggle">Points <span class="panel-summary">${pointsTotal.toLocaleString()} pts${!isComplete ? ' &middot; 1.5x bonus at completion' : ' &middot; 1.5x bonus active'}</span></summary>${breakdownHTML}</details>` : '',
        starsHTML
      ].filter(Boolean).join('');
      const rightCol = rightPanels ? `<div class="repo-panels-right">${rightPanels}</div>` : '';
      return (leftCol || rightCol) ? `<div class="repo-panels-row">${leftCol}${rightCol}</div>` : '';
    })()}
    <div class="filter-bar" id="filter-bar">
      <div class="filter-group">
        <span class="filter-label">Sort by:</span>
        <select class="sort-select" id="sort-select" onchange="setSortBy(this.value)">
          <option value="power" ${sortBy==='power'?'selected':''}>Power</option>
          <option value="quantity" ${sortBy==='quantity'?'selected':''}>Quantity</option>
          <option value="commits" ${sortBy==='commits'?'selected':''}>Commits</option>
          <option value="prs" ${sortBy==='prs'?'selected':''}>PRs Merged</option>
          <option value="issues" ${sortBy==='issues'?'selected':''}>Issues</option>
          <option value="streak" ${sortBy==='streak'?'selected':''}>Streak</option>
          <option value="peak" ${sortBy==='peak'?'selected':''}>Peak Week</option>
          <option value="consistency" ${sortBy==='consistency'?'selected':''}>Consistency</option>
        </select>
      </div>
      <div class="filter-group">
        <button class="filter-btn ${filterRarity==='all'?'active':''}" onclick="setFilter('all')">All</button>
        <button class="filter-btn ${filterRarity==='mythic'?'active':''}" onclick="setFilter('mythic')">Mythic</button>
        <button class="filter-btn ${filterRarity==='legendary'?'active':''}" onclick="setFilter('legendary')">Legendary</button>
        <button class="filter-btn ${filterRarity==='epic'?'active':''}" onclick="setFilter('epic')">Epic</button>
        <button class="filter-btn ${filterRarity==='rare'?'active':''}" onclick="setFilter('rare')">Rare</button>
        <button class="filter-btn ${filterRarity==='common'?'active':''}" onclick="setFilter('common')">Common</button>
      </div>
      <div class="filter-group">
        <button class="filter-btn ${viewMode==='collected'?'active':''}" onclick="setViewMode('collected')">Collected</button>
        <button class="filter-btn ${viewMode==='all'?'active':''}" onclick="setViewMode('all')">All Cards</button>
        <button class="filter-btn ${viewMode==='missing'?'active':''}" onclick="setViewMode('missing')">Missing</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" class="card-search" id="card-search" placeholder="Search cards..." value="${cardSearch}" />
    </div>`;

  // Open achievements and stars panels on desktop, points stays closed with summary
  if (window.innerWidth > 768) {
    const achPanel = document.getElementById('achievements-panel');
    if (achPanel) achPanel.setAttribute('open', '');
    const starsPanel = document.getElementById('stars-panel');
    if (starsPanel) starsPanel.setAttribute('open', '');
  }

  // Wire up open pack button
  const openPackBtn = document.getElementById('open-pack-btn');
  if (openPackBtn) openPackBtn.addEventListener('click', () => openPack());

  // Wire up revert all duplicates button
  const revertAllBtn = document.getElementById('revert-all-btn');
  if (revertAllBtn) revertAllBtn.addEventListener('click', () => showRevertAllOverlay());

  // Wire up cherry-pick all button
  const cherryAllBtn = document.getElementById('cherry-pick-all-btn');
  if (cherryAllBtn) cherryAllBtn.addEventListener('click', () => showCherryPickAllOverlay());

  // Wire up search input
  const searchInput = document.getElementById('card-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => { cardSearch = e.target.value; renderLibrary(); const el = document.getElementById('card-search'); if (el) { el.focus(); el.setSelectionRange(cardSearch.length, cardSearch.length); } });
  }
  // Wire up switch repo button
  const switchBtn = document.getElementById('switch-repo-btn');
  if (switchBtn) switchBtn.addEventListener('click', () => newRepo());

  // Wire up achievement claim buttons
  repoInfo.querySelectorAll('[data-claim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [statType, threshold] = btn.dataset.claim.split('-');
      claimMilestone(statType, parseInt(threshold, 10));
    });
  });

  // Wire up Claim All button
  const claimAllBtn = document.getElementById('ach-claim-all');
  if (claimAllBtn) claimAllBtn.addEventListener('click', () => claimAllMilestones());

  // Start countdown timer if needed
  if (_currentUser && packState && packState.nextRegenAt) {
    startPackCountdown();
  }
}

function setFilter(rarity) {
  filterRarity = rarity;
  renderRepoInfoFromCurrent();
  renderLibrary();
}


// ===== OPEN PACK =====
let packOpen = false;
async function openPack() {
  if (!allContributors.length || packOpen) return;

  // Check pack availability for logged-in users
  if (_currentUser && packState && packState.readyPacks <= 0) {
    return; // No packs available
  }

  packOpen = true;
  const [owner, repo] = currentRepoName.split('/');
  let response, data;
  try {
    response = await fetch(`/api/repo/${owner}/${repo}/pack`);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (response.status === 429) {
        if (errData.requiresAuth) {
          // Guest pack limit reached
          guestPacksRemaining = 0;
          localStorage.setItem('gp_guest_limit_reached', '1');
          localStorage.setItem('gp_guest_packs_remaining', '0');
          renderTopBarPacks();
          renderRepoInfoFromCurrent();
        } else {
          // No packs available (logged-in user)
          packState = { readyPacks: 0, maxPacks: 2, nextRegenAt: errData.nextRegenAt };
          renderRepoInfoFromCurrent();
        }
      }
      packOpen = false;
      return;
    }

    data = await response.json();
  } catch (err) {
    console.error('[GHTC] openPack fetch error:', err);
    packOpen = false;
    return;
  }

  // Handle response: update pack state immediately so buttons show correct count
  let picks;
  if (Array.isArray(data)) {
    picks = data;
  } else {
    picks = data.cards;
    if (data.packState) {
      packState = data.packState;
    }
    if (data.guestPacksRemaining !== undefined) {
      guestPacksRemaining = data.guestPacksRemaining;
      localStorage.setItem('gp_guest_packs_remaining', String(guestPacksRemaining));
    }
  }
  renderTopBarPacks();

  const overlay = document.createElement('div');
  overlay.className = 'pack-overlay';

  // Sign-in banner for logged-out users — persistent across all pack stages
  const packAuthBanner = !_currentUser ? `<div class="pack-auth-banner"><span class="pack-auth-banner-icon">&#x1f512;</span> Sign in to save your cards <button class="login-btn pack-auth-banner-btn" id="pack-sign-in-btn"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign In</button></div>` : '';

  const oddsHTML = getPackOddsHTML();

  overlay.innerHTML = `
    <button class="pack-close-btn" id="pack-close-btn">&times;</button>
    ${packAuthBanner}
    <div class="pack-container">
      <div class="pack-wrapper" id="pack-wrapper">
        <div class="pack-face">
          <div class="pack-seal-left"></div>
          <div class="pack-seal-right"></div>
          <div class="pack-logo">
            <div class="pack-logo-ring">${GP_ICON}</div>
          </div>
          <div class="pack-title"><span class="pack-owner">${currentRepoName.split('/')[0]}</span><span class="pack-repo">${currentRepoName.split('/')[1] || ''}</span></div>
          <div class="pack-subtitle">5 Contributors</div>
          <div class="pack-stripe"><span>GitPacks</span></div>
        </div>
        <div class="pack-burst" id="pack-burst"></div>
      </div>
      <div class="pack-instruction">Click to open</div>
      <div class="reveal-area" id="reveal-area" style="display:none"></div>
    </div>
    ${oddsHTML}`;
  document.body.appendChild(overlay);


  const packWrapper = overlay.querySelector('#pack-wrapper');
  const instruction = overlay.querySelector('.pack-instruction');
  function tearPack() {
    if (packWrapper.classList.contains('tearing')) return;
    packWrapper.classList.add('tearing');
    instruction.style.display = 'none';
    overlay.querySelector('#pack-burst').innerHTML = '<div class="burst-ring"></div>';
    setTimeout(() => { packWrapper.style.display = 'none'; revealCards(overlay, picks, null); }, 700);
    clearSpaceAction();
  }
  packWrapper.addEventListener('click', tearPack);
  setSpaceAction(tearPack);

  function closePack() { packOpen = false; overlay.remove(); clearSpaceAction(); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); }
  overlay._escHandler = e => { if (e.code === 'Escape') closePack(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#pack-close-btn').addEventListener('click', closePack);

  // Wire up sign-in button in auth banner
  const packSignInBtn = overlay.querySelector('#pack-sign-in-btn');
  if (packSignInBtn) {
    packSignInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.__gpLogin) window.__gpLogin();
    });
  }
}

function revealCards(overlay, picks, onComplete) {
  const area = overlay.querySelector('#reveal-area');
  area.style.display = 'flex';
  const rarityOrder = { common:0, rare:1, epic:2, legendary:3, mythic:4 };
  const sorted = [...picks];

  sorted.forEach((c, i) => {
    const isNew = !library[c.login];
    const slot = document.createElement('div');
    slot.className = 'reveal-slot';
    slot.dataset.rarity = c.rarity;

    const cardNum = allContributors.indexOf(c) + 1;
    const cardHTML = buildGalleryCard(c, cardNum, allContributors.length);

    slot.innerHTML = `
      <div class="rarity-glow"></div>
      <div class="reveal-card">
        <div class="reveal-card-back">
          <div class="reveal-card-back-logo">${GP_ICON}</div>
          <div class="reveal-card-back-repo"><span class="repo-owner">${currentRepoName.split('/')[0]}</span><span class="repo-name">${currentRepoName.split('/')[1] || ''}</span></div>
          <div class="reveal-card-back-brand">GitPacks</div>
        </div>
        <div class="reveal-card-front">
          <div class="card-wrapper" data-rarity="${c.rarity}" style="opacity:1">${cardHTML}</div>
        </div>
      </div>`;

    slot._isNew = isNew;
    slot._rarity = c.rarity;
    slot._contributor = c;
    area.appendChild(slot);
  });

  const slots = Array.from(area.querySelectorAll('.reveal-slot'));
  let flipped = 0;
  let revealComplete = false;

  area.offsetHeight;

  slots.forEach(s => {
    const slotW = s.offsetWidth;
    const slotH = s.offsetHeight;
    const w = slotW > 10 ? slotW : 190;
    const h = slotH > 10 ? slotH : 293;
    const cardScale = Math.min(w / 320, h / 480);
    const cw = s.querySelector('.reveal-card-front .card-wrapper');
    if (cw) cw.style.transform = `scale(${cardScale})`;
  });

  slots.forEach(s => {
    s.classList.add('unflipped');
    s.style.opacity = '0';
    s.style.transform = 'translateY(30px)';
  });
  area.offsetHeight;
  slots.forEach((s, i) => {
    setTimeout(() => { s.style.transition = 'opacity 0.4s ease, transform 0.4s ease'; s.style.opacity = '1'; s.style.transform = 'translateY(0)'; }, i * 100);
  });

  const flipInstruction = document.createElement('div');
  flipInstruction.className = 'pack-instruction';
  flipInstruction.textContent = 'Click a card or press Space';
  overlay.querySelector('.pack-container').appendChild(flipInstruction);

  function getNextUnflipped() {
    return slots.find(s => s.classList.contains('unflipped'));
  }

  function flipSlot(slot) {
    if (!slot || !slot.classList.contains('unflipped') || slot._flipping) return;
    slot._flipping = true;
    slot.classList.remove('unflipped');
    const rarity = slot._rarity;
    const card = slot.querySelector('.reveal-card');
    const isNew = slot._isNew;

    card.classList.add('flip-' + rarity);

    const glowDelay = { common:400, rare:600, epic:800, legendary:1000, mythic:1400 }[rarity] || 400;
    setTimeout(() => {
      if (rarity !== 'common') slot.classList.add('revealed');
    }, glowDelay * 0.5);

    if (rarity === 'mythic') {
      overlay.classList.add('shake-screen');
      setTimeout(() => { overlay.classList.remove('shake-screen'); setTimeout(() => overlay.classList.add('shake-screen'), 100); setTimeout(() => overlay.classList.remove('shake-screen'), 600); }, 500);
      const flash = document.createElement('div');
      flash.className = 'screen-flash mythic-screen';
      overlay.appendChild(flash);
      setTimeout(() => flash.remove(), 1500);
      slot.insertAdjacentHTML('beforeend', '<div class="mythic-flash"></div><div class="mythic-ring"></div><div class="mythic-ring2"></div><div class="mythic-ring3"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ff0040','#ff6600','#fff','#ff00ff','#ff0040','#fff','#ff6600'];
      for (let i = 0; i < 35; i++) {
        const angle = (Math.PI * 2 / 35) * i + (Math.random() - 0.5) * 0.5;
        const dist = 100 + Math.random() * 160;
        const px = Math.cos(angle) * dist;
        const py = Math.sin(angle) * dist;
        const dur = 0.8 + Math.random() * 0.8;
        const pdel = Math.random() * 0.3;
        const col = colors[Math.floor(Math.random() * colors.length)];
        const size = 4 + Math.random() * 7;
        particles += `<div class="leg-particle" style="width:${size}px;height:${size}px;background:${col};--px:${px}px;--py:${py}px;--pdur:${dur}s;--pdelay:${pdel}s"></div>`;
      }
      particles += '</div>';
      slot.insertAdjacentHTML('beforeend', particles);
    }
    else if (rarity === 'rare') {
      slot.insertAdjacentHTML('beforeend', '<div class="rare-flash"></div>');
    }
    else if (rarity === 'epic') {
      const flash = document.createElement('div');
      flash.className = 'screen-flash epic-screen';
      overlay.appendChild(flash);
      setTimeout(() => flash.remove(), 600);
      slot.insertAdjacentHTML('beforeend', '<div class="epic-flash"></div><div class="epic-ring"></div>');
    }
    else if (rarity === 'legendary') {
      overlay.classList.add('shake-screen');
      setTimeout(() => overlay.classList.remove('shake-screen'), 500);
      const flash = document.createElement('div');
      flash.className = 'screen-flash legendary-screen';
      overlay.appendChild(flash);
      setTimeout(() => flash.remove(), 1000);
      slot.insertAdjacentHTML('beforeend', '<div class="legendary-flash"></div><div class="legendary-ring"></div><div class="legendary-ring2"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ffd700','#ff6ec7','#fff','#ffd700','#ff9a56','#fff'];
      for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 / 20) * i + (Math.random() - 0.5) * 0.5;
        const dist = 80 + Math.random() * 120;
        const px = Math.cos(angle) * dist;
        const py = Math.sin(angle) * dist;
        const dur = 0.6 + Math.random() * 0.6;
        const pdel = Math.random() * 0.2;
        const col = colors[Math.floor(Math.random() * colors.length)];
        const size = 3 + Math.random() * 5;
        particles += `<div class="leg-particle" style="width:${size}px;height:${size}px;background:${col};--px:${px}px;--py:${py}px;--pdur:${dur}s;--pdelay:${pdel}s"></div>`;
      }
      particles += '</div>';
      slot.insertAdjacentHTML('beforeend', particles);
    }

    if (isNew) {
      const badgeDelay = rarity === 'mythic' ? 1200 : rarity === 'legendary' ? 800 : rarity === 'epic' ? 500 : 300;
      setTimeout(() => {
        slot.insertAdjacentHTML('beforeend', `<div class="reveal-badge is-new">NEW</div>`);
      }, badgeDelay);
    }

    // For logged-out users, save to localStorage
    if (!_currentUser) {
      library[slot._contributor.login] = (library[slot._contributor.login] || 0) + 1;
      saveLibrary();
    } else {
      // For logged-in users, cards are already saved server-side by the pack endpoint
      // Just update the local cache
      library[slot._contributor.login] = (library[slot._contributor.login] || 0) + 1;
      saveLibrary(); // sync localStorage cache
    }

    flipped++;

    setTimeout(() => {
      if (flipped >= slots.length && !revealComplete) {
        revealComplete = true;
        if (onComplete) onComplete();
        flipInstruction.remove();
        clearSpaceAction();

        slots.forEach(s => {
          s.classList.add('hoverable');
          s.addEventListener('click', () => {
            const c = s._contributor;
            if (c) openFullscreenCard(c);
          });
        });

        let anotherOpened = false;
        async function openAnother() {
          if (anotherOpened) return;
          anotherOpened = true;
          clearSpaceAction();

          // Fade out current content, keeping the overlay visible
          const container = overlay.querySelector('.pack-container');
          container.style.transition = 'opacity 0.25s ease';
          container.style.opacity = '0';

          // Fetch next pack while fading
          const [ow, rp] = currentRepoName.split('/');
          let nextPicks = null;
          try {
            const res = await fetch(`/api/repo/${ow}/${rp}/pack`);
            if (res.ok) {
              const d = await res.json();
              if (Array.isArray(d)) { nextPicks = d; }
              else {
                nextPicks = d.cards;
                if (d.packState) packState = d.packState;
                if (d.guestPacksRemaining !== undefined) { guestPacksRemaining = d.guestPacksRemaining; localStorage.setItem('gp_guest_packs_remaining', String(guestPacksRemaining)); }
              }
              renderTopBarPacks();
            } else if (res.status === 429) {
              const errData = await res.json().catch(() => ({}));
              packState = { readyPacks: 0, maxPacks: 2, nextRegenAt: errData.nextRegenAt };
              renderTopBarPacks();
            }
          } catch { /* handled below */ }

          if (!nextPicks) {
            // Failed to get pack — close overlay gracefully
            packOpen = false;
            overlay.remove();
            document.removeEventListener('keydown', overlay._escHandler);
            renderRepoInfoFromCurrent(); renderLibrary();
            return;
          }

          // Reset the overlay content with the new pack (no blink)
          container.innerHTML = `
            <div class="pack-wrapper" id="pack-wrapper">
              <div class="pack-face">
                <div class="pack-seal-left"></div>
                <div class="pack-seal-right"></div>
                <div class="pack-logo"><div class="pack-logo-ring">${GP_ICON}</div></div>
                <div class="pack-title"><span class="pack-owner">${currentRepoName.split('/')[0]}</span><span class="pack-repo">${currentRepoName.split('/')[1] || ''}</span></div>
                <div class="pack-subtitle">5 Contributors</div>
                <div class="pack-stripe"><span>GitPacks</span></div>
              </div>
              <div class="pack-burst" id="pack-burst"></div>
            </div>
            <div class="pack-instruction">Click to open</div>
            <div class="reveal-area" id="reveal-area" style="display:none"></div>`;

          // Fade in the new pack
          void container.offsetHeight;
          container.style.opacity = '1';

          // Wire up the new pack wrapper
          const newWrapper = container.querySelector('#pack-wrapper');
          const newInstruction = container.querySelector('.pack-instruction');
          function tearNewPack() {
            if (newWrapper.classList.contains('tearing')) return;
            newWrapper.classList.add('tearing');
            newInstruction.style.display = 'none';
            container.querySelector('#pack-burst').innerHTML = '<div class="burst-ring"></div>';
            setTimeout(() => { newWrapper.style.display = 'none'; revealCards(overlay, nextPicks, null); }, 700);
            clearSpaceAction();
          }
          newWrapper.addEventListener('click', tearNewPack);
          setSpaceAction(tearNewPack);

          // Update close handler to clean up new listeners
          document.removeEventListener('keydown', overlay._escHandler);
          function closeNewPack() { packOpen = false; overlay.remove(); clearSpaceAction(); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); }
          overlay._escHandler = e => { if (e.code === 'Escape') closeNewPack(); };
          document.addEventListener('keydown', overlay._escHandler);
          overlay.querySelector('#pack-close-btn').onclick = closeNewPack;

          renderRepoInfoFromCurrent(); renderLibrary();
        }

        setTimeout(() => {
          if (!anotherOpened) setSpaceAction(openAnother);
        }, 200);

        const btnWrap = document.createElement('div');
        btnWrap.className = 'reveal-buttons';
        const doneBtn = document.createElement('button');
        doneBtn.className = 'reveal-done-btn';
        doneBtn.textContent = 'View Library';
        doneBtn.onclick = () => { packOpen = false; overlay.remove(); clearSpaceAction(); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); };
        const anotherBtn = document.createElement('button');
        anotherBtn.className = 'reveal-another-btn';

        // Show pack count and hide button if no packs left
        let hasMorePacks = true;
        if (_currentUser && packState) {
          anotherBtn.textContent = packState.readyPacks > 0 ? `Open Another (${packState.readyPacks})` : 'No Packs Left';
          if (packState.readyPacks <= 0) hasMorePacks = false;
        } else if (!_currentUser) {
          const limitReached = localStorage.getItem('gp_guest_limit_reached');
          if (limitReached || guestPacksRemaining <= 0) {
            hasMorePacks = false;
          } else {
            anotherBtn.textContent = `Open Another (${guestPacksRemaining})`;
          }
        } else {
          anotherBtn.textContent = 'Open Another';
        }
        if (!hasMorePacks) anotherBtn.style.display = 'none';
        anotherBtn.onclick = openAnother;
        btnWrap.appendChild(doneBtn);
        btnWrap.appendChild(anotherBtn);
        overlay.querySelector('.pack-container').appendChild(btnWrap);
      }
    }, glowDelay);
  }

  slots.forEach(slot => {
    slot.addEventListener('click', () => {
      if (slot.classList.contains('unflipped')) flipSlot(slot);
    });
  });

  let spaceQueued = false;
  // Use global space action for "flip all" — re-sets itself until complete
  function flipAllViaSpace() {
    if (revealComplete || spaceQueued) return;
    spaceQueued = true;
    function flipNext() {
      const next = getNextUnflipped();
      if (!next) { spaceQueued = false; return; }
      flipSlot(next);
      setTimeout(flipNext, 150);
    }
    flipNext();
  }
  setSpaceAction(flipAllViaSpace);
}

// ===== SELF-CARD REVEAL =====
function revealSelfCard(contributor, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'self-card-overlay';

  const cardNum = allContributors.indexOf(contributor) + 1;
  const cardHTML = buildGalleryCard(contributor, cardNum, allContributors.length);

  overlay.innerHTML = `
    <button class="pack-close-btn" id="self-card-close-btn">&times;</button>
    <div class="self-card-container">
      <div class="self-card-message">You're a contributor!</div>
      <div class="self-card-slot">
        <div class="rarity-glow"></div>
        <div class="reveal-card">
          <div class="reveal-card-back">
            <div class="reveal-card-back-logo">${GP_ICON}</div>
            <div class="reveal-card-back-repo"><span class="repo-owner">${currentRepoName.split('/')[0]}</span><span class="repo-name">${currentRepoName.split('/')[1] || ''}</span></div>
            <div class="reveal-card-back-brand">GitPacks</div>
          </div>
          <div class="reveal-card-front">
            <div class="card-wrapper" data-rarity="${contributor.rarity}" style="opacity:1">${cardHTML}</div>
          </div>
        </div>
      </div>
      <div class="self-card-subtitle">Your card has been added to your collection</div>
      <button class="btn-primary self-card-continue" id="self-card-continue">Continue</button>
    </div>`;

  document.body.appendChild(overlay);

  // Scale the card to fit
  const slot = overlay.querySelector('.self-card-slot');
  const cw = slot.querySelector('.reveal-card-front .card-wrapper');
  if (cw) {
    const slotW = slot.offsetWidth || 220;
    const slotH = slot.offsetHeight || 340;
    const cardScale = Math.min(slotW / 320, slotH / 480);
    cw.style.transform = `scale(${cardScale})`;
  }

  // Start face-down, auto-flip after a delay
  slot.classList.add('unflipped');
  const card = slot.querySelector('.reveal-card');
  const rarity = contributor.rarity;

  setTimeout(() => {
    slot.classList.remove('unflipped');
    card.classList.add('flip-' + rarity);

    const glowDelay = { common:400, rare:600, epic:800, legendary:1000, mythic:1400 }[rarity] || 400;
    setTimeout(() => {
      if (rarity !== 'common') slot.classList.add('revealed');
    }, glowDelay * 0.5);

    // Add rarity effects
    if (rarity === 'mythic') {
      overlay.classList.add('shake-screen');
      setTimeout(() => overlay.classList.remove('shake-screen'), 600);
      slot.insertAdjacentHTML('beforeend', '<div class="mythic-flash"></div><div class="mythic-ring"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ff0040','#ff6600','#fff','#ff00ff'];
      for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 / 20) * i;
        const dist = 80 + Math.random() * 120;
        const px = Math.cos(angle) * dist;
        const py = Math.sin(angle) * dist;
        const col = colors[Math.floor(Math.random() * colors.length)];
        particles += `<div class="leg-particle" style="width:5px;height:5px;background:${col};--px:${px}px;--py:${py}px;--pdur:${0.8 + Math.random() * 0.6}s;--pdelay:${Math.random() * 0.2}s"></div>`;
      }
      particles += '</div>';
      slot.insertAdjacentHTML('beforeend', particles);
    } else if (rarity === 'legendary') {
      overlay.classList.add('shake-screen');
      setTimeout(() => overlay.classList.remove('shake-screen'), 500);
      slot.insertAdjacentHTML('beforeend', '<div class="legendary-flash"></div><div class="legendary-ring"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ffd700','#ff6ec7','#fff'];
      for (let i = 0; i < 15; i++) {
        const angle = (Math.PI * 2 / 15) * i;
        const dist = 60 + Math.random() * 100;
        const px = Math.cos(angle) * dist;
        const py = Math.sin(angle) * dist;
        const col = colors[Math.floor(Math.random() * colors.length)];
        particles += `<div class="leg-particle" style="width:4px;height:4px;background:${col};--px:${px}px;--py:${py}px;--pdur:${0.6 + Math.random() * 0.5}s;--pdelay:${Math.random() * 0.2}s"></div>`;
      }
      particles += '</div>';
      slot.insertAdjacentHTML('beforeend', particles);
    } else if (rarity === 'epic') {
      slot.insertAdjacentHTML('beforeend', '<div class="epic-flash"></div><div class="epic-ring"></div>');
    } else if (rarity === 'rare') {
      slot.insertAdjacentHTML('beforeend', '<div class="rare-flash"></div>');
    }
  }, 800);

  function closeOverlay() {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    if (onDone) onDone();
  }

  const escHandler = e => { if (e.key === 'Escape') closeOverlay(); };
  document.addEventListener('keydown', escHandler);
  overlay.querySelector('#self-card-close-btn').addEventListener('click', closeOverlay);
  overlay.querySelector('#self-card-continue').addEventListener('click', closeOverlay);
}

// ===== CLAIM MILESTONE =====
async function claimMilestone(statType, threshold) {
  const [owner, repo] = currentRepoName.split('/');
  const btn = document.querySelector(`[data-claim="${statType}-${threshold}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Claiming...'; }

  try {
    const res = await fetch(`/api/achievements/${owner}/${repo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stat_type: statType, threshold }),
    });
    if (!res.ok) {
      if (btn) { btn.disabled = false; btn.textContent = '\u{1F381} ' + threshold; }
      return;
    }
    const data = await res.json();

    // Mark as claimed in local achievement data
    if (lastAchievementData && lastAchievementData.milestones && lastAchievementData.milestones[statType]) {
      lastAchievementData.milestones[statType].claimed.push(threshold);
      lastAchievementData.milestones[statType].claimable =
        lastAchievementData.milestones[statType].claimable.filter(t => t !== threshold);
    }

    // Update the achievements panel
    renderRepoInfoFromCurrent();

    // Open the pack reveal with the drawn cards
    revealMilestonePack(data.cards);
  } catch (err) {
    console.error('[GHTC] claimMilestone error:', err);
    if (btn) { btn.disabled = false; btn.textContent = '\u{1F381} ' + threshold; }
  }
}

function getClaimableList() {
  if (!lastAchievementData || !lastAchievementData.milestones) return [];
  const list = [];
  for (const [statType, m] of Object.entries(lastAchievementData.milestones)) {
    for (const t of m.claimable) {
      list.push({ stat_type: statType, threshold: t });
    }
  }
  return list;
}

function revealMilestonePack(cards) {
  packOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'pack-overlay';
  overlay.innerHTML = `
    <button class="pack-close-btn" id="pack-close-btn">&times;</button>
    <div class="pack-container">
      <div class="reveal-area" id="reveal-area" style="display:flex"></div>
    </div>
    ${getPackOddsHTML()}`;
  document.body.appendChild(overlay);

  function closePack() {
    packOpen = false;
    overlay.remove();
    document.removeEventListener('keydown', overlay._escHandler);
    if (_currentUser) loadLibraryFromDB().then(() => { renderRepoInfoFromCurrent(); renderLibrary(); });
  }
  overlay._escHandler = e => { if (e.code === 'Escape') closePack(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#pack-close-btn').addEventListener('click', closePack);

  // Show cards and add achievement-specific buttons after reveal
  function showPackInOverlay(packCards) {
    revealCards(overlay, packCards, () => {
      // Replace default buttons after a tick (revealCards adds its own)
      setTimeout(() => {
        overlay.querySelectorAll('.reveal-buttons').forEach(el => el.remove());

        const remaining = getClaimableList();
        const btnWrap = document.createElement('div');
        btnWrap.className = 'reveal-buttons';

        const doneBtn = document.createElement('button');
        doneBtn.className = 'reveal-done-btn';
        doneBtn.textContent = 'View Library';
        doneBtn.onclick = closePack;
        btnWrap.appendChild(doneBtn);

        if (remaining.length > 0) {
          const nextBtn = document.createElement('button');
          nextBtn.className = 'reveal-another-btn';
          nextBtn.textContent = `Next Achievement Pack (${remaining.length})`;
          nextBtn.onclick = async () => {
            if (nextBtn.disabled) return;
            nextBtn.disabled = true;
            const next = remaining[0];
            const [ow, rp] = currentRepoName.split('/');
            try {
              const res = await fetch(`/api/achievements/${ow}/${rp}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next),
              });
              if (!res.ok) { closePack(); return; }
              const data = await res.json();
              if (lastAchievementData?.milestones?.[next.stat_type]) {
                lastAchievementData.milestones[next.stat_type].claimed.push(next.threshold);
                lastAchievementData.milestones[next.stat_type].claimable =
                  lastAchievementData.milestones[next.stat_type].claimable.filter(t => t !== next.threshold);
              }
              // Fade out, reset, fade in, reveal next pack
              const container = overlay.querySelector('.pack-container');
              container.style.transition = 'opacity 0.25s ease';
              container.style.opacity = '0';
              await new Promise(r => setTimeout(r, 300));
              container.innerHTML = `<div class="reveal-area" id="reveal-area" style="display:flex"></div>`;
              void container.offsetHeight;
              container.style.opacity = '1';
              showPackInOverlay(data.cards);
            } catch { closePack(); }
          };
          btnWrap.appendChild(nextBtn);

          // Space to open next
          setTimeout(() => setSpaceAction(() => nextBtn.onclick()), 200);
        } else {
          // No more achievement packs — space closes
          setTimeout(() => setSpaceAction(closePack), 200);
        }

        overlay.querySelector('.pack-container').appendChild(btnWrap);
      }, 50);
    });
  }

  showPackInOverlay(cards);
}

// ===== CLAIM ALL MILESTONES =====
async function claimAllMilestones() {
  const claimable = getClaimableList();
  if (claimable.length === 0) return;

  // Show overlay with loading spinner immediately to block other interactions
  packOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'pack-overlay';
  overlay.innerHTML = `
    <button class="pack-close-btn" id="pack-close-btn">&times;</button>
    <div class="pack-container claim-all-container">
      <div class="claim-all-header">${claimable.length} Achievement Pack${claimable.length !== 1 ? 's' : ''}</div>
      <div class="claim-all-loading"><div class="spinner"></div><p>Opening ${claimable.length} pack${claimable.length !== 1 ? 's' : ''}...</p></div>
      <div class="reveal-area claim-all-area no-card-effects" id="reveal-area" style="display:flex;display:none"></div>
    </div>
    ${getPackOddsHTML()}`;
  document.body.appendChild(overlay);

  function closePack() {
    packOpen = false;
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    if (_currentUser) loadLibraryFromDB().then(() => { renderRepoInfoFromCurrent(); renderLibrary(); });
  }
  const escHandler = e => { if (e.code === 'Escape') closePack(); };
  document.addEventListener('keydown', escHandler);
  overlay.querySelector('#pack-close-btn').addEventListener('click', closePack);

  // Fetch all cards
  const [owner, repo] = currentRepoName.split('/');
  let allCards = [];
  try {
    const res = await fetch(`/api/achievements/${owner}/${repo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_all: true }),
    });
    if (!res.ok) { closePack(); return; }
    const data = await res.json();
    allCards = data.cards || [];
    if (data.milestones && lastAchievementData?.milestones) {
      for (const m of data.milestones) {
        const ms = lastAchievementData.milestones[m.stat_type];
        if (ms) { ms.claimed.push(m.threshold); ms.claimable = ms.claimable.filter(t => t !== m.threshold); }
      }
    }
  } catch { closePack(); return; }

  renderRepoInfoFromCurrent();
  if (allCards.length === 0) { closePack(); return; }

  // Hide loading, show reveal area
  const loadingEl = overlay.querySelector('.claim-all-loading');
  if (loadingEl) loadingEl.remove();
  const area = overlay.querySelector('#reveal-area');
  area.style.display = 'flex';

  // Sort: common first, mythic last
  const rarityOrder = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  allCards.sort((a, b) => (rarityOrder[a.rarity] || 0) - (rarityOrder[b.rarity] || 0));

  const seenLogins = new Set(Object.keys(library));
  const slots = [];

  allCards.forEach((c) => {
    const isNew = !seenLogins.has(c.login);
    const slot = document.createElement('div');
    slot.className = 'reveal-slot unflipped';
    slot.dataset.rarity = c.rarity;

    const cardNum = allContributors.indexOf(c) + 1;
    const cardHTML = buildGalleryCard(c, cardNum, allContributors.length);

    slot.innerHTML = `
      <div class="rarity-glow"></div>
      <div class="reveal-card">
        <div class="reveal-card-back">
          <div class="reveal-card-back-logo">${GP_ICON}</div>
          <div class="reveal-card-back-repo"><span class="repo-owner">${currentRepoName.split('/')[0]}</span><span class="repo-name">${currentRepoName.split('/')[1] || ''}</span></div>
          <div class="reveal-card-back-brand">GitPacks</div>
        </div>
        <div class="reveal-card-front">
          <div class="card-wrapper" data-rarity="${c.rarity}" style="opacity:1">${cardHTML}</div>
        </div>
      </div>`;

    slot._isNew = isNew;
    slot._rarity = c.rarity;
    slot._contributor = c;
    // Mark as seen so subsequent dupes don't get NEW
    seenLogins.add(c.login);
    area.appendChild(slot);
    slots.push(slot);
  });

  // Scale cards
  area.offsetHeight;
  slots.forEach(s => {
    const slotW = s.offsetWidth || 190;
    const slotH = s.offsetHeight || 293;
    const cardScale = Math.min(slotW / 320, slotH / 480);
    const cw = s.querySelector('.reveal-card-front .card-wrapper');
    if (cw) cw.style.transform = `scale(${cardScale})`;
  });

  // Show all cards immediately
  slots.forEach(s => { s.style.opacity = '1'; });

  let flipped = 0;

  function flipNext() {
    if (flipped >= slots.length) {
      // All done — re-enable card shimmer and show buttons
      area.classList.remove('no-card-effects');
      const btnWrap = document.createElement('div');
      btnWrap.className = 'reveal-buttons';
      const doneBtn = document.createElement('button');
      doneBtn.className = 'reveal-done-btn';
      doneBtn.textContent = 'View Library';
      doneBtn.onclick = closePack;
      btnWrap.appendChild(doneBtn);
      overlay.querySelector('.pack-container').appendChild(btnWrap);
      slots.forEach(s => {
        s.classList.add('hoverable');
        s.addEventListener('click', () => { if (s._contributor) openFullscreenCard(s._contributor); });
      });
      return;
    }

    const slot = slots[flipped];
    const rarity = slot._rarity;
    const card = slot.querySelector('.reveal-card');

    slot.classList.remove('unflipped');
    card.classList.add('flip-' + rarity);

    // Glow only (no particles yet)
    const glowDelay = { common: 80, rare: 120, epic: 180, legendary: 250, mythic: 350 }[rarity] || 80;
    setTimeout(() => { if (rarity !== 'common') slot.classList.add('revealed'); }, glowDelay * 0.5);

    if (slot._isNew) {
      setTimeout(() => { slot.insertAdjacentHTML('beforeend', '<div class="reveal-badge is-new">NEW</div>'); }, glowDelay);
    }

    library[slot._contributor.login] = (library[slot._contributor.login] || 0) + 1;
    saveLibrary();

    slot.scrollIntoView({ behavior: 'smooth', block: 'center' });

    flipped++;
    const delay = { common: 50, rare: 80, epic: 150, legendary: 300, mythic: 500 }[rarity] || 50;
    setTimeout(flipNext, delay);
  }

  // Start flipping immediately
  setTimeout(flipNext, 200);
}

window.claimMilestone = claimMilestone;
window.claimAllMilestones = claimAllMilestones;

// ===== COMPLETE LIBRARY =====
function setViewMode(mode) {
  viewMode = mode;
  renderRepoInfoFromCurrent();
  renderLibrary();
}

function setSortBy(sort) {
  sortBy = sort;
  renderLibrary();
}

function shareRepo() {
  const url = window.location.origin + window.location.pathname + '?repo=' + currentRepoName;
  const btn = document.getElementById('share-btn');
  navigator.clipboard.writeText(url).then(() => {
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Share', 2000); }
  }).catch(() => {
    prompt('Copy this link:', url);
  });
}

function newRepo() {
  repoLoaded = false;
  allContributors = [];
  library = {};
  currentRepoName = '';
  filterRarity = 'all';
  viewMode = 'collected';
  sortBy = 'power';
  cardSearch = '';
  packState = null;
  if (packCountdownInterval) clearInterval(packCountdownInterval);
  grid.innerHTML = '';
  repoInfo.style.display = 'none';
  searchContainer.style.display = '';
  popularRepos.style.display = '';
  document.getElementById('gallery-screen').classList.remove('repo-loaded');
  input.value = '';
  input.focus();
  history.replaceState(null, '', window.location.pathname);
  loadPopularRepos();
}

// ===== RENDER LIBRARY =====
function renderLibrary() {
  grid.innerHTML = '';
  if (!repoLoaded) return;
  const allCollected = allContributors.filter(c => library[c.login]);
  if (allCollected.length === 0 && viewMode === 'collected') {
    grid.innerHTML = `<div class="empty-library">
      <div class="empty-icon">${GP_ICON}</div>
      <p>Open a pack to start collecting!</p>
    </div>`;
    return;
  }

  let pool;
  if (viewMode === 'missing') pool = allContributors.filter(c => !library[c.login]);
  else if (viewMode === 'all') pool = [...allContributors];
  else pool = [...allCollected];

  if (filterRarity !== 'all') pool = pool.filter(c => c.rarity === filterRarity);
  if (cardSearch) { const q = cardSearch.toLowerCase(); pool = pool.filter(c => c.login.toLowerCase().includes(q) || (c.title && c.title.toLowerCase().includes(q))); }

  const sortFns = {
    power: (a, b) => b.power - a.power,
    quantity: (a, b) => (library[b.login] || 0) - (library[a.login] || 0),
    name: (a, b) => a.login.localeCompare(b.login),
    commits: (a, b) => b.commits - a.commits,
    prs: (a, b) => b.prsMerged - a.prsMerged,
    issues: (a, b) => b.issues - a.issues,
    streak: (a, b) => b.maxStreak - a.maxStreak,
    peak: (a, b) => b.peak - a.peak,
    consistency: (a, b) => b.activeWeeks - a.activeWeeks,
  };
  pool.sort(sortFns[sortBy] || sortFns.power);

  if (pool.length === 0) {
    grid.innerHTML = `<div class="empty-library"><p>No cards match filters</p></div>`;
    return;
  }

  const totalCards = allContributors.length;
  pool.forEach((c, i) => {
    const owned = !!library[c.login];
    const w = document.createElement('div');
    w.className = owned ? 'card-wrapper clickable' : 'card-wrapper ghost-card';
    w.dataset.rarity = c.rarity;
    w._cardData = c;
    w._owned = owned;
    w._cardNum = allContributors.indexOf(c) + 1;
    w._totalCards = totalCards;
    w.addEventListener('click', () => openFullscreenCard(c));
    grid.appendChild(w);
  });

  if (!grid._hoverBound) {
    grid._hoverBound = true;
    grid.addEventListener('mousemove', e => {
      const card = e.target.closest('.card');
      if (!card || card._lastMove && Date.now() - card._lastMove < 16) return;
      card._lastMove = Date.now();
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.04)`;
      const shine = card.querySelector('.card-shine');
      if (shine) shine.style.background = `radial-gradient(circle at ${(x+.5)*100}% ${(y+.5)*100}%, rgba(255,255,255,0.15) 0%, transparent 60%)`;
    });
    grid.addEventListener('mouseleave', e => {
      const card = e.target.closest('.card');
      if (card) card.style.transform = '';
    }, true);
  }

  if (window._cardObserver) window._cardObserver.disconnect();
  window._cardObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const w = e.target;
      if (e.isIntersecting) {
        if (!w._rendered) {
          w._rendered = true;
          w.innerHTML = buildGalleryCard(w._cardData, w._cardNum, w._totalCards);
          if (w._owned) {
            const qty = library[w._cardData.login] || 1;
            if (qty > 1) w.insertAdjacentHTML('beforeend', `<div class="card-qty">x${qty}</div>`);
          }
        }
        w.classList.remove('offscreen');
      } else {
        w.classList.add('offscreen');
      }
    });
  }, { rootMargin: '400px' });
  grid.querySelectorAll('.card-wrapper').forEach(w => window._cardObserver.observe(w));
}

function renderRepoInfoFromCurrent() {
  const parts = input.value.trim().replace(/^https?:\/\/github\.com\//, '').match(/^([^/]+)\/([^/]+)/);
  if (parts) renderRepoInfo(parts[1], parts[2]);
}

// ===== HELPERS =====
function showError(m) { errorEl.textContent = m; errorEl.style.display = m ? 'block' : 'none'; }

// ===== FULLSCREEN CARD VIEW =====
function openFullscreenCard(c) {
  const overlay = document.createElement('div');
  const isGhost = !library[c.login];
  overlay.className = 'fullscreen-overlay' + (isGhost ? ' fullscreen-ghost' : '');
  const cardNum = allContributors.indexOf(c) + 1;
  const cardHTML = buildGalleryCard(c, cardNum, allContributors.length);

  // Update URL to include card param so the link is shareable
  history.pushState(null, '', `?repo=${currentRepoName}&card=${c.login}`);

  let _popHandler = null;
  const closeOverlay = () => {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    if (_popHandler) window.removeEventListener('popstate', _popHandler);
    history.pushState(null, '', `?repo=${currentRepoName}`);
  };
  const escHandler = e => { if (e.key === 'Escape') closeOverlay(); };

  const weeksSinceFirst = (c.firstCommitTs && isFinite(c.firstCommitTs)) ? Math.round((Date.now() / 1000 - c.firstCommitTs) / 604800) : 0;
  const pct = c.pctScores || {};
  const rc = rarityColor(c.rarity);

  const dom = c.dominantStat;
  function statRow(label, value, pctVal, color, highlight) {
    const p = Math.round((pctVal || 0) * 100);
    const hl = highlight ? ' fs-highlight' : '';
    const topPct = Math.max(1, Math.ceil(100 - (pctVal || 0) * 100));
    const pctLabel = topPct > 80 ? 'Bottom 20%' : `Top ${topPct}%`;
    const bar = pctVal != null ? `<div class="fs-pct-inline"><div class="fs-pct-track"><div class="fs-pct-fill" style="width:${p}%;background:${color}"></div></div><span class="fs-pct-val"${highlight ? ` style="color:${color}"` : ''}>${pctLabel}</span></div>` : '';
    return `<div class="fs-stat-row${hl}"${highlight ? ` style="border-bottom-color:${color}30;border-left-color:${color}"` : ''}><div class="fs-stat-top"><span class="fs-stat-label"${highlight ? ` style="color:${color}"` : ''}>${label}</span><span class="fs-stat-value">${value}</span></div>${bar}</div>`;
  }

  overlay.innerHTML = `
    <div class="fullscreen-layout">
      <div class="fullscreen-close">CLOSE</div>
      <div class="fullscreen-card-container">
        <div class="card-wrapper" data-rarity="${c.rarity}" style="opacity:1;animation:none">${cardHTML}</div>
      </div>
      <div class="fullscreen-stats-panel">
        <h3>Details</h3>
        ${statRow('Total Commits', fmt(c.commits) + ' commits', pct.commits, rc, false)}
        ${statRow('PRs Merged', fmt(c.prsMerged) + ' PRs', pct.prsMerged, '#4ade80', dom === 'prs')}
        ${statRow('Issues', fmt(c.issues) + ' issues', pct.issues, '#f472b6', dom === 'issues')}
        ${statRow('Active Weeks', `${c.activeWeeks} <span class="fs-stat-pct">/ ${c.totalWeeks}</span> weeks`, pct.activeWeeks, '#4adede', dom === 'consistency')}
        ${statRow('Best Streak', c.maxStreak + ' weeks', pct.streak, '#facc15', dom === 'streak')}
        ${statRow('Peak Week', c.peak + ' commits', pct.peak, '#c084fc', dom === 'peak')}

        ${statRow('Tenure', weeksSinceFirst < 52 ? weeksSinceFirst + 'w' : Math.round(weeksSinceFirst / 52 * 10) / 10 + 'y', null, null)}
        <div class="fs-stat-row"><div class="fs-stat-top"><span class="fs-stat-label">Owned</span><span class="fs-stat-value" id="fs-owned-value">${(library[c.login] || 0)}x</span></div></div>
        ${(() => {
          if (!_currentUser) return '';
          const owned = library[c.login] || 0;
          if (isGhost) {
            const cost = CHERRY_PICK_COST[c.rarity] || 999;
            return `<div class="fs-recycle-actions">
              <button class="cherry-pick-btn" id="fs-cherry-pick" ${starBalance < cost ? 'disabled' : ''}>Cherry-pick (${cost} &starf;)</button>
              <span class="fs-recycle-balance">&starf; ${starBalance} Stars</span>
            </div>`;
          }
          if (owned > 1) {
            const yld = REVERT_YIELD[c.rarity] || 1;
            return `<div class="fs-recycle-actions">
              <button class="fs-revert-btn revert-btn" id="fs-revert">Revert 1 (+${yld} &starf;)</button>
              ${owned > 2 ? `<button class="fs-revert-btn revert-btn" id="fs-revert-all">Revert ${owned - 1} (+${(owned - 1) * yld} &starf;)</button>` : ''}
              <span class="fs-recycle-balance">&starf; ${starBalance} Stars</span>
            </div>`;
          }
          return '';
        })()}
      </div>
    </div>
    <div class="fullscreen-bottom">
      ${!_currentUser ? `<div class="fs-sales-pitch">
        <p class="fs-sales-text">Open packs, collect contributors, and climb the leaderboard.</p>
        <p class="fs-sales-cta"><strong>10 free packs</strong> when you sign up. Contribute to a repo and <strong>get your own card for free</strong>.</p>
        <button class="login-btn fs-sales-btn" id="fs-sign-in"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign In with GitHub</button>
      </div>` : ''}
      <a class="fullscreen-profile" href="https://github.com/${c.login}" target="_blank" rel="noopener">${GH_ICON} View Profile</a>
      <div class="fullscreen-share-row">
        <button class="share-action-btn" id="fs-copy-link">Copy Link</button>
        <a class="share-action-btn" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out my GitPacks card for ${currentRepoName}!`)}&url=${encodeURIComponent(`${window.location.origin}?repo=${currentRepoName}&card=${c.login}`)}" target="_blank" rel="noopener">Share on X</a>
        <button class="share-action-btn" id="fs-copy-md">Copy for README</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const container = overlay.querySelector('.fullscreen-card-container');
  const cardWrapper = container.querySelector('.card-wrapper');
  const card = container.querySelector('.card');
  cardWrapper.addEventListener('mousemove', e => {
    const r = cardWrapper.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateY(${x * 20}deg) rotateX(${-y * 20}deg)`;
    const shine = card.querySelector('.card-shine');
    if (shine) shine.style.background = `radial-gradient(circle at ${(x+.5)*100}% ${(y+.5)*100}%, rgba(255,255,255,0.18) 0%, transparent 60%)`;
    if (shine) shine.style.opacity = '1';
  });
  cardWrapper.addEventListener('mouseleave', () => {
    card.style.transform = '';
    const shine = card.querySelector('.card-shine');
    if (shine) shine.style.opacity = '0';
  });

  // Handle browser back button
  _popHandler = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); window.removeEventListener('popstate', _popHandler); };
  window.addEventListener('popstate', _popHandler);

  const fsSignIn = overlay.querySelector('#fs-sign-in');
  if (fsSignIn) fsSignIn.addEventListener('click', e => { e.stopPropagation(); if (window.__gpLogin) window.__gpLogin(); });
  overlay.querySelector('.fullscreen-close').addEventListener('click', e => { e.stopPropagation(); closeOverlay(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', escHandler);
  overlay.querySelector('.fullscreen-layout').addEventListener('click', e => e.stopPropagation());
  overlay.querySelector('.fullscreen-bottom').addEventListener('click', e => e.stopPropagation());

  // Share buttons
  const shareUrl = `${window.location.origin}?repo=${currentRepoName}&card=${c.login}`;
  const mdSnippet = `<a href="${shareUrl}"><img src="${window.location.origin}/api/card/${currentRepoName}/${c.login}" alt="${c.login} on ${currentRepoName}" width="200" /></a>`;

  const copyLinkBtn = overlay.querySelector('#fs-copy-link');
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
    });
  });

  const copyMdBtn = overlay.querySelector('#fs-copy-md');
  if (copyMdBtn) copyMdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(mdSnippet).then(() => {
      copyMdBtn.textContent = 'Copied!';
      setTimeout(() => { copyMdBtn.textContent = 'Copy for README'; }, 2000);
    });
  });

  // Helper to refresh recycling UI in the stats panel after revert
  function updateRecycleUI() {
    const owned = library[c.login] || 0;
    const ownedEl = overlay.querySelector('#fs-owned-value');
    if (ownedEl) ownedEl.textContent = owned + 'x';
    const balEl = overlay.querySelector('.fs-recycle-balance');
    if (balEl) balEl.innerHTML = `&starf; ${starBalance} Stars`;
    const actionsEl = overlay.querySelector('.fs-recycle-actions');
    if (actionsEl && owned <= 1) actionsEl.remove();
    renderRepoInfoFromCurrent();
    renderLibrary();
  }

  // Revert single button
  const revertBtn = overlay.querySelector('#fs-revert');
  if (revertBtn) revertBtn.addEventListener('click', async () => {
    revertBtn.disabled = true;
    revertBtn.textContent = 'Reverting...';
    const result = await revertSingleCard(c);
    if (result) {
      revertBtn.textContent = `+${result.starsEarned} \u2605`;
      setTimeout(() => updateRecycleUI(), 800);
    } else {
      revertBtn.textContent = 'Error';
      setTimeout(() => { revertBtn.textContent = `Revert 1 (+${REVERT_YIELD[c.rarity] || 1} \u2605)`; revertBtn.disabled = false; }, 2000);
    }
  });

  // Revert all copies of this card
  const revertAllCardBtn = overlay.querySelector('#fs-revert-all');
  if (revertAllCardBtn) revertAllCardBtn.addEventListener('click', async () => {
    const count = (library[c.login] || 0) - 1;
    if (count < 1) return;
    revertAllCardBtn.disabled = true;
    revertAllCardBtn.textContent = 'Reverting...';
    const [owner, repo] = currentRepoName.split('/');
    try {
      const res = await fetch(`/api/recycling/${owner}/${repo}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: [{ login: c.login, count }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revert failed');
      library[c.login] = 1;
      starBalance += data.starsEarned || 0;
      saveLibrary();
      revertAllCardBtn.textContent = `+${data.starsEarned} \u2605`;
      setTimeout(() => updateRecycleUI(), 800);
    } catch (err) {
      revertAllCardBtn.textContent = 'Error';
      setTimeout(() => { revertAllCardBtn.disabled = false; }, 2000);
    }
  });

  // Cherry-pick button
  const cherryBtn = overlay.querySelector('#fs-cherry-pick');
  if (cherryBtn) cherryBtn.addEventListener('click', async () => {
    cherryBtn.disabled = true;
    cherryBtn.textContent = 'Cherry-picking...';
    const result = await cherryPickCard(c);
    if (result) {
      closeOverlay();
      showCherryPickReveal(c, () => { renderRepoInfoFromCurrent(); renderLibrary(); });
    } else {
      cherryBtn.textContent = 'Failed';
      setTimeout(() => { cherryBtn.textContent = `Cherry-pick (${CHERRY_PICK_COST[c.rarity] || '?'} \u2605)`; cherryBtn.disabled = starBalance < (CHERRY_PICK_COST[c.rarity] || 999); }, 2000);
    }
  });
}

function showCherryPickReveal(contributor, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'self-card-overlay';

  const cardNum = allContributors.indexOf(contributor) + 1;
  const cardHTML = buildGalleryCard(contributor, cardNum, allContributors.length);

  overlay.innerHTML = `
    <button class="pack-close-btn" id="cherry-reveal-close">&times;</button>
    <div class="self-card-container">
      <div class="self-card-message">Cherry-picked!</div>
      <div class="self-card-slot">
        <div class="rarity-glow"></div>
        <div class="reveal-card">
          <div class="reveal-card-back">
            <div class="reveal-card-back-logo">${GP_ICON}</div>
            <div class="reveal-card-back-repo"><span class="repo-owner">${currentRepoName.split('/')[0]}</span><span class="repo-name">${currentRepoName.split('/')[1] || ''}</span></div>
            <div class="reveal-card-back-brand">GitPacks</div>
          </div>
          <div class="reveal-card-front">
            <div class="card-wrapper" data-rarity="${contributor.rarity}" style="opacity:1">${cardHTML}</div>
          </div>
        </div>
      </div>
      <div class="self-card-subtitle">${contributor.login} added to your collection</div>
      <button class="btn-primary self-card-continue" id="cherry-reveal-continue">Continue</button>
    </div>`;

  document.body.appendChild(overlay);

  const slot = overlay.querySelector('.self-card-slot');
  const cw = slot.querySelector('.reveal-card-front .card-wrapper');
  if (cw) {
    const slotW = slot.offsetWidth || 220;
    const slotH = slot.offsetHeight || 340;
    const cardScale = Math.min(slotW / 320, slotH / 480);
    cw.style.transform = `scale(${cardScale})`;
  }

  slot.classList.add('unflipped');
  const card = slot.querySelector('.reveal-card');
  const rarity = contributor.rarity;

  setTimeout(() => {
    slot.classList.remove('unflipped');
    card.classList.add('flip-' + rarity);

    const glowDelay = { common:400, rare:600, epic:800, legendary:1000, mythic:1400 }[rarity] || 400;
    setTimeout(() => {
      if (rarity !== 'common') slot.classList.add('revealed');
    }, glowDelay * 0.5);

    if (rarity === 'mythic') {
      overlay.classList.add('shake-screen');
      setTimeout(() => overlay.classList.remove('shake-screen'), 600);
      slot.insertAdjacentHTML('beforeend', '<div class="mythic-flash"></div><div class="mythic-ring"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ff0040','#ff6600','#fff','#ff00ff'];
      for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 / 20) * i;
        const dist = 80 + Math.random() * 120;
        particles += `<div class="leg-particle" style="width:5px;height:5px;background:${colors[Math.floor(Math.random() * colors.length)]};--px:${Math.cos(angle) * dist}px;--py:${Math.sin(angle) * dist}px;--pdur:${0.8 + Math.random() * 0.6}s;--pdelay:${Math.random() * 0.2}s"></div>`;
      }
      slot.insertAdjacentHTML('beforeend', particles + '</div>');
    } else if (rarity === 'legendary') {
      overlay.classList.add('shake-screen');
      setTimeout(() => overlay.classList.remove('shake-screen'), 500);
      slot.insertAdjacentHTML('beforeend', '<div class="legendary-flash"></div><div class="legendary-ring"></div>');
      let particles = '<div class="leg-particles">';
      const colors = ['#ffd700','#ff6ec7','#fff'];
      for (let i = 0; i < 15; i++) {
        const angle = (Math.PI * 2 / 15) * i;
        const dist = 60 + Math.random() * 100;
        particles += `<div class="leg-particle" style="width:4px;height:4px;background:${colors[Math.floor(Math.random() * colors.length)]};--px:${Math.cos(angle) * dist}px;--py:${Math.sin(angle) * dist}px;--pdur:${0.6 + Math.random() * 0.5}s;--pdelay:${Math.random() * 0.2}s"></div>`;
      }
      slot.insertAdjacentHTML('beforeend', particles + '</div>');
    } else if (rarity === 'epic') {
      slot.insertAdjacentHTML('beforeend', '<div class="epic-flash"></div><div class="epic-ring"></div>');
    } else if (rarity === 'rare') {
      slot.insertAdjacentHTML('beforeend', '<div class="rare-flash"></div>');
    }
  }, 800);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
    if (onDone) onDone();
  }

  const escHandler = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
  overlay.querySelector('#cherry-reveal-close').addEventListener('click', close);
  overlay.querySelector('#cherry-reveal-continue').addEventListener('click', close);
}

function fmt(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toString(); }
function rarityColor(r) { return {mythic:'#ff0040',legendary:'#ffd700',epic:'#c084fc',rare:'#60a5fa',common:'#888'}[r]||'#888'; }
function powerGrad(r) { return {mythic:'linear-gradient(90deg,#ff0040,#ff6600,#ff00ff)',legendary:'linear-gradient(90deg,#ffd700,#ff6ec7)',epic:'linear-gradient(90deg,#a855f7,#6366f1)',rare:'linear-gradient(90deg,#3b82f6,#06b6d4)',common:'linear-gradient(90deg,#555,#777)'}[r]||'linear-gradient(90deg,#555,#777)'; }

// ===== CARD RECYCLING =====
function showRevertAllOverlay() {
  if (!_currentUser || !currentRepoName) return;
  const [owner, repo] = currentRepoName.split('/');

  // Compute breakdown
  const rarityOrder = ['mythic', 'legendary', 'epic', 'rare', 'common'];
  const rarityColors = { mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888' };
  let totalDupes = 0;
  let totalStars = 0;
  const breakdown = {};
  rarityOrder.forEach(r => { breakdown[r] = { dupes: 0, stars: 0 }; });

  for (const c of allContributors) {
    const count = library[c.login] || 0;
    if (count > 1) {
      const dupes = count - 1;
      totalDupes += dupes;
      const stars = dupes * (REVERT_YIELD[c.rarity] || 1);
      totalStars += stars;
      breakdown[c.rarity].dupes += dupes;
      breakdown[c.rarity].stars += stars;
    }
  }

  if (totalDupes === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'revert-all-overlay';
  const rows = rarityOrder
    .filter(r => breakdown[r].dupes > 0)
    .map(r => `<div class="revert-breakdown-row">
      <span class="revert-rarity" style="color:${rarityColors[r]}">${r}</span>
      <span class="revert-count">${breakdown[r].dupes} card${breakdown[r].dupes !== 1 ? 's' : ''}</span>
      <span class="revert-stars">+${breakdown[r].stars} &starf;</span>
    </div>`).join('');

  overlay.innerHTML = `<div class="revert-all-content">
    <div class="revert-all-title">Revert All Duplicates</div>
    <div class="revert-all-desc">Destroy all duplicate cards (keeping 1 of each) to earn Stars.</div>
    <div class="revert-breakdown">${rows}</div>
    <div class="revert-total">${totalDupes} cards &rarr; ${totalStars} &starf;</div>
    <div class="revert-all-actions">
      <button class="btn-secondary revert-confirm-btn" id="revert-confirm">Confirm Revert</button>
      <button class="btn-secondary revert-cancel-btn" id="revert-cancel">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#revert-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#revert-confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('#revert-confirm');
    btn.disabled = true;
    btn.textContent = 'Reverting...';
    try {
      const res = await fetch(`/api/recycling/${owner}/${repo}/revert-all`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revert failed');
      starBalance += data.starsEarned || 0;
      overlay.querySelector('.revert-all-content').innerHTML = `
        <div class="revert-all-title">Revert Complete!</div>
        <div class="revert-result">+${data.starsEarned} &starf; earned from ${data.cardsReverted} cards</div>
        <button class="btn-secondary" id="revert-done">Done</button>`;
      overlay.querySelector('#revert-done').addEventListener('click', () => overlay.remove());
      await loadLibraryFromDB();
      await loadStarBalance();
      renderRepoInfoFromCurrent();
      renderLibrary();
    } catch (err) {
      btn.textContent = 'Error: ' + err.message;
      btn.disabled = false;
    }
  });
}

function showCherryPickAllOverlay() {
  if (!_currentUser || !currentRepoName) return;
  const [owner, repo] = currentRepoName.split('/');

  const rarityOrder = ['mythic', 'legendary', 'epic', 'rare', 'common'];
  const rarityColors = { mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888' };
  let totalMissing = 0;
  let totalCost = 0;
  const breakdown = {};
  rarityOrder.forEach(r => { breakdown[r] = { missing: 0, cost: 0 }; });

  for (const c of allContributors) {
    if (!library[c.login]) {
      totalMissing++;
      const cost = CHERRY_PICK_COST[c.rarity] || 5;
      totalCost += cost;
      breakdown[c.rarity].missing++;
      breakdown[c.rarity].cost += cost;
    }
  }

  if (totalMissing === 0 || starBalance < totalCost) return;

  const overlay = document.createElement('div');
  overlay.className = 'revert-all-overlay';
  const rows = rarityOrder
    .filter(r => breakdown[r].missing > 0)
    .map(r => `<div class="revert-breakdown-row">
      <span class="revert-rarity" style="color:${rarityColors[r]}">${r}</span>
      <span class="revert-count">${breakdown[r].missing} card${breakdown[r].missing !== 1 ? 's' : ''}</span>
      <span class="revert-stars">${breakdown[r].cost} &starf;</span>
    </div>`).join('');

  overlay.innerHTML = `<div class="revert-all-content">
    <div class="cherry-all-title">Cherry-pick All Missing</div>
    <div class="revert-all-desc">Spend Stars to instantly complete your collection.</div>
    <div class="revert-breakdown">${rows}</div>
    <div class="revert-total">${totalMissing} cards for ${totalCost} &starf; (you have ${starBalance} &starf;)</div>
    <div class="revert-all-actions">
      <button class="btn-secondary cherry-confirm-btn" id="cherry-all-confirm">Confirm Cherry-pick</button>
      <button class="btn-secondary revert-cancel-btn" id="cherry-all-cancel">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#cherry-all-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#cherry-all-confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('#cherry-all-confirm');
    btn.disabled = true;
    btn.textContent = 'Cherry-picking...';
    try {
      const res = await fetch(`/api/recycling/${owner}/${repo}/cherry-pick-all`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cherry-pick failed');
      starBalance = data.newBalance ?? 0;
      overlay.querySelector('.revert-all-content').innerHTML = `
        <div class="cherry-all-title">Collection Complete!</div>
        <div class="revert-result">${data.cardsAcquired} cards acquired</div>
        <button class="btn-secondary" id="cherry-all-done">Done</button>`;
      overlay.querySelector('#cherry-all-done').addEventListener('click', () => overlay.remove());
      await loadLibraryFromDB();
      await loadStarBalance();
      renderRepoInfoFromCurrent();
      renderLibrary();
    } catch (err) {
      btn.textContent = 'Error: ' + err.message;
      btn.disabled = false;
    }
  });
}

async function revertSingleCard(c) {
  if (!_currentUser || !currentRepoName) return;
  const [owner, repo] = currentRepoName.split('/');
  const yld = REVERT_YIELD[c.rarity] || 1;
  try {
    const res = await fetch(`/api/recycling/${owner}/${repo}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [{ login: c.login, count: 1 }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Revert failed');
    // Update local state inline
    if (library[c.login]) library[c.login]--;
    starBalance += data.starsEarned || 0;
    saveLibrary();
    return { starsEarned: data.starsEarned || 0 };
  } catch (err) {
    console.error('Revert error:', err);
    return null;
  }
}

async function cherryPickCard(c) {
  if (!_currentUser || !currentRepoName) return;
  const [owner, repo] = currentRepoName.split('/');
  try {
    const res = await fetch(`/api/recycling/${owner}/${repo}/cherry-pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: c.login }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cherry-pick failed');
    // Update local state
    library[c.login] = (library[c.login] || 0) + 1;
    starBalance = data.newBalance;
    saveLibrary();
    return { success: true, newBalance: data.newBalance };
  } catch (err) {
    console.error('Cherry-pick error:', err);
    return null;
  }
}

// Expose functions used by inline onclick handlers in dynamically generated HTML
window.openPack = openPack;
window.setFilter = setFilter;
window.setViewMode = setViewMode;
window.setSortBy = setSortBy;
window.quickLoad = quickLoad;
window.revertAllDuplicates = showRevertAllOverlay;

function buildGalleryCard(c, idx, total) {
  const rc = rarityColor(c.rarity);
  let sparklesHTML = '';
  if (c.rarity === 'mythic' || c.rarity === 'legendary' || c.rarity === 'epic') {
    const count = c.rarity === 'mythic' ? 24 : c.rarity === 'legendary' ? 16 : 8;
    sparklesHTML = '<div class="card-sparkles">';
    for (let i = 0; i < count; i++) {
      sparklesHTML += `<div class="sparkle" style="left:${Math.random()*100}%;top:${Math.random()*100}%;--dur:${1.5+Math.random()*2}s;--delay:${Math.random()*3}s"></div>`;
    }
    sparklesHTML += '</div>';
  }

  const statsHTML = `
      <div class="stat-box"><div class="stat-value" style="color:${rc}">${fmt(c.commits)}</div><div class="stat-label">Commits</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#4ade80">${fmt(c.prsMerged)}</div><div class="stat-label">PRs Merged</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#f472b6">${fmt(c.issues)}</div><div class="stat-label">Issues</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#4adede">${c.activeWeeks}</div><div class="stat-label">Active Wks</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#c084fc">${c.peak}</div><div class="stat-label">Peak Week</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#facc15">${c.maxStreak}w</div><div class="stat-label">Streak</div></div>`;

  return `<div class="card" data-rarity="${c.rarity}"><div class="card-inner"><div class="card-shine"></div><div class="card-holo"></div><div class="card-rainbow"></div>${sparklesHTML}
    <div class="card-header-repo">${currentRepoName}</div>
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
    <div class="card-footer"><span>#${String(idx).padStart(3,'0')} / ${total}</span><span class="card-footer-brand">GitPacks</span></div></div>
    <div class="card-total-badge">${total} in set</div></div>`;
}
}

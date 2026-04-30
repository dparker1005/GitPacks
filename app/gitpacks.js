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

// Clear guest localStorage on login to prevent stale crossover
if (_currentUser) {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('ghtc_lib_') || key.startsWith('gp_guest')) localStorage.removeItem(key);
  });
}

// Welcome overlay is shown after pack state loads (checks server-side isNewUser)

const GH_ICON = `<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const GP_ICON = `<svg viewBox="0 0 32 32"><defs><linearGradient id="gp-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#7873f5"/><stop offset="100%" style="stop-color:#4adede"/></linearGradient></defs><rect x="4" y="2" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2" opacity="0.4" transform="rotate(-6 13 15)"/><rect x="8" y="3" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2" opacity="0.7" transform="rotate(3 17 16)"/><rect x="6" y="2.5" width="18" height="26" rx="3" fill="none" stroke="url(#gp-grad)" stroke-width="2.5"/><text x="15" y="20.5" font-family="sans-serif" font-weight="900" font-size="14" fill="url(#gp-grad)" text-anchor="middle">G</text></svg>`;

let input = document.getElementById('repo-input');
let btn = document.getElementById('generate-btn');
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
let packState = null; // { readyPacks, bonusPacks, maxPacks, nextRegenAt }
let packCountdownInterval = null;
let guestPacksRemaining = 1; // for logged-out users
let lastAchievementData = null; // achievement data for current repo
let starBalance = 0; // per-repo star balance for card recycling
let repoFetchedAt = null; // ISO timestamp of when the cards were last pulled from GitHub
let repoPartialMeta = null; // { failures: [{step, endpoint, attempts, lastStatus, totalWaitedMs, message}] } when last refresh was partial
let _referralInfo = null; // { referralCode, referralCount, maxReferrals, sharedOnX }

// Global space handler — only one at a time, avoids stacking conflicts
let _spaceAction = null;
function _globalSpaceHandler(e) { if (e.code === 'Space' && _spaceAction) { e.preventDefault(); const action = _spaceAction; _spaceAction = null; action(); } }
document.addEventListener('keydown', _globalSpaceHandler);
function setSpaceAction(fn) { _spaceAction = fn; }
function clearSpaceAction() { _spaceAction = null; }

let searchContainer = document.getElementById('search-container');
const popularRepos = document.getElementById('popular-repos');

// ===== REPO STREAM =====
// /api/repo/{owner}/{repo} returns NDJSON: one JSON object per line.
// Events: probe → commits (many) → issues, contributors → done | error.
// onEvent receives every parsed event; the resolved value is the final `done`
// event (with .data, .source, .fetchedAt, optional .partialMeta).
async function fetchRepoStream(url, onEvent) {
  const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON */ }
    const e = new Error(body.error || `Repo fetch failed: ${res.status}`);
    e.status = res.status;
    e.details = body.details || null;
    throw e;
  }
  if (!res.body) throw new Error('Repo fetch failed: no response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (onEvent) { try { onEvent(event); } catch (e) { console.error('[GHTC] onEvent threw:', e); } }
      if (event.stage === 'done') result = event;
      else if (event.stage === 'error') {
        const e = new Error(event.message || 'Repo fetch failed');
        e.code = event.code;
        e.details = event.details;
        throw e;
      }
    }
  }
  if (!result) throw new Error('Repo stream ended without a result');
  return result;
}

// Progress UI helpers — manipulate the existing #loading / .progress-* markup
// in page.tsx. Steps: step-commits, step-issues, step-processing.
function _setStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
}
function _setProgressFill(pct) {
  const el = document.getElementById('progress-fill');
  if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function _setProgressDetail(text) {
  const el = document.getElementById('progress-detail');
  if (el) el.textContent = text || '';
}
function _resetProgress() {
  _setStep('step-commits', null);
  _setStep('step-issues', null);
  _setStep('step-processing', null);
  _setProgressFill(0);
  _setProgressDetail('');
}

// Drive the progress UI from a single repo-stream event. Returns an updater
// closure — call it once per event.
function makeProgressDriver() {
  let totalCommits = 0;
  let issuesDone = false;
  let contribsDone = false;
  let allFetchDone = false;
  return (e) => {
    switch (e.stage) {
      case 'probe':
        totalCommits = e.totalCommits || 0;
        _setStep('step-commits', 'active');
        _setStep('step-issues', 'active');
        _setProgressDetail(
          totalCommits > 0
            ? `Scoring ${totalCommits.toLocaleString()} commits…`
            : 'Loading repository…'
        );
        _setProgressFill(2);
        break;
      case 'commits': {
        // Reserve 10% for the post-fetch aggregation; commits-fetched fills 0-90%.
        const pct = totalCommits > 0 ? Math.min(90, (e.fetched / totalCommits) * 90) : 50;
        _setProgressFill(pct);
        _setProgressDetail(`${e.fetched.toLocaleString()} of ${totalCommits.toLocaleString()} commits`);
        break;
      }
      case 'issues':
        issuesDone = true;
        if (issuesDone && contribsDone) _setStep('step-issues', 'done');
        break;
      case 'contributors':
        contribsDone = true;
        if (issuesDone && contribsDone) _setStep('step-issues', 'done');
        break;
      case 'done':
        allFetchDone = true;
        _setStep('step-commits', 'done');
        _setStep('step-issues', 'done');
        _setStep('step-processing', 'done');
        _setProgressFill(100);
        _setProgressDetail('');
        break;
    }
  };
}

// ===== CLIENT-SIDE CACHE =====
const _cache = {};
function cacheGet(key, maxAgeMs) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAgeMs) { delete _cache[key]; return null; }
  return entry.data;
}
function cacheSet(key, data) { _cache[key] = { data, ts: Date.now() }; }
function cacheInvalidate(...prefixes) {
  for (const k of Object.keys(_cache)) {
    if (prefixes.some(p => k.startsWith(p))) delete _cache[k];
  }
}
// Invalidate caches that depend on card acquisition
function invalidateCardCaches() {
  cacheInvalidate('leaderboard', 'score', 'user-repos');
}

// Store referral code from URL (belt and suspenders with page.tsx)
const _urlRef = new URLSearchParams(window.location.search).get('gpref');
if (_urlRef) localStorage.setItem('gp_ref', _urlRef);

function getReferralUrl(baseUrl) {
  if (_currentUser) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return baseUrl + sep + 'gpref=' + encodeURIComponent(_currentUser.username);
  }
  return baseUrl;
}

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
      <div class="welcome-item">Complete <strong>daily tasks</strong> to earn up to <strong>3 packs per day</strong></div>
      <div class="welcome-item">Packs regenerate: <strong>1 new pack every 12 hours</strong>, up to 2 at a time</div>
      <div class="welcome-item">Earn <strong>achievement packs</strong> for repos you contribute to</div>
      <div class="welcome-item"><strong>Share a card on X</strong> for 5 bonus packs</div>
      <div class="welcome-item"><strong>Refer friends</strong> — you both get 5 bonus packs</div>
      <button class="welcome-start">Start Collecting</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.welcome-start').addEventListener('click', () => {
    localStorage.setItem('gp_welcome_shown', '1');
    overlay.remove();
  });
}

if (btn) btn.addEventListener('click', () => loadRepo());
document.getElementById('share-btn').addEventListener('click', () => shareRepo());

if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });

function quickLoad(repo) { if (input) input.value = repo; loadRepo(true, repo); }

// True for a plain left-click — modifier/middle clicks fall through so the browser opens a new tab.
function isPlainNavClick(e) {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

// Rarity badge sits inside the row's <a>, so it has to be a span — emulate link semantics by hand.
document.addEventListener('click', (e) => {
  const badge = e.target.closest && e.target.closest('.my-rarity-badge[data-card-href]');
  if (!badge) return;
  const href = badge.dataset.cardHref;
  e.preventDefault();
  e.stopPropagation();
  if (!isPlainNavClick(e)) window.open(href, '_blank', 'noopener');
  else window.location.href = href;
});

// ===== PACK STATE =====
// Show skeleton while pack state loads
if (_currentUser) {
  const el = document.getElementById('top-bar-packs');
  if (el) el.innerHTML = `<div class="topbar-packs"><span class="topbar-packs-icon">${GP_ICON}</span><span class="skeleton-pulse" style="display:inline-block;width:2.5em;height:1em;border-radius:4px"></span></div>`;
}

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
      // Show welcome overlay for genuinely new users (server-confirmed)
      if (packState.isNewUser && !localStorage.getItem('gp_welcome_shown')) {
        setTimeout(() => showWelcomeOverlay(), 0);
      }
    }
  } catch { packState = null; }
  renderTopBarPacks();
}

function renderTopBarPacks() {
  const el = document.getElementById('top-bar-packs');
  if (!el) return;

  if (!_currentUser) {
    el.innerHTML = '';
    return;
  }

  if (!packState) { el.innerHTML = ''; return; }
  const { readyPacks, bonusPacks = 0, maxPacks, nextRegenAt } = packState;
  const timerHTML = readyPacks < maxPacks && nextRegenAt
    ? `<span class="topbar-pack-timer" id="topbar-pack-timer"></span>`
    : '';
  const isRegening = readyPacks < maxPacks && nextRegenAt;
  const bonusHTML = bonusPacks > 0
    ? `<span class="topbar-packs-bonus">${bonusPacks}</span><span class="topbar-packs-plus">+</span>`
    : '';
  el.innerHTML = `<div class="topbar-packs">
    <span class="topbar-packs-icon">${GP_ICON}</span>
    ${bonusHTML}<span class="topbar-packs-count${isRegening ? ' topbar-regen' : ''}">${readyPacks}<span class="topbar-packs-max">/${maxPacks}</span></span>${timerHTML}
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
async function loadPopularRepos(featuredRepo) {
  popularRepos.innerHTML = `<div style="text-align:center;padding:60px 20px"><div class="spinner"></div></div>`;
  try {
    // Fetch popular repos and user repos in parallel (with client cache)
    let repos = cacheGet('repos', 300000); // 5 min client cache
    let userReposFromCache = _currentUser ? cacheGet('user-repos', 60000) : null; // 1 min
    const [reposRes, urRes] = await Promise.all([
      repos ? Promise.resolve(null) : fetch('/api/repos'),
      userReposFromCache || !_currentUser ? Promise.resolve(null) : fetch('/api/user-repos', { cache: 'no-cache' }),
    ]);
    if (!repos) {
      if (!reposRes || !reposRes.ok) return;
      repos = await reposRes.json();
      cacheSet('repos', repos);
    }
    repos = JSON.parse(JSON.stringify(repos)); // deep clone so we don't mutate cache
    if (!repos.length) {
      popularRepos.innerHTML = `<div class="popular-section">
        <p class="popular-hint">Enter a GitHub repo above to get started!</p>
      </div>`;
      return;
    }

    let userRepos = userReposFromCache || [];
    if (!userReposFromCache && urRes && urRes.ok) {
      try { userRepos = await urRes.json(); cacheSet('user-repos', userRepos); } catch { /* silent */ }
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
      const repoNameSet = new Set(repos.map(r => r.name.toLowerCase()));
      repos.forEach(r => {
        const ur = userRepos.find(u => u.name === r.name.toLowerCase());
        r.collected = ur ? ur.collected : 0;
        r.pct = r.cards > 0 ? r.collected / r.cards : 0;
        r.base_points = ur ? ur.base_points : 0;
        r.completion_bonus = ur ? ur.completion_bonus : 0;
        r.total_points = ur ? ur.total_points : 0;
        r.my_rarity = ur ? ur.my_rarity : null;
        r.stars = ur ? ur.stars : 0;
        r.was_complete = ur ? ur.was_complete : false;
      });
      // Add user repos not in the popular list
      userRepos.forEach(ur => {
        if (!repoNameSet.has(ur.name.toLowerCase())) {
          repos.push({ name: ur.name, cards: ur.cards, collected: ur.collected, pct: ur.pct, base_points: ur.base_points, completion_bonus: ur.completion_bonus, total_points: ur.total_points, my_rarity: ur.my_rarity, stars: ur.stars, was_complete: ur.was_complete });
        }
      });
    }

    const yourRepos = repos.filter(r => r.collected > 0).sort((a, b) => b.pct - a.pct || b.cards - a.cards);
    const otherRepos = repos.filter(r => r.collected === 0).sort((a, b) => b.cards - a.cards);

    // Split yourRepos into completed and in-progress for logged-in dashboard
    const completedRepos = yourRepos.filter(r => r.cards > 0 && r.collected >= r.cards);
    const inProgressRepos = yourRepos.filter(r => r.collected > 0 && (r.cards === 0 || r.collected < r.cards))
      .sort((a, b) => {
        // Broken sets pinned to top so the user notices and can re-complete them.
        if (!!a.was_complete !== !!b.was_complete) return a.was_complete ? -1 : 1;
        return b.pct - a.pct;
      });

    function myRarityBadge(r) {
      if (!r.my_rarity || !_currentUser) return '';
      const href = `/?repo=${r.name}&card=${_currentUser.username}`;
      return `<span class="my-rarity-badge ${r.my_rarity}" data-card-href="${href}" role="link" tabindex="0">${r.my_rarity}</span>`;
    }

    function repoBtn(r, showProgressBar) {
      const pctNum = Math.round(r.pct * 100);
      const isComplete = r.cards > 0 && r.collected >= r.cards;
      const progressBar = showProgressBar && !isComplete && r.cards > 0
        ? `<div class="repo-progress-bar"><div class="repo-progress-fill" style="width:${pctNum}%"></div></div>`
        : '';
      return `<a class="popular-repo-btn${isComplete ? ' repo-complete' : ''}" href="?repo=${r.name}" data-repo="${r.name}">
          <span class="popular-repo-name">${r.name}${myRarityBadge(r)}${progressBar}</span>
          <span class="popular-repo-meta">
            <span class="popular-repo-progress">${r.collected}/${r.cards}</span>
            <span class="popular-repo-pct">${pctNum}%</span>
          </span>
        </a>`;
    }

    function repoBtnScored(r, showProgressBar) {
      const pctNum = Math.round(r.pct * 100);
      const isComplete = r.cards > 0 && r.collected >= r.cards;
      const progressBar = showProgressBar && !isComplete && r.cards > 0
        ? `<div class="repo-progress-bar"><div class="repo-progress-fill" style="width:${pctNum}%"></div></div>`
        : '';
      const bonus = r.completion_bonus || 0;
      const bonusHTML = bonus > 0
        ? `<span class="repo-bonus">+${bonus.toLocaleString()} bonus</span>`
        : '';
      const pointsHTML = r.base_points > 0
        ? `<span class="repo-points">${r.base_points.toLocaleString()} pts${bonusHTML}</span>`
        : '';
      const tradablePacks = r.stars >= 100 ? Math.floor(r.stars / 100) : 0;
      const starsHint = isComplete && tradablePacks > 0
        ? `<div class="repo-stars-hint">&starf; ${r.stars} &rarr; ${tradablePacks} pack${tradablePacks !== 1 ? 's' : ''}</div>`
        : '';
      const isBroken = !isComplete && r.was_complete;
      return `<a class="popular-repo-btn scored${isComplete ? ' repo-complete' : ''}${isBroken ? ' repo-broken' : ''}" href="?repo=${r.name}" data-repo="${r.name}">
          <span class="popular-repo-name">${r.name}${myRarityBadge(r)}${progressBar}${starsHint}</span>
          <span class="popular-repo-meta-stacked">
            <span class="popular-repo-progress">${r.collected}/${r.cards} cards</span>
            ${pointsHTML}
          </span>
        </a>`;
    }

    let html = '';

    if (_currentUser) {
      // Engagement row: Dailies + Sprints side-by-side (above dashboard)
      html += `<div class="engagement-row">`;

      // Dailies section
      html += `<div id="dailies-section"><div class="dailies-section dailies-skeleton">
        <div class="dailies-header"><div class="dailies-title-row"><span class="skeleton-pulse" style="display:inline-block;width:120px;height:1em;border-radius:4px"></span><span class="daily-progress" style="margin-left:auto"><span class="skeleton-pulse" style="display:inline-block;width:60px;height:1em;border-radius:4px"></span></span></div></div>
        <div class="skeleton-pulse" style="width:70%;height:0.8em;border-radius:4px;margin:0 auto 8px"></div>
        <div class="dailies-grid">${Array(5).fill('<div class="daily-item"><span class="skeleton-pulse" style="display:inline-block;width:100%;height:1.2em;border-radius:4px"></span></div>').join('')}</div>
      </div></div>`;

      // Sprints section (skeleton)
      html += `<div id="sprints-section"><div class="sprints-section sprints-skeleton">
        <div class="sprints-header"><span class="skeleton-pulse" style="display:inline-block;width:140px;height:1em;border-radius:4px"></span></div>
        <div class="sprints-cards"><div class="sprint-card-skeleton"><span class="skeleton-pulse" style="display:inline-block;width:100%;height:4em;border-radius:8px"></span></div><div class="sprint-card-skeleton"><span class="skeleton-pulse" style="display:inline-block;width:100%;height:4em;border-radius:8px"></span></div></div>
      </div></div>`;

      html += `</div>`; // .engagement-row

      // Dashboard layout: 4 quadrants
      html += `<div class="dashboard">`;

      const hasCollection = inProgressRepos.length || completedRepos.length;

      // Top-left: In Progress
      html += `<div class="dash-quad dash-q-inprogress">
        <h3 class="popular-title">${hasCollection ? 'In Progress' : 'Your Collection'}</h3>`;
      if (inProgressRepos.length) {
        html += `<div class="popular-grid dash-scroll">${inProgressRepos.map(r => repoBtnScored(r, true)).join('')}</div>`;
      } else if (!hasCollection) {
        html += `<p class="popular-hint">Open packs on any repo to start collecting!</p>`;
      }
      html += `</div>`;

      // Top-right: Leaderboard (score summary is injected by loadLeaderboard)
      html += `<div id="leaderboard-section" class="dash-quad dash-q-leaderboard"><h3 class="popular-title">Leaderboard</h3><div class="leaderboard-list dash-scroll">${Array(10).fill('<div class="lb-row lb-skeleton"><span class="lb-rank">&nbsp;</span><div class="lb-avatar skeleton-pulse"></div><span class="lb-info"><span class="lb-name skeleton-pulse" style="display:inline-block;width:80px;height:1em;border-radius:4px"></span></span><span class="lb-points skeleton-pulse" style="display:inline-block;width:40px;height:1em;border-radius:4px"></span></div>').join('')}</div></div>`;

      // Bottom-left: Completed + Score Total + Your Repos
      const totalBase = yourRepos.reduce((sum, r) => sum + (r.base_points || 0), 0);
      const totalBonus = yourRepos.reduce((sum, r) => sum + (r.completion_bonus || 0), 0);
      const totalPoints = yourRepos.reduce((sum, r) => sum + (r.total_points || 0), 0);
      html += `<div class="dash-quad dash-q-completed">
        <h3 class="popular-title">Completed</h3>`;
      if (completedRepos.length) {
        html += `<div class="popular-grid dash-scroll">${completedRepos.map(r => repoBtnScored(r, false)).join('')}</div>`;
      }
      if (totalPoints > 0) {
        html += `<div class="score-total">
          <span class="score-total-label">Total</span>
          <span class="score-total-value">${totalBase.toLocaleString()}${totalBonus > 0 ? `<span class="score-total-bonus">+${totalBonus.toLocaleString()}</span>` : ''}<span class="score-total-eq"> = ${totalPoints.toLocaleString()} pts</span></span>
        </div>`;
      }
      html += `</div>`;

      // Bottom-right: Discover (contributed repos get prepended after async load)
      html += `<div class="dash-quad dash-q-discover">
        <h3 class="popular-title">Discover</h3>
        <div class="discover-search" id="search-container">
          <input type="text" id="repo-input" placeholder="Search any repo..." />
          <button id="generate-btn" class="discover-search-btn">Go</button>
        </div>
        <div id="discover-grid" class="popular-grid dash-scroll">
          <div id="contributed-loading" class="contrib-loading-row"><span class="spinner-small"></span> Finding your repos...</div>
          ${otherRepos.map(r => repoBtn(r, false)).join('')}
        </div>
      </div>`;

      html += `</div>`; // close .dashboard
    } else {
      // Logged-out layout: only featured repo buttons for the card fan
      const featuredEl = document.getElementById('featured-repos');
      if (featuredEl) {
        const topRepos = otherRepos.slice(0, 8);
        // If a featured repo was requested via URL, ensure it's in the list
        if (featuredRepo) {
          const existing = topRepos.find(r => r.name.toLowerCase() === featuredRepo.toLowerCase());
          if (existing) {
            featuredRepo = existing.name; // use canonical casing
          } else {
            topRepos.unshift({ name: featuredRepo, cards: '?' });
            topRepos.pop(); // keep list at 8
          }
        }
        if (topRepos.length) {
          featuredEl.innerHTML = `<p class="featured-repos-label">Every public GitHub repo has cards. Preview a few:</p><div class="featured-repos-grid">${topRepos.map(r =>
            `<button class="featured-repo-btn" data-repo="${r.name}">
              <span class="featured-repo-name">${r.name}</span>
              <span class="featured-repo-cards">${r.cards} cards</span>
            </button>`
          ).join('')}</div>`;
          featuredEl.querySelectorAll('.featured-repo-btn').forEach(b => {
            b.addEventListener('click', () => selectFeaturedRepo(b.dataset.repo));
          });
          // Auto-select featured repo from URL, or first in list
          const defaultRepo = featuredRepo || topRepos[0].name;
          selectFeaturedRepo(defaultRepo);
        }
      }
    }
    popularRepos.innerHTML = html;
    popularRepos.querySelectorAll('.popular-repo-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        if (isPlainNavClick(e)) { e.preventDefault(); quickLoad(b.dataset.repo); }
      });
    });

    // Re-grab search elements (now rendered inside Discover for logged-in users)
    if (_currentUser) {
      input = document.getElementById('repo-input');
      btn = document.getElementById('generate-btn');
      searchContainer = document.getElementById('search-container');
      if (btn) btn.addEventListener('click', () => loadRepo());
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });
    }

    // Lazy load contributed repos, leaderboard, dailies, sprints, and stats
    if (_currentUser) {
      loadLeaderboard();
      loadContributedRepos(yourRepos);
      loadDailies();
      loadSprints();
    }
  } catch { /* silent */ }
}

async function loadContributedRepos(yourRepos) {
  const grid = document.getElementById('discover-grid');
  const loadingEl = document.getElementById('contributed-loading');
  if (!grid) return;

  let contributedRepos = [];
  try {
    const crRes = await fetch('/api/user-contributed-repos');
    if (crRes.ok) contributedRepos = await crRes.json();
  } catch { /* silent */ }

  // Remove loading indicator
  if (loadingEl) loadingEl.remove();

  const collectedNames = new Set((yourRepos || []).map(r => r.name.toLowerCase()));
  const newContributed = contributedRepos.filter(r => !collectedNames.has(r.name.toLowerCase()));

  if (newContributed.length === 0) return;

  function contribBtn(r) {
    const meta = r.cached
      ? `<span class="popular-repo-progress">0/${r.cards}</span><span class="popular-repo-pct">0%</span>`
      : `<span class="contrib-loading"><span class="spinner-small"></span></span>`;
    return `<a class="popular-repo-btn contributed-repo-btn" href="?repo=${r.name}" data-repo="${r.name}"${r.cached ? '' : ' data-preload="true"'}>
        <span class="contributed-badge">Your repo</span>
        <span class="popular-repo-name">${r.name}</span>
        <span class="popular-repo-meta">${meta}</span>
      </a>`;
  }

  // Prepend contributed repos at top of Discover grid
  const fragment = document.createRange().createContextualFragment(newContributed.map(contribBtn).join(''));
  grid.prepend(fragment);

  grid.querySelectorAll('.contributed-repo-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      if (isPlainNavClick(e)) { e.preventDefault(); quickLoad(b.dataset.repo); }
    });
  });

  // Preload uncached repos in background
  for (const r of newContributed.filter(r => !r.cached)) {
    const [ow, rp] = r.name.split('/');
    if (!ow || !rp) continue;
    fetchRepoStream(`/api/repo/${ow}/${rp}`).then((result) => {
      const btn = grid.querySelector(`.contributed-repo-btn[data-repo="${r.name}"][data-preload]`);
      const data = result.data;
      const cardCount = Array.isArray(data) ? data.length : 0;
      if (btn) {
        btn.removeAttribute('data-preload');
        const meta = btn.querySelector('.popular-repo-meta');
        if (meta) meta.innerHTML = `<span class="popular-repo-progress">0/${cardCount}</span><span class="popular-repo-pct">0%</span>`;
      }
    }).catch(() => {
      const btn = grid.querySelector(`.contributed-repo-btn[data-repo="${r.name}"][data-preload]`);
      if (btn) btn.remove();
    });
  }
}

// ===== SHARED CARD OVERLAY (logged-out users) =====
async function showSharedCardOverlay(repoName, login) {
  const [owner, repo] = repoName.split('/');
  if (!owner || !repo || !login) return;

  const overlay = document.createElement('div');
  overlay.className = 'shared-card-overlay';
  overlay.innerHTML = `
    <button class="shared-card-close" id="shared-card-close">&times;</button>
    <div class="shared-card-content">
      <div class="shared-card-header">
        <div class="shared-card-logo">${GP_ICON}</div>
        <div class="shared-card-title">GitPacks</div>
      </div>
      <div class="shared-card-heading">Open packs. Collect contributors. Complete the set.</div>
      <div class="shared-card-slot">
        <div class="reveal-slot unflipped" data-rarity="common" id="shared-card-flip">
          <div class="rarity-glow"></div>
          <div class="reveal-card">
            <div class="reveal-card-back">
              <div class="reveal-card-back-logo">${GP_ICON}</div>
              <div class="reveal-card-back-repo"><span class="repo-owner">${owner}</span><span class="repo-name">${repo}</span></div>
              <div class="reveal-card-back-brand">GitPacks</div>
            </div>
            <div class="reveal-card-front" id="shared-card-front"></div>
          </div>
        </div>
      </div>
      <div class="shared-card-instruction">Click the card to reveal</div>
      <div class="shared-card-cta" style="display:none" id="shared-card-cta">
        <button class="login-btn landing-cta" id="shared-card-login">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          Sign In with GitHub
        </button>
        <p class="landing-cta-sub">Start with <strong>10 packs</strong> to open</p>
        <p class="landing-cta-sub landing-cta-sub2">Contribute to a repo? <strong>You get your own card.</strong></p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function closeOverlay() {
    overlay.remove();
    history.replaceState(null, '', window.location.pathname);
  }
  overlay.querySelector('#shared-card-close').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', function handler(e) {
    if (e.code === 'Escape') { closeOverlay(); document.removeEventListener('keydown', handler); }
  });
  overlay.querySelector('#shared-card-login').addEventListener('click', () => {
    if (window.__gpLogin) window.__gpLogin();
  });

  // Fetch contributor data and prepare the card front
  try {
    const res = await fetch(`/api/contributor/${owner}/${repo}/${login}`);
    if (!res.ok) return;
    const c = await res.json();

    // Find card index (approximate — we don't have full list, use 1/100)
    const cardHTML = buildGalleryCard(c, 1, 100);
    const front = overlay.querySelector('#shared-card-front');
    if (front) front.innerHTML = `<div class="card-wrapper" data-rarity="${c.rarity}" style="opacity:1">${cardHTML}</div>`;

    // Scale card to fit slot (same approach as self-card reveal)
    const slot = overlay.querySelector('#shared-card-flip');
    const cw = front?.querySelector('.card-wrapper');
    if (cw && slot) {
      const slotW = slot.offsetWidth || 220;
      const slotH = slot.offsetHeight || 340;
      const cardScale = Math.min(slotW / 320, slotH / 480);
      cw.style.transform = `scale(${cardScale})`;
    }

    // Update rarity on the slot for glow effects
    if (slot) {
      slot.dataset.rarity = c.rarity;

      // Flip on click
      slot.addEventListener('click', () => {
        if (!slot.classList.contains('unflipped')) return;
        slot.classList.remove('unflipped');
        const card = slot.querySelector('.reveal-card');
        const rarity = c.rarity;
        if (card) {
          card.classList.add('flip-' + rarity);
          card.style.transition = 'transform 0.6s ease';
          card.style.transform = 'rotateY(0deg) scale(1)';
        }

        // Rarity glow
        const glowDelay = { common:400, rare:600, epic:800, legendary:1000, mythic:1400 }[rarity] || 400;
        setTimeout(() => {
          if (rarity !== 'common') slot.classList.add('revealed');
        }, glowDelay * 0.5);

        // Rarity effects (flash, ring, particles, shake)
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

        // Show CTA after flip
        const instruction = overlay.querySelector('.shared-card-instruction');
        if (instruction) instruction.style.display = 'none';
        setTimeout(() => {
          const cta = overlay.querySelector('#shared-card-cta');
          if (cta) cta.style.display = '';
        }, glowDelay);
      });
    }
  } catch { /* silent — card back still shows */ }
}

// ===== LANDING CARD FAN =====
const LANDING_RARITY_ORDER = ['common', 'legendary', 'mythic', 'epic', 'rare'];
let _landingActiveRepo = null;

async function loadLandingCards(repoName) {
  const container = document.getElementById('landing-cards');
  if (!container) return;
  if (_landingActiveRepo === repoName) return;
  _landingActiveRepo = repoName;

  // Show shimmer placeholders
  container.innerHTML = LANDING_RARITY_ORDER.map((r, i) =>
    `<div class="landing-card landing-card-${i === 2 ? 'center' : 'pos' + i} landing-card-loading" data-rarity="${r}"></div>`
  ).join('');

  try {
    const result = await fetchRepoStream(`/api/repo/${repoName}`);
    if (_landingActiveRepo !== repoName) return;
    const contributors = result.data;
    if (!Array.isArray(contributors) || _landingActiveRepo !== repoName) return;

    // Update card count on the featured repo button (for repos added via URL with unknown count)
    const repoBtn = document.querySelector(`.featured-repo-btn[data-repo="${repoName}"] .featured-repo-cards`);
    if (repoBtn) repoBtn.textContent = `${contributors.length} cards`;

    // Pick top contributor from each rarity
    const picks = {};
    for (const rarity of LANDING_RARITY_ORDER) {
      const match = contributors.find(c => c.rarity === rarity && !Object.values(picks).includes(c.login));
      if (match) picks[rarity] = match.login;
    }

    // Build image elements
    if (_landingActiveRepo !== repoName) return;
    const [owner, repo] = repoName.split('/');
    container.innerHTML = LANDING_RARITY_ORDER.map((rarity, i) => {
      const login = picks[rarity];
      if (!login) return '';
      const posClass = i === 2 ? 'landing-card-center' : `landing-card-pos${i}`;
      return `<img src="/api/card/${owner}/${repo}/${login}" alt="${login}" class="landing-card ${posClass}" loading="eager" />`;
    }).join('');
  } catch {
    if (_landingActiveRepo === repoName) container.innerHTML = '';
  }
}

function selectFeaturedRepo(repoName) {
  // Update active state on buttons
  document.querySelectorAll('.featured-repo-btn').forEach(b => {
    b.classList.toggle('featured-repo-active', b.dataset.repo === repoName);
  });
  loadLandingCards(repoName);
}

// ===== LEADERBOARD =====
let _lbEntries = [];
let _lbTotal = 0;

async function loadLeaderboard() {
  const section = document.getElementById('leaderboard-section');
  if (!section) return;

  try {
    let cached = cacheGet('leaderboard', 300000); // 5 min
    let entries = cached?.entries;
    let userScore = _currentUser ? cacheGet('score', 60000) : null; // 1 min

    const [lbRes, scoreRes] = await Promise.all([
      entries ? Promise.resolve(null) : fetch('/api/leaderboard?limit=10'),
      userScore || !_currentUser ? Promise.resolve(null) : fetch('/api/score'),
    ]);

    if (!entries && lbRes && lbRes.ok) {
      const data = await lbRes.json();
      entries = data.entries || [];
      _lbTotal = data.total_entries || 0;
      cacheSet('leaderboard', data);
    } else if (cached) {
      _lbTotal = cached.total_entries || 0;
    }
    entries = entries || [];
    _lbEntries = entries;

    if (!userScore && scoreRes && scoreRes.ok) {
      userScore = await scoreRes.json();
      cacheSet('score', userScore);
    }

    renderLeaderboard(section, entries, userScore);
  } catch { /* silent */ }
}

async function loadMoreLeaderboard() {
  const btn = document.getElementById('lb-load-more');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const res = await fetch(`/api/leaderboard?limit=10&offset=${_lbEntries.length}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const newEntries = data.entries || [];
    _lbTotal = data.total_entries || _lbTotal;
    _lbEntries = _lbEntries.concat(newEntries);

    // Update cache
    cacheSet('leaderboard', { entries: _lbEntries, total_entries: _lbTotal });

    const section = document.getElementById('leaderboard-section');
    const userScore = _currentUser ? cacheGet('score', 60000) : null;
    renderLeaderboard(section, _lbEntries, userScore);
  } catch {
    btn.disabled = false;
    btn.textContent = 'Load more';
  }
}

function renderLeaderboard(section, entries, userScore) {
    let html = `<h3 class="popular-title">Leaderboard</h3>`;

    // User score summary
    if (userScore && userScore.total_points > 0) {
      html += `<div class="score-summary">
        <div class="score-summary-points">${userScore.total_points.toLocaleString()}<span class="score-summary-label">pts</span>${userScore.global_rank ? `<span class="score-summary-rank">#${userScore.global_rank}${_lbTotal ? '/' + _lbTotal : ''}</span>` : ''}</div>
        <div class="score-summary-stats">
          <span>${userScore.repos_collected} repo${userScore.repos_collected !== 1 ? 's' : ''}</span>
          <span class="score-summary-dot">&middot;</span>
          <span>${userScore.repos_completed} complete</span>
        </div>
      </div>`;
    }

    if (entries.length > 0) {
      html += `<div class="leaderboard-list dash-scroll">`;
      entries.forEach((e, i) => {
        const rank = e.rank;
        const isCurrentUser = _currentUser && e.github_username.toLowerCase() === _currentUser.username.toLowerCase();
        const rankClass = rank === 1 ? 'lb-rank-1' : rank === 2 ? 'lb-rank-2' : rank === 3 ? 'lb-rank-3' : '';
        const medalIcon = rank === 1 ? '<span class="lb-medal">🥇</span>' : rank === 2 ? '<span class="lb-medal">🥈</span>' : rank === 3 ? '<span class="lb-medal">🥉</span>' : '';

        html += `<a href="/profile/${encodeURIComponent(e.github_username)}" class="lb-row ${rankClass}${isCurrentUser ? ' lb-you' : ''}">
          <span class="lb-rank">${medalIcon}${rank}</span>
          <img src="${e.avatar_url}" alt="" class="lb-avatar" loading="lazy" />
          <span class="lb-info">
            <span class="lb-name">${e.github_username}</span>
            <span class="lb-detail">${e.repos_completed > 0 ? e.repos_completed + ' collection' + (e.repos_completed !== 1 ? 's' : '') + ' complete' : 'collecting'}</span>
          </span>
          <span class="lb-points">${e.total_points.toLocaleString()}<span class="lb-pts-label">pts</span></span>
        </a>`;
      });

      if (entries.length < _lbTotal) {
        html += `<button id="lb-load-more" class="lb-load-more" onclick="loadMoreLeaderboard()">Load more</button>`;
      }

      html += `</div>`;
    }

    section.innerHTML = html;
}

// ===== DAILIES =====
const DAILY_EVENTS = [
  { type: 'PushEvent', label: 'Push a commit', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0a8 8 0 110 16A8 8 0 018 0zm.75 4.75a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z"/></svg>' },
  { type: 'IssuesEvent', label: 'Open an issue', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/></svg>' },
  { type: 'PullRequestEvent', label: 'Open a pull request', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>' },
  { type: 'IssueCommentEvent', label: 'Comment on an issue', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5zm1.5 0a.25.25 0 01.25-.25h10.5a.25.25 0 01.25.25v7.5a.25.25 0 01-.25.25h-4.5a.75.75 0 00-.53.22l-2.72 2.72v-2.19a.75.75 0 00-.75-.75h-2a.25.25 0 01-.25-.25v-7.5z"/></svg>' },
  { type: 'PullRequestReviewEvent', label: 'Review a pull request', icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.5 3.25c0-.966.784-1.75 1.75-1.75h8.5c.966 0 1.75.784 1.75 1.75v7.5a1.75 1.75 0 01-1.75 1.75H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12.5H3.25a1.75 1.75 0 01-1.75-1.75v-7.5zm7.03 2.22a.75.75 0 10-1.06 1.06L8.69 7.75 7.47 8.97a.75.75 0 101.06 1.06l1.75-1.75a.75.75 0 000-1.06l-1.75-1.75z"/></svg>' },
];

let dailyCountdownInterval = null;

async function loadDailies() {
  const section = document.getElementById('dailies-section');
  if (!section || !_currentUser) return;

  try {
    const res = await fetch('/api/dailies');
    if (!res.ok) { section.innerHTML = ''; return; }
    const data = await res.json();
    renderDailies(section, data);
  } catch { section.innerHTML = ''; }
}

function renderDailies(section, data) {
  const { detected = [], claims = [], claimsCount = 0, maxClaims = 3, resetAt, lastCheckedAt } = data;
  const claimedSet = new Set(claims);
  const detectedSet = new Set(detected);
  const allDone = claimsCount >= maxClaims;

  let itemsHTML = DAILY_EVENTS.map(ev => {
    const isClaimed = claimedSet.has(ev.type);
    const isDetected = detectedSet.has(ev.type);
    const canClaim = isDetected && !isClaimed && !allDone;
    const statusClass = isClaimed ? 'claimed' : canClaim ? 'claimable' : 'unchecked';

    let statusHTML;
    if (isClaimed) {
      statusHTML = `<span class="daily-status-claimed">Claimed</span>`;
    } else if (canClaim) {
      statusHTML = `<button class="daily-claim-btn" data-daily-claim="${ev.type}">Claim +1 ${GP_ICON}</button>`;
    } else {
      statusHTML = `<span class="daily-status-unchecked">Not detected</span>`;
    }

    return `<div class="daily-item ${statusClass}">
      <div class="daily-item-icon">${ev.icon}</div>
      <div class="daily-item-label">${ev.label}</div>
      <div class="daily-item-action">${statusHTML}</div>
    </div>`;
  }).join('');

  const progressDots = Array.from({ length: maxClaims }, (_, i) =>
    `<span class="daily-progress-dot${i < claimsCount ? ' filled' : ''}"></span>`
  ).join('');

  const checkedAgo = lastCheckedAt ? formatTimeAgo(new Date(lastCheckedAt)) : '';
  const checkedHint = checkedAgo ? `<span class="daily-checked-ago">Checked ${checkedAgo}</span>` : '';

  section.innerHTML = `<div class="dailies-section">
    <div class="dailies-header">
      <div class="dailies-title-row">
        <span class="dailies-title">${GP_ICON} Daily Tasks</span>
        <span class="daily-progress">${progressDots} <span class="daily-progress-text">${claimsCount}/${maxClaims}</span></span>
      </div>
      <div class="dailies-meta-row">
        ${checkedHint}
        <button class="daily-refresh-btn" id="daily-refresh-btn">Refresh</button>
        <span class="daily-reset-timer" id="daily-reset-timer"></span>
      </div>
    </div>
    <div class="dailies-desc">Complete any 3 activities on GitHub to earn bonus packs.</div>
    ${allDone ? `<div class="dailies-done">All done for today! Come back tomorrow.</div>` : ''}
    <div class="dailies-grid">${itemsHTML}</div>
    <div class="dailies-hint">Only public GitHub activity counts. Recent activity may take a few minutes to appear.</div>
  </div>`;

  // Wire up claim buttons
  section.querySelectorAll('.daily-claim-btn').forEach(btn => {
    btn.addEventListener('click', () => claimDaily(btn.dataset.dailyClaim));
  });

  // Wire up refresh button
  const refreshBtn = document.getElementById('daily-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshDailies);

  // Start countdown to reset
  startDailyCountdown(resetAt);
}

function formatTimeAgo(date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function startDailyCountdown(resetAt) {
  if (dailyCountdownInterval) clearInterval(dailyCountdownInterval);
  if (!resetAt) return;

  const target = new Date(resetAt).getTime();

  function update() {
    const el = document.getElementById('daily-reset-timer');
    if (!el) { clearInterval(dailyCountdownInterval); return; }
    const remaining = target - Date.now();
    if (remaining <= 0) {
      el.textContent = 'Resetting...';
      clearInterval(dailyCountdownInterval);
      setTimeout(() => loadDailies(), 1500);
      return;
    }
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    el.textContent = `Resets in ${h}h ${String(m).padStart(2, '0')}m`;
  }

  update();
  dailyCountdownInterval = setInterval(update, 60000);
}

async function claimDaily(eventType) {
  const btn = document.querySelector(`[data-daily-claim="${eventType}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Claiming...'; }

  try {
    const res = await fetch('/api/dailies/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType }),
    });
    const data = await res.json();
    if (data.success) {
      if (packState) packState.bonusPacks = data.newBonusPacks;
      renderTopBarPacks();
      if (repoLoaded) renderRepoInfoFromCurrent();
      // Re-fetch full dailies state to re-render
      loadDailies();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Claim +1'; }
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Claim +1'; }
  }
}

async function refreshDailies() {
  const btn = document.getElementById('daily-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }

  try {
    const res = await fetch('/api/dailies/refresh', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      const section = document.getElementById('dailies-section');
      if (section) renderDailies(section, data);
    }
  } catch { /* silent */ }

  if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
}

// ===== SPRINTS (Daily + Weekly) =====
let _sprintData = null; // { daily, weekly, unclaimedCount }
let _sprintCountdownInterval = null;

async function loadSprints() {
  const section = document.getElementById('sprints-section');
  if (!section || !_currentUser) return;

  try {
    const res = await fetch('/api/sprints/current');
    if (!res.ok) { section.innerHTML = ''; return; }
    _sprintData = await res.json();
    renderSprints(section, _sprintData);
  } catch { section.innerHTML = ''; }
}

function renderSprints(section, data) {
  const { daily, weekly, unclaimedCount = 0 } = data;

  // Hide entire section if no active sprints and nothing to claim
  if (!daily && !weekly && unclaimedCount === 0) {
    section.innerHTML = '';
    return;
  }

  const maxDaily = 4;
  const maxWeekly = 12;

  function sprintCardHTML(sprint, label, maxPacks) {
    if (!sprint) {
      return `<div class="sprint-card sprint-card-empty">
        <div class="sprint-card-label">${label}</div>
        <div class="sprint-card-none">No active sprint</div>
      </div>`;
    }

    const repoName = `${sprint.repoOwner}/${sprint.repoName}`;
    const hasEntry = sprint.myEntry && sprint.myEntry.committedAt;
    const power = hasEntry ? sprint.myEntry.totalPower : 0;
    const statusText = hasEntry ? `Committed &middot; ${power} PWR` : 'Not entered';
    const statusClass = hasEntry ? 'sprint-committed' : 'sprint-not-entered';
    const endsAt = new Date(sprint.endsAt).getTime();
    const remaining = endsAt - Date.now();
    const timeText = remaining > 0 ? formatSprintTime(remaining) : 'Ending...';

    return `<div class="sprint-card">
      <div class="sprint-card-top">
        <div class="sprint-card-label">${label}</div>
        <span class="sprint-card-packs">Win up to ${maxPacks} packs</span>
      </div>
      <a class="sprint-card-repo" href="?repo=${repoName}" data-sprint-repo="${repoName}">${repoName} &rarr;</a>
      <div class="sprint-card-details">
        <span class="${statusClass}">${statusText}</span>
        <span class="sprint-separator">&middot;</span>
        <span class="sprint-participants">${sprint.participants === 0 ? 'No participants yet' : sprint.participants + ' participant' + (sprint.participants !== 1 ? 's' : '')}</span>
        <span class="sprint-separator">&middot;</span>
        <span class="sprint-timer" data-sprint-ends="${sprint.endsAt}">${timeText}</span>
      </div>
    </div>`;
  }

  const unclaimedBadge = unclaimedCount > 0
    ? `<span class="sprint-unclaimed-badge">${unclaimedCount} unclaimed</span>`
    : '';

  section.innerHTML = `<div class="sprints-section">
    <div class="sprints-header">
      <span class="sprints-title">${GP_ICON} Sprints <span class="beta-tag">BETA</span></span>
      ${unclaimedBadge}
      <button class="sprint-past-btn" id="sprint-past-btn">Past Sprints</button>
    </div>
    <div class="sprints-desc">Open packs on the featured repo, build your best 5-card lineup, and compete for bonus packs.</div>
    <div class="sprints-cards">
      ${sprintCardHTML(daily, 'Daily Sprint', maxDaily)}
      ${sprintCardHTML(weekly, 'Weekly Sprint', maxWeekly)}
    </div>
  </div>`;

  // Wire repo links
  section.querySelectorAll('[data-sprint-repo]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (isPlainNavClick(e)) { e.preventDefault(); quickLoad(btn.dataset.sprintRepo); }
    });
  });

  // Wire past sprints button
  const pastBtn = document.getElementById('sprint-past-btn');
  if (pastBtn) pastBtn.addEventListener('click', showPastSprintsOverlay);

  // Wire unclaimed badge
  const unclaimedEl = section.querySelector('.sprint-unclaimed-badge');
  if (unclaimedEl) unclaimedEl.addEventListener('click', showPastSprintsOverlay);

  // Start countdown
  startSprintCountdown();
}

function formatSprintTime(ms) {
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function startSprintCountdown() {
  if (_sprintCountdownInterval) clearInterval(_sprintCountdownInterval);

  function update() {
    document.querySelectorAll('.sprint-timer[data-sprint-ends]').forEach(el => {
      const ends = new Date(el.dataset.sprintEnds).getTime();
      const remaining = ends - Date.now();
      if (remaining <= 0) {
        el.textContent = 'Ended';
        clearInterval(_sprintCountdownInterval);
        setTimeout(() => loadSprints(), 2000);
      } else {
        el.textContent = formatSprintTime(remaining);
      }
    });
  }

  update();
  _sprintCountdownInterval = setInterval(update, 60000);
}

// Check if a repo is an active sprint repo
function getActiveSprintForRepo(ownerRepo) {
  if (!_sprintData) return null;
  const lower = ownerRepo.toLowerCase();
  for (const s of [_sprintData.daily, _sprintData.weekly]) {
    if (s && `${s.repoOwner}/${s.repoName}`.toLowerCase() === lower) return s;
  }
  return null;
}

// Sprint section in repo view
function renderSprintPanel(sprint) {
  const hasEntry = sprint.myEntry && sprint.myEntry.committedAt;
  const power = hasEntry ? sprint.myEntry.totalPower : 0;
  const isDaily = sprint.type === 'daily';
  const typeLabel = isDaily ? 'Daily Sprint' : 'Weekly Sprint';

  const BRACKETS = isDaily
    ? [['Top 10%', 4], ['Top 25%', 3], ['Top 50%', 2], ['Participated', 1]]
    : [['Top 10%', 12], ['Top 25%', 9], ['Top 50%', 6], ['Participated', 3]];

  // Build lineup display from user's current collection
  const SLOT_LABELS = [
    { key: 'mythic', label: 'Mythic', color: '#ff0040' },
    { key: 'legendary', label: 'Legendary', color: '#ffd700' },
    { key: 'epic', label: 'Epic', color: '#c084fc' },
    { key: 'rare', label: 'Rare', color: '#60a5fa' },
    { key: 'common', label: 'Common', color: '#888' },
  ];

  // Compute theoretical max power (best possible lineup from all cards in repo)
  const RARITY_IDX = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  const allSorted = [...allContributors].sort((a, b) => b.power - a.power);
  const maxUsed = new Set();
  let maxPower = 0;
  for (const maxRarity of [4, 3, 2, 1, 0]) {
    for (const c of allSorted) {
      if (maxUsed.has(c.login)) continue;
      if (RARITY_IDX[c.rarity] <= maxRarity) { maxUsed.add(c.login); maxPower += c.power; break; }
    }
  }

  let lineupHTML = '';
  let lineupPower = 0;
  const lineup = autoSelectLineupClient();

  for (const slot of SLOT_LABELS) {
    const cardLogin = lineup[`card_${slot.key}`];
    const card = cardLogin ? allContributors.find(c => c.login === cardLogin) : null;
    if (card) {
      lineupPower += card.power;
      const rarityColor = RARITY_COLORS[card.rarity] || '#888';
      lineupHTML += `<div class="sprint-lineup-slot">
        <span class="sprint-slot-label" style="color:${slot.color}">${slot.label}</span>
        <span class="sprint-slot-card">${card.login} <span class="sprint-card-rarity" style="color:${rarityColor};border-color:${rarityColor}40">${card.rarity}</span></span>
        <span class="sprint-slot-power">${card.power} PWR</span>
      </div>`;
    } else {
      lineupHTML += `<div class="sprint-lineup-slot sprint-slot-empty">
        <span class="sprint-slot-label" style="color:${slot.color}">${slot.label}</span>
        <span class="sprint-slot-card sprint-slot-none">No card</span>
        <span class="sprint-slot-power">—</span>
      </div>`;
    }
  }

  const commitLabel = hasEntry ? 'Update Lineup' : 'Commit Lineup';
  const canCommit = lineupPower > 0;
  const endsAt = new Date(sprint.endsAt).getTime();
  const remaining = endsAt - Date.now();
  const timeText = remaining > 0 ? formatSprintTime(remaining) : 'Ended';

  const participantsText = sprint.participants === 0 ? 'No participants yet' : `${sprint.participants} participant${sprint.participants !== 1 ? 's' : ''}`;
  const maxPacks = isDaily ? 4 : 12;

  return `<div class="sprint-repo-panel">
    <div class="panel-desc">Open packs on this repo and compete for bonus packs. Your best card from each rarity is auto-selected into your lineup.</div>
    <div class="sprint-repo-header">
      <span class="sprint-type-badge ${sprint.type}">${typeLabel}</span>
      <span class="sprint-packs-tooltip-wrap">
        <span class="sprint-card-packs">Win up to ${maxPacks} packs &#9432;</span>
        <div class="sprint-packs-tooltip">
          ${BRACKETS.map(([label, packs]) => `<div class="sprint-reward-row"><span class="sprint-reward-bracket">${label}</span><span class="sprint-reward-packs">${packs} pack${packs > 1 ? 's' : ''}</span></div>`).join('')}
        </div>
      </span>
    </div>
    <div class="sprint-repo-meta">
      <span class="sprint-repo-timer">${remaining > 0 ? timeText + ' remaining' : timeText}</span>
      <span class="sprint-separator">&middot;</span>
      <span class="sprint-repo-participants">${participantsText}</span>
    </div>
    <div class="sprint-lineup">
      <div class="sprint-lineup-header">
        <span class="sprint-lh-rarity">Max Rarity</span>
        <span class="sprint-lh-card">Contributor</span>
        <span class="sprint-lh-power">Power</span>
      </div>
      ${lineupHTML}
    </div>
    <div class="sprint-lineup-total">
      <span class="sprint-total-label">Total Power</span>
      <span class="sprint-total-value">${lineupPower} <span class="sprint-total-max">/ ${maxPower} max</span></span>
    </div>
    <button class="sprint-commit-btn" id="sprint-commit-btn" ${canCommit ? '' : 'disabled'} data-sprint-id="${sprint.id}">${commitLabel}</button>
    ${hasEntry ? `<div class="sprint-committed-msg">Committed with ${power} PWR${lineupPower > power ? ` — new lineup has ${lineupPower} PWR` : ''}</div>` : ''}
  </div>`;
}

// Client-side auto-select (mirrors server logic)
function autoSelectLineupClient() {
  const RARITY_IDX = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  // Sort all owned cards by power descending
  const owned = allContributors
    .filter(c => library[c.login])
    .map(c => ({ login: c.login, rarity: c.rarity, power: c.power }))
    .sort((a, b) => b.power - a.power);

  const used = new Set();
  const result = { card_common: null, card_rare: null, card_epic: null, card_legendary: null, card_mythic: null };

  // Pick highest-power unused card at or below a max rarity index
  function pickBest(maxIdx) {
    for (const c of owned) {
      if (used.has(c.login)) continue;
      if (RARITY_IDX[c.rarity] <= maxIdx) { used.add(c.login); return c.login; }
    }
    return null;
  }

  // Fill top-down: best card goes to mythic+ slot first
  result.card_mythic = pickBest(4);     // any rarity
  result.card_legendary = pickBest(3);  // legendary or lower
  result.card_epic = pickBest(2);       // epic or lower
  result.card_rare = pickBest(1);       // rare or lower
  result.card_common = pickBest(0);     // common only
  return result;
}

async function commitSprintLineup(sprintId) {
  const btn = document.getElementById('sprint-commit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Committing...'; }

  try {
    const res = await fetch('/api/sprints/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprintId }),
    });
    const data = await res.json();
    if (data.success) {
      // Update sprint data in memory
      if (_sprintData) {
        for (const key of ['daily', 'weekly']) {
          const s = _sprintData[key];
          if (s && s.id === sprintId) {
            const wasAlreadyCommitted = s.myEntry && s.myEntry.committedAt;
            s.myEntry = {
              totalPower: data.lineup.totalPower,
              committedAt: data.committedAt,
              cardCommon: data.lineup.cardCommon,
              cardRare: data.lineup.cardRare,
              cardEpic: data.lineup.cardEpic,
              cardLegendary: data.lineup.cardLegendary,
              cardMythic: data.lineup.cardMythic,
            };
            if (!wasAlreadyCommitted) {
              s.participants = (s.participants || 0) + 1;
            }
          }
        }
      }
      // Re-render repo view to show updated sprint panel
      if (repoLoaded) renderRepoInfoFromCurrent();
      // Re-render dashboard sprint section
      const section = document.getElementById('sprints-section');
      if (section && _sprintData) renderSprints(section, _sprintData);
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Commit Lineup'; }
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Commit Lineup'; }
  }
}

async function showPastSprintsOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'sprint-overlay';

  overlay.innerHTML = `<div class="sprint-overlay-content">
    <button class="sprint-overlay-close" id="sprint-overlay-close">&times;</button>
    <h2 class="sprint-overlay-title">Past Sprints</h2>
    <div class="sprint-past-tabs">
      <button class="sprint-past-tab active" data-past-tab="daily">Daily</button>
      <button class="sprint-past-tab" data-past-tab="weekly">Weekly</button>
    </div>
    <div class="sprint-past-list" id="sprint-past-list">
      <div class="sprint-past-loading">Loading...</div>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', overlay._escHandler);
  }

  overlay._escHandler = e => { if (e.code === 'Escape') close(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#sprint-overlay-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Wire tabs
  overlay.querySelectorAll('[data-past-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('[data-past-tab]').forEach(t => t.classList.toggle('active', t === tab));
      loadPastSprintsTab(overlay, tab.dataset.pastTab);
    });
  });

  loadPastSprintsTab(overlay, 'daily');
}

async function loadPastSprintsTab(overlay, type) {
  const list = overlay.querySelector('#sprint-past-list');
  if (!list) return;
  list.innerHTML = '<div class="sprint-past-loading">Loading...</div>';

  try {
    const res = await fetch(`/api/sprints/past?type=${encodeURIComponent(type)}&limit=20`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderPastSprintsList(overlay, data.entries, data.total);
  } catch {
    list.innerHTML = '<div class="sprint-past-empty">Failed to load past sprints.</div>';
  }
}

function renderPastSprintsList(overlay, entries, total) {
  const list = overlay.querySelector('#sprint-past-list');
  if (!entries || entries.length === 0) {
    list.innerHTML = '<div class="sprint-past-empty">No past sprints yet.</div>';
    return;
  }

  list.innerHTML = entries.map(e => {
    const repoName = `${e.repoOwner}/${e.repoName}`;
    const typeLabel = e.type === 'daily' ? 'Daily' : 'Weekly';
    const date = new Date(e.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const participated = !!e.committedAt;
    const pending = participated && e.rank == null;
    const rankText = pending
      ? 'Results pending'
      : participated
        ? `#${e.rank}/${e.participants}`
        : (e.id ? 'Did not commit' : 'Did not enter');
    const bracketText = participated && !pending ? getBracketLabel(e.rank, e.participants) : '';
    const packsText = e.packsWon > 0 ? `${e.packsWon} pack${e.packsWon > 1 ? 's' : ''}` : '';

    let actionHTML = '';
    if (e.packsWon > 0 && !e.packsClaimed && e.id) {
      actionHTML = `<button class="sprint-claim-btn" data-claim-entry="${e.id}">Claim ${e.packsWon} pack${e.packsWon > 1 ? 's' : ''}</button>`;
    } else if (e.packsClaimed) {
      actionHTML = `<span class="sprint-claimed-check">Claimed</span>`;
    }

    const powerHTML = participated ? `<span class="sprint-past-power">${e.totalPower} PWR</span>` : '';

    return `<div class="sprint-past-entry" data-sprint-id="${e.sprintId}">
      <div class="sprint-past-main">
        <div class="sprint-past-info">
          <span class="sprint-past-type ${e.type}">${typeLabel}</span>
          <span class="sprint-past-repo">${repoName}</span>
          <span class="sprint-past-date">${date}</span>
        </div>
        <div class="sprint-past-result">
          ${powerHTML}
          <span class="sprint-past-rank">${rankText}</span>
          ${bracketText ? `<span class="sprint-past-bracket">${bracketText}</span>` : ''}
          ${packsText ? `<span class="sprint-past-packs">${packsText}</span>` : ''}
        </div>
      </div>
      <div class="sprint-past-actions">
        ${actionHTML}
        <button class="sprint-rankings-btn" data-rankings-sprint="${e.sprintId}">View Rankings</button>
      </div>
    </div>`;
  }).join('');

  // Wire claim buttons
  list.querySelectorAll('[data-claim-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entryId = btn.dataset.claimEntry;
      btn.disabled = true;
      btn.textContent = 'Claiming...';
      try {
        const res = await fetch('/api/sprints/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId }),
        });
        const data = await res.json();
        if (data.success) {
          btn.outerHTML = `<span class="sprint-claimed-check">Claimed ${data.packsAwarded} pack${data.packsAwarded > 1 ? 's' : ''}</span>`;
          if (packState) packState.bonusPacks = data.newBonusPacks;
          renderTopBarPacks();
          if (repoLoaded) renderRepoInfoFromCurrent();
          // Update unclaimed count on dashboard
          if (_sprintData) {
            _sprintData.unclaimedCount = Math.max(0, (_sprintData.unclaimedCount || 0) - 1);
            const dashSection = document.getElementById('sprints-section');
            if (dashSection) renderSprints(dashSection, _sprintData);
          }
        } else {
          btn.disabled = false;
          btn.textContent = 'Claim';
        }
      } catch {
        btn.disabled = false;
        btn.textContent = 'Claim';
      }
    });
  });

  // Wire rankings buttons
  list.querySelectorAll('[data-rankings-sprint]').forEach(btn => {
    btn.addEventListener('click', () => showRankingsOverlay(btn.dataset.rankingsSprint));
  });
}

// Tier boundaries must match the server finalize_sprint function:
//   top10 = max(ceil(total * 0.10), 1)
//   top25 = max(ceil(total * 0.25), top10 + 1)
//   top50 = max(ceil(total * 0.50), top25 + 1)
// Each tier holds ≥ 1 user, so with few participants the "Top 10%" bracket
// really is just 1st place — label it that way instead of a misleading percentage.
function getBracketLabel(rank, totalParticipants) {
  const total = Number(totalParticipants) || 0;
  if (!rank || !total) return '';
  if (rank > total) return 'Did not commit';

  const top10 = Math.max(Math.ceil(total * 0.10), 1);
  const top25 = Math.max(Math.ceil(total * 0.25), top10 + 1);
  const top50 = Math.max(Math.ceil(total * 0.50), top25 + 1);

  let tierStart, tierEnd, pctLabel;
  if (rank <= top10) {
    tierStart = 1; tierEnd = top10; pctLabel = 'Top 10%';
  } else if (rank <= top25) {
    tierStart = top10 + 1; tierEnd = top25; pctLabel = 'Top 25%';
  } else if (rank <= top50) {
    tierStart = top25 + 1; tierEnd = top50; pctLabel = 'Top 50%';
  } else {
    return 'Participated';
  }

  if (tierStart === tierEnd) return `${ordinalSuffix(tierStart)} Place`;
  return pctLabel;
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

async function showRankingsOverlay(sprintId) {
  const overlay = document.createElement('div');
  overlay.className = 'sprint-overlay';

  overlay.innerHTML = `<div class="sprint-overlay-content">
    <button class="sprint-overlay-close" id="rankings-close">&times;</button>
    <h2 class="sprint-overlay-title">Sprint Rankings</h2>
    <div class="sprint-rankings-list" id="sprint-rankings-list">
      <div class="sprint-past-loading">Loading...</div>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', overlay._escHandler);
  }

  overlay._escHandler = e => { if (e.code === 'Escape') close(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#rankings-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  try {
    const res = await fetch(`/api/sprints/${sprintId}/rankings?limit=50`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderRankingsList(overlay, data, sprintId);
  } catch {
    const el = document.getElementById('sprint-rankings-list');
    if (el) el.innerHTML = '<div class="sprint-past-empty">Failed to load rankings.</div>';
  }
}

function renderRankingsList(overlay, data, sprintId) {
  const list = overlay.querySelector('#sprint-rankings-list');
  const { sprint, entries, total } = data;

  const repoName = `${sprint.repoOwner}/${sprint.repoName}`;
  const typeLabel = sprint.type === 'daily' ? 'Daily' : 'Weekly';

  let html = `<div class="sprint-rankings-header">
    <span class="sprint-past-type ${sprint.type}">${typeLabel}</span>
    <span class="sprint-rankings-repo">${repoName}</span>
    <span class="sprint-rankings-count">${total} participants</span>
  </div>`;

  html += entries.map((e, i) => {
    const medal = e.rank === 1 ? '<span class="lb-medal" style="color:#ffd700">&#x1F947;</span>' :
                  e.rank === 2 ? '<span class="lb-medal" style="color:#c0c0c0">&#x1F948;</span>' :
                  e.rank === 3 ? '<span class="lb-medal" style="color:#cd7f32">&#x1F949;</span>' : '';
    const bracket = getBracketLabel(e.rank, total);
    const isYou = _currentUser && _currentUser.username === e.githubUsername;

    return `<div class="sprint-rank-row${isYou ? ' sprint-rank-you' : ''}">
      <span class="sprint-rank-num">${medal}#${e.rank}</span>
      <img class="sprint-rank-avatar" src="${e.avatarUrl}" alt="" loading="lazy" />
      <span class="sprint-rank-name${isYou ? ' sprint-rank-name-you' : ''}">${e.githubUsername}</span>
      <span class="sprint-rank-power">${e.totalPower} PWR</span>
      <span class="sprint-rank-bracket">${bracket}</span>
      <span class="sprint-rank-packs">${e.packsWon} ${GP_ICON}</span>
    </div>`;
  }).join('');

  // Load more button
  if (entries.length < total) {
    html += `<button class="lb-load-more" id="sprint-rankings-more" data-offset="${entries.length}">Load more</button>`;
  }

  list.innerHTML = html;

  // Wire load more
  wireRankingsLoadMore(list, sprintId);
}

function wireRankingsLoadMore(list, sprintId) {
  const moreBtn = list.querySelector('#sprint-rankings-more');
  if (!moreBtn) return;

  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    moreBtn.textContent = 'Loading...';
    const offset = parseInt(moreBtn.dataset.offset, 10);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/rankings?limit=50&offset=${offset}`);
      if (!res.ok) { moreBtn.disabled = false; moreBtn.textContent = 'Load more'; return; }
      const moreData = await res.json();
      moreBtn.remove();

      const newRows = (moreData.entries || []).map(e => {
        const medal = e.rank <= 3 ? ['&#x1F947;', '&#x1F948;', '&#x1F949;'][e.rank - 1] : '';
        const bracket = getBracketLabel(e.rank, moreData.total);
        const isYou = _currentUser && _currentUser.username === e.githubUsername;
        return `<div class="sprint-rank-row${isYou ? ' sprint-rank-you' : ''}">
          <span class="sprint-rank-num">${medal ? `<span class="lb-medal">${medal}</span>` : ''}#${e.rank}</span>
          <img class="sprint-rank-avatar" src="${e.avatarUrl}" alt="" loading="lazy" />
          <span class="sprint-rank-name${isYou ? ' sprint-rank-name-you' : ''}">${e.githubUsername}</span>
          <span class="sprint-rank-power">${e.totalPower} PWR</span>
          <span class="sprint-rank-bracket">${bracket}</span>
          <span class="sprint-rank-packs">${e.packsWon} ${GP_ICON}</span>
        </div>`;
      }).join('');

      list.insertAdjacentHTML('beforeend', newRows);

      if (offset + (moreData.entries || []).length < moreData.total) {
        list.insertAdjacentHTML('beforeend', `<button class="lb-load-more" id="sprint-rankings-more" data-offset="${offset + moreData.entries.length}">Load more</button>`);
        wireRankingsLoadMore(list, sprintId);
      }
    } catch { /* silent */ }
  });
}

// ===== REFERRAL INFO =====
async function loadReferralInfo() {
  if (!_currentUser) return;
  try {
    const res = await fetch('/api/referrals');
    if (res.ok) _referralInfo = await res.json();
  } catch { /* silent */ }
}

function showTradeStarsOverlay() {
  if (!_currentUser || !currentRepoName || starBalance < 100) return;
  const available = Math.floor(starBalance / 100);
  const overlay = document.createElement('div');
  overlay.className = 'trade-overlay';
  overlay.innerHTML = `<div class="trade-content">
    <div class="trade-title">Trade Stars for Packs</div>
    <div class="trade-desc">&starf; ${starBalance} available &mdash; 100 &starf; per pack</div>
    <div class="trade-buttons">
      <button class="btn-primary trade-confirm-one">Trade 1 Pack (100 &starf;)</button>
      ${available > 1 ? `<button class="btn-primary trade-confirm-all">Trade All ${available} Packs (${available * 100} &starf;)</button>` : ''}
      <button class="btn-secondary trade-confirm-cancel">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.trade-confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.trade-confirm-one').addEventListener('click', () => { overlay.remove(); executeStarTrade(1); });
  const allBtn = overlay.querySelector('.trade-confirm-all');
  if (allBtn) allBtn.addEventListener('click', () => { overlay.remove(); executeStarTrade(available); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function executeStarTrade(count) {
  if (!_currentUser || !currentRepoName || starBalance < 100) return;
  const btn = document.getElementById('trade-stars-btn');
  if (btn) { btn.disabled = true; btn.textContent = `Trading ${count > 1 ? '1/' + count : ''}...`; }
  let traded = 0;
  try {
    for (let i = 0; i < count; i++) {
      if (starBalance < 100) break;
      const res = await fetch('/api/recycling/trade-for-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_repo: currentRepoName }),
      });
      const data = await res.json();
      if (data.success) {
        traded++;
        starBalance = data.newBalance;
        if (packState) packState.bonusPacks = data.newBonusPacks;
        if (btn && count > 1) btn.textContent = `Trading ${traded + 1}/${count}...`;
      } else { break; }
    }
    renderTopBarPacks();
    renderRepoInfoFromCurrent();
  } catch {
    if (traded > 0) { renderTopBarPacks(); renderRepoInfoFromCurrent(); }
    else if (btn) { btn.disabled = false; }
  }
}

async function claimShareReward() {
  if (!_currentUser || (_referralInfo && _referralInfo.sharedOnX)) return;
  try {
    const res = await fetch('/api/share-reward', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        if (packState) packState.bonusPacks = data.newBonusPacks;
        if (_referralInfo) _referralInfo.sharedOnX = true;
        renderTopBarPacks();
      }
    }
  } catch { /* silent */ }
}

// Load pack state for top bar (all users)
loadPackState();
loadReferralInfo();

// Auto-load from URL param, otherwise show repo browser
const urlRepo = new URLSearchParams(window.location.search).get('repo');
const urlCard = new URLSearchParams(window.location.search).get('card');
if (urlRepo && !_currentUser && urlCard) {
  // Logged-out user with shared card link — show lightweight card overlay
  showSharedCardOverlay(urlRepo, urlCard);
  loadPopularRepos();
} else if (urlRepo && !_currentUser && !urlCard) {
  // Logged-out user with repo link — show landing with that repo's cards featured
  loadPopularRepos(urlRepo);
} else if (urlRepo && _currentUser) {
  // Logged-in user with URL param — load popular repos first (creates input), then load repo
  loadPopularRepos().then(() => {
    if (input) input.value = urlRepo;
    loadRepo(false, urlRepo);
  });
} else {
  loadPopularRepos();
}

// Handle browser back/forward between homepage and repo views
window.addEventListener('popstate', () => {
  const repo = new URLSearchParams(window.location.search).get('repo');
  if (repo && (!repoLoaded || currentRepoName !== repo)) {
    if (input) input.value = repo;
    loadRepo(false, repo);
  } else if (!repo && repoLoaded) {
    newRepo(true);
  }
});

function saveLibrary() {
  if (!currentRepoName) return;
  // Only save to localStorage for logged-out users
  if (!_currentUser) {
    try { localStorage.setItem('ghtc_lib_' + currentRepoName.toLowerCase(), JSON.stringify(library)); } catch { }
  }
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
    }
  } catch { /* silent */ }
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

const RARITY_POINTS = { mythic: 50, legendary: 15, epic: 5, rare: 2, common: 1 };
const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'common'];
const RARITY_COLORS = { mythic: '#ff0040', legendary: '#ffd700', epic: '#c084fc', rare: '#60a5fa', common: '#888' };

function computeRepoBasePoints(contributors, collectedLogins) {
  let total = 0;
  for (const c of contributors) {
    if (collectedLogins[c.login]) {
      total += RARITY_POINTS[c.rarity] || 0;
    }
  }
  return total;
}

function computeCompletionBonus(basePoints, isComplete) {
  return isComplete ? Math.floor(basePoints * 0.5) : 0;
}

const REVERT_YIELD = { common: 1, rare: 3, epic: 10, legendary: 30, mythic: 100 };
const CHERRY_PICK_COST = { common: 5, rare: 15, epic: 50, legendary: 150, mythic: 500 };

async function loadRepo(fromHomepage, repoOverride) {
  const repoInput = (repoOverride || (input ? input.value : '')).trim().replace(/^https?:\/\/github\.com\//, '');
  const match = repoInput.match(/^([^/]+)\/([^/]+)/);
  if (!match) return showError('Enter a valid repo like owner/repo');
  const [, owner, repo] = match;

  // Update URL so the page can be refreshed without retyping
  const url = new URL(window.location);
  url.searchParams.set('repo', `${owner}/${repo}`);
  window.history.replaceState({}, '', url);

  showError(''); grid.innerHTML = ''; repoInfo.style.display = 'none';
  popularRepos.style.display = 'none';
  const landingEl = document.getElementById('landing-section');
  if (landingEl) landingEl.style.display = 'none';
  loading.style.display = 'block'; if (btn) btn.disabled = true;
  _resetProgress();
  try {
    const onEvent = makeProgressDriver();
    const result = await fetchRepoStream(`/api/repo/${owner}/${repo}`, onEvent);
    allContributors = result.data;
    repoFetchedAt = result.fetchedAt || null;
    repoPartialMeta = result.partialMeta || null;

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

    // Check achievements and refresh DB scores for logged-in users
    lastAchievementData = null;
    if (_currentUser) {
      try {
        const achRes = await fetch(`/api/achievements/${owner}/${repo}`);
        if (achRes.ok) lastAchievementData = await achRes.json();
      } catch { /* silent */ }
      // Fire-and-forget: trigger score refresh so DB stays in sync with repo cache
      fetch(`/api/score/${owner}/${repo}`).catch(() => {});
    }

    // Capture card param before replaceState strips it
    const urlCard = new URLSearchParams(window.location.search).get('card');

    loading.style.display = 'none';
    if (searchContainer) searchContainer.style.display = 'none';
    document.getElementById('gallery-screen').classList.add('repo-loaded');
    if (fromHomepage) {
      history.pushState(null, '', `?repo=${owner}/${repo}`);
    } else {
      history.replaceState(null, '', `?repo=${owner}/${repo}`);
    }
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
  } catch (err) { console.error('[GHTC] loadRepo error:', err.message, err.stack); showError(err.message, err.details); loading.style.display = 'none'; }
  if (btn) btn.disabled = false;
}

// Human-readable "2 hours ago" / "5 days ago" for the updated-at pill.
function formatTimeAgo(iso) {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// Returns true if the cached data is > 24h old — we only surface the Refresh
// button past this threshold to avoid nudging people to re-fetch fresh data.
function shouldOfferRefresh(fetchedAtIso) {
  if (!fetchedAtIso) return true;
  return Date.now() - new Date(fetchedAtIso).getTime() > 24 * 60 * 60 * 1000;
}

async function refreshRepoData() {
  if (!currentRepoName) return;
  const parts = currentRepoName.match(/^([^/]+)\/([^/]+)/);
  if (!parts) return;
  const [, owner, repo] = parts;
  const btn = document.getElementById('refresh-repo-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  showError('');

  try {
    const result = await fetchRepoStream(`/api/repo/${owner}/${repo}?refresh=true`);
    allContributors = result.data;
    repoFetchedAt = result.fetchedAt || new Date().toISOString();
    repoPartialMeta = result.partialMeta || null;
    renderRepoInfo(owner, repo);
    renderLibrary();
  } catch (err) {
    console.error('[GHTC] refreshRepoData error:', err);
    showError(err.message, err.details);
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh data'; }
  }
}

function renderRepoInfo(owner, repo) {
  repoInfo.style.display = 'block';
  const collected = allContributors.reduce((n, c) => n + (library[c.login] ? 1 : 0), 0);
  const total = allContributors.length;

  // Pack state UI for logged-in users
  let packHTML = '';
  if (_currentUser && packState) {
    const { readyPacks, bonusPacks = 0 } = packState;
    const totalPacks = bonusPacks + readyPacks;
    packHTML = `<div class="pack-state">
      <div class="pack-count">
        <span class="pack-count-icon">${GP_ICON}</span>
        <span class="pack-count-num">${totalPacks}</span>
        <span class="pack-count-label">pack${totalPacks !== 1 ? 's' : ''} <span class="pack-any-repo">usable on any repo</span></span>
      </div>
    </div>`;
  }

  // Sign-in nudge for logged-out users
  let authNudge = '';
  if (!_currentUser) {
    authNudge = `<div class="auth-nudge"><span class="auth-nudge-icon">&#x1f512;</span> Sign up to save your cards — start with <strong>10 packs</strong></div>`;
  }

  // Achievement panel for logged-in users
  let achievementHTML = '';
  if (_currentUser) {
    const isContributor = lastAchievementData && lastAchievementData.isContributor;
    const stats = isContributor ? lastAchievementData.contributor : { commits: 0, prsMerged: 0, issues: 0, activeWeeks: 0, maxStreak: 0, peak: 0 };
    const milestones = isContributor ? lastAchievementData.milestones : {};
    const maxPerStat = lastAchievementData?.maxPerStat ?? 0;
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
      const m = milestones[key] || { claimed: [], claimable: [], locked: [] };

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
      <div class="panel-desc">Contribute to this repo to earn bonus packs</div>
      <div class="ach-slots-info">
        <span class="ach-slots-label">${Math.min(maxPerStat, 5)}/5 slots unlocked</span>
        ${slotsHint ? `<span class="ach-slots-hint">${slotsHint}</span>` : ''}
      </div>
      ${rows}
      ${claimAllBtn}
    </div>`;
  }

  const isComplete = total > 0 && collected >= total;

  const ghLink = `<a class="repo-gh-link" href="https://github.com/${owner}/${repo}" target="_blank" rel="noopener">${GH_ICON} View on GitHub</a>`;

  // Points breakdown by rarity
  let breakdownHTML = '';
  if (_currentUser) {
    const totalBase = computeRepoBasePoints(allContributors, library);
    const rows = RARITY_ORDER.map(rarity => {
      const allOfRarity = allContributors.filter(c => c.rarity === rarity);
      const collectedOfRarity = allOfRarity.filter(c => library[c.login]);
      const pts = collectedOfRarity.length * RARITY_POINTS[rarity];
      return { rarity, collected: collectedOfRarity.length, total: allOfRarity.length, ptsEach: RARITY_POINTS[rarity], pts };
    });
    const completionBonus = computeCompletionBonus(totalBase, isComplete);
    const grandTotal = totalBase + completionBonus;

    breakdownHTML = `<div class="points-breakdown">
      <div class="panel-desc">Collect cards to earn points and climb the leaderboard</div>
      <div class="pb-rows">
        ${rows.map(r => `<div class="pb-row">
          <span class="pb-rarity" style="color:${RARITY_COLORS[r.rarity]}">${r.rarity}</span>
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

  const offerRefresh = shouldOfferRefresh(repoFetchedAt);
  const isPartial = !!repoPartialMeta;
  const updatedLabel = repoFetchedAt ? formatTimeAgo(repoFetchedAt) : 'not yet cached';
  const freshnessHTML = `<div class="repo-freshness${isPartial ? ' repo-freshness-partial' : ''}">
      <span class="repo-freshness-label">${isPartial ? 'Partial data' : 'Updated'} ${updatedLabel}</span>
      ${offerRefresh || isPartial
        ? `<button class="repo-freshness-btn" id="refresh-repo-btn" title="Re-fetch this repo's contributor data from GitHub">Refresh data</button>`
        : ''}
    </div>`;

  repoInfo.innerHTML = `<div class="repo-info-row">
      <div class="repo-info-inner${isComplete ? ' repo-info-complete' : ''}">
        <h2><span>${owner || ''}</span> / <span>${repo || ''}</span></h2>
        ${ghLink}
        <div class="repo-info-sep"></div>
        <div class="collection-progress"><span>${collected}</span> / <span>${total}</span> collected</div>
      </div>
      <button class="switch-repo-btn" id="switch-repo-btn">Switch Repo</button>
    </div>
    ${freshnessHTML}
    ${authNudge}
    <div class="repo-action-row">
      <div class="action-buttons">
        <button class="btn-secondary" id="open-pack-btn" ${total === 0 ? 'disabled' : ''} ${_currentUser && packState && ((packState.bonusPacks || 0) + packState.readyPacks) <= 0 ? 'disabled' : ''} ${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? '' : ''}>${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? 'Sign Up — 10 Packs Waiting' : 'Open Pack'}</button>
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
            <div class="panel-desc">Revert duplicate cards for stars, spend stars to cherry-pick missing cards or trade for packs (100 &starf;)</div>
            <div class="stars-balance-display">&starf; ${starBalance} Stars</div>
            <div class="stars-rates">
              <div class="stars-rates-header"><span>Rarity</span><span>Revert</span><span>Dupes</span><span>Cherry-pick</span><span>Missing</span></div>
              ${perRarity.map(r => `<div class="stars-rates-row"><span style="color:${rarityClrs[r.rarity]}">${r.rarity}</span><span>+${r.revertYield}</span><span>${r.dupes > 0 ? r.dupes : '—'}</span><span>${r.cherryCost}</span><span>${r.missing > 0 ? r.missing : '—'}</span></div>`).join('')}
              <div class="stars-rates-totals"><span></span><span></span><span class="stars-total-revert">${totalRevertStars > 0 ? '+' + totalRevertStars + ' &starf;' : ''}</span><span></span><span class="stars-total-cherry">${totalCherryStars > 0 ? totalCherryStars + ' &starf;' : ''}</span></div>
            </div>
            ${hasDupes ? `<button class="stars-revert-all-btn" id="revert-all-btn">Revert All Duplicates (${dupeCount} cards &rarr; +${totalRevertStars} &starf;)</button>` : '<div class="stars-no-dupes">No duplicate cards to revert</div>'}
            ${totalCherryStars > 0 && starBalance >= totalCherryStars ? `<button class="stars-cherry-all-btn" id="cherry-pick-all-btn">Cherry-pick All Missing (${perRarity.reduce((s,r) => s + r.missing, 0)} cards for ${totalCherryStars} &starf;)</button>` : ''}
            ${starBalance >= 100 ? `<button class="stars-trade-btn" id="trade-stars-btn">Trade 100 &starf; for 1 Bonus Pack (${Math.floor(starBalance / 100)} available)</button>` : ''}
          </div>
        </details>`;
      }
      // Check if this repo is an active sprint
      const activeSprint = getActiveSprintForRepo(`${owner}/${repo}`);

      let leftCol = '';
      if (_currentUser && activeSprint) {
        // Sprint repo: achievements locked, sprint panel stacked below (wrapped like right column)
        leftCol = `<div class="repo-panels-left">
          <details class="repo-panel-collapse" id="achievements-panel"><summary class="repo-panel-toggle">Your Achievements <span class="panel-summary sprint-ach-locked">Disabled for sprint repos to keep competition fair</span></summary>${achievementHTML}</details>
          <details class="repo-panel-collapse" id="sprint-panel" open><summary class="repo-panel-toggle">Sprint <span class="beta-tag">BETA</span></summary>${renderSprintPanel(activeSprint)}</details>
        </div>`;
      } else if (_currentUser) {
        leftCol = `<details class="repo-panel-collapse" id="achievements-panel"><summary class="repo-panel-toggle">Your Achievements</summary>${achievementHTML}</details>`;
      }

      const pointsTotal = (() => {
        const tb = computeRepoBasePoints(allContributors, library);
        return tb + computeCompletionBonus(tb, isComplete);
      })();
      const rightPanels = [
        _currentUser ? `<details class="repo-panel-collapse" id="points-panel"><summary class="repo-panel-toggle">Score <span class="panel-summary">${pointsTotal.toLocaleString()} pts${!isComplete ? ' &middot; 1.5x bonus at completion' : ' &middot; 1.5x bonus active'}</span></summary>${breakdownHTML}</details>` : '',
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

  // Panel open/close logic: achievements & stars open on desktop; on mobile, only if actionable
  const _isMobile = window.innerWidth <= 768;
  const sprintPanel = document.getElementById('sprint-panel');
  const achPanel = document.getElementById('achievements-panel');
  if (sprintPanel) {
    // Sprint panel is always open (set via HTML 'open' attribute)
    // Achievement panel stays CLOSED on sprint repos
  } else if (achPanel) {
    if (!_isMobile || document.querySelector('.ach-slot.claimable, #ach-claim-all')) {
      achPanel.setAttribute('open', '');
    }
  }
  // Points/score panel always stays closed
  const starsPanel = document.getElementById('stars-panel');
  if (starsPanel) {
    if (!_isMobile || document.getElementById('revert-all-btn') || document.getElementById('cherry-pick-all-btn')) {
      starsPanel.setAttribute('open', '');
    }
  }

  // Wire up sprint commit button
  const sprintCommitBtn = document.getElementById('sprint-commit-btn');
  if (sprintCommitBtn) {
    sprintCommitBtn.addEventListener('click', () => commitSprintLineup(sprintCommitBtn.dataset.sprintId));
  }

  // Wire up open pack button
  const openPackBtn = document.getElementById('open-pack-btn');
  if (openPackBtn) {
    if (!_currentUser && localStorage.getItem('gp_guest_limit_reached')) {
      openPackBtn.addEventListener('click', () => { if (window.__gpLogin) window.__gpLogin(); });
    } else {
      openPackBtn.addEventListener('click', () => openPack());
    }
  }

  // Wire up revert all duplicates button
  const revertAllBtn = document.getElementById('revert-all-btn');
  if (revertAllBtn) revertAllBtn.addEventListener('click', () => showRevertAllOverlay());

  // Wire up cherry-pick all button
  const cherryAllBtn = document.getElementById('cherry-pick-all-btn');
  if (cherryAllBtn) cherryAllBtn.addEventListener('click', () => showCherryPickAllOverlay());

  // Wire up trade stars for pack button
  const tradeBtn = document.getElementById('trade-stars-btn');
  if (tradeBtn) tradeBtn.addEventListener('click', () => showTradeStarsOverlay());

  // Wire up search input
  const searchInput = document.getElementById('card-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => { cardSearch = e.target.value; renderLibrary(); const el = document.getElementById('card-search'); if (el) { el.focus(); el.setSelectionRange(cardSearch.length, cardSearch.length); } });
  }
  // Wire up switch repo button
  const switchBtn = document.getElementById('switch-repo-btn');
  if (switchBtn) switchBtn.addEventListener('click', () => newRepo());

  // Wire up refresh data button — explicit user-triggered re-fetch from GitHub
  const refreshBtn = document.getElementById('refresh-repo-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshRepoData());

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
function flashPackError(msg) {
  const btn = document.getElementById('open-pack-btn');
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
}

let packOpen = false;
async function openPack() {
  if (!allContributors.length || packOpen) return;

  // Check pack availability for logged-in users
  if (_currentUser && packState && ((packState.bonusPacks || 0) + packState.readyPacks) <= 0) {
    return; // No packs available
  }

  packOpen = true;
  const [owner, repo] = currentRepoName.split('/');
  let response, data;
  try {
    response = await fetch(`/api/repo/${owner}/${repo}/pack`);

    // If server cache expired (404), re-fetch repo data to repopulate it, then retry once
    if (response.status === 404) {
      try {
        const repoResult = await fetchRepoStream(`/api/repo/${owner}/${repo}`);
        allContributors = repoResult.data;
        response = await fetch(`/api/repo/${owner}/${repo}/pack`);
      } catch { /* fall through — pack call already failed, surface that error */ }
    }

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
          packState = { readyPacks: 0, bonusPacks: 0, maxPacks: 2, nextRegenAt: errData.nextRegenAt };
          renderRepoInfoFromCurrent();
        }
      } else {
        flashPackError('Something went wrong. Try again.');
      }
      packOpen = false;
      return;
    }

    data = await response.json();
  } catch (err) {
    console.error('[GHTC] openPack fetch error:', err);
    flashPackError('Network error. Check your connection and try again.');
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
      invalidateCardCaches();
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
  const packAuthBanner = !_currentUser ? `<div class="pack-auth-banner"><span class="pack-auth-banner-icon">&#x1f512;</span> Sign up — start with 10 packs <button class="login-btn pack-auth-banner-btn" id="pack-sign-in-btn"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign Up</button></div>` : '';

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
      // Just update the in-memory cache
      library[slot._contributor.login] = (library[slot._contributor.login] || 0) + 1;
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
                if (d.packState) { packState = d.packState; invalidateCardCaches(); }
                if (d.guestPacksRemaining !== undefined) { guestPacksRemaining = d.guestPacksRemaining; localStorage.setItem('gp_guest_packs_remaining', String(guestPacksRemaining)); }
              }
              renderTopBarPacks();
            } else if (res.status === 429) {
              const errData = await res.json().catch(() => ({}));
              packState = { readyPacks: 0, bonusPacks: 0, maxPacks: 2, nextRegenAt: errData.nextRegenAt };
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
          const totalAvail = (packState.bonusPacks || 0) + packState.readyPacks;
          anotherBtn.textContent = totalAvail > 0 ? `Open Another (${totalAvail})` : 'No Packs Left';
          if (totalAvail <= 0) hasMorePacks = false;
        } else if (!_currentUser) {
          const limitReached = localStorage.getItem('gp_guest_limit_reached');
          if (limitReached || guestPacksRemaining <= 0) {
            hasMorePacks = false;
            // Replace "View Library" with sign-up CTA for guests
            doneBtn.textContent = 'Sign Up — 10 Packs Waiting';
            doneBtn.className = 'reveal-done-btn reveal-signup-btn';
            doneBtn.onclick = () => { if (window.__gpLogin) window.__gpLogin(); };
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
  // Block achievement claims on sprint repos
  if (getActiveSprintForRepo(currentRepoName)) return;

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
    invalidateCardCaches();
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
  // Block achievement claims on sprint repos
  if (getActiveSprintForRepo(currentRepoName)) return;

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
window.loadMoreLeaderboard = loadMoreLeaderboard;

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
  const url = getReferralUrl(window.location.origin + window.location.pathname + '?repo=' + currentRepoName);
  const btn = document.getElementById('share-btn');
  navigator.clipboard.writeText(url).then(() => {
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Share', 2000); }
  }).catch(() => {
    prompt('Copy this link:', url);
  });
}

function newRepo(skipHistory) {
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
  if (searchContainer) searchContainer.style.display = '';
  popularRepos.style.display = '';
  const landingElRestore = document.getElementById('landing-section');
  if (landingElRestore) landingElRestore.style.display = '';
  document.getElementById('gallery-screen').classList.remove('repo-loaded');
  if (input) { input.value = ''; input.focus(); }
  if (!skipHistory) history.pushState(null, '', window.location.pathname);
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
  if (!currentRepoName) return;
  const parts = currentRepoName.match(/^([^/]+)\/([^/]+)/);
  if (parts) renderRepoInfo(parts[1], parts[2]);
}

// ===== HELPERS =====
function showError(m, details) {
  if (!m) { errorEl.innerHTML = ''; errorEl.style.display = 'none'; return; }
  // Plain string error (no structured details) — keep the old simple look.
  if (!details || !details.failures || !details.failures.length) {
    errorEl.innerHTML = escapeHtml(m);
    errorEl.style.display = 'block';
    return;
  }
  // Structured error: main message + collapsible technical breakdown.
  const failuresHTML = details.failures.map((f) => {
    const attempts = Array.isArray(f.attempts) ? f.attempts : [];
    const statusList = attempts.map((a) => a.status).join(', ') || 'n/a';
    const waited = f.totalWaitedMs ? `${Math.round(f.totalWaitedMs / 1000)}s` : '0s';
    return `<div class="err-failure">
      <div class="err-failure-head"><span class="err-step">${escapeHtml(f.step)}</span> <span class="err-last-status">HTTP ${f.lastStatus ?? '—'}</span></div>
      <div class="err-endpoint">${escapeHtml(f.endpoint || '')}</div>
      <div class="err-attempts">Attempts: ${escapeHtml(String(statusList))} &middot; waited ${waited}</div>
      ${f.message ? `<div class="err-msg">${escapeHtml(f.message)}</div>` : ''}
    </div>`;
  }).join('');
  errorEl.innerHTML = `
    <div class="err-primary">${escapeHtml(m)}</div>
    <details class="err-details"><summary>Technical details</summary>
      ${failuresHTML}
    </details>`;
  errorEl.style.display = 'block';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
        <p class="fs-sales-cta">Start with <strong>10 packs</strong>. Contribute to a repo and <strong>get your own card</strong>.</p>
        ${localStorage.getItem('gp_ref') ? `<p class="fs-referral-nudge">Plus gain <strong>5 bonus packs</strong> for you and your referrer!</p>` : ''}
        <button class="login-btn fs-sales-btn" id="fs-sign-in"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign In with GitHub</button>
      </div>` : ''}
      <div class="fullscreen-profile-links">
        <a class="fullscreen-profile" href="https://github.com/${c.login}" target="_blank" rel="noopener">${GH_ICON} GitHub</a>
        <a class="fullscreen-profile" href="/profile/${encodeURIComponent(c.login)}">GitPacks Profile</a>
      </div>
      <div class="fullscreen-share-row">
        <button class="share-action-btn" id="fs-copy-link">Copy Link</button>
        <a class="share-action-btn" id="fs-share-x" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(_currentUser && _currentUser.username === c.login ? `Check out my @GitPacks card for ${currentRepoName}!` : `Check out ${c.login}'s @GitPacks card for ${currentRepoName}!`)}&url=${encodeURIComponent(getReferralUrl(`${window.location.origin}/card/${currentRepoName}/${c.login}`))}" target="_blank" rel="noopener">Share on X</a>
        <button class="share-action-btn" id="fs-copy-md">Copy for README</button>
      </div>
      ${_currentUser && _referralInfo ? `<div class="fs-referral-info">
        ${!_referralInfo.sharedOnX ? `<div class="fs-referral-hint">Share on X to earn <strong>5 bonus packs</strong>!</div>` : `<div class="fs-referral-claimed">Shared — 5 packs earned</div>`}
        <div class="fs-referral-link">When someone signs up with your link, you <strong>both</strong> get <strong>5 bonus packs</strong> <button class="fs-ref-copy-btn" id="fs-ref-copy">${_referralInfo.referralCount}/${_referralInfo.maxReferrals} referrals</button></div>
      </div>` : ''}
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

  // Share buttons (all URLs include referral link)
  const shareUrl = getReferralUrl(`${window.location.origin}/card/${currentRepoName}/${c.login}`);
  const mdSnippet = `<a href="${shareUrl}"><img src="${window.location.origin}/api/card/${currentRepoName}/${c.login}" alt="${c.login} on ${currentRepoName}" width="200" /></a>`;

  const copyLinkBtn = overlay.querySelector('#fs-copy-link');
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
    });
  });

  // Share on X — also triggers one-time share reward
  const shareXBtn = overlay.querySelector('#fs-share-x');
  if (shareXBtn) shareXBtn.addEventListener('click', () => {
    claimShareReward();
  });

  const copyMdBtn = overlay.querySelector('#fs-copy-md');
  if (copyMdBtn) copyMdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(mdSnippet).then(() => {
      copyMdBtn.textContent = 'Copied!';
      setTimeout(() => { copyMdBtn.textContent = 'Copy for README'; }, 2000);
    });
  });

  // Referral link copy button
  const refCopyBtn = overlay.querySelector('#fs-ref-copy');
  if (refCopyBtn) refCopyBtn.addEventListener('click', () => {
    const refUrl = getReferralUrl(window.location.origin);
    navigator.clipboard.writeText(refUrl).then(() => {
      refCopyBtn.textContent = 'Copied!';
      setTimeout(() => { refCopyBtn.textContent = `${_referralInfo?.referralCount || 0}/${_referralInfo?.maxReferrals || 10} referrals`; }, 2000);
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
    invalidateCardCaches();
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
    invalidateCardCaches();
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

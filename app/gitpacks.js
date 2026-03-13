let _initialized = false;
let _currentUser = null;

export function initGitPacks(user) {
// Prevent double-init — just update user reference on re-calls
if (_initialized) {
  _currentUser = user || null;
  // Re-render repo info to update pack state / auth messaging
  if (repoLoaded) {
    loadPackState().then(() => renderRepoInfoFromCurrent());
  }
  return;
}
_initialized = true;
_currentUser = user || null;

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
let showMissing = false;
let cardSearch = '';

// Pack state for logged-in users
let packState = null; // { readyPacks, maxPacks, nextRegenAt }
let packCountdownInterval = null;

const searchContainer = document.getElementById('search-container');
const popularRepos = document.getElementById('popular-repos');

btn.addEventListener('click', () => loadRepo());
document.getElementById('share-btn').addEventListener('click', () => shareRepo());

function setProgress(step, pct, detail) {
  ['step-commits','step-issues','step-processing'].forEach(id => {
    document.getElementById(id).className = 'progress-step';
  });
  const steps = ['step-commits','step-issues','step-processing'];
  const idx = steps.indexOf(step);
  for (let i = 0; i < idx; i++) document.getElementById(steps[i]).className = 'progress-step done';
  if (idx >= 0) document.getElementById(step).className = 'progress-step active';
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-detail').textContent = detail || '';
}

input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });

function quickLoad(repo) { input.value = repo; loadRepo(); }

// ===== PACK STATE =====
async function loadPackState() {
  if (!_currentUser) { packState = null; return; }
  try {
    const res = await fetch('/api/pack-state');
    if (res.ok) {
      packState = await res.json();
    }
  } catch { packState = null; }
}

function startPackCountdown() {
  if (packCountdownInterval) clearInterval(packCountdownInterval);
  packCountdownInterval = setInterval(() => {
    const el = document.getElementById('pack-countdown');
    if (!el || !packState || !packState.nextRegenAt) {
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
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    el.textContent = `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }, 1000);
}

// ===== POPULAR REPOS =====
async function loadPopularRepos() {
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
      // Merge user repo data with all repos
      repos.forEach(r => {
        const ur = userRepos.find(u => u.name === r.name.toLowerCase());
        r.collected = ur ? ur.collected : 0;
        r.pct = r.cards > 0 ? r.collected / r.cards : 0;
      });
    }

    const yourRepos = repos.filter(r => r.collected > 0).sort((a, b) => b.pct - a.pct || b.cards - a.cards);
    const otherRepos = repos.filter(r => r.collected === 0).sort((a, b) => b.cards - a.cards);

    function repoBtn(r) {
      const pctNum = Math.round(r.pct * 100);
      return `<button class="popular-repo-btn" data-repo="${r.name}">
          <span class="popular-repo-name">${r.name}</span>
          <span class="popular-repo-meta">
            <span class="popular-repo-progress">${r.collected}/${r.cards}</span>
            <span class="popular-repo-pct">${pctNum}%</span>
          </span>
        </button>`;
    }

    let html = '';
    if (yourRepos.length) {
      html += `<div class="popular-section">
        <h3 class="popular-title">Your Repos</h3>
        <div class="popular-grid">${yourRepos.map(repoBtn).join('')}</div>
      </div>`;
    }
    if (otherRepos.length) {
      html += `<div class="popular-section">
        <h3 class="popular-title">Popular Repos</h3>
        <div class="popular-grid">${otherRepos.map(repoBtn).join('')}</div>
      </div>`;
    }
    popularRepos.innerHTML = html;
    popularRepos.querySelectorAll('.popular-repo-btn').forEach(b => {
      b.addEventListener('click', () => quickLoad(b.dataset.repo));
    });
  } catch { /* silent */ }
}

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
  var libKey = 'ghtc_lib_' + currentRepoName.toLowerCase();
  var libData = localStorage.getItem(libKey);
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
      <p style="color:#555;font-size:0.75rem;margin-top:8px">This may take a moment for large repos</p>
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

    // Load pack state for logged-in users
    if (_currentUser) {
      await loadPackState();
    }

    loading.style.display = 'none';
    searchContainer.style.display = 'none';
    document.getElementById('gallery-screen').classList.add('repo-loaded');
    history.replaceState(null, '', `?repo=${owner}/${repo}`);
    renderRepoInfo(owner, repo);
    renderLibrary();
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
        <span class="pack-count-label">pack${readyPacks !== 1 ? 's' : ''} ready</span>
      </div>
      ${readyPacks < maxPacks && nextRegenAt ? `<div class="pack-regen"><span class="pack-regen-label">Next pack in</span><span class="pack-regen-time" id="pack-countdown">--:--</span></div>` : ''}
    </div>`;
  }

  // Sign-in nudge for logged-out users
  let authNudge = '';
  if (!_currentUser) {
    authNudge = `<div class="auth-nudge"><span class="auth-nudge-icon">&#x1f512;</span> Sign in to save your collection across devices</div>`;
  }

  repoInfo.innerHTML = `<div class="repo-info-row">
      <div class="repo-info-inner">
        <h2><span>${owner || ''}</span> / <span>${repo || ''}</span></h2>
        <div class="repo-info-sep"></div>
        <div class="collection-progress"><span>${collected}</span> / <span>${total}</span> collected</div>
      </div>
      <button class="switch-repo-btn" id="switch-repo-btn">Switch Repo</button>
    </div>
    ${authNudge}
    <div class="action-buttons">
      <button class="btn-secondary" id="open-pack-btn" ${total === 0 ? 'disabled' : ''} ${_currentUser && packState && packState.readyPacks <= 0 ? 'disabled' : ''} ${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? 'disabled' : ''}>${!_currentUser && localStorage.getItem('gp_guest_limit_reached') ? 'Sign In to Open Packs' : 'Open Pack'}</button>
      ${packHTML}
    </div>
    <div class="filter-bar" id="filter-bar">
      <button class="filter-btn ${filterRarity==='all'?'active':''}" data-rarity="all" onclick="setFilter('all')">All</button>
      <button class="filter-btn ${filterRarity==='mythic'?'active':''}" data-rarity="mythic" onclick="setFilter('mythic')">Mythic</button>
      <button class="filter-btn ${filterRarity==='legendary'?'active':''}" data-rarity="legendary" onclick="setFilter('legendary')">Legendary</button>
      <button class="filter-btn ${filterRarity==='epic'?'active':''}" data-rarity="epic" onclick="setFilter('epic')">Epic</button>
      <button class="filter-btn ${filterRarity==='rare'?'active':''}" data-rarity="rare" onclick="setFilter('rare')">Rare</button>
      <button class="filter-btn ${filterRarity==='common'?'active':''}" data-rarity="common" onclick="setFilter('common')">Common</button>
      <div class="filter-sep"></div>
      <button class="filter-btn ${showMissing?'active':''}" style="${showMissing?'background:linear-gradient(135deg,#7873f5,#4adede);color:#fff':''}" onclick="toggleMissing()">Show Missing</button>
      <div class="filter-sep"></div>
      <input type="text" class="card-search" id="card-search" placeholder="Search cards..." value="${cardSearch}" />
    </div>`;

  // Wire up open pack button
  const openPackBtn = document.getElementById('open-pack-btn');
  if (openPackBtn) openPackBtn.addEventListener('click', () => openPack());

  // Wire up search input
  const searchInput = document.getElementById('card-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => { cardSearch = e.target.value; renderLibrary(); const el = document.getElementById('card-search'); if (el) { el.focus(); el.setSelectionRange(cardSearch.length, cardSearch.length); } });
  }
  // Wire up switch repo button
  const switchBtn = document.getElementById('switch-repo-btn');
  if (switchBtn) switchBtn.addEventListener('click', () => newRepo());

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
          localStorage.setItem('gp_guest_limit_reached', '1');
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

  // Handle authenticated response (has cards + packState) vs unauthenticated (just array)
  let picks;
  if (Array.isArray(data)) {
    picks = data;
  } else {
    picks = data.cards;
    if (data.packState) {
      packState = data.packState;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'pack-overlay';

  // Sign-in banner for logged-out users — persistent across all pack stages
  const packAuthBanner = !_currentUser ? `<div class="pack-auth-banner"><span class="pack-auth-banner-icon">&#x1f512;</span> Sign in to save your cards across devices <button class="login-btn pack-auth-banner-btn" id="pack-sign-in-btn"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Sign In</button></div>` : '';

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
    </div>`;
  document.body.appendChild(overlay);
  const packWrapper = overlay.querySelector('#pack-wrapper');
  const instruction = overlay.querySelector('.pack-instruction');
  function tearPack() {
    if (packWrapper.classList.contains('tearing')) return;
    packWrapper.classList.add('tearing');
    instruction.style.display = 'none';
    overlay.querySelector('#pack-burst').innerHTML = '<div class="burst-ring"></div>';
    setTimeout(() => { packWrapper.style.display = 'none'; revealCards(overlay, picks); }, 700);
    document.removeEventListener('keydown', packSpaceHandler);
  }
  packWrapper.addEventListener('click', tearPack);
  const packSpaceHandler = e => { if (e.code === 'Space') { e.preventDefault(); tearPack(); } };
  document.addEventListener('keydown', packSpaceHandler);

  function closePack() { packOpen = false; overlay.remove(); document.removeEventListener('keydown', packSpaceHandler); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); }
  overlay._escHandler = e => { if (e.code === 'Escape') closePack(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#pack-close-btn').addEventListener('click', closePack);

  // Wire up sign-in button in auth banner
  const packSignInBtn = overlay.querySelector('#pack-sign-in-btn');
  if (packSignInBtn) {
    packSignInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      import('./lib/supabase-browser').then(({ getSupabaseBrowser }) => {
        const supabase = getSupabaseBrowser();
        supabase.auth.signInWithOAuth({
          provider: 'github',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
      });
    });
  }
}

function revealCards(overlay, picks) {
  const area = overlay.querySelector('#reveal-area');
  area.style.display = 'flex';
  const rarityOrder = { common:0, rare:1, epic:2, legendary:3, mythic:4 };
  const sorted = [...picks].sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity]);

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
        flipInstruction.remove();
        document.removeEventListener('keydown', spaceHandler);

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
          document.removeEventListener('keydown', doneSpaceHandler);

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
              else { nextPicks = d.cards; if (d.packState) packState = d.packState; }
            } else if (res.status === 429) {
              const errData = await res.json().catch(() => ({}));
              packState = { readyPacks: 0, maxPacks: 2, nextRegenAt: errData.nextRegenAt };
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
            setTimeout(() => { newWrapper.style.display = 'none'; revealCards(overlay, nextPicks); }, 700);
            document.removeEventListener('keydown', newSpaceHandler);
          }
          newWrapper.addEventListener('click', tearNewPack);
          const newSpaceHandler = e => { if (e.code === 'Space') { e.preventDefault(); tearNewPack(); } };
          document.addEventListener('keydown', newSpaceHandler);

          // Update close handler to clean up new listeners
          document.removeEventListener('keydown', overlay._escHandler);
          function closeNewPack() { packOpen = false; overlay.remove(); document.removeEventListener('keydown', newSpaceHandler); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); }
          overlay._escHandler = e => { if (e.code === 'Escape') closeNewPack(); };
          document.addEventListener('keydown', overlay._escHandler);
          overlay.querySelector('#pack-close-btn').onclick = closeNewPack;

          renderRepoInfoFromCurrent(); renderLibrary();
        }

        const doneSpaceHandler = e => { if (e.code === 'Space') { e.preventDefault(); openAnother(); } };
        setTimeout(() => {
          if (!anotherOpened) document.addEventListener('keydown', doneSpaceHandler);
        }, 200);

        const btnWrap = document.createElement('div');
        btnWrap.className = 'reveal-buttons';
        const doneBtn = document.createElement('button');
        doneBtn.className = 'reveal-done-btn';
        doneBtn.textContent = 'View Library';
        doneBtn.onclick = () => { packOpen = false; overlay.remove(); document.removeEventListener('keydown', doneSpaceHandler); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); };
        const anotherBtn = document.createElement('button');
        anotherBtn.className = 'reveal-another-btn';

        // Show pack count on the button for logged-in users
        if (_currentUser && packState) {
          anotherBtn.textContent = packState.readyPacks > 0 ? `Open Another (${packState.readyPacks})` : 'No Packs Left';
          anotherBtn.disabled = packState.readyPacks <= 0;
        } else {
          anotherBtn.textContent = 'Open Another';
        }
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
  const spaceHandler = e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (revealComplete || spaceQueued) return;
    spaceQueued = true;
    function flipAll() {
      const next = getNextUnflipped();
      if (!next) { spaceQueued = false; return; }
      flipSlot(next);
      setTimeout(flipAll, 150);
    }
    flipAll();
  };
  document.addEventListener('keydown', spaceHandler);
}

// ===== COMPLETE LIBRARY =====
function toggleMissing() {
  showMissing = !showMissing;
  renderRepoInfoFromCurrent();
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
  showMissing = false;
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
  if (allCollected.length === 0 && !showMissing) {
    grid.innerHTML = `<div class="empty-library">
      <div class="empty-icon">${GP_ICON}</div>
      <p>Open a pack to start collecting!</p>
    </div>`;
    return;
  }

  let pool = showMissing ? [...allContributors] : [...allCollected];
  if (filterRarity !== 'all') pool = pool.filter(c => c.rarity === filterRarity);
  if (cardSearch) { const q = cardSearch.toLowerCase(); pool = pool.filter(c => c.login.toLowerCase().includes(q) || (c.title && c.title.toLowerCase().includes(q))); }

  pool.sort((a, b) => b.power - a.power);

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function showError(m) { errorEl.textContent = m; errorEl.style.display = m ? 'block' : 'none'; }

// ===== FULLSCREEN CARD VIEW =====
function openFullscreenCard(c) {
  const overlay = document.createElement('div');
  const isGhost = !library[c.login];
  overlay.className = 'fullscreen-overlay' + (isGhost ? ' fullscreen-ghost' : '');
  const cardNum = allContributors.indexOf(c) + 1;
  const cardHTML = buildGalleryCard(c, cardNum, allContributors.length);

  const closeOverlay = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
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
        ${statRow('Owned', (library[c.login] || 0) + 'x', null, null)}
      </div>
    </div>
    <a class="fullscreen-profile" href="https://github.com/${c.login}" target="_blank" rel="noopener">${GH_ICON} View Profile</a>`;
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

  overlay.querySelector('.fullscreen-close').addEventListener('click', e => { e.stopPropagation(); closeOverlay(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', escHandler);
  overlay.querySelector('.fullscreen-layout').addEventListener('click', e => e.stopPropagation());
  overlay.querySelector('.fullscreen-profile').addEventListener('click', e => e.stopPropagation());
}

function fmt(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toString(); }
function rarityColor(r) { return {mythic:'#ff0040',legendary:'#ffd700',epic:'#c084fc',rare:'#60a5fa',common:'#888'}[r]||'#888'; }
function powerGrad(r) { return {mythic:'linear-gradient(90deg,#ff0040,#ff6600,#ff00ff)',legendary:'linear-gradient(90deg,#ffd700,#ff6ec7)',epic:'linear-gradient(90deg,#a855f7,#6366f1)',rare:'linear-gradient(90deg,#3b82f6,#06b6d4)',common:'linear-gradient(90deg,#555,#777)'}[r]||'linear-gradient(90deg,#555,#777)'; }

// Expose functions used by inline onclick handlers in dynamically generated HTML
window.openPack = openPack;
window.setFilter = setFilter;
window.toggleMissing = toggleMissing;
window.quickLoad = quickLoad;

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

export function initGitPacks() {
const GH_ICON = `<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
// GitPacks logo — stylized card/pack icon
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

const searchContainer = document.getElementById('search-container');

// Bind button events (replaces inline onclick handlers)
btn.addEventListener('click', () => loadRepo());
document.getElementById('clear-cache-btn').addEventListener('click', () => clearRepoCache());
document.getElementById('share-btn').addEventListener('click', () => shareRepo());

// Progress bar helpers
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

// Auto-load from URL param or default to PMPro
const urlRepo = new URLSearchParams(window.location.search).get('repo');
if (urlRepo) { input.value = urlRepo; }
loadRepo();
function saveLibrary() {
  if (!currentRepoName) return;
  try { localStorage.setItem('ghtc_lib_' + currentRepoName.toLowerCase(), JSON.stringify(library)); } catch (e) { }
}
function loadLibrary() {
  if (!currentRepoName) return;
  var libKey = 'ghtc_lib_' + currentRepoName.toLowerCase();
  var libData = localStorage.getItem(libKey);
  if (libData) {
    try { library = JSON.parse(libData); } catch (e2) { library = {}; }
  }
}

async function loadRepo() {
  const repoInput = input.value.trim().replace(/^https?:\/\/github\.com\//, '');
  const match = repoInput.match(/^([^/]+)\/([^/]+)/);
  if (!match) return showError('Enter a valid repo like owner/repo');
  const [, owner, repo] = match;
  showError(''); grid.innerHTML = ''; repoInfo.style.display = 'none';
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
    loadLibrary();
    loading.style.display = 'none';
    searchContainer.style.display = 'none';
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
  repoInfo.innerHTML = `<div class="repo-info-inner">
      <h2><span>${owner || ''}</span> / <span>${repo || ''}</span></h2>
      <div class="repo-info-sep"></div>
      <div class="collection-progress"><span>${collected}</span> / <span>${total}</span> collected</div>
    </div>
    <div class="action-buttons">
      <button class="btn-secondary" onclick="openPack()" ${total === 0 ? 'disabled' : ''}>Open Pack</button>
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
      <div class="filter-sep"></div>
      <button class="filter-btn" onclick="fillLibrary()">Fill All</button>
      <button class="filter-btn" onclick="clearLibrary()">Clear All</button>
    </div>`;
  // Wire up search input
  const searchInput = document.getElementById('card-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => { cardSearch = e.target.value; renderLibrary(); const el = document.getElementById('card-search'); if (el) { el.focus(); el.setSelectionRange(cardSearch.length, cardSearch.length); } });
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
  packOpen = true;
  const [owner, repo] = currentRepoName.split('/');
  const response = await fetch(`/api/repo/${owner}/${repo}/pack`);
  if (!response.ok) throw new Error('Failed to draw pack');
  const picks = await response.json();
  const overlay = document.createElement('div');
  overlay.className = 'pack-overlay';
  overlay.innerHTML = `
    <button class="pack-close-btn" id="pack-close-btn">&times;</button>
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

  // Close button and Escape key to exit pack opening
  function closePack() { packOpen = false; overlay.remove(); document.removeEventListener('keydown', packSpaceHandler); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); }
  overlay._escHandler = e => { if (e.code === 'Escape') closePack(); };
  document.addEventListener('keydown', overlay._escHandler);
  overlay.querySelector('#pack-close-btn').addEventListener('click', closePack);
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

    // Build the full gallery card HTML (same as library)
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

    // Store metadata for animation and contributor data
    slot._isNew = isNew;
    slot._rarity = c.rarity;
    slot._contributor = c;
    area.appendChild(slot);
  });

  const slots = Array.from(area.querySelectorAll('.reveal-slot'));
  let flipped = 0;
  let revealComplete = false;

  // Force reflow so percentage-based slot widths resolve before measuring
  area.offsetHeight;

  // Dynamically scale gallery cards (320x480) to fit actual slot dimensions
  slots.forEach(s => {
    const slotW = s.offsetWidth;
    const slotH = s.offsetHeight;
    // Fallback to default desktop size if layout hasn't resolved
    const w = slotW > 10 ? slotW : 190;
    const h = slotH > 10 ? slotH : 293;
    const cardScale = Math.min(w / 320, h / 480);
    const cw = s.querySelector('.reveal-card-front .card-wrapper');
    if (cw) cw.style.transform = `scale(${cardScale})`;
  });

  // Mark all as unflipped and stagger entrance
  // Force a layout so the unflipped styles (back face visible) are computed before fading in
  slots.forEach(s => {
    s.classList.add('unflipped');
    s.style.opacity = '0';
    s.style.transform = 'translateY(30px)';
  });
  // Force reflow so unflipped styles are applied before we start the entrance animation
  area.offsetHeight;
  slots.forEach((s, i) => {
    setTimeout(() => { s.style.transition = 'opacity 0.4s ease, transform 0.4s ease'; s.style.opacity = '1'; s.style.transform = 'translateY(0)'; }, i * 100);
  });

  // Add instruction
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

    // Add rarity-specific flip class
    card.classList.add('flip-' + rarity);

    // Activate persistent rarity glow after flip animation
    const glowDelay = { common:400, rare:600, epic:800, legendary:1000, mythic:1400 }[rarity] || 400;
    setTimeout(() => {
      if (rarity !== 'common') slot.classList.add('revealed');
    }, glowDelay * 0.5);

    // Rarity-specific effects
    if (rarity === 'mythic') {
      // Double screen shake
      overlay.classList.add('shake-screen');
      setTimeout(() => { overlay.classList.remove('shake-screen'); setTimeout(() => overlay.classList.add('shake-screen'), 100); setTimeout(() => overlay.classList.remove('shake-screen'), 600); }, 500);
      // Massive screen flash
      const flash = document.createElement('div');
      flash.className = 'screen-flash mythic-screen';
      overlay.appendChild(flash);
      setTimeout(() => flash.remove(), 1500);
      // Triple rings + flash
      slot.insertAdjacentHTML('beforeend', '<div class="mythic-flash"></div><div class="mythic-ring"></div><div class="mythic-ring2"></div><div class="mythic-ring3"></div>');
      // Extra particles — more, bigger, red/orange/white
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

    // NEW badge for new cards only
    if (isNew) {
      const badgeDelay = rarity === 'mythic' ? 1200 : rarity === 'legendary' ? 800 : rarity === 'epic' ? 500 : 300;
      setTimeout(() => {
        slot.insertAdjacentHTML('beforeend', `<div class="reveal-badge is-new">NEW</div>`);
      }, badgeDelay);
    }

    // Add to library (increment count)
    library[slot._contributor.login] = (library[slot._contributor.login] || 0) + 1;
    saveLibrary();

    flipped++;

    // Check completion after animation settles
    setTimeout(() => {
      // All cards flipped?
      if (flipped >= slots.length && !revealComplete) {
        revealComplete = true;
        flipInstruction.remove();
        document.removeEventListener('keydown', spaceHandler);

        // Enable hover + click-to-fullscreen
        slots.forEach(s => {
          s.classList.add('hoverable');
          s.addEventListener('click', () => {
            const c = s._contributor;
            if (c) openFullscreenCard(c);
          });
        });

        let anotherOpened = false;
        function openAnother() {
          if (anotherOpened) return;
          anotherOpened = true;
          packOpen = false;
          overlay.remove();
          document.removeEventListener('keydown', doneSpaceHandler);
          document.removeEventListener('keydown', overlay._escHandler);
          renderRepoInfoFromCurrent(); renderLibrary(); openPack();
        }

        // Space to open another pack — delay registration so a space press that
        // triggered the last flip can't immediately trigger this handler too
        const doneSpaceHandler = e => { if (e.code === 'Space') { e.preventDefault(); openAnother(); } };
        setTimeout(() => {
          if (!anotherOpened) document.addEventListener('keydown', doneSpaceHandler);
        }, 200);

        // Show action buttons
        const btnWrap = document.createElement('div');
        btnWrap.className = 'reveal-buttons';
        const doneBtn = document.createElement('button');
        doneBtn.className = 'reveal-done-btn';
        doneBtn.textContent = 'View Library';
        doneBtn.onclick = () => { packOpen = false; overlay.remove(); document.removeEventListener('keydown', doneSpaceHandler); document.removeEventListener('keydown', overlay._escHandler); renderRepoInfoFromCurrent(); renderLibrary(); };
        const anotherBtn = document.createElement('button');
        anotherBtn.className = 'reveal-another-btn';
        anotherBtn.textContent = 'Open Another';
        anotherBtn.onclick = openAnother;
        btnWrap.appendChild(doneBtn);
        btnWrap.appendChild(anotherBtn);
        overlay.querySelector('.pack-container').appendChild(btnWrap);
      }
    }, glowDelay);
  }

  // Click a card to flip that specific card
  slots.forEach(slot => {
    slot.addEventListener('click', () => {
      if (slot.classList.contains('unflipped')) flipSlot(slot);
    });
  });

  // Spacebar flips all remaining cards one at a time
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

function fillLibrary() {
  allContributors.forEach(c => { if (!library[c.login]) library[c.login] = 1; });
  saveLibrary();
  renderRepoInfoFromCurrent();
  renderLibrary();
}

function clearLibrary() {
  library = {};
  saveLibrary();
  renderRepoInfoFromCurrent();
  renderLibrary();
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
  grid.innerHTML = '';
  repoInfo.style.display = 'none';
  searchContainer.style.display = '';
  input.value = '';
  input.focus();
  history.replaceState(null, '', window.location.pathname);
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

  // Build display list: collected + optionally missing
  let pool = showMissing ? [...allContributors] : [...allCollected];
  if (filterRarity !== 'all') pool = pool.filter(c => c.rarity === filterRarity);
  if (cardSearch) { const q = cardSearch.toLowerCase(); pool = pool.filter(c => c.login.toLowerCase().includes(q) || (c.title && c.title.toLowerCase().includes(q))); }

  pool.sort((a, b) => b.power - a.power);

  if (pool.length === 0) {
    grid.innerHTML = `<div class="empty-library"><p>No cards match filters</p></div>`;
    return;
  }

  const totalCards = allContributors.length;
  // Create lightweight placeholders — real card HTML is built lazily on scroll
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

  // Event delegation for mousemove — one listener instead of 400
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

  // Lazy render + pause offscreen animations via IntersectionObserver
  if (window._cardObserver) window._cardObserver.disconnect();
  window._cardObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const w = e.target;
      if (e.isIntersecting) {
        // Lazy-render card HTML on first appearance
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

async function clearRepoCache() {
  const name = currentRepoName || input.value.trim().replace(/^https?:\/\/github\.com\//, '');
  const match = name.match(/^([^\/]+)\/([^\/]+)/);
  if (!match) return;
  const btn = document.getElementById('clear-cache-btn');
  if (btn) { btn.textContent = 'Clearing...'; btn.disabled = true; }
  await fetch(`/api/repo/${match[1]}/${match[2]}?refresh=true`);
  if (btn) { btn.textContent = 'Cache Cleared!'; }
  await loadRepo();
  if (btn) { btn.textContent = 'Clear Cache'; btn.disabled = false; }
}

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

  // 3D tilt on mousemove — only on the card itself
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

  // Close button
  overlay.querySelector('.fullscreen-close').addEventListener('click', e => { e.stopPropagation(); closeOverlay(); });

  // Close on click outside card or ESC
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', escHandler);

  // Prevent card/stats/profile click from closing overlay
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
window.fillLibrary = fillLibrary;
window.clearLibrary = clearLibrary;
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

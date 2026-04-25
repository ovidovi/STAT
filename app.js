/* ================================================================
   STAT — app.js
   ================================================================ */

'use strict';

/* ── Helpers ─────────────────────────────────────────────────────── */

function esc(s) {
  return String(s ?? '—')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

function fmtAvg(val) {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(3).replace(/^0/, '');
}

function fmtDec(val, places = 2) {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(places);
}

function avatarSVG() {
  return '<svg class="avatar-placeholder" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="7" r="6" fill="#aaa"/><ellipse cx="11" cy="24" rx="10" ry="8" fill="#aaa"/></svg>';
}

function makeHeadshotImg(url, name) {
  const img = document.createElement('img');
  img.src = url;
  img.alt = name;
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    if (img.parentElement) img.parentElement.innerHTML = avatarSVG();
  }, { once: true });
  return img;
}

/* ── MLB Stats API ──────────────────────────────────────────────── */
const MLB = {
  base:     'https://statsapi.mlb.com/api/v1',
  headshot: id => `https://img.mlbstatic.com/mlb-photos/image/upload/w_180/v1/people/${id}/headshot/67/current`,
  teamLogo: id => `https://www.mlbstatic.com/team-logos/${id}.svg`,

  async search(query, type = 'player') {
    if (type === 'team') {
      const res = await fetchWithTimeout(`${MLB.base}/teams?sportId=1`);
      const data = await res.json();
      return (data.teams || [])
        .filter(t => t.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8)
        .map(t => ({ id: t.id, fullName: t.name, position: '', teamName: t.locationName || '' }));
    }
    const res = await fetchWithTimeout(`${MLB.base}/people/search?names=${encodeURIComponent(query)}&sportIds=1`);
    const data = await res.json();
    return (data.people || []).slice(0, 8).map(p => ({
      id:       p.id,
      fullName: p.fullName,
      position: p.primaryPosition?.abbreviation || '',
      teamName: p.currentTeam?.name || '',
    }));
  },

  async getPlayer(id) {
    const res = await fetchWithTimeout(`${MLB.base}/people/${id}?hydrate=currentTeam`);
    const data = await res.json();
    return data.people?.[0] || null;
  },

  async getHittingStats(id) {
    const res = await fetchWithTimeout(`${MLB.base}/people/${id}/stats?stats=yearByYear&group=hitting&sportId=1`);
    const data = await res.json();
    const splits = data.stats?.[0]?.splits || [];
    const byYear = {};
    for (const s of splits) {
      const yr = s.season;
      const gp = s.stat?.gamesPlayed || 0;
      if (!byYear[yr] || gp > (byYear[yr].stat?.gamesPlayed || 0)) byYear[yr] = s;
    }
    return Object.values(byYear).sort((a, b) => Number(b.season) - Number(a.season));
  },

  async getPitchingStats(id) {
    const res = await fetchWithTimeout(`${MLB.base}/people/${id}/stats?stats=yearByYear&group=pitching&sportId=1`);
    const data = await res.json();
    const splits = data.stats?.[0]?.splits || [];
    const byYear = {};
    for (const s of splits) {
      const yr = s.season;
      const ip = parseFloat(s.stat?.inningsPitched || 0);
      if (!byYear[yr] || ip > parseFloat(byYear[yr].stat?.inningsPitched || 0)) byYear[yr] = s;
    }
    return Object.values(byYear).sort((a, b) => Number(b.season) - Number(a.season));
  },

  async getSabermetrics(id, group, season) {
    const yr = season || new Date().getFullYear();
    try {
      const res = await fetchWithTimeout(
        `${MLB.base}/people/${id}/stats?stats=sabermetrics&group=${group}&season=${yr}&sportId=1`,
        6000
      );
      const data = await res.json();
      return data.stats?.[0]?.splits?.[0]?.stat || null;
    } catch (e) {
      return null;
    }
  },

  async getTeamStats(id, season) {
    const seasonParam = season ? `&season=${season}` : '';
    const res = await fetchWithTimeout(
      `${MLB.base}/teams/${id}/stats?stats=season&group=hitting&sportId=1${seasonParam}`
    );
    const data = await res.json();
    return data.stats?.[0]?.splits?.[0]?.stat || null;
  },

  async getTeam(id) {
    const res = await fetchWithTimeout(`${MLB.base}/teams/${id}`);
    const data = await res.json();
    return data.teams?.[0] || null;
  },

  async getTeamRecord(teamId, season) {
    const yr = season || new Date().getFullYear();
    try {
      const res = await fetchWithTimeout(
        `${MLB.base}/standings?leagueId=103,104&season=${yr}&sportId=1`,
        8000
      );
      const data = await res.json();
      for (const div of (data.records || [])) {
        for (const rec of (div.teamRecords || [])) {
          if (rec.team.id === teamId) {
            return `${rec.wins}-${rec.losses}`;
          }
        }
      }
    } catch (e) { /* standings unavailable */ }
    return null;
  },

  async getDepthChart(teamId) {
    try {
      const res = await fetchWithTimeout(
        `${MLB.base}/teams/${teamId}/roster?rosterType=depthChart`,
        8000
      );
      const data = await res.json();
      return data.roster || [];
    } catch (e) {
      return [];
    }
  },

  async getPlayerSeasonHitting(id, season) {
    try {
      const res = await fetchWithTimeout(
        `${MLB.base}/people/${id}/stats?stats=season&group=hitting&season=${season}&sportId=1`,
        6000
      );
      const data = await res.json();
      return data.stats?.[0]?.splits?.[0]?.stat || null;
    } catch (e) {
      return null;
    }
  },
};

/* ── State ──────────────────────────────────────────────────────── */
const state = {
  stack:            [],
  current:          -1,
  searchType:       'player',
  searchDebounce:   null,
  previousStack:    null,
  saveAllMode:      false,
  pendingDeleteIdx: -1,
};

/*
  Card shape:
  {
    type:        'player' | 'team',
    subtype:     'batter' | 'pitcher' | 'team',
    id:          number,
    name:        string,
    meta:        string,
    headshotUrl: string | null,
    logoUrl:     string | null,
    highlights:  [{ val, label }, × 3],
    cols:        string[],
    seasons:     [{ cells: string[], isBest, isCurrent }],
    depthChart:  [{ pos, name }] | null,
  }
*/

/* ── DOM refs ───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  searchInput:          $('search-input'),
  goBtn:                $('go-btn'),
  btnPlayer:            $('btn-player'),
  btnTeam:              $('btn-team'),
  autocomplete:         $('autocomplete-list'),
  stackList:            $('stack-list'),
  namedStacksList:      $('named-stacks-list'),
  saveBtn:              $('save-btn'),
  backBtn:              $('back-btn'),
  mSearchInput:         $('m-search-input'),
  mGoBtn:               $('m-go-btn'),
  mBtnPlayer:           $('m-btn-player'),
  mBtnTeam:             $('m-btn-team'),
  mAutocomplete:        $('m-autocomplete-list'),
  mStacksBtn:           $('m-stacks-btn'),
  mStackDropdown:       $('mobile-stack-dropdown'),
  mStackList:           $('m-stack-list'),
  mNamedStacksList:     $('m-named-stacks-list'),
  mBackBtn:             $('m-back-btn'),
  emptyState:           $('empty-state'),
  errorState:           $('error-state'),
  errorMsg:             $('error-msg'),
  loadingState:         $('loading-state'),
  cardStage:            $('card-stage'),
  cardTrack:            $('card-track'),
  addCardBtn:           $('add-card-btn'),
  saveStackBtn:         $('save-stack-btn'),
  removeCardBtn:        $('remove-card-btn'),
  dialogOverlay:        $('dialog-overlay'),
  dialogExisting:       $('dialog-existing-section'),
  dialogExistingList:   $('dialog-existing-list'),
  dialogInput:          $('dialog-input'),
  dialogConfirm:        $('dialog-confirm'),
  dialogCancel:         $('dialog-cancel'),
  deleteStackOverlay:   $('delete-stack-overlay'),
  deleteStackMsg:       $('delete-stack-msg'),
  deleteStackConfirm:   $('delete-stack-confirm'),
  deleteStackCancel:    $('delete-stack-cancel'),
};

/* ── Show / hide states ─────────────────────────────────────────── */
function showState(name) {
  dom.emptyState.classList.add('hidden');
  dom.errorState.classList.add('hidden');
  dom.loadingState.classList.add('hidden');
  dom.cardStage.classList.add('hidden');
  if (name === 'empty')   dom.emptyState.classList.remove('hidden');
  if (name === 'error')   dom.errorState.classList.remove('hidden');
  if (name === 'loading') dom.loadingState.classList.remove('hidden');
  if (name === 'card')    dom.cardStage.classList.remove('hidden');
}

/* ── Build card DOM element ─────────────────────────────────────── */
function buildCardElement(card) {
  const article = document.createElement('article');
  article.className = 'card';

  // Header: photo/logo + identity
  const header = document.createElement('header');
  header.className = 'card-header';

  if (card.logoUrl) {
    const wrap = document.createElement('div');
    wrap.className = 'card-logo-wrap';
    const img = document.createElement('img');
    img.src = card.logoUrl;
    img.alt = card.name;
    wrap.appendChild(img);
    header.appendChild(wrap);
  } else if (card.headshotUrl) {
    const wrap = document.createElement('div');
    wrap.className = 'card-photo-wrap';
    wrap.appendChild(makeHeadshotImg(card.headshotUrl, card.name));
    header.appendChild(wrap);
  }

  const identity = document.createElement('div');
  identity.className = 'card-identity';
  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = card.name;
  const metaEl = document.createElement('div');
  metaEl.className = 'card-meta';
  metaEl.textContent = card.meta;
  identity.append(nameEl, metaEl);
  header.appendChild(identity);
  article.appendChild(header);

  // Highlights
  const hlRow = document.createElement('div');
  hlRow.className = 'card-highlights';
  card.highlights.forEach(hl => {
    const cell = document.createElement('div');
    cell.className = 'hl-cell';
    const num = document.createElement('div');
    num.className = 'hl-num';
    num.textContent = hl.val;
    const key = document.createElement('div');
    key.className = 'hl-key';
    key.textContent = hl.label;
    cell.append(num, key);
    hlRow.appendChild(cell);
  });
  article.appendChild(hlRow);

  // Stat table
  const tableWrap = document.createElement('div');
  tableWrap.className = card.depthChart ? 'card-table-wrap team-table' : 'card-table-wrap';
  const table = document.createElement('table');
  table.className = 'stat-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.className = 'table-head-row';
  card.cols.forEach((col, i) => {
    const th = document.createElement('th');
    th.className = i === 0 ? 'col-year' : 'col-stat';
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  card.seasons.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'stat-row';
    if (s.isCurrent) tr.classList.add('current');
    if (s.isBest && !s.isCurrent) tr.classList.add('best');
    s.cells.forEach(c => {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  article.appendChild(tableWrap);

  // Depth chart (team cards only)
  if (card.depthChart && card.depthChart.length) {
    const section = document.createElement('div');
    section.className = 'card-lineup';
    const lbl = document.createElement('div');
    lbl.className = 'lineup-label';
    lbl.textContent = 'Depth Chart';
    section.appendChild(lbl);

    const ltable = document.createElement('table');
    ltable.className = 'lineup-table';

    const lthead = document.createElement('thead');
    const htr = document.createElement('tr');
    ['', 'Player', 'AVG', 'OBP', 'SLG'].forEach((col, i) => {
      const th = document.createElement('th');
      th.className = i <= 1 ? 'lineup-th-left' : 'lineup-th-stat';
      th.textContent = col;
      htr.appendChild(th);
    });
    lthead.appendChild(htr);
    ltable.appendChild(lthead);

    const ltbody = document.createElement('tbody');
    card.depthChart.forEach(row => {
      const tr = document.createElement('tr');
      const posTd = document.createElement('td');
      posTd.className = 'lineup-pos';
      posTd.textContent = row.pos;
      const nameTd = document.createElement('td');
      nameTd.className = 'lineup-player';
      nameTd.textContent = row.name;
      const avgTd = document.createElement('td');
      avgTd.className = 'lineup-stat';
      avgTd.textContent = row.avg ? fmtAvg(row.avg) : '—';
      const obpTd = document.createElement('td');
      obpTd.className = 'lineup-stat';
      obpTd.textContent = row.obp ? fmtAvg(row.obp) : '—';
      const slgTd = document.createElement('td');
      slgTd.className = 'lineup-stat';
      slgTd.textContent = row.slg ? fmtAvg(row.slg) : '—';
      tr.append(posTd, nameTd, avgTd, obpTd, slgTd);
      ltbody.appendChild(tr);
    });
    ltable.appendChild(ltbody);
    section.appendChild(ltable);
    article.appendChild(section);
  }

  return article;
}

/* ── Card track ─────────────────────────────────────────────────── */
function slotWidth() {
  const peek = window.innerWidth <= 700 ? 20 : 72;
  const sidebarW = window.innerWidth > 700 ? 259 : 0;
  return Math.max(200, window.innerWidth - sidebarW - peek * 2);
}

function renderCardTrack() {
  const w = slotWidth();
  dom.cardTrack.innerHTML = '';
  state.stack.forEach(card => {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.style.width = `${w}px`;
    slot.appendChild(buildCardElement(card));
    dom.cardTrack.appendChild(slot);
  });
  showState('card');
  scrollToCard(state.current, false);
  updateActiveSlot();
}

function scrollToCard(idx, animate = true) {
  const slots = dom.cardTrack.querySelectorAll('.card-slot');
  if (!slots[idx]) return;
  const slot = slots[idx];
  const peek = window.innerWidth <= 700 ? 20 : 72;
  const targetLeft = slot.offsetLeft - peek;
  dom.cardTrack.scrollTo({ left: targetLeft, behavior: animate ? 'smooth' : 'instant' });
}

function initScrollObserver() {
  const onSettle = () => {
    const slots = Array.from(dom.cardTrack.querySelectorAll('.card-slot'));
    if (!slots.length) return;
    const center = dom.cardTrack.getBoundingClientRect().left + dom.cardTrack.clientWidth / 2;
    let closest = state.current, minDist = Infinity;
    slots.forEach((slot, i) => {
      const r = slot.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - center);
      if (d < minDist) { minDist = d; closest = i; }
    });
    if (closest !== state.current) {
      state.current = closest;
      persistStack();
      updateActiveSlot();
      renderStackList();
    }
  };

  const debouncedSettle = debounce(onSettle, 120);
  dom.cardTrack.addEventListener('scroll', debouncedSettle, { passive: true });
  if ('onscrollend' in window) {
    dom.cardTrack.addEventListener('scrollend', onSettle, { passive: true });
  }
}

/* ── Render stack list ──────────────────────────────────────────── */
function renderStackList() {
  [dom.stackList, dom.mStackList].forEach(list => {
    list.innerHTML = '';
    if (state.stack.length === 0) {
      const li = document.createElement('li');
      li.className = 'named-stack-empty';
      li.textContent = 'No cards yet.';
      list.appendChild(li);
      return;
    }
    state.stack.forEach((card, idx) => {
      const li = document.createElement('li');
      li.className = `stack-item${idx === state.current ? ' active' : ''}`;

      const avatarDiv = document.createElement('div');
      const isLogo = !!card.logoUrl;
      avatarDiv.className = `stack-item-avatar${isLogo ? ' is-logo' : ''}`;

      if (card.logoUrl) {
        const img = document.createElement('img');
        img.src = card.logoUrl;
        img.alt = card.name;
        img.loading = 'lazy';
        avatarDiv.appendChild(img);
      } else if (card.headshotUrl) {
        avatarDiv.appendChild(makeHeadshotImg(card.headshotUrl, card.name));
      } else {
        avatarDiv.innerHTML = avatarSVG();
      }

      const infoDiv = document.createElement('div');
      infoDiv.className = 'stack-item-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'stack-item-name';
      nameEl.textContent = card.name;
      const subEl = document.createElement('div');
      subEl.className = 'stack-item-sub';
      subEl.textContent = card.meta;
      infoDiv.append(nameEl, subEl);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'stack-item-remove';
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.textContent = '×';

      li.append(avatarDiv, infoDiv, removeBtn);

      li.addEventListener('click', e => {
        if (e.target.closest('.stack-item-remove')) return;
        state.current = idx;
        scrollToCard(idx);
        renderStackList();
        updateActiveSlot();
      });
      removeBtn.addEventListener('click', () => removeFromStack(idx));
      list.appendChild(li);
    });
  });
}

/* ── Active slot opacity ────────────────────────────────────────── */
function updateActiveSlot() {
  dom.cardTrack.querySelectorAll('.card-slot').forEach((slot, i) => {
    slot.classList.toggle('is-active', i === state.current);
  });
  renderBackBtn();
}

function renderBackBtn() {
  const show = !!state.previousStack;
  [dom.backBtn, dom.mBackBtn].forEach(btn => {
    if (btn) btn.classList.toggle('hidden', !show);
  });
}

/* ── localStorage ───────────────────────────────────────────────── */
function persistStack() {
  try {
    localStorage.setItem('stat_stack',   JSON.stringify(state.stack));
    localStorage.setItem('stat_current', String(state.current));
  } catch (e) { /* quota — silent */ }
}

function loadNamedStacks() {
  try {
    const raw = localStorage.getItem('stat_named_stacks');
    if (!raw) return [];
    const all = JSON.parse(raw);
    // Drop stacks with old card shape (no .cols field)
    return all.filter(s => s.cards?.length && s.cards[0].cols);
  } catch (e) { return []; }
}

function renderNamedStacksList() {
  const all = loadNamedStacks();
  [dom.namedStacksList, dom.mNamedStacksList].forEach(list => {
    if (!list) return;
    list.innerHTML = '';
    if (all.length === 0) {
      const li = document.createElement('li');
      li.className = 'named-stack-empty';
      li.textContent = 'No saved stacks yet.';
      list.appendChild(li);
      return;
    }
    all.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = 'named-stack-item';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'named-stack-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'named-stack-name';
      nameEl.textContent = s.name;
      const subEl = document.createElement('div');
      subEl.className = 'named-stack-sub';
      subEl.textContent = `${s.cards.length} card${s.cards.length !== 1 ? 's' : ''}`;
      infoDiv.append(nameEl, subEl);

      const loadBtn = document.createElement('button');
      loadBtn.className = 'named-stack-load';
      loadBtn.setAttribute('aria-label', `Load ${s.name}`);
      loadBtn.textContent = '↑';
      loadBtn.addEventListener('click', () => loadNamedStackAt(idx));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'named-stack-delete';
      deleteBtn.setAttribute('aria-label', `Delete ${s.name}`);
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => openDeleteStackDialog(idx));

      li.append(infoDiv, loadBtn, deleteBtn);
      list.appendChild(li);

      // Individual card rows with remove buttons
      s.cards.forEach((card, cardIdx) => {
        const cardLi = document.createElement('li');
        cardLi.className = 'named-stack-card-item';

        const cardName = document.createElement('span');
        cardName.className = 'named-stack-card-name';
        cardName.textContent = card.name;

        const cardRemove = document.createElement('button');
        cardRemove.className = 'named-stack-card-remove';
        cardRemove.setAttribute('aria-label', `Remove ${card.name}`);
        cardRemove.textContent = '×';
        cardRemove.addEventListener('click', () => removeCardFromNamedStack(idx, cardIdx));

        cardLi.append(cardName, cardRemove);
        list.appendChild(cardLi);
      });
    });
  });
}

function loadNamedStackAt(idx) {
  const all = loadNamedStacks();
  const s = all[idx];
  if (!s?.cards.length) return;
  state.previousStack = state.stack.length
    ? { stack: [...state.stack], current: state.current }
    : null;
  state.stack   = [...s.cards];
  state.current = 0;
  renderCardTrack();
  renderStackList();
  renderNamedStacksList();
  renderBackBtn();
  closeMobileDropdown();
}

function goBack() {
  if (!state.previousStack) return;
  state.stack         = state.previousStack.stack;
  state.current       = state.previousStack.current;
  state.previousStack = null;
  renderCardTrack();
  renderStackList();
  renderBackBtn();
}

function removeCardFromNamedStack(stackIdx, cardIdx) {
  const all = loadNamedStacks();
  if (!all[stackIdx]) return;
  all[stackIdx].cards.splice(cardIdx, 1);
  if (all[stackIdx].cards.length === 0) all.splice(stackIdx, 1);
  try {
    localStorage.setItem('stat_named_stacks', JSON.stringify(all));
  } catch (e) {}
  renderNamedStacksList();
}

function openDeleteStackDialog(idx) {
  const all = loadNamedStacks();
  if (!all[idx]) return;
  state.pendingDeleteIdx = idx;
  dom.deleteStackMsg.textContent = `Delete "${all[idx].name}"? This cannot be undone.`;
  dom.deleteStackOverlay.classList.remove('hidden');
}

function confirmDeleteStack() {
  if (state.pendingDeleteIdx < 0) return;
  const all = loadNamedStacks();
  all.splice(state.pendingDeleteIdx, 1);
  try {
    localStorage.setItem('stat_named_stacks', JSON.stringify(all));
  } catch (e) {}
  state.pendingDeleteIdx = -1;
  dom.deleteStackOverlay.classList.add('hidden');
  renderNamedStacksList();
}

function closeDeleteDialog() {
  state.pendingDeleteIdx = -1;
  dom.deleteStackOverlay.classList.add('hidden');
}

/* ── Stack management ───────────────────────────────────────────── */
function addToStack(card) {
  const existing = state.stack.findIndex(c => c.id === card.id && c.type === card.type);
  if (existing !== -1) {
    state.current = existing;
    scrollToCard(existing);
    renderStackList();
    updateActiveSlot();
    return;
  }

  state.stack.push(card);
  state.current = state.stack.length - 1;

  const w = slotWidth();
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  slot.style.width = `${w}px`;
  slot.appendChild(buildCardElement(card));
  dom.cardTrack.appendChild(slot);

  persistStack();
  showState('card');
  scrollToCard(state.current);
  renderStackList();
  updateActiveSlot();
}

function removeFromStack(idx) {
  state.stack.splice(idx, 1);
  if (state.current >= state.stack.length) state.current = Math.max(0, state.stack.length - 1);

  if (state.stack.length === 0) {
    state.current = -1;
    dom.cardTrack.innerHTML = '';
    showState('empty');
  } else {
    renderCardTrack();
  }

  persistStack();
  renderStackList();
  updateActiveSlot();
}

function removeCurrentCard() {
  if (state.current < 0 || !state.stack.length) return;
  removeFromStack(state.current);
}

/* ── Save to Stack dialog ───────────────────────────────────────── */
function openSaveDialog(allMode = false) {
  if (!state.stack.length) return;
  if (!allMode && (state.current < 0 || !state.stack[state.current])) return;
  state.saveAllMode = allMode;

  // Populate existing stacks
  const all = loadNamedStacks();
  dom.dialogExistingList.innerHTML = '';

  if (all.length > 0) {
    dom.dialogExisting.classList.remove('hidden');
    all.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'dialog-stack-row';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'dialog-stack-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'dialog-stack-name';
      nameSpan.textContent = s.name;
      const countSpan = document.createElement('span');
      countSpan.className = 'dialog-stack-count';
      countSpan.textContent = `${s.cards.length} card${s.cards.length !== 1 ? 's' : ''}`;
      infoDiv.append(nameSpan, countSpan);

      const addBtn = document.createElement('button');
      addBtn.className = 'dialog-add-btn';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => addCardToNamedStack(idx));

      row.append(infoDiv, addBtn);
      dom.dialogExistingList.appendChild(row);
    });
  } else {
    dom.dialogExisting.classList.add('hidden');
  }

  dom.dialogInput.value = '';
  dom.dialogInput.placeholder = 'Name this stack…';
  dom.dialogOverlay.classList.remove('hidden');
  setTimeout(() => dom.dialogInput.focus(), 50);
}

function closeDialog() {
  dom.dialogOverlay.classList.add('hidden');
}

function addCardToNamedStack(stackIdx) {
  const cards = state.saveAllMode ? state.stack : [state.stack[state.current]];
  if (!cards.length) return;
  const all = loadNamedStacks();
  if (!all[stackIdx]) return;

  cards.forEach(card => {
    const already = all[stackIdx].cards.some(c => c.id === card.id && c.type === card.type);
    if (!already) all[stackIdx].cards.push(card);
  });
  try {
    localStorage.setItem('stat_named_stacks', JSON.stringify(all));
  } catch (e) {
    return;
  }
  closeDialog();
  renderNamedStacksList();
  showSaveFeedback();
}

function confirmSave() {
  const name = dom.dialogInput.value.trim();
  if (!name) { dom.dialogInput.focus(); return; }
  const cards = state.saveAllMode ? state.stack : [state.stack[state.current]];
  if (!cards.length) return;

  try {
    const all = loadNamedStacks();
    all.push({ name, cards: [...cards], createdAt: Date.now() });
    localStorage.setItem('stat_named_stacks', JSON.stringify(all));
  } catch (e) {
    dom.dialogInput.value = '';
    dom.dialogInput.placeholder = 'Storage full — delete a saved stack first';
    dom.dialogInput.focus();
    return;
  }

  closeDialog();
  renderNamedStacksList();
  showSaveFeedback();
}

function showSaveFeedback() {
  [dom.addCardBtn, dom.saveStackBtn, dom.saveBtn].forEach(btn => {
    const orig = btn.textContent;
    btn.textContent = 'Saved ✓';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('saved'); }, 2000);
  });
}

/* ── Mobile dropdown ────────────────────────────────────────────── */
function closeMobileDropdown() {
  dom.mStackDropdown.classList.add('hidden');
  dom.mStacksBtn.textContent = 'Stacks';
  dom.mStacksBtn.classList.remove('active');
}

function toggleMobileDropdown() {
  const isOpen = !dom.mStackDropdown.classList.contains('hidden');
  if (isOpen) {
    closeMobileDropdown();
  } else {
    dom.mStackDropdown.classList.remove('hidden');
    dom.mStacksBtn.textContent = '⊗ Close';
    dom.mStacksBtn.classList.add('active');
    renderNamedStacksList();
  }
}

/* ── Build player card ──────────────────────────────────────────── */
async function buildPlayerCard(playerId, playerName) {
  const person = await MLB.getPlayer(playerId);
  if (!person) throw new Error('No data found for player.');

  const name      = person.fullName || playerName;
  const team      = person.currentTeam?.name || '';
  const pos       = person.primaryPosition?.abbreviation || '';
  const debutYear = person.mlbDebutDate ? new Date(person.mlbDebutDate).getFullYear() : '';
  const yrs       = debutYear ? new Date().getFullYear() - debutYear + 1 : '';
  const meta      = [team, pos, yrs ? `${yrs} yrs` : ''].filter(Boolean).join(' · ');

  const isPitcher = ['P', 'SP', 'RP'].includes(pos);

  if (isPitcher) {
    const [seasons, saber] = await Promise.all([
      MLB.getPitchingStats(playerId),
      MLB.getSabermetrics(playerId, 'pitching', new Date().getFullYear()),
    ]);
    return buildPitcherCard(playerId, name, meta, seasons, saber);
  }

  const [seasons, saber] = await Promise.all([
    MLB.getHittingStats(playerId),
    MLB.getSabermetrics(playerId, 'hitting', new Date().getFullYear()),
  ]);
  return buildBatterCard(playerId, name, meta, seasons, saber);
}

function buildBatterCard(playerId, name, meta, sortedSeasons, saber) {
  let bestIdx = 0, bestOps = -Infinity;
  sortedSeasons.forEach((s, i) => {
    const ops = parseFloat(s.stat?.ops || 0);
    if (ops > bestOps) { bestOps = ops; bestIdx = i; }
  });

  const current = sortedSeasons[0];
  const best    = sortedSeasons[bestIdx];

  // OPS+ from sabermetrics (wRC+ is the modern equivalent and often returned)
  const opsPlus = saber?.wRcPlus
    ? String(Math.round(parseFloat(saber.wRcPlus)))
    : (saber?.opsPlus ? String(Math.round(parseFloat(saber.opsPlus))) : '—');

  const highlights = [
    { val: current ? fmtAvg(current.stat?.avg) : '—', label: 'AVG' },
    { val: current ? fmtAvg(current.stat?.ops) : '—', label: 'OPS' },
    { val: opsPlus,                                    label: opsPlus !== '—' ? 'wRC+' : 'OPS+' },
  ];

  const rowOrder = [];
  if (current) rowOrder.push({ ...current, _isCurrent: true,  _isBest: bestIdx === 0 });
  if (bestIdx !== 0) rowOrder.push({ ...best, _isBest: true, _isCurrent: false });
  sortedSeasons
    .filter((_, i) => i !== 0 && i !== bestIdx)
    .forEach(s => rowOrder.push({ ...s, _isBest: false, _isCurrent: false }));

  const seasons = rowOrder.map(s => ({
    cells: [
      s._isBest && !s._isCurrent ? `${s.season} ★` : s.season,
      String(s.stat?.gamesPlayed ?? '—'),
      String(s.stat?.homeRuns    ?? '—'),
      String(s.stat?.rbi         ?? '—'),
      String(s.stat?.strikeOuts  ?? '—'),
      fmtAvg(s.stat?.obp),
      fmtAvg(s.stat?.slg),
    ],
    isCurrent: s._isCurrent,
    isBest:    s._isBest,
  }));

  return {
    type: 'player', subtype: 'batter',
    id: playerId, name, meta,
    headshotUrl: MLB.headshot(playerId),
    logoUrl: null,
    highlights,
    cols: ['Year', 'G', 'HR', 'RBI', 'SO', 'OBP', 'SLG'],
    seasons,
    depthChart: null,
  };
}

function buildPitcherCard(playerId, name, meta, sortedSeasons, saber) {
  let bestIdx = 0, bestIp = -Infinity;
  sortedSeasons.forEach((s, i) => {
    const ip = parseFloat(s.stat?.inningsPitched || 0);
    if (ip > bestIp) { bestIp = ip; bestIdx = i; }
  });

  const current = sortedSeasons[0];
  const best    = sortedSeasons[bestIdx];

  const fip = saber?.fip ? fmtDec(saber.fip) : '—';

  const highlights = [
    { val: current ? fmtDec(current.stat?.era)  : '—', label: 'ERA' },
    { val: current ? fmtDec(current.stat?.whip) : '—', label: 'WHIP' },
    { val: fip,                                         label: 'FIP' },
  ];

  const rowOrder = [];
  if (current) rowOrder.push({ ...current, _isCurrent: true,  _isBest: bestIdx === 0 });
  if (bestIdx !== 0) rowOrder.push({ ...best, _isBest: true, _isCurrent: false });
  sortedSeasons
    .filter((_, i) => i !== 0 && i !== bestIdx)
    .forEach(s => rowOrder.push({ ...s, _isBest: false, _isCurrent: false }));

  const seasons = rowOrder.map(s => {
    const wl = (s.stat?.wins !== undefined && s.stat?.losses !== undefined)
      ? `${s.stat.wins}-${s.stat.losses}` : '—';
    return {
      cells: [
        s._isBest && !s._isCurrent ? `${s.season} ★` : s.season,
        String(s.stat?.gamesPlayed    ?? '—'),
        wl,
        String(s.stat?.inningsPitched ?? '—'),
        String(s.stat?.strikeOuts     ?? '—'),
        fmtDec(s.stat?.era),
        fmtDec(s.stat?.whip),
      ],
      isCurrent: s._isCurrent,
      isBest:    s._isBest,
    };
  });

  return {
    type: 'player', subtype: 'pitcher',
    id: playerId, name, meta,
    headshotUrl: MLB.headshot(playerId),
    logoUrl: null,
    highlights,
    cols: ['Year', 'G', 'W-L', 'IP', 'SO', 'ERA', 'WHIP'],
    seasons,
    depthChart: null,
  };
}

/* ── Build team card ────────────────────────────────────────────── */
async function buildTeamCard(teamId, teamName) {
  const curYear  = new Date().getFullYear();
  const prevYear = curYear - 1;

  const [team, curStats, prevStats, curRecord, prevRecord, roster] = await Promise.all([
    MLB.getTeam(teamId),
    MLB.getTeamStats(teamId),
    MLB.getTeamStats(teamId, prevYear),
    MLB.getTeamRecord(teamId),
    MLB.getTeamRecord(teamId, prevYear),
    MLB.getDepthChart(teamId),
  ]);

  const name     = team?.name || teamName;
  const division = team?.division?.name || '';
  const league   = team?.league?.name   || '';
  const meta     = [division, league].filter(Boolean).join(' · ');

  const wl = curRecord || '—';

  const highlights = [
    { val: curStats ? fmtAvg(curStats.avg) : '—', label: 'AVG'  },
    { val: curStats ? fmtAvg(curStats.ops) : '—', label: 'OPS'  },
    { val: wl,                                     label: 'W-L'  },
  ];

  const seasons = [];
  if (curStats) seasons.push({
    cells: [
      String(curYear),
      String(curStats.gamesPlayed ?? '—'),
      curRecord || '—',
      fmtAvg(curStats.avg),
      fmtAvg(curStats.obp),
      fmtAvg(curStats.slg),
      fmtAvg(curStats.ops),
    ],
    isCurrent: true, isBest: false,
  });
  if (prevStats) seasons.push({
    cells: [
      String(prevYear),
      String(prevStats.gamesPlayed ?? '—'),
      prevRecord || '—',
      fmtAvg(prevStats.avg),
      fmtAvg(prevStats.obp),
      fmtAvg(prevStats.slg),
      fmtAvg(prevStats.ops),
    ],
    isCurrent: false, isBest: false,
  });

  // Build depth chart from roster
  const POS_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  const seen = new Set();
  const depthChart = [];
  for (const entry of roster) {
    const pos = entry.position?.abbreviation;
    if (!pos || !POS_ORDER.includes(pos) || seen.has(pos)) continue;
    seen.add(pos);
    depthChart.push({ pos, name: entry.person?.fullName || '', id: entry.person?.id || null });
  }
  depthChart.sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos));

  // Fetch current-season hitting stats for each lineup player in parallel
  const playerStats = await Promise.all(
    depthChart.map(p => p.id ? MLB.getPlayerSeasonHitting(p.id, curYear) : Promise.resolve(null))
  );
  playerStats.forEach((stat, i) => {
    depthChart[i].avg = stat?.avg  ?? null;
    depthChart[i].obp = stat?.obp  ?? null;
    depthChart[i].slg = stat?.slg  ?? null;
  });

  return {
    type: 'team', subtype: 'team',
    id: teamId, name, meta,
    headshotUrl: null,
    logoUrl: MLB.teamLogo(teamId),
    highlights,
    cols: ['Year', 'G', 'W-L', 'AVG', 'OBP', 'SLG', 'OPS'],
    seasons,
    depthChart: depthChart.length ? depthChart : null,
  };
}

/* ── Search & autocomplete ──────────────────────────────────────── */
async function fetchAutocomplete(query, listEl) {
  if (query.length < 2) { listEl.classList.add('hidden'); return; }
  try {
    const results = await MLB.search(query, state.searchType);
    renderAutocomplete(results, listEl);
  } catch (e) {
    listEl.classList.add('hidden');
  }
}

function renderAutocomplete(results, listEl) {
  listEl.innerHTML = '';
  if (!results.length) { listEl.classList.add('hidden'); return; }
  results.forEach(r => {
    const li = document.createElement('li');
    li.className = 'autocomplete-item';
    const sub = [r.teamName, r.position].filter(Boolean).join(' · ');
    li.append(document.createTextNode(r.fullName));
    const subSpan = document.createElement('span');
    subSpan.textContent = sub;
    li.appendChild(subSpan);
    li.addEventListener('click', () => {
      handleSelect(r.id, r.fullName);
      listEl.classList.add('hidden');
    });
    listEl.appendChild(li);
  });
  listEl.classList.remove('hidden');
}

async function handleSelect(id, name) {
  dom.searchInput.value  = name;
  dom.mSearchInput.value = name;
  dom.autocomplete.classList.add('hidden');
  dom.mAutocomplete.classList.add('hidden');
  showState('loading');
  try {
    const card = state.searchType === 'player'
      ? await buildPlayerCard(id, name)
      : await buildTeamCard(id, name);
    addToStack(card);
  } catch (e) {
    console.error(e);
    dom.errorMsg.textContent = `No data available for "${name}" — try another search.`;
    showState('error');
  }
}

async function handleSearch(inputEl) {
  const query = inputEl.value.trim();
  if (!query) return;
  showState('loading');
  dom.autocomplete.classList.add('hidden');
  dom.mAutocomplete.classList.add('hidden');
  try {
    const results = await MLB.search(query, state.searchType);
    if (!results.length) {
      dom.errorMsg.textContent = `No results for "${query}" — try a different name.`;
      showState('error');
      return;
    }
    await handleSelect(results[0].id, results[0].fullName);
  } catch (e) {
    console.error(e);
    dom.errorMsg.textContent = e.name === 'AbortError'
      ? 'Request timed out — check your connection and try again.'
      : 'Could not reach the MLB Stats API. Check your connection.';
    showState('error');
  }
}

/* ── Navigation ─────────────────────────────────────────────────── */
function navigate(dir) {
  const next = state.current + dir;
  if (next < 0 || next >= state.stack.length) return;
  state.current = next;
  persistStack();
  scrollToCard(state.current);
  renderStackList();
  updateActiveSlot();
}

/* ── Type toggle ────────────────────────────────────────────────── */
function setSearchType(type) {
  state.searchType = type;
  [dom.btnPlayer, dom.btnTeam, dom.mBtnPlayer, dom.mBtnTeam].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

/* ── Wire search ─────────────────────────────────────────────────── */
function wireSearch(inputEl, goEl, acEl) {
  // Clear input on focus when a card is already loaded
  inputEl.addEventListener('focus', () => {
    if (state.stack.length > 0) inputEl.value = '';
  });

  inputEl.addEventListener('input', () => {
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => fetchAutocomplete(inputEl.value.trim(), acEl), 220);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  handleSearch(inputEl);
    if (e.key === 'Escape') acEl.classList.add('hidden');
  });

  goEl.addEventListener('click', () => handleSearch(inputEl));
}

/* ── Load persisted stack ───────────────────────────────────────── */
function loadStack() {
  try {
    const raw = localStorage.getItem('stat_stack');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return;
    // Discard stacks with old card shape
    if (!parsed[0].cols) {
      localStorage.removeItem('stat_stack');
      localStorage.removeItem('stat_current');
      return;
    }
    state.stack   = parsed;
    state.current = Math.max(0, Math.min(
      parseInt(localStorage.getItem('stat_current') || '0', 10),
      state.stack.length - 1
    ));
    renderCardTrack();
    renderStackList();
  } catch (e) {
    console.warn('Could not restore stack:', e);
  }
}

/* ── Init ───────────────────────────────────────────────────────── */
function init() {
  wireSearch(dom.searchInput,  dom.goBtn,  dom.autocomplete);
  wireSearch(dom.mSearchInput, dom.mGoBtn, dom.mAutocomplete);

  [dom.btnPlayer, dom.btnTeam].forEach(btn =>
    btn.addEventListener('click', () => setSearchType(btn.dataset.type))
  );
  [dom.mBtnPlayer, dom.mBtnTeam].forEach(btn =>
    btn.addEventListener('click', () => setSearchType(btn.dataset.type))
  );

  dom.addCardBtn.addEventListener('click', () => openSaveDialog(false));
  dom.saveStackBtn.addEventListener('click', () => openSaveDialog(true));
  dom.saveBtn.addEventListener('click', () => openSaveDialog(false));
  dom.removeCardBtn.addEventListener('click', removeCurrentCard);
  dom.mStacksBtn.addEventListener('click', toggleMobileDropdown);

  dom.backBtn.addEventListener('click', goBack);
  dom.mBackBtn.addEventListener('click', () => { goBack(); closeMobileDropdown(); });

  dom.dialogConfirm.addEventListener('click', confirmSave);
  dom.dialogCancel.addEventListener('click', closeDialog);
  dom.dialogOverlay.addEventListener('click', e => {
    if (e.target === dom.dialogOverlay) closeDialog();
  });
  dom.dialogInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmSave();
    if (e.key === 'Escape') closeDialog();
  });

  dom.deleteStackConfirm.addEventListener('click', confirmDeleteStack);
  dom.deleteStackCancel.addEventListener('click', closeDeleteDialog);
  dom.deleteStackOverlay.addEventListener('click', e => {
    if (e.target === dom.deleteStackOverlay) closeDeleteDialog();
  });

  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.searchInput.value  = btn.dataset.query;
      dom.mSearchInput.value = btn.dataset.query;
      handleSearch(dom.searchInput);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft')  navigate(-1);
    if (e.key === 'ArrowRight') navigate(+1);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.sidebar-search') && !e.target.closest('.mobile-search')) {
      dom.autocomplete.classList.add('hidden');
      dom.mAutocomplete.classList.add('hidden');
    }
  });

  initScrollObserver();

  // Recompute card slot widths on resize
  window.addEventListener('resize', debounce(() => {
    if (state.stack.length > 0) renderCardTrack();
  }, 200));

  loadStack();
  renderNamedStacksList();
  if (state.stack.length === 0) showState('empty');
}

document.addEventListener('DOMContentLoaded', init);

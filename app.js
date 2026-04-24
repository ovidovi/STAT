/* ================================================================
   STAT — app.js
   MLB Stats API integration + app logic
   ================================================================ */

'use strict';

/* ── Helpers ─────────────────────────────────────────────────────── */

function esc(s) {
  return String(s ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function fmtEra(val) {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(2);
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

  async search(query, type = 'player') {
    if (type === 'team') {
      const res = await fetchWithTimeout(`${MLB.base}/teams?sportId=1`);
      const data = await res.json();
      return (data.teams || [])
        .filter(t => t.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8)
        .map(t => ({ id: t.id, fullName: t.name, position: t.division?.name || '', teamName: t.locationName || '' }));
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

  async getTeamStats(id) {
    const res = await fetchWithTimeout(`${MLB.base}/teams/${id}/stats?stats=season&group=hitting&sportId=1`);
    const data = await res.json();
    return data.stats?.[0]?.splits?.[0]?.stat || null;
  },

  async getTeam(id) {
    const res = await fetchWithTimeout(`${MLB.base}/teams/${id}`);
    const data = await res.json();
    return data.teams?.[0] || null;
  },
};

/* ── State ──────────────────────────────────────────────────────── */
const state = {
  stack:          [],
  current:        -1,
  searchType:     'player',
  searchDebounce: null,
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
    highlights:  [{ val: string, label: string }, × 3],
    cols:        string[],
    seasons:     [{ cells: string[], isBest: bool, isCurrent: bool }],
  }
*/

/* ── DOM refs ───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  // Desktop sidebar
  searchInput:       $('search-input'),
  goBtn:             $('go-btn'),
  btnPlayer:         $('btn-player'),
  btnTeam:           $('btn-team'),
  autocomplete:      $('autocomplete-list'),
  stackList:         $('stack-list'),
  namedStacksList:   $('named-stacks-list'),
  saveBtn:           $('save-btn'),
  // Mobile
  mSearchInput:      $('m-search-input'),
  mGoBtn:            $('m-go-btn'),
  mBtnPlayer:        $('m-btn-player'),
  mBtnTeam:          $('m-btn-team'),
  mAutocomplete:     $('m-autocomplete-list'),
  mStacksBtn:        $('m-stacks-btn'),
  mStackDropdown:    $('mobile-stack-dropdown'),
  mStackList:        $('m-stack-list'),
  mNamedStacksList:  $('m-named-stacks-list'),
  // States
  emptyState:        $('empty-state'),
  errorState:        $('error-state'),
  errorMsg:          $('error-msg'),
  loadingState:      $('loading-state'),
  cardStage:         $('card-stage'),
  // Card
  cardName:          $('card-name'),
  cardMeta:          $('card-meta'),
  hlAvg:             $('hl-avg'),
  hlOps:             $('hl-ops'),
  hlWar:             $('hl-war'),
  statTable:         $('stat-table'),
  statTbody:         $('stat-tbody'),
  stackIndicator:    $('stack-indicator'),
  stackCount:        $('stack-count'),
  prevBtn:           $('prev-btn'),
  nextBtn:           $('next-btn'),
  saveStackBtn:      $('save-stack-btn'),
  removeCardBtn:     $('remove-card-btn'),
  // Dialog
  dialogOverlay:     $('dialog-overlay'),
  dialogInput:       $('dialog-input'),
  dialogConfirm:     $('dialog-confirm'),
  dialogCancel:      $('dialog-cancel'),
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

/* ── Render card ────────────────────────────────────────────────── */
function renderCard(card) {
  if (!card) { showState('empty'); return; }

  dom.cardName.textContent = card.name;
  dom.cardMeta.textContent = card.meta;

  // Update highlight cells (value + label)
  const hlEls = [dom.hlAvg, dom.hlOps, dom.hlWar];
  card.highlights.forEach((hl, i) => {
    hlEls[i].querySelector('.hl-num').textContent = hl.val;
    hlEls[i].querySelector('.hl-key').textContent = hl.label;
  });

  // Rebuild table header
  dom.statTable.querySelector('thead tr').innerHTML =
    card.cols.map((col, i) =>
      `<th class="${i === 0 ? 'col-year' : 'col-stat'}">${esc(col)}</th>`
    ).join('');

  // Rebuild tbody
  dom.statTbody.innerHTML = '';
  for (const s of card.seasons) {
    const tr = document.createElement('tr');
    tr.className = 'stat-row';
    if (s.isCurrent) tr.classList.add('current');
    if (s.isBest && !s.isCurrent) tr.classList.add('best');
    tr.innerHTML = s.cells.map(c => `<td>${esc(c)}</td>`).join('');
    dom.statTbody.appendChild(tr);
  }

  renderStackIndicator();
  showState('card');
}

/* ── Render current stack list (sidebar + mobile dropdown) ──────── */
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
      avatarDiv.className = 'stack-item-avatar';
      if (card.headshotUrl) {
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
        renderCard(state.stack[state.current]);
        renderStackList();
      });
      removeBtn.addEventListener('click', () => removeFromStack(idx));
      list.appendChild(li);
    });
  });
}

/* ── Render stack indicator dots + count ────────────────────────── */
function renderStackIndicator() {
  dom.stackIndicator.innerHTML = state.stack.map((_, i) =>
    `<span class="ind-dot${i === state.current ? ' active' : ''}"></span>`
  ).join('');

  const total = state.stack.length;
  dom.stackCount.textContent = total > 0 ? `${state.current + 1} of ${total}` : '';
  dom.prevBtn.disabled = state.current <= 0;
  dom.nextBtn.disabled = state.current >= state.stack.length - 1;
}

/* ── localStorage persistence ───────────────────────────────────── */
function persistStack() {
  try {
    localStorage.setItem('stat_stack', JSON.stringify(state.stack));
    localStorage.setItem('stat_current', String(state.current));
  } catch (e) { /* quota exceeded — silent fail */ }
}

function loadNamedStacks() {
  try {
    const raw = localStorage.getItem('stat_named_stacks');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function persistNamedStack(name) {
  const all = loadNamedStacks();
  all.push({ name, cards: [...state.stack], createdAt: Date.now() });
  // Let quota errors propagate so confirmSave can surface them
  localStorage.setItem('stat_named_stacks', JSON.stringify(all));
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
      loadBtn.textContent = '+';
      loadBtn.addEventListener('click', () => loadNamedStackAt(idx));

      li.append(infoDiv, loadBtn);
      list.appendChild(li);
    });
  });
}

function loadNamedStackAt(idx) {
  const all = loadNamedStacks();
  const s = all[idx];
  if (!s || !s.cards.length) return;
  state.stack   = [...s.cards];
  state.current = 0;
  renderCard(state.stack[0]);
  renderStackList();
  renderNamedStacksList();
  closeMobileDropdown();
}

/* ── Stack management ───────────────────────────────────────────── */
function addToStack(card) {
  const existing = state.stack.findIndex(c => c.id === card.id && c.type === card.type);
  if (existing !== -1) {
    state.current = existing;
  } else {
    state.stack.push(card);
    state.current = state.stack.length - 1;
  }
  persistStack();
  renderStackList();
  renderStackIndicator();
}

function removeFromStack(idx) {
  state.stack.splice(idx, 1);
  if (state.current >= state.stack.length) state.current = state.stack.length - 1;
  if (state.stack.length === 0) {
    state.current = -1;
    showState('empty');
  } else {
    renderCard(state.stack[state.current]);
  }
  persistStack();
  renderStackList();
  renderStackIndicator();
}

function removeCurrentCard() {
  if (state.current < 0 || state.stack.length === 0) return;
  removeFromStack(state.current);
}

/* ── Save stack dialog ──────────────────────────────────────────── */
function openSaveDialog() {
  if (state.stack.length === 0) return;
  dom.dialogInput.value = '';
  dom.dialogInput.placeholder = 'e.g. AL Sluggers 2024';
  dom.dialogOverlay.classList.remove('hidden');
  setTimeout(() => dom.dialogInput.focus(), 50);
}

function closeDialog() {
  dom.dialogOverlay.classList.add('hidden');
}

function confirmSave() {
  const name = dom.dialogInput.value.trim();
  if (!name) { dom.dialogInput.focus(); return; }
  try {
    persistNamedStack(name);
  } catch (e) {
    dom.dialogInput.value = '';
    dom.dialogInput.placeholder = 'Storage full — delete a saved stack first';
    dom.dialogInput.focus();
    return;
  }
  closeDialog();
  renderNamedStacksList();
  [dom.saveStackBtn, dom.saveBtn].forEach(btn => {
    const original = btn.textContent;
    btn.textContent = 'Saved ✓';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('saved');
    }, 2000);
  });
}

/* ── Mobile stacks dropdown ─────────────────────────────────────── */
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
    const seasons = await MLB.getPitchingStats(playerId);
    return buildPitcherCard(playerId, name, meta, seasons);
  }
  const seasons = await MLB.getHittingStats(playerId);
  return buildBatterCard(playerId, name, meta, seasons);
}

function buildBatterCard(playerId, name, meta, sortedSeasons) {
  let bestIdx = 0, bestOps = -Infinity;
  sortedSeasons.forEach((s, i) => {
    const ops = parseFloat(s.stat?.ops || 0);
    if (ops > bestOps) { bestOps = ops; bestIdx = i; }
  });

  const current = sortedSeasons[0];
  const best    = sortedSeasons[bestIdx];

  const highlights = [
    { val: current ? fmtAvg(current.stat?.avg) : '—', label: 'AVG' },
    { val: current ? fmtAvg(current.stat?.ops) : '—', label: 'OPS' },
    { val: '—', label: 'WAR' },
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
      fmtAvg(s.stat?.avg),
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
    highlights,
    cols: ['Year', 'G', 'HR', 'RBI', 'AVG', 'OBP', 'SLG'],
    seasons,
  };
}

function buildPitcherCard(playerId, name, meta, sortedSeasons) {
  // Best season = highest innings pitched
  let bestIdx = 0, bestIp = -Infinity;
  sortedSeasons.forEach((s, i) => {
    const ip = parseFloat(s.stat?.inningsPitched || 0);
    if (ip > bestIp) { bestIp = ip; bestIdx = i; }
  });

  const current = sortedSeasons[0];
  const best    = sortedSeasons[bestIdx];

  const highlights = [
    { val: current ? fmtEra(current.stat?.era)  : '—', label: 'ERA' },
    { val: current ? fmtEra(current.stat?.whip) : '—', label: 'WHIP' },
    { val: '—', label: 'WAR' },
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
        fmtEra(s.stat?.era),
        fmtEra(s.stat?.whip),
      ],
      isCurrent: s._isCurrent,
      isBest:    s._isBest,
    };
  });

  return {
    type: 'player', subtype: 'pitcher',
    id: playerId, name, meta,
    headshotUrl: MLB.headshot(playerId),
    highlights,
    cols: ['Year', 'G', 'W-L', 'IP', 'SO', 'ERA', 'WHIP'],
    seasons,
  };
}

/* ── Build team card ────────────────────────────────────────────── */
async function buildTeamCard(teamId, teamName) {
  const [team, stats] = await Promise.all([
    MLB.getTeam(teamId),
    MLB.getTeamStats(teamId),
  ]);

  const name     = team?.name || teamName;
  const division = team?.division?.name || '';
  const league   = team?.league?.name   || '';
  const meta     = [division, league].filter(Boolean).join(' · ');

  const highlights = [
    { val: stats ? fmtAvg(stats.avg) : '—', label: 'AVG' },
    { val: stats ? fmtAvg(stats.ops) : '—', label: 'OPS' },
    { val: '—', label: 'W-L' },
  ];

  const seasons = stats ? [{
    cells: [
      new Date().getFullYear().toString(),
      String(stats.gamesPlayed ?? '—'),
      String(stats.homeRuns    ?? '—'),
      String(stats.rbi         ?? '—'),
      fmtAvg(stats.avg),
      fmtAvg(stats.obp),
      fmtAvg(stats.slg),
    ],
    isCurrent: true,
    isBest:    false,
  }] : [];

  return {
    type: 'team', subtype: 'team',
    id: teamId, name, meta,
    headshotUrl: null,
    highlights,
    cols: ['Year', 'G', 'HR', 'RBI', 'AVG', 'OBP', 'SLG'],
    seasons,
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
    const nameNode = document.createTextNode(r.fullName);
    const subSpan  = document.createElement('span');
    subSpan.textContent = sub;
    li.append(nameNode, subSpan);
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
    renderCard(card);
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
    const msg = e.name === 'AbortError'
      ? 'Request timed out — check your connection and try again.'
      : 'Could not reach the MLB Stats API. Check your connection.';
    dom.errorMsg.textContent = msg;
    showState('error');
  }
}

/* ── Navigation ─────────────────────────────────────────────────── */
function navigate(dir) {
  const next = state.current + dir;
  if (next < 0 || next >= state.stack.length) return;
  state.current = next;
  persistStack();
  renderCard(state.stack[state.current]);
  renderStackList();
}

/* ── Type toggle ────────────────────────────────────────────────── */
function setSearchType(type) {
  state.searchType = type;
  [dom.btnPlayer, dom.btnTeam, dom.mBtnPlayer, dom.mBtnTeam].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

/* ── Wire search field ──────────────────────────────────────────── */
function wireSearch(inputEl, goEl, acEl) {
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

/* ── Load persisted current stack ───────────────────────────────── */
function loadStack() {
  try {
    const raw = localStorage.getItem('stat_stack');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    state.stack   = parsed;
    state.current = Math.max(0, Math.min(
      parseInt(localStorage.getItem('stat_current') || '0', 10),
      state.stack.length - 1
    ));
    renderCard(state.stack[state.current]);
    renderStackList();
  } catch (e) {
    console.warn('Could not restore stack from localStorage:', e);
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

  dom.prevBtn.addEventListener('click', () => navigate(-1));
  dom.nextBtn.addEventListener('click', () => navigate(+1));

  dom.saveStackBtn.addEventListener('click', openSaveDialog);
  dom.saveBtn.addEventListener('click', openSaveDialog);
  dom.removeCardBtn.addEventListener('click', removeCurrentCard);
  dom.mStacksBtn.addEventListener('click', toggleMobileDropdown);

  dom.dialogConfirm.addEventListener('click', confirmSave);
  dom.dialogCancel.addEventListener('click', closeDialog);
  dom.dialogOverlay.addEventListener('click', e => {
    if (e.target === dom.dialogOverlay) closeDialog();
  });
  dom.dialogInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmSave();
    if (e.key === 'Escape') closeDialog();
  });

  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.dataset.query;
      dom.searchInput.value  = query;
      dom.mSearchInput.value = query;
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

  loadStack();
  renderNamedStacksList();
  if (state.stack.length === 0) showState('empty');
}

document.addEventListener('DOMContentLoaded', init);

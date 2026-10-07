// BetterCrags — My Crags dashboard: the To-do tierlists tab (board
// persistence, S/A/B/C drag-and-drop, search/browse, import/export,
// full backup/restore).
(() => {
  'use strict';
  // One namespace object shared by every mycrags/*.js file (see core.js).
  const MC = (window.BCMyCrags = window.BCMyCrags || {});
  const { $, BOARD_KEY, BOARD_KEY_V1, PROJECT_SUGGESTIONS_KEY, STORAGE_KEYS, TIERS, USERNAME_KEY, bcGenId, clearAlert, enrichRouteStats, escapeHtml, gradeLabelExact, loadBrowseScope, makeCustomList, makeList, renderProjectSuggestions, sanitizeList, searchAll, setStatus, state, storageGet, storageSet } = MC;

  // ── To-do tierlists: drag todos into S/A/B/C tiers, saved as lists ──

  function bucketOf(genre) {
    return genre === 'Boulder' ? 'Boulder' : genre === 'Sport' ? 'Sport' : 'Other';
  }
  // thetopo rates routes out of 3 stars (not 5).
  const MAX_STARS = 3;
  function starsHtml(rating) {
    let s = '';
    const full = Math.round(rating || 0);
    for (let i = 1; i <= MAX_STARS; i++) s += i <= full ? '★' : '☆';
    return s;
  }
  function defaultBoard() {
    const l = makeList('My projects');
    return { version: 2, lists: [l], activeListId: l.id };
  }
  // A list is "stored" (self-contained) when it carries its own item snapshot —
  // true for both dream/custom lists and imported lists. Otherwise it's live
  // over your todos.
  function listIsStored(list) {
    return Array.isArray(list.items);
  }

  let boardSaveTimer = null;
  // Serialized form of the last value this tab wrote, so the storage.onChanged
  // echo of our own save can be ignored even if state.board has moved on since.
  let lastBoardWrite = null;
  function writeBoard() {
    lastBoardWrite = JSON.stringify(state.board);
    storageSet({ [BOARD_KEY]: state.board }).then(ok => {
      // onStorageError already raised the banner on failure; on success,
      // clear a stale one so the user knows they're safe again.
      if (ok) clearAlert('storage-personal');
    });
  }
  function saveBoard() {
    if (boardSaveTimer) clearTimeout(boardSaveTimer);
    boardSaveTimer = setTimeout(() => { writeBoard(); boardSaveTimer = null; }, 250);
  }
  // If the tab closes/hides before the debounce fires, persist immediately so
  // the pending edit isn't lost.
  function flushBoardSave() {
    if (!boardSaveTimer) return;
    clearTimeout(boardSaveTimer);
    boardSaveTimer = null;
    writeBoard();
  }
  window.addEventListener('pagehide', flushBoardSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBoardSave();
  });

  async function loadBoard() {
    let b = await storageGet(BOARD_KEY);
    if (!b) {
      // Migrate from the v1 single-list board if present.
      b = defaultBoard();
      const old = await storageGet(BOARD_KEY_V1);
      if (old) {
        if (old.tiers) b.lists[0].tiers = old.tiers;
        if (old.notes) b.lists[0].notes = old.notes;
        if (old.genre) b.lists[0].genre = old.genre;
        if (old.areas) b.lists[0].areas = old.areas;
      }
    }
    if (!Array.isArray(b.lists) || !b.lists.length) b.lists = [makeList('My projects')];
    // Fill in fields older versions didn't write. (Deliberately not
    // sanitizeList: a stored board is ours, and a strict pass could drop
    // data a future version writes that this one doesn't know about.)
    for (const l of b.lists) {
      l.tiers = l.tiers || {};
      l.order = l.order || {};
      l.notes = l.notes || {};
      if (!('genre' in l)) l.genre = 'all';
      if (!('areas' in l)) l.areas = null;
      if (!('gradeMin' in l)) l.gradeMin = null;
      if (!('gradeMax' in l)) l.gradeMax = null;
    }
    if (!b.activeListId || !b.lists.some(l => l.id === b.activeListId)) b.activeListId = b.lists[0].id;
    state.board = b;
  }

  function activeList() {
    if (!state.board) state.board = defaultBoard();
    return state.board.lists.find(l => l.id === state.board.activeListId) || state.board.lists[0];
  }

  // Items from the user's own todos, enriched with rating/ascents/area.
  function boardItems() {
    return state.todo.map(r => {
      const tot = state.cragTotals[r.cragId] || {};
      const stats = state.routeStats[r.key];
      const s = stats || {};
      const genre = r.genre || s.genre || '';
      const gradeInt = r.gradeInt || s.gradeInt || 0;
      return {
        key: r.key,
        routeName: r.routeName || '',
        cragName: r.cragName || tot.name || r.cragId,
        area: tot.area || '',
        gradeLabel: r.gradeLabel || (gradeInt ? gradeLabelExact(gradeInt, genre) : ''),
        gradeInt,
        bucket: bucketOf(genre),
        genreKnown: !!genre,
        rating: s.rating || 0,
        ascents: s.ascents || 0,
        hasStats: !!stats,
      };
    });
  }

  // Decorate a stored item (dream/imported) with live area + stats lookups, so
  // ratings/ascents fill in once enriched and area shows once the crag is known.
  function decorateStored(it) {
    // Defensive against malformed/legacy stored items: coerce key to a string
    // and numbers to numbers so bad storage can't crash the render.
    const key = String((it && it.key) || '');
    it = it || {};
    const cragId = key.split('/')[0];
    const tot = state.cragTotals[cragId] || {};
    const stats = state.routeStats[key];
    const s = stats || {};
    const gradeInt = Number(it.gradeInt || s.gradeInt) || 0;
    const genre = it.genre || s.genre || '';
    return {
      key,
      routeName: it.routeName || '',
      cragName: it.cragName || tot.name || cragId,
      area: it.area || tot.area || '',
      gradeLabel: it.gradeLabel || (gradeInt ? gradeLabelExact(gradeInt, genre) : ''),
      gradeInt,
      bucket: bucketOf(genre),
      genreKnown: !!genre,
      rating: Number(s.rating || it.rating) || 0,
      ascents: Number(s.ascents || it.ascents) || 0,
      hasStats: !!stats || it.rating != null,
    };
  }

  // The (filtered) item pool for a list: stored lists from their snapshot, live
  // lists from your todos. Genre/area/grade filters apply to both.
  function listItems(list) {
    const items = listIsStored(list) ? list.items.map(decorateStored) : boardItems();
    return filterItems(items, list);
  }

  function filterItems(items, list) {
    return items.filter(it => {
      // Genre: only exclude a *known* genre mismatch. A todo whose genre never
      // resolved (grade in a system we don't parse, or not yet enriched) buckets
      // to 'Other' — but it must not be silently hidden by a Boulder/Sport tab,
      // so unknown-genre items stay visible under every genre filter.
      if (list.genre !== 'all' && it.genreKnown && it.bucket !== list.genre) return false;
      // Area: likewise only exclude a *known* area mismatch. An unresolved area
      // ('') stays visible under any area selection rather than disappearing.
      if (list.areas && it.area && !list.areas.includes(it.area)) return false;
      if (list.gradeMin != null || list.gradeMax != null) {
        if (!it.gradeInt) return false; // unknown grade is excluded once a grade filter is set
        if (list.gradeMin != null && it.gradeInt < list.gradeMin) return false;
        if (list.gradeMax != null && it.gradeInt > list.gradeMax) return false;
      }
      return true;
    });
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  }

  // ── Board controls (list selector, filters) ──
  function renderListControls() {
    const el = $('#mc-pb-lists');
    const b = state.board;
    const list = activeList();
    el.innerHTML = '';
    const sel = document.createElement('select');
    sel.className = 'mc-pb-list-select';
    const addOption = (parent, l) => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.name;
      if (l.id === b.activeListId) o.selected = true;
      parent.appendChild(o);
    };
    const own = b.lists.filter(l => !l.imported);
    const imported = b.lists.filter(l => l.imported);
    if (own.length && imported.length) {
      const g1 = document.createElement('optgroup'); g1.label = 'My lists';
      own.forEach(l => addOption(g1, l));
      sel.appendChild(g1);
      const g2 = document.createElement('optgroup'); g2.label = 'Imported';
      imported.forEach(l => addOption(g2, l));
      sel.appendChild(g2);
    } else {
      // Only one kind present — no need for group headers.
      b.lists.forEach(l => addOption(sel, l));
    }
    sel.addEventListener('change', () => { b.activeListId = sel.value; boardBrowse = null; saveBoard(); renderBoard(); });
    el.appendChild(sel);

    const mkBtn = (label, title, fn) => {
      const btn = document.createElement('button');
      btn.textContent = label; btn.title = title;
      btn.addEventListener('click', fn);
      el.appendChild(btn);
    };
    mkBtn('+ New', 'New list from your todos', () => {
      const name = (prompt('Name for the new todo list:', 'New list') || '').trim();
      if (!name) return;
      const l = makeList(name);
      b.lists.push(l); b.activeListId = l.id; boardBrowse = null; saveBoard(); renderBoard();
    });
    mkBtn('+ Dream', 'New dream/trip list — add any routes by search', () => {
      const name = (prompt('Name for the dream/trip list:', 'Dream list') || '').trim();
      if (!name) return;
      const l = makeCustomList(name);
      b.lists.push(l); b.activeListId = l.id; boardBrowse = null; saveBoard(); renderBoard();
    });
    mkBtn('Rename', 'Rename this list', () => {
      const name = (prompt('Rename list:', list.name) || '').trim();
      if (!name) return;
      list.name = name; saveBoard(); renderBoard();
    });
    mkBtn('Duplicate', 'Duplicate this list', () => {
      const copy = JSON.parse(JSON.stringify(list));
      copy.id = bcGenId(); copy.name = `${list.name} copy`;
      b.lists.push(copy); b.activeListId = copy.id; boardBrowse = null; saveBoard(); renderBoard();
    });
    mkBtn('Export', 'Download this list as a shareable JSON', () => exportList(list));
    mkBtn('Import', 'Import a shared list JSON', () => $('#mc-pb-import').click());
    mkBtn('Delete', 'Delete this list', () => {
      if (b.lists.length <= 1) { alert('Keep at least one list.'); return; }
      if (!confirm(`Delete list "${list.name}"?`)) return;
      b.lists = b.lists.filter(x => x.id !== list.id);
      b.activeListId = b.lists[0].id; boardBrowse = null; saveBoard(); renderBoard();
    });

    if (list.imported || list.custom) {
      const tag = document.createElement('span');
      tag.className = 'mc-pb-imported';
      tag.textContent = list.imported
        ? (list.sourceUser ? `imported from ${list.sourceUser}` : 'imported')
        : 'dream list';
      el.appendChild(tag);
    }
  }

  function renderBoardGenreTabs(items, list) {
    const container = $('#mc-pb-genre-tabs');
    const present = new Set(items.map(it => it.bucket));
    const opts = ['all', ...['Boulder', 'Sport', 'Other'].filter(g => present.has(g))];
    container.innerHTML = '';
    for (const g of opts) {
      const btn = document.createElement('button');
      btn.textContent = g === 'all' ? 'All' : g;
      if (g === (list.genre || 'all')) btn.dataset.active = '1';
      btn.addEventListener('click', () => { list.genre = g; saveBoard(); renderBoard(); });
      container.appendChild(btn);
    }
  }

  function renderBoardAreaChips(items, list) {
    const container = $('#mc-pb-areas');
    const genre = list.genre || 'all';
    const counts = new Map();
    for (const it of items) {
      if (genre !== 'all' && it.bucket !== genre) continue;
      const a = it.area || '';
      const e = counts.get(a) || { label: it.area || 'Unknown', count: 0 };
      e.count++; counts.set(a, e);
    }
    container.innerHTML = '';
    if (counts.size <= 1) return;
    const seld = list.areas;
    const allBtn = document.createElement('button');
    allBtn.textContent = 'All areas';
    if (!seld) allBtn.dataset.active = '1';
    allBtn.addEventListener('click', () => { list.areas = null; saveBoard(); renderBoard(); });
    container.appendChild(allBtn);
    const ordered = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    for (const [a, { label, count }] of ordered) {
      const btn = document.createElement('button');
      btn.textContent = `${label} (${count})`;
      if (seld && seld.includes(a)) btn.dataset.active = '1';
      btn.addEventListener('click', () => {
        let s = Array.isArray(list.areas) ? [...list.areas] : [];
        s = s.includes(a) ? s.filter(x => x !== a) : [...s, a];
        list.areas = s.length ? s : null;
        saveBoard(); renderBoard();
      });
      container.appendChild(btn);
    }
  }

  function renderBoardGrade(items, list) {
    const container = $('#mc-pb-grade');
    const genre = list.genre || 'all';
    const gis = [...new Set(items
      .filter(it => genre === 'all' || it.bucket === genre)
      .map(it => it.gradeInt).filter(g => g > 0))].sort((a, b) => a - b);
    container.innerHTML = '';
    if (gis.length < 2) return;
    const labelGenre = genre === 'Sport' ? 'Sport' : 'Boulder';
    const lbl = document.createElement('span');
    lbl.className = 'lbl'; lbl.textContent = 'Grade';
    container.appendChild(lbl);
    const mkSel = (which, val) => {
      const s = document.createElement('select');
      const any = document.createElement('option'); any.value = ''; any.textContent = 'Any'; s.appendChild(any);
      for (const gi of gis) {
        const o = document.createElement('option'); o.value = String(gi);
        o.textContent = gradeLabelExact(gi, labelGenre);
        if (val === gi) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener('change', () => {
        const v = s.value ? +s.value : null;
        if (which === 'min') list.gradeMin = v; else list.gradeMax = v;
        saveBoard(); renderBoard();
      });
      return s;
    };
    container.appendChild(mkSel('min', list.gradeMin));
    const dash = document.createElement('span'); dash.textContent = '–'; dash.className = 'dash';
    container.appendChild(dash);
    container.appendChild(mkSel('max', list.gradeMax));
  }

  // ── Cards + tier rows ──
  function cardHtml(it, note, opts) {
    opts = opts || {};
    // Coerce everything that came from storage/import — stored items can carry
    // attacker-controlled strings (imported JSON) or corrupt values, so nothing
    // reaches the markup unescaped or un-coerced.
    const key = String(it.key || '');
    const cragId = key.split('/')[0] || '';
    const rating = Number(it.rating) || 0;
    const ascents = Number(it.ascents) || 0;
    const routeHref = `https://thetopo.com/crags/${key.split('/').map(encodeURIComponent).join('/routes/')}`;
    const cragHref = `https://thetopo.com/crags/${encodeURIComponent(cragId)}`;
    const hasNote = !!note;
    const markers = opts.markers
      ? `${it.done ? '<span class="mk done" title="You\'ve sent this">✓ sent</span>' : ''}${it.onTodo ? '<span class="mk todo" title="On your todo list">todo</span>' : ''}`
      : '';
    const rm = opts.removable ? '<button class="rm" draggable="false" title="Remove from list">×</button>' : '';
    return `
      <div class="mc-tl-card" draggable="true" data-key="${escapeHtml(key)}">
        <span class="g">${escapeHtml(it.gradeLabel || '—')}</span>
        <a class="nm" href="${escapeHtml(routeHref)}" target="_blank" rel="noopener" draggable="false" title="Open route on thetopo">${escapeHtml(it.routeName || '(unnamed)')}</a>
        ${markers}
        <span class="rt ${it.hasStats ? '' : 'unk'}" title="${it.hasStats ? rating.toFixed(1) + ' / 3' : 'rating not fetched'}">${starsHtml(rating)}</span>
        <span class="as" title="ascents logged">${it.hasStats ? ascents : '–'}</span>
        <span class="cr"><a href="${escapeHtml(cragHref)}" target="_blank" rel="noopener" draggable="false" title="Open crag on thetopo">${escapeHtml(it.cragName)}</a>${it.area ? ` · ${escapeHtml(it.area)}` : ''}</span>
        <button class="nb${hasNote ? ' has' : ''}" draggable="false" title="Notes">✎</button>
        ${rm}
        <div class="nt" hidden><textarea placeholder="notes…">${escapeHtml(note || '')}</textarea></div>
      </div>`;
  }

  // Full render: list selector, filters, search box, then the tier area.
  function renderBoard() {
    const card = $('#mc-pb-card');
    if (!card) return;
    if (!state.board) state.board = defaultBoard();
    const list = activeList();
    card.hidden = false;
    renderListControls();
    const allItems = listIsStored(list) ? list.items.map(decorateStored) : boardItems();
    $('#mc-pb-filters').hidden = false;
    renderBoardGenreTabs(allItems, list);
    renderBoardAreaChips(allItems, list);
    renderBoardGrade(allItems, list);
    renderSearchBox(list);
    renderTierArea(list);
  }

  // Renders just the tier rows + pool (cheap re-render after drag / add / remove,
  // so the search box and controls keep their state).
  function renderTierArea(list) {
    const listEl = $('#mc-pb-list');
    if (!listEl) return;
    const stored = listIsStored(list);
    const items = listItems(list);
    const doneKeys = new Set(state.done.map(r => r.key));
    const todoKeys = new Set(state.todo.map(r => r.key));
    items.forEach(it => { it.done = doneKeys.has(it.key); it.onTodo = todoKeys.has(it.key); });

    // Lazily fetch ratings/ascents for items we don't know yet. enrichRouteStats
    // resolves each crag's area (fetching the crag page when unknown) before
    // pulling per-route stats, so it backfills genre/grade/area for todos that
    // enrichTodoStats skipped (their crag had no known areaParamId) — otherwise
    // those todos keep an unknown genre/area and get filtered away.
    const enrichKeys = stored ? list.items.map(i => i.key) : state.todo.map(r => r.key);
    const missing = enrichKeys.filter(k => !state.routeStats[k] && !state.enrichTried.has(k));
    if (missing.length) {
      const gen = MC.renderGen;
      enrichRouteStats(enrichKeys).then(() => {
        // Stale-result guard: skip if a newer load started or the list changed.
        if (gen !== MC.renderGen || activeList() !== list) return;
        // Live todo lists: full re-render so genre tabs + area chips pick up the
        // newly-resolved genres/areas. Stored lists: tier-only re-render to keep
        // the add-search box (which the user may be typing in) from rebuilding.
        if (stored) renderTierArea(list); else renderBoard();
      });
    }

    const opts = { markers: stored, removable: stored };
    const groups = { '': [] };
    for (const t of TIERS) groups[t] = [];
    for (const it of items) {
      const t = list.tiers[it.key];
      groups[TIERS.includes(t) ? t : ''].push(it);
    }
    const ord = k => (list.order[k] == null ? 1e9 : list.order[k]);
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => ord(a.key) - ord(b.key));

    const tierRows = TIERS.map(t => `
      <div class="mc-tl-row">
        <div class="mc-tl-label tier-${t}">${t}</div>
        <div class="mc-tl-drop" data-tier="${t}">${groups[t].map(it => cardHtml(it, list.notes[it.key], opts)).join('')}</div>
      </div>`).join('');
    const pool = `
      <div class="mc-tl-pool">
        <div class="mc-tl-pool-h">Unranked <span class="n">${groups[''].length}</span></div>
        <div class="mc-tl-drop mc-tl-pooldrop" data-tier="">${groups[''].map(it => cardHtml(it, list.notes[it.key], opts)).join('') || '<div class="mc-tl-empty">Everything placed in tiers.</div>'}</div>
      </div>`;

    if (!items.length) {
      const total = stored ? list.items.length : boardItems().length;
      const msg = stored
        ? (total ? 'No routes match these filters.' : 'No routes yet — search above to add some.')
        : (total ? 'No todos match these filters.' : 'No todos yet — add some on thetopo, or make a Dream list above.');
      listEl.innerHTML = `<div class="mc-card-sub" style="padding:14px 16px;">${msg}</div>`;
      return;
    }
    listEl.innerHTML = tierRows + pool;
    listEl.querySelectorAll('.mc-tl-card .nt textarea').forEach(autoGrow);
  }

  // ── Search box + area/crag browse (dream/stored lists only) ──
  let boardBrowse = null; // active browse scope: { type, id, name, area, routes, genre, gradeMin, gradeMax, minStars }

  function addRouteToList(list, m, after) {
    if (list.items.some(i => i.key === m.key)) return;
    list.items.push({ key: m.key, routeName: m.routeName, gradeLabel: m.gradeLabel, gradeInt: m.gradeInt, genre: m.genre, cragName: m.cragName, area: m.area || '' });
    saveBoard();
    if (!state.routeStats[m.key]) {
      const gen = MC.renderGen;
      enrichRouteStats([m.key]).then(() => {
        if (gen === MC.renderGen && activeList() === list) renderTierArea(list);
      });
    }
    renderTierArea(list);
    if (after) after();
  }

  function renderSearchBox(list) {
    const wrap = $('#mc-pb-search');
    if (!wrap) return;
    if (!listIsStored(list)) { wrap.hidden = true; wrap.innerHTML = ''; boardBrowse = null; return; }
    wrap.hidden = false;
    wrap.innerHTML = `
      <input type="search" class="mc-pb-search-input" placeholder="Search a route, crag or area (e.g. Magic Wood)…" autocomplete="off" />
      <div class="mc-pb-search-results" hidden></div>
      <div class="mc-pb-browse" hidden></div>`;
    const input = wrap.querySelector('.mc-pb-search-input');
    const results = wrap.querySelector('.mc-pb-search-results');
    const browseEl = wrap.querySelector('.mc-pb-browse');

    let timer = null, lastQ = '';
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      lastQ = q;
      if (q.length < 2) { results.hidden = true; results.innerHTML = ''; return; }
      boardBrowse = null; browseEl.hidden = true;
      results.hidden = false;
      results.innerHTML = '<div class="mc-pb-sr-empty">Searching…</div>';
      timer = setTimeout(async () => {
        const matches = await searchAll(q);
        if (lastQ !== q) return;
        results._matches = matches;
        renderSearchResults(results, list);
      }, 300);
    });

    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('.mc-pb-sr');
      if (!btn) return;
      const m = (results._matches || []).find(x => (x.type === 'route' ? x.key : x.id) === btn.dataset.id);
      if (!m) return;
      if (m.type === 'route') {
        if (!btn.disabled) addRouteToList(list, m, () => renderSearchResults(results, list));
        return;
      }
      // crag / area → browse
      btn.disabled = true;
      setStatus(`Loading ${m.name}…`, true);
      boardBrowse = await loadBrowseScope(m.type, m.id, m.name);
      Object.assign(boardBrowse, { genre: 'all', gradeMin: null, gradeMax: null, minStars: 0, nameQuery: '' });
      setStatus('', false);
      results.hidden = true;
      renderBrowse(browseEl, list);
    });

    browseEl.addEventListener('click', (e) => {
      if (e.target.closest('.mc-pb-browse-back')) { boardBrowse = null; browseEl.hidden = true; results.hidden = false; return; }
      const add = e.target.closest('.mc-pb-sr');
      if (add && !add.disabled) {
        const m = (boardBrowse.routes || []).find(x => x.key === add.dataset.id);
        if (m) addRouteToList(list, m, () => renderBrowseResults(browseEl, list));
        return;
      }
      if (e.target.closest('.mc-pb-browse-addall')) {
        const toAdd = filterBrowse(boardBrowse).filter(m => !list.items.some(i => i.key === m.key));
        if (!toAdd.length) return;
        if (toAdd.length > 30 && !confirm(`Add all ${toAdd.length} routes to this list?`)) return;
        for (const m of toAdd) list.items.push({ key: m.key, routeName: m.routeName, gradeLabel: m.gradeLabel, gradeInt: m.gradeInt, genre: m.genre, cragName: m.cragName, area: m.area || '' });
        saveBoard();
        renderTierArea(list);
        renderBrowseResults(browseEl, list);
      }
    });
    browseEl.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-bf]');
      if (!sel || !boardBrowse) return;
      const f = sel.getAttribute('data-bf');
      if (f === 'name') return; // handled live by the input listener
      const v = sel.value;
      if (f === 'genre') boardBrowse.genre = v;
      else if (f === 'min') boardBrowse.gradeMin = v ? +v : null;
      else if (f === 'max') boardBrowse.gradeMax = v ? +v : null;
      else if (f === 'stars') boardBrowse.minStars = v ? +v : 0;
      renderBrowse(browseEl, list);
    });
    browseEl.addEventListener('input', (e) => {
      const nameInput = e.target.closest('.mc-pb-browse-name');
      if (!nameInput || !boardBrowse) return;
      boardBrowse.nameQuery = nameInput.value;
      renderBrowseResults(browseEl, list);
    });

    // Restore an in-progress browse across full re-renders.
    if (boardBrowse) { results.hidden = true; renderBrowse(browseEl, list); }
  }

  function renderSearchResults(results, list) {
    const matches = results._matches || [];
    results.hidden = false;
    if (!matches.length) { results.innerHTML = '<div class="mc-pb-sr-empty">No matches.</div>'; return; }
    const have = new Set(list.items.map(i => i.key));
    results.innerHTML = matches.slice(0, 25).map(m => {
      if (m.type === 'route') {
        const has = have.has(m.key);
        return `<button type="button" class="mc-pb-sr" data-id="${escapeHtml(m.key)}"${has ? ' disabled' : ''}>
          <span class="g">${escapeHtml(m.gradeLabel || '?')}</span>
          <span class="nm">${escapeHtml(m.routeName || '(unnamed)')}</span>
          <span class="cr">${escapeHtml(m.cragName || '')}</span>
          <span class="${has ? 'added' : 'add'}">${has ? 'added' : '+ add'}</span>
        </button>`;
      }
      return `<button type="button" class="mc-pb-sr browse" data-id="${escapeHtml(m.id)}">
        <span class="g kind">${m.type === 'area' ? 'AREA' : 'CRAG'}</span>
        <span class="nm">${escapeHtml(m.name)}</span>
        <span class="cr">${escapeHtml(m.subtitle || '')}</span>
        <span class="add">browse →</span>
      </button>`;
    }).join('');
  }

  function filterBrowse(b) {
    const q = (b.nameQuery || '').trim().toLowerCase();
    return (b.routes || []).filter(it => {
      if (b.genre !== 'all' && it.bucket !== b.genre) return false;
      if (b.gradeMin != null && (!it.gradeInt || it.gradeInt < b.gradeMin)) return false;
      if (b.gradeMax != null && (!it.gradeInt || it.gradeInt > b.gradeMax)) return false;
      if (b.minStars && it.rating < b.minStars) return false;
      if (q && !(it.routeName || '').toLowerCase().includes(q) && !(it.cragName || '').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, c) => (c.rating - a.rating) || (c.gradeInt - a.gradeInt));
  }

  function renderBrowse(browseEl, list) {
    const b = boardBrowse;
    if (!b) { browseEl.hidden = true; return; }
    browseEl.hidden = false;
    const present = new Set(b.routes.map(r => r.bucket));
    const genreOpts = ['all', ...['Boulder', 'Sport', 'Other'].filter(g => present.has(g))];
    const gis = [...new Set(b.routes.map(r => r.gradeInt).filter(g => g > 0))].sort((x, y) => x - y);
    const labelGenre = b.genre === 'Sport' ? 'Sport' : 'Boulder';
    const gradeOpt = (val) => `<option value="">Any</option>` + gis.map(gi => `<option value="${gi}"${val === gi ? ' selected' : ''}>${escapeHtml(gradeLabelExact(gi, labelGenre))}</option>`).join('');
    browseEl.innerHTML = `
      <div class="mc-pb-browse-h">
        <button type="button" class="mc-pb-browse-back">← search</button>
        <strong>${escapeHtml(b.name)}</strong>
        <span class="sub" data-browse-count></span>
        <button type="button" class="mc-pb-browse-addall"></button>
      </div>
      <div class="mc-pb-browse-filters">
        <input type="search" class="mc-pb-browse-name" data-bf="name" placeholder="Filter by name…" autocomplete="off" value="${escapeHtml(b.nameQuery || '')}" />
        <select data-bf="genre">${genreOpts.map(g => `<option value="${g}"${g === b.genre ? ' selected' : ''}>${g === 'all' ? 'All types' : g}</option>`).join('')}</select>
        <span class="lbl">Grade</span>
        <select data-bf="min">${gradeOpt(b.gradeMin)}</select>
        <span class="dash">–</span>
        <select data-bf="max">${gradeOpt(b.gradeMax)}</select>
        <select data-bf="stars">
          <option value="0"${!b.minStars ? ' selected' : ''}>Any rating</option>
          <option value="1"${b.minStars === 1 ? ' selected' : ''}>★ 1+</option>
          <option value="2"${b.minStars === 2 ? ' selected' : ''}>★ 2+</option>
          <option value="3"${b.minStars === 3 ? ' selected' : ''}>★ 3</option>
        </select>
      </div>
      <div class="mc-pb-search-results mc-pb-browse-list" style="margin-top:0;border-radius:0 0 8px 8px;"></div>`;
    renderBrowseResults(browseEl, list);
  }

  // Re-render only the route list + counts (so the name filter keeps focus).
  function renderBrowseResults(browseEl, list) {
    const b = boardBrowse;
    if (!b) return;
    const filtered = filterBrowse(b);
    const have = new Set(list.items.map(i => i.key));
    const shown = filtered.slice(0, 150);
    const countEl = browseEl.querySelector('[data-browse-count]');
    if (countEl) countEl.textContent = `${filtered.length} of ${b.routes.length} routes`;
    const addAll = browseEl.querySelector('.mc-pb-browse-addall');
    if (addAll) addAll.textContent = `+ Add all (${filtered.length})`;
    const listEl = browseEl.querySelector('.mc-pb-browse-list');
    if (!listEl) return;
    listEl.innerHTML = `
      ${shown.length ? shown.map(m => {
        const has = have.has(m.key);
        return `<button type="button" class="mc-pb-sr" data-id="${escapeHtml(m.key)}"${has ? ' disabled' : ''}>
          <span class="g">${escapeHtml(m.gradeLabel || '?')}</span>
          <span class="nm">${escapeHtml(m.routeName || '(unnamed)')}</span>
          <span class="rt">${starsHtml(m.rating)}</span>
          <span class="cr">${escapeHtml(m.cragName || '')}</span>
          <span class="${has ? 'added' : 'add'}">${has ? 'added' : '+ add'}</span>
        </button>`;
      }).join('') : '<div class="mc-pb-sr-empty">No routes match these filters.</div>'}
      ${filtered.length > shown.length ? `<div class="mc-pb-sr-empty">Showing first ${shown.length} — narrow the filters or use “Add all”.</div>` : ''}`;
  }

  // Rebuild the active list's tier + order maps from the DOM after a drag.
  // Hidden (filtered-out) items keep their existing placement.
  function commitBoardFromDom() {
    const list = activeList();
    const tiers = { ...list.tiers };
    const order = { ...list.order };
    $('#mc-pb-list').querySelectorAll('.mc-tl-drop').forEach(zone => {
      const tier = zone.getAttribute('data-tier') || '';
      [...zone.querySelectorAll('.mc-tl-card')].forEach((cardEl, i) => {
        const key = cardEl.dataset.key;
        if (tier) tiers[key] = tier; else delete tiers[key];
        order[key] = i;
      });
    });
    // Only persist when the placement actually changed.
    if (JSON.stringify({ tiers, order }) === JSON.stringify({ tiers: list.tiers, order: list.order })) return;
    list.tiers = tiers;
    list.order = order;
    saveBoard();
  }

  function dragAfterCard(zone, x, y) {
    const cards = [...zone.querySelectorAll('.mc-tl-card:not(.dragging)')];
    let closest = null, best = Infinity, before = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) { best = d; closest = c; before = x < cx; }
    }
    if (!closest) return null;
    return before ? closest : closest.nextElementSibling;
  }

  // ── Export / import shareable list JSON ──
  function exportList(list) {
    // Export the whole list — stored lists in full, live lists as their current
    // filtered view (that's the curated set the user sees).
    const items = listIsStored(list) ? list.items.map(decorateStored) : filterItems(boardItems(), list);
    const out = {
      bettercrags_tierlist: 1,
      username: state.user || '',
      name: list.name,
      exportedAt: Date.now(),
      tiers: TIERS,
      items: items.map(it => ({
        key: it.key,
        routeName: it.routeName,
        gradeLabel: it.gradeLabel,
        gradeInt: it.gradeInt,
        genre: it.bucket,
        rating: it.rating,
        ascents: it.ascents,
        cragName: it.cragName,
        area: it.area,
        tier: list.tiers[it.key] || '',
        order: list.order[it.key] == null ? null : list.order[it.key],
        note: list.notes[it.key] || '',
      })),
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(list.name)}.bettercrags.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importListObject(obj) {
    if (!obj || obj.bettercrags_tierlist == null || !Array.isArray(obj.items)) {
      alert('That doesn\'t look like a BetterCrags tierlist file.');
      return;
    }
    // The file is untrusted JSON: the per-item tier/order/note live on each
    // item in the export format, so lift them into list maps and let
    // sanitizeList validate everything (keys, numbers, tiers).
    const tiers = {}, order = {}, notes = {};
    for (const it of obj.items) {
      if (!it || typeof it !== 'object' || typeof it.key !== 'string') continue;
      const key = it.key.trim();
      if (it.tier) tiers[key] = it.tier;
      if (it.order != null) order[key] = it.order;
      if (it.note) notes[key] = it.note;
    }
    const l = sanitizeList({ name: obj.name || 'Imported list', items: obj.items, tiers, order, notes, imported: true, sourceUser: obj.username || '' });
    if (!l) { alert('That doesn\'t look like a BetterCrags tierlist file.'); return; }
    l.id = bcGenId(); // never trust an id from a file — it must not collide with a local list
    state.board.lists.push(l);
    state.board.activeListId = l.id;
    boardBrowse = null;
    saveBoard();
    renderBoard();
    setStatus(`Imported list "${l.name}"${l.sourceUser ? ` from ${l.sourceUser}` : ''} (${l.items.length} routes).`, false);
  }

  // ── Full backup / restore ──
  // Everything that isn't re-fetchable from thetopo, in one file: every
  // tier-list (live and stored), notes, dismissed suggestions, filter and
  // dark-mode settings. Reloading the unpacked extension from a new folder
  // (or uninstalling) wipes chrome.storage, so this is the user's safety net.
  async function exportBackup() {
    const keys = [BOARD_KEY, PROJECT_SUGGESTIONS_KEY, STORAGE_KEYS.FILTER_STATE, STORAGE_KEYS.DARK_MODE, USERNAME_KEY];
    const stored = await storageGet(keys);
    flushBoardSave();
    const out = {
      bettercrags_backup: 1,
      extensionVersion: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
      exportedAt: new Date().toISOString(),
      username: stored[USERNAME_KEY] || state.user || '',
      board: state.board || stored[BOARD_KEY] || null,
      dismissedProjects: stored[PROJECT_SUGGESTIONS_KEY] || {},
      filterState: stored[STORAGE_KEYS.FILTER_STATE] || null,
      darkMode: !!stored[STORAGE_KEYS.DARK_MODE],
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bettercrags-backup-${out.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const n = out.board && Array.isArray(out.board.lists) ? out.board.lists.length : 0;
    setStatus(`Backup saved (${n} list${n === 1 ? '' : 's'}).`, false);
  }

  // Merge a backup into the current state: lists with a matching id are
  // replaced by the backup's copy, unknown ids are added, local lists the
  // backup doesn't know are kept. Settings are only restored when present.
  async function restoreBackup(obj) {
    if (!obj || obj.bettercrags_backup == null || !obj.board || !Array.isArray(obj.board.lists)) {
      alert('That doesn\'t look like a BetterCrags backup file (expected a "bettercrags_backup" JSON export).');
      return;
    }
    const lists = obj.board.lists.map(sanitizeList).filter(Boolean);
    if (!lists.length) { alert('The backup contains no usable lists.'); return; }
    if (!state.board) await loadBoard();
    const existing = new Map(state.board.lists.map(l => [l.id, l]));
    const replaced = lists.filter(l => existing.has(l.id)).length;
    const added = lists.length - replaced;
    const when = obj.exportedAt ? ` from ${String(obj.exportedAt).slice(0, 10)}` : '';
    if (!confirm(`Restore backup${when}?\n\n• ${added} list${added === 1 ? '' : 's'} will be added\n• ${replaced} list${replaced === 1 ? '' : 's'} with the same id will be replaced by the backup's version\n• other local lists are kept\n\nThis can't be undone (take a Backup first if unsure).`)) return;

    for (const l of lists) {
      const idx = state.board.lists.findIndex(x => x.id === l.id);
      if (idx >= 0) state.board.lists[idx] = l; else state.board.lists.push(l);
    }
    if (typeof obj.board.activeListId === 'string' && state.board.lists.some(l => l.id === obj.board.activeListId)) {
      state.board.activeListId = obj.board.activeListId;
    }
    const writes = {};
    if (obj.dismissedProjects && typeof obj.dismissedProjects === 'object') {
      const merged = { ...state.dismissedProjectsByUser };
      for (const [user, keys] of Object.entries(obj.dismissedProjects)) {
        if (!Array.isArray(keys)) continue;
        merged[user] = [...new Set([...(merged[user] || []), ...keys.filter(k => typeof k === 'string')])];
      }
      state.dismissedProjectsByUser = merged;
      if (state.user) state.dismissedProjectKeys = new Set(merged[state.user] || []);
      writes[PROJECT_SUGGESTIONS_KEY] = merged;
    }
    if (obj.filterState && typeof obj.filterState === 'object') writes[STORAGE_KEYS.FILTER_STATE] = obj.filterState;
    if (typeof obj.darkMode === 'boolean') writes[STORAGE_KEYS.DARK_MODE] = obj.darkMode;
    if (!state.user && typeof obj.username === 'string' && obj.username.trim()) {
      writes[USERNAME_KEY] = obj.username.trim();
      $('#mc-user-input').value = obj.username.trim();
    }
    boardBrowse = null;
    writeBoard();
    const ok = Object.keys(writes).length ? await storageSet(writes) : true;
    renderBoard();
    renderProjectSuggestions();
    setStatus(ok
      ? `Restored ${lists.length} list${lists.length === 1 ? '' : 's'} (${added} added, ${replaced} replaced).`
      : 'Lists restored, but some settings could not be saved — see the warning above.', false, !ok);
  }

  let boardWired = false;
  function wireBoard() {
    if (boardWired) return;
    const root = $('#mc-pb-list');
    if (!root) return;
    boardWired = true;

    // Cross-tab sync: re-render when another mycrags tab saves the board.
    // The echo of this tab's own save is matched against the snapshot taken at
    // write time (not live state.board, which may already hold a newer edit).
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[BOARD_KEY]) return;
        const next = changes[BOARD_KEY].newValue;
        if (!next || !Array.isArray(next.lists)) return;
        try {
          const nextStr = JSON.stringify(next);
          if (nextStr === lastBoardWrite) return;
          if (nextStr === JSON.stringify(state.board)) return;
        } catch {}
        state.board = next;
        boardBrowse = null;
        renderBoard();
      });
    } catch {}

    let dragDropped = false;
    root.addEventListener('dragstart', (e) => {
      const cardEl = e.target.closest('.mc-tl-card');
      if (!cardEl || e.target.closest('textarea, a, button')) { e.preventDefault(); return; }
      dragDropped = false;
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', cardEl.dataset.key); } catch {}
    });
    root.addEventListener('dragover', (e) => {
      const dragging = root.querySelector('.mc-tl-card.dragging');
      if (!dragging) return;
      const zone = e.target.closest('.mc-tl-drop');
      if (!zone) return;
      e.preventDefault();
      const after = dragAfterCard(zone, e.clientX, e.clientY);
      if (after == null) zone.appendChild(dragging);
      else zone.insertBefore(dragging, after);
    });
    root.addEventListener('drop', (e) => { e.preventDefault(); dragDropped = true; });
    root.addEventListener('dragend', () => {
      const dragging = root.querySelector('.mc-tl-card.dragging');
      if (dragging) dragging.classList.remove('dragging');
      // Only commit on an actual drop — a cancelled drag (Esc / dropped outside)
      // re-renders from saved state instead, undoing the live DOM shuffle.
      if (dragDropped) commitBoardFromDom();
      dragDropped = false;
      renderTierArea(activeList());
    });

    root.addEventListener('click', (e) => {
      const rm = e.target.closest('.rm');
      if (rm) {
        const cardEl = rm.closest('.mc-tl-card');
        const key = cardEl && cardEl.dataset.key;
        const list = activeList();
        if (key && listIsStored(list)) {
          list.items = list.items.filter(i => i.key !== key);
          delete list.tiers[key]; delete list.order[key]; delete list.notes[key];
          saveBoard();
          renderTierArea(list);
        }
        return;
      }
      const nb = e.target.closest('.nb');
      if (!nb) return;
      const cardEl = nb.closest('.mc-tl-card');
      const nt = cardEl.querySelector('.nt');
      nt.hidden = !nt.hidden;
      if (!nt.hidden) { const ta = nt.querySelector('textarea'); autoGrow(ta); ta.focus(); }
    });
    root.addEventListener('input', (e) => {
      const ta = e.target.closest('.nt textarea');
      if (!ta) return;
      const cardEl = ta.closest('.mc-tl-card');
      const key = cardEl && cardEl.dataset.key;
      if (!key) return;
      const list = activeList();
      if (ta.value) list.notes[key] = ta.value; else delete list.notes[key];
      cardEl.querySelector('.nb').classList.toggle('has', !!ta.value);
      autoGrow(ta);
      saveBoard();
    });
    // Disable dragging while a note is being edited.
    root.addEventListener('focusin', (e) => {
      const cardEl = e.target.closest('.mc-tl-card');
      if (cardEl && e.target.closest('textarea')) cardEl.setAttribute('draggable', 'false');
    });
    root.addEventListener('focusout', (e) => {
      const cardEl = e.target.closest('.mc-tl-card');
      if (cardEl) cardEl.setAttribute('draggable', 'true');
    });

    const fileInput = $('#mc-pb-import');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { importListObject(JSON.parse(reader.result)); }
          catch { alert('Could not read that file as JSON.'); }
          fileInput.value = '';
        };
        reader.readAsText(file);
      });
    }
  }

  // Exposed for the unit tests in test/ (not used by other files).
  Object.assign(MC, { filterItems, listIsStored, defaultBoard, starsHtml, importListObject, exportList });

  Object.assign(MC, { bucketOf, exportBackup, loadBoard, renderBoard, restoreBackup, wireBoard });
})();

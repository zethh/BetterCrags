// BetterCrags — My Crags dashboard: tab navigation, load orchestration and
// boot. Loaded last by mycrags.html.
(() => {
  'use strict';
  // One namespace object shared by every mycrags/*.js file (see core.js).
  const MC = (window.BCMyCrags = window.BCMyCrags || {});
  const { $, ASCENTS_CACHE_KEY, CACHE_KEYS, CACHE_TTL_MS, CRAG_TOTALS_KEY, USERNAME_KEY, aggregate, clearAlert, enrichDoneFeatures, enrichTodoStats, exportBackup, fetchUserList, fillMissingCragTotals, loadBoard, loadDismissedProjects, renderActivity, renderBoard, renderCrags, renderFirsts, renderNext, renderProfile, renderProjectSuggestions, renderSpotlight, renderStats, renderSummary, restoreBackup, setStatus, state, storageGet, storageRemove, storageSet, updateStorageInfo, wireBoard } = MC;

  // ── Tab navigation (Dashboard / To-do tierlists) ──
  function initTabs() {
    const tabs = document.querySelectorAll('.mc-tab');
    if (!tabs.length) return;
    let stored = 'dashboard';
    try { stored = localStorage.getItem('bc_mc_tab') || 'dashboard'; } catch {}
    const activate = (name) => {
      tabs.forEach(t => { t.dataset.active = t.dataset.tab === name ? '1' : '0'; });
      document.querySelectorAll('.mc-tab-panel').forEach(p => { p.hidden = p.id !== `mc-tab-${name}`; });
      try { localStorage.setItem('bc_mc_tab', name); } catch {}
    };
    tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));
    activate([...tabs].some(t => t.dataset.tab === stored) ? stored : 'dashboard');
  }


  function renderAll() {
    aggregate();
    renderProfile();
    renderSummary();
    renderActivity();
    renderProjectSuggestions();
    renderNext();
    renderBoard();
    renderCrags();
    renderSpotlight();
    renderFirsts();
    renderStats();
    updateCacheInfo();
    updateStorageInfo();
  }

  function updateCacheInfo() {
    const knownTotals = [...state.cragsAggregated.values()].filter(c => c.total != null && c.total > 0).length;
    const unknownTotals = [...state.cragsAggregated.values()].filter(c => c.total == null || c.total <= 0).length;
    $('#mc-cache-info').textContent = `Cache: ${knownTotals} crags with totals, ${unknownTotals} unknown · click Refresh to re-fetch your ascents.`;
  }


  // ── Boot ──────────────────────────────────────────────────────────
  async function ensureUsername() {
    const stored = await storageGet(USERNAME_KEY);
    const input = $('#mc-user-input');
    if (stored) {
      input.value = stored;
      return stored;
    }
    return null;
  }

  async function loadAscents(useCache, user) {
    const cached = await storageGet(ASCENTS_CACHE_KEY);
    const now = Date.now();
    if (useCache && cached && cached.user === user && (now - (cached.t || 0)) < CACHE_TTL_MS) {
      state.done = cached.done || [];
      state.todo = cached.todo || [];
      setStatus(`Loaded ${state.done.length} sends and ${state.todo.length} todos from cache.`, false);
      return true; // served from cache — caller may want a background freshness check
    }
    setStatus('Fetching your ascents…', true);
    const [done, todo] = await Promise.all([
      fetchUserList(user, 'done', (t) => setStatus(t, true)),
      fetchUserList(user, 'todo', (t) => setStatus(t, true)),
    ]);
    state.done = done;
    state.todo = todo;
    await storageSet({ [ASCENTS_CACHE_KEY]: { user, t: Date.now(), done, todo } });
    setStatus(`Fetched ${done.length} sends and ${todo.length} todos.`, false);
    return false;
  }

  // After a cached load, quietly re-fetch the todo list so todos added on
  // thetopo since the cache was written show up (in each matching live list's
  // Unranked pool) without a manual Refresh. Todos-only keeps it cheap. Skips
  // the re-render if you're mid-interaction in the tierlist.
  async function backgroundRefreshTodos(user) {
    const gen = MC.renderGen;
    let todo;
    try { todo = await fetchUserList(user, 'todo'); } catch { return; }
    // A newer load (e.g. a manual Refresh) started while we were fetching —
    // its data is fresher, so discard this result instead of painting over it.
    if (gen !== MC.renderGen) return;
    const before = new Set(state.todo.map(r => r.key));
    const changed = todo.length !== state.todo.length || todo.some(r => !before.has(r.key));
    if (!changed) return;
    state.todo = todo;
    const cached = (await storageGet(ASCENTS_CACHE_KEY)) || {};
    await storageSet({ [ASCENTS_CACHE_KEY]: { user, t: cached.t || Date.now(), done: state.done, todo } });
    aggregate();
    await fillMissingCragTotals();
    await enrichDoneFeatures(false);
    await enrichTodoStats(false);
    if (gen !== MC.renderGen) return;
    // Don't yank the UI out from under an active edit/drag/search.
    const card = $('#mc-pb-card');
    if (card && card.contains(document.activeElement)) { renderActivity(); renderNext(); renderCrags(); return; }
    renderAll();
  }

  async function loadAllForUser(user, useCache) {
    const gen = ++MC.renderGen;
    state.user = user;
    state.cragTotals = (await storageGet(CRAG_TOTALS_KEY)) || {};
    await loadBoard();
    await loadDismissedProjects(user);
    if (gen !== MC.renderGen) return;
    let servedFromCache = false;
    try {
      servedFromCache = await loadAscents(useCache, user);
    } catch (err) {
      if (gen !== MC.renderGen) return;
      setStatus(`Couldn't fetch ascents: ${err && err.message || err}. Make sure you're logged in to thetopo.com.`, false, true);
      return;
    }
    if (gen !== MC.renderGen) return;
    if (!state.done.length && !state.todo.length) {
      setStatus(`No ascents or todos found for "${user}". Either the username is wrong or you're not logged in to thetopo.com in this browser.`, false, true);
      renderAll();
      return;
    }
    aggregate();
    renderProfile();
    renderSummary();
    renderNext();
    renderProjectSuggestions();
    renderCrags();
    renderFirsts();
    renderStats();
    updateCacheInfo();

    await fillMissingCragTotals();
    await enrichDoneFeatures(!useCache);
    await enrichTodoStats(!useCache);
    if (gen !== MC.renderGen) return;
    renderAll();
    setStatus(`Showing ${state.done.length} sends · ${state.todo.length} todos · ${state.cragsAggregated.size} crags.`, false);

    // Quietly pick up todos added on thetopo since the cache was written.
    if (servedFromCache) {
      backgroundRefreshTodos(user).catch(err =>
        console.warn('BetterCrags: background todo refresh failed:', err));
    }
  }

  async function init() {
    // Wire UI
    let refreshing = false;
    $('#mc-refresh').addEventListener('click', async () => {
      if (refreshing) return; // in-flight guard: a second click mustn't start a concurrent refresh
      const user = ($('#mc-user-input').value || '').trim();
      if (!user) { setStatus('Enter a username first.', false, true); return; }
      refreshing = true;
      const btn = $('#mc-refresh');
      btn.disabled = true;
      try {
        await storageSet({ [USERNAME_KEY]: user });
        await loadAllForUser(user, false);
      } catch (err) {
        setStatus(`Refresh failed: ${err && err.message || err}`, false, true);
      } finally {
        refreshing = false;
        btn.disabled = false;
      }
    });
    $('#mc-clear').addEventListener('click', async () => {
      // Caches only — the project board (priorities/tiers/notes) is personal
      // data and deliberately survives a cache clear.
      const ok = await storageRemove(CACHE_KEYS);
      if (!ok) { setStatus('Couldn\'t clear the cache — see the browser console.', false, true); return; }
      state.cragTotals = {};
      state.routeStats = {};
      state.routeFeatures = {};
      state.areaRoutes = {};
      state.enrichTried.clear();
      clearAlert('storage-cache');
      setStatus('Cache cleared. Hit Refresh to re-fetch.', false);
      updateCacheInfo();
      updateStorageInfo();
    });
    $('#mc-backup').addEventListener('click', () => exportBackup());
    $('#mc-restore').addEventListener('click', () => $('#mc-restore-file').click());
    $('#mc-restore-file').addEventListener('change', () => {
      const input = $('#mc-restore-file');
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try { await restoreBackup(JSON.parse(reader.result)); }
        catch (err) { alert(`Couldn't read that backup: ${err && err.message || err}`); }
        input.value = '';
      };
      reader.readAsText(file);
    });
    wireBoard();
    initTabs();
    $('#mc-user-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#mc-refresh').click();
    });
    $('#mc-crag-search').addEventListener('input', () => renderCrags());
    $('#mc-hide-zero-done').addEventListener('change', () => renderCrags());
    $('#mc-only-todo').addEventListener('change', () => renderCrags());
    $('#mc-known-totals').addEventListener('change', () => renderCrags());
    $('#mc-completion-range').addEventListener('change', (e) => {
      state.completionGradeMax = e.target.value;
      renderCrags();
    });
    document.querySelectorAll('#mc-crags-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (state.cragSort.col === col) {
          state.cragSort.dir = state.cragSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.cragSort.col = col;
          state.cragSort.dir = col === 'name' ? 'asc' : 'desc';
        }
        renderCrags();
      });
    });

    const user = await ensureUsername();
    if (!user) {
      setStatus(`No username on file yet. Visit any thetopo.com area routelist while logged in, or type your username and click Refresh.`, false);
      return;
    }
    setStatus(`Loading data for ${user}…`, true);
    await loadAllForUser(user, true);
  }

  init().catch(err => {
    console.error('BetterCrags: init failed:', err);
    try { setStatus(`Something went wrong: ${err && err.message || err}`, false, true); } catch {}
  });
})();

// BetterCrags — My Crags dashboard: shared state, status line, alerts.
// Loaded first by mycrags.html; the other mycrags/*.js files hang their
// functions off window.BCMyCrags and pull what they need from it.
(() => {
  'use strict';
  // One namespace object shared by every mycrags/*.js file (see core.js).
  const MC = (window.BCMyCrags = window.BCMyCrags || {});

  // Grade tables, feature tags, storage wrappers + list shapes live in
  // shared.js (loaded by mycrags.html first).
  const {
    FONT_GRADES, FRENCH_GRADES, escapeHtml,
    FEATURE_GROUPS, FEATURE_KEYS, STORAGE_KEYS, CACHE_KEYS,
    storageGet, storageSet, storageRemove, storageBytesInUse, onStorageError, formatBytes,
    gradeLabelExact, parseGradeToken, findGradeInText,
    routeKeyOf, readRouteListStore, maxPageInPager, looksLikeLoginPage,
    TIERS, bcGenId, makeList, makeCustomList, sanitizeList,
  } = window.BCShared;

  const USERNAME_KEY = STORAGE_KEYS.USERNAME;
  const CRAG_TOTALS_KEY = STORAGE_KEYS.CRAG_TOTALS;
  const ASCENTS_CACHE_KEY = STORAGE_KEYS.ASCENTS_CACHE;
  const CRAG_FETCH_CACHE_KEY = STORAGE_KEYS.CRAG_FETCHED;
  const ROUTE_STATS_KEY = STORAGE_KEYS.ROUTE_STATS;
  const ROUTE_FEATURES_KEY = STORAGE_KEYS.ROUTE_FEATURES;
  const PROJECT_SUGGESTIONS_KEY = STORAGE_KEYS.PROJECT_SUGGESTIONS;
  const BOARD_KEY = STORAGE_KEYS.BOARD;
  const BOARD_KEY_V1 = STORAGE_KEYS.BOARD_V1;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for ascents (cheap to refetch)
  const CRAG_PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const ROUTE_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // ── State & rendering ─────────────────────────────────────────────
  const state = {
    user: '',
    done: [],         // [{key, cragId, ...}]
    todo: [],         // [{key, cragId, ...}]
    cragTotals: {},   // cragId → { name, total, byGenre, byGrade, t }
    cragsAggregated: new Map(), // cragId → aggregated stats
    activeGenreNext: 'all',
    activeAreaNext: 'all',
    activeAreaProjects: 'all',
    activeGenreProjects: 'all',
    dismissedProjectKeys: new Set(),
    dismissedProjectsByUser: {},
    activeGenreCrags: 'all',
    cragSort: { col: 'todo', dir: 'desc' },
    activeYear: null,     // 'all' or 'YYYY'
    compareYear: null,    // 'YYYY' to compare against, or null
    selectedMonth: null,  // 1..12 or null
    activeGenreMonth: 'all', // 'all' | 'Boulder' | 'Sport' | 'Other'
    profileFromYear: 'all',
    profileToYear: 'all',
    completionGradeMax: 'all',
    selectedCragId: null, // crag spotlight
    routeStats: {},       // routeKey → { rating, ascents, gradeInt, genre }
    routeFeatures: {},    // routeKey → { crimpers: true, ... }
    areaRoutes: {},       // area id → full RouteList routes (session-only discovery pool)
    enrichTried: new Set(), // route keys we've already tried to enrich this session
    board: null,          // tier-list board (loaded from storage)
  };

  // Render-generation token: bumped on every user-triggered (re)load so slower
  // async paths from an earlier trigger can detect they're stale and not paint
  // old data over newer state.
  MC.renderGen = 0;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (sel) => document.querySelector(sel);
  const statusEl = $('#mc-status');
  const statusTextEl = $('#mc-status-text');
  const spinnerEl = $('#mc-spinner');

  function setStatus(text, busy, isError) {
    statusTextEl.textContent = text || '';
    statusTextEl.classList.toggle('error', !!isError);
    spinnerEl.hidden = !busy;
  }

  function hideStatus() {
    statusEl.hidden = true;
  }

  function showStatus() {
    statusEl.hidden = false;
  }

  // ── Alerts: persistent, dismissible problem banners ──
  // Unlike the status line (which the next progress message overwrites),
  // these stay until dismissed — for failed saves and "thetopo changed"
  // notices the user must actually see. One banner per id; re-showing the
  // same id replaces its text.
  function showAlert(id, text, kind) {
    const host = $('#mc-alerts');
    if (!host) return;
    let el = host.querySelector(`[data-alert-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.alertId = id;
      el.setAttribute('role', 'alert');
      el.innerHTML = '<div class="mc-alert-text"></div><button type="button" class="mc-alert-close" aria-label="Dismiss">×</button>';
      el.querySelector('.mc-alert-close').addEventListener('click', () => el.remove());
      host.appendChild(el);
    }
    el.className = `mc-alert ${kind || 'warn'}`;
    el.querySelector('.mc-alert-text').textContent = text;
  }
  function clearAlert(id) {
    const el = $('#mc-alerts') && $('#mc-alerts').querySelector(`[data-alert-id="${CSS.escape(id)}"]`);
    if (el) el.remove();
  }
  // A thetopo page didn't look the way we expect. Shown once per problem
  // per page-load so a broken area doesn't spam a banner per fetch.
  const siteProblemsNoted = new Set();
  function noteSiteProblem(id, text) {
    if (siteProblemsNoted.has(id)) return;
    siteProblemsNoted.add(id);
    showAlert(`site-${id}`, text, 'warn');
  }

  // Surface failed writes. The board is the one thing that isn't re-fetchable,
  // so a failed board save gets the loudest wording.
  onStorageError((err) => {
    if (err.op === 'get') return; // reads fall back to defaults; nothing lost
    const personal = err.keys.some(k => k === BOARD_KEY || k === PROJECT_SUGGESTIONS_KEY || k === USERNAME_KEY);
    if (personal) {
      showAlert('storage-personal', `Couldn't save your tier-lists (${err.message}). Your latest edits are NOT saved — use Backup to export them now, then try "Clear cache" to free space.`, 'error');
    } else {
      showAlert('storage-cache', `Couldn't write cached crag/route data (${err.message}). The dashboard still works, but will re-fetch next time. Try "Clear cache" if this keeps happening.`, 'warn');
    }
    updateStorageInfo();
  });

  // Footer line: how much of chrome.storage.local we're using. Mostly for
  // diagnosing "Clear cache" needs; the manifest requests unlimitedStorage so
  // there's no hard cap, but a multi-MB store is worth knowing about.
  async function updateStorageInfo() {
    const el = $('#mc-storage-info');
    if (!el) return;
    const [total, board] = await Promise.all([storageBytesInUse(), storageBytesInUse([BOARD_KEY])]);
    if (total == null) { el.textContent = ''; return; }
    el.textContent = `Storage: ${formatBytes(total)} used (lists ${formatBytes(board)}, caches ${formatBytes(Math.max(0, total - (board || 0)))}).`;
  }


  Object.assign(MC, { $, ASCENTS_CACHE_KEY, BOARD_KEY, BOARD_KEY_V1, CACHE_KEYS, CACHE_TTL_MS, CRAG_FETCH_CACHE_KEY, CRAG_PAGE_TTL_MS, CRAG_TOTALS_KEY, FEATURE_GROUPS, FEATURE_KEYS, FONT_GRADES, FRENCH_GRADES, MONTHS, PROJECT_SUGGESTIONS_KEY, ROUTE_FEATURES_KEY, ROUTE_STATS_KEY, ROUTE_STATS_TTL_MS, STORAGE_KEYS, TIERS, USERNAME_KEY, bcGenId, clearAlert, escapeHtml, findGradeInText, gradeLabelExact, looksLikeLoginPage, makeCustomList, makeList, maxPageInPager, noteSiteProblem, parseGradeToken, readRouteListStore, routeKeyOf, sanitizeList, setStatus, state, storageGet, storageRemove, storageSet, updateStorageInfo });
})();

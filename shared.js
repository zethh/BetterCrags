// BetterCrags — helpers shared by content.js (routelist content script),
// routepage.js (single-route pages) and mycrags.js (dashboard page).
// Must be loaded before each consumer; exposes window.BCShared.
(() => {
  'use strict';

  // Empirically derived from thetopo's data store (grade_int → displayed label).
  // Step size is +50 per sub-grade. 6A starts at 400.
  const FONT_GRADES = [
    [100, '3'], [200, '4'], [300, '5'], [350, '5+'],
    [400, '6A'], [450, '6A+'], [500, '6B'], [550, '6B+'],
    [600, '6C'], [650, '6C+'],
    [700, '7A'], [750, '7A+'], [800, '7B'], [850, '7B+'],
    [900, '7C'], [950, '7C+'],
    [1000, '8A'], [1050, '8A+'], [1100, '8B'], [1150, '8B+'],
    [1200, '8C'], [1250, '8C+'],
    [1300, '9A'], [1350, '9A+'], [1400, '9B'], [1450, '9B+'],
    [1500, '9C'],
  ];
  // French (sport) scale, aligned to the same grade_int values.
  const FRENCH_GRADES = [
    [100, '3'], [200, '4a'], [300, '4c'], [350, '5a'],
    [400, '5c'], [450, '6a'], [500, '6a+'], [550, '6b'],
    [600, '6b+'], [650, '6c'],
    [700, '6c+'], [750, '7a'], [800, '7a+'], [850, '7b'],
    [900, '7b+'], [950, '7c'],
    [1000, '7c+'], [1050, '8a'], [1100, '8a+'], [1150, '8b'],
    [1200, '8b+'], [1250, '8c'],
    [1300, '8c+'], [1350, '9a'], [1400, '9a+'], [1450, '9b'],
    [1500, '9c'],
  ];

  const FONT_LABEL_TO_INT = new Map(FONT_GRADES.map(([v, l]) => [l, v]));
  const FRENCH_LABEL_TO_INT = new Map(FRENCH_GRADES.map(([v, l]) => [l, v]));
  const FONT_INT_TO_LABEL = new Map(FONT_GRADES.map(([v, l]) => [v, l]));
  const FRENCH_INT_TO_LABEL = new Map(FRENCH_GRADES.map(([v, l]) => [v, l]));

  // Route feature tags, in the order thetopo renders them on a route row.
  // Single source of truth for the routelist filter pills, the dashboard's
  // feature profile and the "suggested projects" affinity.
  const FEATURE_TAGS = [
    ['crimpers', 'Crimps'],
    ['slopers', 'Slopers'],
    ['jugs', 'Jugs'],
    ['fingery', 'Fingery'],
    ['pockets', 'Pockets'],
    ['powerful', 'Powerful'],
    ['dyno', 'Dyno'],
    ['endurance', 'Endurance'],
    ['technical', 'Technical'],
    ['mental', 'Mental'],
    ['dangerous', 'Dangerous'],
    ['slab', 'Slab'],
    ['vertical', 'Vertical'],
    ['overhang', 'Overhang'],
    ['roof', 'Roof'],
    ['traverse', 'Traverse'],
    ['sitstart', 'Sit start'],
    ['topslasthold', 'Top/last hold'],
    ['crack', 'Crack'],
    ['tufas', 'Tufas'],
    ['tradgear_required', 'Trad gear'],
  ];
  const FEATURE_LABELS = Object.fromEntries(FEATURE_TAGS);
  // Display groupings: [groupLabel, [[key, label], …]].
  const FEATURE_GROUP_KEYS = [
    ['Hold type', ['crimpers', 'slopers', 'jugs', 'pockets', 'tufas', 'crack']],
    ['Wall angle', ['roof', 'overhang', 'vertical', 'slab']],
    ['Style', ['fingery', 'powerful', 'dyno', 'endurance', 'technical', 'mental', 'traverse']],
    ['Other', ['sitstart', 'topslasthold', 'tradgear_required', 'dangerous']],
  ];
  const FEATURE_GROUPS = FEATURE_GROUP_KEYS.map(([label, keys]) => [label, keys.map(k => [k, FEATURE_LABELS[k]])]);
  const FEATURE_KEYS = FEATURE_TAGS.map(([k]) => k);

  // Every chrome.storage.local key the extension writes, in one place.
  // CACHE_KEYS are throwaway (re-fetchable) and are what "Clear cache" wipes;
  // everything else is personal data (lists, settings) and survives a clear.
  const STORAGE_KEYS = {
    USERNAME: 'bc_username_v1',
    FILTER_STATE: 'bc_filter_state_v1',
    DARK_MODE: 'bc_dark_mode_v1',
    BOARD: 'bc_project_board_v2',          // tier-list board: named lists + notes
    BOARD_V1: 'bc_project_board_v1',       // legacy single-list board (migrated on load)
    PROJECT_SUGGESTIONS: 'bc_project_suggestions_v1', // user → dismissed route keys
    CRAG_TOTALS: 'bc_crag_totals_v1',
    ASCENTS_CACHE: 'bc_mycrags_ascents_v1',
    CRAG_FETCHED: 'bc_mycrags_crag_fetched_v4', // v4: capture area param_id for routelist fetches
    ROUTE_STATS: 'bc_route_stats_v1',      // routeKey → { rating, ascents, gradeInt, genre }
    ROUTE_FEATURES: 'bc_route_features_v2', // routeKey → { crimpers, jugs, ... }
    META_CACHE: 'bc_meta_cache_v1',        // routeId → { video, comment, t }
  };
  const CACHE_KEYS = [
    STORAGE_KEYS.CRAG_TOTALS, STORAGE_KEYS.ASCENTS_CACHE, STORAGE_KEYS.CRAG_FETCHED,
    STORAGE_KEYS.ROUTE_STATS, STORAGE_KEYS.ROUTE_FEATURES, STORAGE_KEYS.META_CACHE,
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── chrome.storage.local wrappers ───────────────────────────────────
  // Promise-based, never throw. A failed write (quota, extension reloaded
  // underneath the page, …) resolves `false` and notifies onStorageError
  // listeners so the UI can tell the user instead of silently dropping data.
  const storageErrorListeners = new Set();
  function onStorageError(fn) { storageErrorListeners.add(fn); return () => storageErrorListeners.delete(fn); }
  function reportStorageError(op, keys, message) {
    const err = { op, keys: Array.isArray(keys) ? keys : [keys], message: message || 'unknown error' };
    console.warn(`[BetterCrags] storage.${op} failed for ${err.keys.join(', ')}: ${err.message}`);
    for (const fn of storageErrorListeners) { try { fn(err); } catch {} }
  }
  function lastErrorMessage() {
    try { return chrome.runtime.lastError && chrome.runtime.lastError.message; } catch { return null; }
  }
  // Read one key → its value (or null), or an array of keys → { key: value }.
  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (o) => {
          const msg = lastErrorMessage();
          if (msg) { reportStorageError('get', keys, msg); resolve(Array.isArray(keys) ? {} : null); return; }
          if (Array.isArray(keys)) resolve(o || {});
          else resolve((o && o[keys]) ?? null);
        });
      } catch (err) {
        reportStorageError('get', keys, err && err.message);
        resolve(Array.isArray(keys) ? {} : null);
      }
    });
  }
  // Write { key: value, … }. Resolves true on success, false on failure.
  function storageSet(obj) {
    const keys = Object.keys(obj);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => {
          const msg = lastErrorMessage();
          if (msg) { reportStorageError('set', keys, msg); resolve(false); return; }
          resolve(true);
        });
      } catch (err) {
        reportStorageError('set', keys, err && err.message);
        resolve(false);
      }
    });
  }
  function storageRemove(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => {
          const msg = lastErrorMessage();
          if (msg) { reportStorageError('remove', keys, msg); resolve(false); return; }
          resolve(true);
        });
      } catch (err) {
        reportStorageError('remove', keys, err && err.message);
        resolve(false);
      }
    });
  }
  // Bytes used by the given keys (or everything when omitted); null if the
  // API isn't available.
  function storageBytesInUse(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.getBytesInUse(keys == null ? null : keys, (n) => {
          resolve(lastErrorMessage() ? null : (typeof n === 'number' ? n : null));
        });
      } catch { resolve(null); }
    });
  }
  function formatBytes(n) {
    if (n == null || !isFinite(n)) return '?';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── Route helpers ──────────────────────────────────────────────────
  // Canonical "cragSlug/routeSlug" key used everywhere a route is stored.
  function routeKeyOf(route) {
    return `${(route && route.crag_param_id) || ''}/${(route && route.param_id) || ''}`;
  }
  // thetopo embeds the full route list of an area as JSON in a script tag.
  // Returns the parsed store (or null when the tag is missing / unparsable).
  function readRouteListStore(doc) {
    const tag = doc && doc.querySelector('script[data-component-name="RouteList"]');
    if (!tag) return null;
    try { return JSON.parse(tag.textContent); } catch { return null; }
  }
  // Highest page number linked from thetopo's pager (0 when unpaginated).
  function maxPageInPager(doc) {
    const pager = doc.querySelector('#table-pager, .pagination, nav[aria-label="Pager"]');
    if (!pager) return 0;
    let mx = 0;
    for (const a of pager.querySelectorAll('a[data-page], a[href]')) {
      const dp = a.getAttribute('data-page');
      if (dp != null) {
        const p = +dp;
        if (!isNaN(p)) mx = Math.max(mx, p);
        continue;
      }
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]page=(\d+)/);
      if (m) mx = Math.max(mx, +m[1]);
    }
    return mx;
  }
  // A thetopo page that is really the login form (what you get for
  // /climbers/<you>/ascents when logged out).
  function looksLikeLoginPage(doc) {
    return !!(doc && doc.querySelector('input[type="password"], form[action*="sign_in"], form[action*="/login"]'));
  }

  // grade_int → nearest displayed label (Font for boulder, French otherwise).
  function gradeLabelFor(gi, genre) {
    const table = genre === 'Boulder' ? FONT_GRADES : FRENCH_GRADES;
    let best = String(gi), bestD = Infinity;
    for (const [v, l] of table) {
      const d = Math.abs(v - gi);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  // grade_int → exact displayed label; falls back to the number itself when
  // the value isn't on the table (unlike gradeLabelFor, which snaps to nearest).
  function gradeLabelExact(gi, genre) {
    const map = genre === 'Boulder' ? FONT_INT_TO_LABEL : FRENCH_INT_TO_LABEL;
    return map.get(gi) || String(gi);
  }

  // Displayed label → grade_int, using the genre's table (exact match, then
  // case-insensitive). Returns 0 when the label isn't recognized.
  function gradeIntFromLabel(label, genre) {
    if (!label) return 0;
    const table = genre === 'Boulder' ? FONT_GRADES : FRENCH_GRADES;
    for (const [v, l] of table) if (l === label) return v;
    const li = String(label).toLowerCase();
    for (const [v, l] of table) if (l.toLowerCase() === li) return v;
    return 0;
  }

  // Parse a bare grade token ("7A+", "6b", "5+"). Font first (uppercase
  // letter ⇒ boulder), then French; bare numbers are genre-unknown.
  // Returns { gi, genre, label } or null.
  function parseGradeToken(token) {
    if (!token) return null;
    const t = String(token).trim().replace(/\s+/g, '');
    const fontMatch = t.match(/^([3-9])([A-D])?(\+)?$/);
    if (fontMatch && fontMatch[2]) {
      const label = (fontMatch[1] + fontMatch[2] + (fontMatch[3] || '')).toUpperCase();
      const gi = FONT_LABEL_TO_INT.get(label);
      if (gi) return { gi, genre: 'Boulder', label };
    }
    const frenchMatch = t.match(/^([3-9])([a-c])(\+)?$/);
    if (frenchMatch) {
      const label = (frenchMatch[1] + frenchMatch[2] + (frenchMatch[3] || '')).toLowerCase();
      const gi = FRENCH_LABEL_TO_INT.get(label);
      if (gi) return { gi, genre: 'Sport', label };
    }
    const numMatch = t.match(/^([3-5])(\+)?$/);
    if (numMatch) {
      const label = numMatch[1] + (numMatch[2] || '');
      const gi = FONT_LABEL_TO_INT.get(label) || FRENCH_LABEL_TO_INT.get(label);
      if (gi) return { gi, genre: '', label };
    }
    return null;
  }

  // First recognisable grade token inside longer text (an ascent row, say).
  // NB: a trailing \b can never sit after a "+" (a "+" before whitespace/end has
  // no word boundary), so \b would make the engine backtrack and silently drop the
  // "+", folding every plus-grade into its base (7A+ → 7A). Use a no-alnum lookahead.
  const GRADE_TOKEN_RE = /\b\d[A-Da-c]\+?(?![A-Za-z0-9])|\b\d\+?(?![A-Za-z0-9])/g;
  function findGradeInText(text) {
    if (!text) return null;
    const candidates = String(text).match(GRADE_TOKEN_RE) || [];
    for (const c of candidates) {
      const parsed = parseGradeToken(c);
      if (parsed) return parsed;
    }
    return null;
  }

  // ── Custom tier-list board (shared store with the My Crags dashboard) ──
  // Mirrors mycrags.js's storage shape (bc_project_board_v2):
  //   { version: 2, lists: [ {id,name,…,items:[…]} ], activeListId }
  // We only ever read and append to "stored" lists — those carrying their own
  // `items` array (dream/custom/imported lists). Live lists (backed by your
  // todos) have no items array and aren't writable from here.
  const BOARD_KEY = STORAGE_KEYS.BOARD;
  const TIERS = ['S', 'A', 'B', 'C'];

  function getBoard() { return storageGet(BOARD_KEY); }
  // Resolves true when the write landed, false when it failed (and the
  // failure has already been reported via onStorageError).
  function setBoard(board) { return storageSet({ [BOARD_KEY]: board }); }
  // Serialize read-modify-write so rapid clicks (or a concurrently-open
  // dashboard tab) can't interleave and clobber each other. The mutator gets
  // the current board (or null) and returns the board to persist, or a falsy
  // value to skip the write.
  let boardWriteChain = Promise.resolve();
  function mutateBoard(mutator) {
    const p = boardWriteChain.then(async () => {
      const board = await getBoard();
      const next = mutator(board);
      if (next) await setBoard(next);
      return next;
    });
    boardWriteChain = p.then(() => {}, () => {});
    return p;
  }

  function bcGenId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  // A "live" list: a view over your todos with tiers/notes keyed by route.
  function makeList(name) {
    return { id: bcGenId(), name: name || 'My projects', genre: 'all', areas: null, gradeMin: null, gradeMax: null, tiers: {}, order: {}, notes: {} };
  }
  // A "dream"/custom list isn't backed by your todos — you build it by
  // searching and adding routes, which are stored on the list itself.
  function makeCustomList(name) {
    const l = makeList(name || 'Dream list');
    l.custom = true;
    l.items = [];
    return l;
  }
  // Coerce an untrusted list object (import file, backup, bad storage) into a
  // well-formed list, dropping anything malformed. Returns null when it's
  // unusable. Stored lists keep their item snapshot; live lists keep just
  // tiers/order/notes (their items come from your todos).
  function sanitizeList(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const l = makeList(String(raw.name || 'Untitled list'));
    if (typeof raw.id === 'string' && raw.id.trim()) l.id = raw.id.trim();
    if (['Boulder', 'Sport', 'Other'].includes(raw.genre)) l.genre = raw.genre;
    if (Array.isArray(raw.areas)) l.areas = raw.areas.filter(a => typeof a === 'string');
    if (raw.gradeMin != null && !isNaN(Number(raw.gradeMin))) l.gradeMin = Number(raw.gradeMin);
    if (raw.gradeMax != null && !isNaN(Number(raw.gradeMax))) l.gradeMax = Number(raw.gradeMax);
    if (raw.custom) l.custom = true;
    if (raw.imported) l.imported = true;
    if (raw.sourceUser) l.sourceUser = String(raw.sourceUser);
    const validKey = (k) => typeof k === 'string' && k.includes('/');
    if (Array.isArray(raw.items)) {
      l.items = [];
      const seen = new Set();
      for (const it of raw.items) {
        if (!it || typeof it !== 'object') continue;
        const key = typeof it.key === 'string' ? it.key.trim() : '';
        if (!validKey(key) || seen.has(key)) continue;
        seen.add(key);
        l.items.push({
          key,
          routeName: String(it.routeName || ''),
          cragName: String(it.cragName || ''),
          area: String(it.area || ''),
          gradeLabel: String(it.gradeLabel || ''),
          gradeInt: Number(it.gradeInt) || 0,
          genre: String(it.genre || ''),
          rating: Number(it.rating) || 0,
          ascents: Number(it.ascents) || 0,
        });
      }
    }
    const tiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
    for (const [k, v] of Object.entries(tiers)) if (validKey(k) && TIERS.includes(v)) l.tiers[k] = v;
    const order = raw.order && typeof raw.order === 'object' ? raw.order : {};
    for (const [k, v] of Object.entries(order)) if (validKey(k) && v != null && !isNaN(Number(v))) l.order[k] = Number(v);
    const notes = raw.notes && typeof raw.notes === 'object' ? raw.notes : {};
    for (const [k, v] of Object.entries(notes)) if (validKey(k) && v) l.notes[k] = String(v);
    return l;
  }
  // A page route → a stored-list item, matching mycrags.js addRouteToList.
  // `area` is left blank: the dashboard fills it in from cached crag totals.
  function routeToItem(route) {
    const genre = route.genre || '';
    const gradeInt = route.grade_int || 0;
    return {
      key: routeKeyOf(route),
      routeName: route.name || '',
      gradeLabel: gradeInt ? gradeLabelFor(gradeInt, genre) : (route.gradeLabel || ''),
      gradeInt,
      genre,
      cragName: route.crag_name || '',
      area: '',
    };
  }

  // Append a route to an existing stored list. Resolves to
  // 'added' | 'exists' | 'notfound'.
  async function addRouteToBoardList(listId, route) {
    let outcome = 'notfound';
    await mutateBoard((board) => {
      if (!board || !Array.isArray(board.lists)) return null;
      const list = board.lists.find(l => l.id === listId);
      if (!list || !Array.isArray(list.items)) return null;
      const item = routeToItem(route);
      if (list.items.some(i => i.key === item.key)) { outcome = 'exists'; return null; }
      list.items.push(item);
      outcome = 'added';
      return board;
    });
    return outcome;
  }
  // Create a new custom list seeded with the route. Resolves to the new id.
  async function createBoardListWithRoute(name, route) {
    let newId = null;
    await mutateBoard((board) => {
      const list = makeCustomList(name);
      list.items.push(routeToItem(route));
      newId = list.id;
      if (!board || !Array.isArray(board.lists) || !board.lists.length) {
        return { version: 2, lists: [list], activeListId: list.id };
      }
      board.lists.push(list);
      board.activeListId = list.id;
      return board;
    });
    return newId;
  }

  // ── "+ list" dropdown menu ───────────────────────────────────────────
  // A lightweight popup anchored under a "+ list" button: pick a custom list
  // to drop the route into, or spin up a new one on the spot. Used on both the
  // routelist rows and single-route pages.
  let listMenuEl = null;
  let listMenuCloseHandler = null;

  function closeListMenu() {
    if (listMenuEl) { listMenuEl.remove(); listMenuEl = null; }
    if (listMenuCloseHandler) {
      document.removeEventListener('click', listMenuCloseHandler, true);
      document.removeEventListener('keydown', listMenuCloseHandler, true);
      window.removeEventListener('scroll', listMenuCloseHandler, true);
      listMenuCloseHandler = null;
    }
  }

  function positionListMenu(menu, anchorBtn) {
    const r = anchorBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    const mw = menu.offsetWidth || 220;
    let left = Math.round(r.right - mw);
    if (left < 8) left = 8;
    menu.style.left = `${left}px`;
    const mh = menu.offsetHeight || 0;
    let top = Math.round(r.bottom + 4);
    if (top + mh > window.innerHeight - 8) top = Math.max(8, Math.round(r.top - 4 - mh));
    menu.style.top = `${top}px`;
  }

  async function openListMenu(anchorBtn, route) {
    closeListMenu();
    const menu = document.createElement('div');
    menu.className = 'tt-xf-list-menu';
    menu.setAttribute('role', 'menu');
    listMenuEl = menu;
    document.body.appendChild(menu);

    const key = routeKeyOf(route);

    async function rebuild() {
      const board = await getBoard();
      if (listMenuEl !== menu) return; // closed or superseded while reading
      const lists = (board && Array.isArray(board.lists) ? board.lists : [])
        .filter(l => Array.isArray(l.items));
      let html = '<div class="tt-xf-list-menu-head">Add to list</div>';
      if (lists.length) {
        html += '<div class="tt-xf-list-menu-items">';
        for (const l of lists) {
          const on = l.items.some(i => i.key === key);
          html += `<button type="button" class="tt-xf-list-menu-item${on ? ' is-on' : ''}" data-bc-list-id="${escapeHtml(l.id)}"${on ? ' disabled' : ''}>` +
            `<span class="tt-xf-list-menu-check">${on ? '✓' : '+'}</span>` +
            `<span class="tt-xf-list-menu-name">${escapeHtml(l.name || 'Untitled')}</span>` +
            `<span class="tt-xf-list-menu-count">${l.items.length}</span></button>`;
        }
        html += '</div>';
      } else {
        html += '<div class="tt-xf-list-menu-empty">No custom lists yet.</div>';
      }
      html += '<button type="button" class="tt-xf-list-menu-new" data-bc-list-new>+ New list…</button>';
      menu.innerHTML = html;
      positionListMenu(menu, anchorBtn);
    }

    menu.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newBtn = e.target.closest('[data-bc-list-new]');
      if (newBtn) {
        const name = (window.prompt('Name for the new list:', '') || '').trim();
        if (!name || listMenuEl !== menu) return;
        await createBoardListWithRoute(name, route);
        await rebuild();
        return;
      }
      const itemBtn = e.target.closest('[data-bc-list-id]');
      if (itemBtn && !itemBtn.disabled) {
        await addRouteToBoardList(itemBtn.dataset.bcListId, route);
        await rebuild();
      }
    });

    await rebuild();

    // Defer wiring the outside-close handlers so the click that opened the
    // menu (still mid-dispatch) doesn't immediately close it.
    setTimeout(() => {
      if (listMenuEl !== menu) return;
      listMenuCloseHandler = (e) => {
        if (e.type === 'keydown') { if (e.key === 'Escape') closeListMenu(); return; }
        if (e.type === 'click' && menu.contains(e.target)) return;
        closeListMenu();
      };
      document.addEventListener('click', listMenuCloseHandler, true);
      document.addEventListener('keydown', listMenuCloseHandler, true);
      window.addEventListener('scroll', listMenuCloseHandler, true);
    }, 0);
  }

  window.BCShared = {
    FONT_GRADES, FRENCH_GRADES, escapeHtml,
    FEATURE_TAGS, FEATURE_LABELS, FEATURE_GROUPS, FEATURE_KEYS,
    STORAGE_KEYS, CACHE_KEYS,
    storageGet, storageSet, storageRemove, storageBytesInUse, onStorageError, formatBytes,
    gradeLabelFor, gradeLabelExact, gradeIntFromLabel, parseGradeToken, findGradeInText,
    routeKeyOf, readRouteListStore, maxPageInPager, looksLikeLoginPage,
    TIERS, getBoard, setBoard, mutateBoard, bcGenId, makeList, makeCustomList, sanitizeList,
    addRouteToBoardList, createBoardListWithRoute, routeToItem,
    openListMenu, closeListMenu,
  };
})();

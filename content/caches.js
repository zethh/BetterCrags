// BetterCrags — routelist content script: persisted state + caches
// (filter state, crag totals, route meta, photo batches, the user's
// todo/done key sets) and the thetopo fetches that fill them.
(() => {
  'use strict';
  // One namespace object shared by every content/*.js file (see core.js).
  const RL = (window.BCRoutelist = window.BCRoutelist || {});
  const { STORAGE_KEYS, maxPageInPager, readRouteListStore, storageGet, storageSet, warn } = RL;

  const STATE_KEY = STORAGE_KEYS.FILTER_STATE;
  function loadSavedState() { return storageGet(STATE_KEY); }
  // Resolves false (after logging) when the write fails; callers that care
  // about the user noticing (filter state) surface it in the panel.
  function persistState(state) { return storageSet({ [STATE_KEY]: state }); }

  const META_CACHE_KEY = STORAGE_KEYS.META_CACHE;
  const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const CRAG_TOTALS_KEY = STORAGE_KEYS.CRAG_TOTALS;
  const CRAG_TOTALS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const USERNAME_KEY = STORAGE_KEYS.USERNAME;

  async function persistCragTotals(byCrag) {
    if (!byCrag || !byCrag.size) return;
    const existing = (await storageGet(CRAG_TOTALS_KEY)) || {};
    const now = Date.now();
    // Prune stale entries while we're merging — keeps the store bounded.
    for (const [id, data] of Object.entries(existing)) {
      if (!data || !data.t || (now - data.t) > CRAG_TOTALS_TTL_MS) delete existing[id];
    }
    for (const [id, data] of byCrag) {
      existing[id] = { ...data, t: now };
    }
    await storageSet({ [CRAG_TOTALS_KEY]: existing });
  }
  async function loadMetaCacheRaw() {
    return (await storageGet(META_CACHE_KEY)) || {};
  }
  function saveMetaCacheRaw(obj) {
    return storageSet({ [META_CACHE_KEY]: obj });
  }


  function readEmbeddedStore() {
    return readRouteListStore(document);
  }

  function usernameFromLink(a) {
    const m = (a.getAttribute('href') || '').match(/^\/climbers\/([^/?#]+)(?:[/?#]|$)/);
    return (m && m[1] && !['top', 'index', 'search'].includes(m[1])) ? m[1] : null;
  }
  function detectUsername() {
    // Prefer the logged-in account UI (header / nav / account menu) — a
    // /climbers/ link in page content (e.g. an ascent log) can belong to a
    // different user and must not be persisted as ours.
    for (const sel of ['nav', 'header', '.navbar', '[data-component-name="Nav"]', '.account', '.user-menu', '.dropdown-menu']) {
      for (const root of document.querySelectorAll(sel)) {
        for (const a of root.querySelectorAll('a[href^="/climbers/"]')) {
          const u = usernameFromLink(a);
          if (u) return u;
        }
      }
    }
    // Fallback heuristic: first climber link anywhere on the page.
    for (const a of document.querySelectorAll('a[href^="/climbers/"]')) {
      const u = usernameFromLink(a);
      if (u) return u;
    }
    return null;
  }
  function persistUsername(user) {
    if (!user) return;
    storageSet({ [USERNAME_KEY]: user });
  }

  function extractRouteKeysInto(doc, set) {
    const before = set.size;
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/crags\/([^/?#]+)\/routes\/([^/?#]+)/);
      if (m) set.add(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
    }
    return set.size - before;
  }
  async function fetchPage(url, page, signal) {
    const u = new URL(url, location.origin);
    if (page > 0) u.searchParams.set('page', String(page));
    const res = await fetch(u.toString(), { credentials: 'include', signal });
    if (!res.ok) return null;
    const text = await res.text();
    return new DOMParser().parseFromString(text, 'text/html');
  }

  // Fetch page 0 to discover total page count, then drain pages 1..N through
  // a small worker pool. Two lists load concurrently (todo + done), so keep
  // the per-call cap low — 3 each ≈ 6 requests in flight overall.
  const MAX_KEYSET_CONCURRENT = 3;
  async function fetchRouteKeySet(url, signal) {
    const set = new Set();
    try {
      if (signal && signal.aborted) return set;
      const doc0 = await fetchPage(url, 0, signal);
      if (!doc0) return set;
      extractRouteKeysInto(doc0, set);
      const maxPage = maxPageInPager(doc0);
      if (maxPage <= 0) return set;

      const last = Math.min(maxPage, 99);
      let next = 1;
      async function worker() {
        while (next <= last) {
          if (signal && signal.aborted) return;
          const p = next++;
          try {
            const doc = await fetchPage(url, p, signal);
            if (doc) extractRouteKeysInto(doc, set);
          } catch (err) {
            if (err && err.name !== 'AbortError' && err.name !== 'TypeError') {
              warn('fetchRouteKeySet page failed', url, p, err);
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_KEYSET_CONCURRENT, last) }, worker));
      return set;
    } catch (err) {
      if (err && err.name === 'AbortError') return set.size ? set : null;
      if (err && err.name !== 'TypeError') warn('fetchRouteKeySet failed', url, err);
      return set.size ? set : null;
    }
  }

  // thetopo has a batch endpoint: /api/web01/search/photos?ids=A,B,C → { routes: [{id, photo_url}] }
  const ROUTE_IMG_CACHE = new Map(); // id (number) -> string url | '' (none)

  // Per-route metadata (video/comment presence) — fetched when the
  // corresponding filter is active. Entries are { video, comment, t } and
  // persisted to chrome.storage with a 7-day TTL so we don't refetch route
  // detail pages every session. `null` is a pending sentinel.
  const ROUTE_META_CACHE = new Map();

  let metaCacheDirty = false;
  let metaSaveTimer = null;
  function persistMetaCacheSoon() {
    metaCacheDirty = true;
    if (metaSaveTimer) return;
    metaSaveTimer = setTimeout(() => {
      metaSaveTimer = null;
      if (!metaCacheDirty) return;
      metaCacheDirty = false;
      const obj = {};
      for (const [id, entry] of ROUTE_META_CACHE) {
        if (entry && typeof entry === 'object' && entry.t) obj[id] = entry;
      }
      saveMetaCacheRaw(obj);
    }, 2000);
  }

  async function hydrateMetaCache() {
    try {
      const obj = await loadMetaCacheRaw();
      const now = Date.now();
      for (const [id, entry] of Object.entries(obj)) {
        if (entry && entry.t && (now - entry.t) < META_TTL_MS) {
          ROUTE_META_CACHE.set(+id, entry);
        }
      }
    } catch (err) {
      warn('hydrateMetaCache failed', err);
    }
  }

  async function fetchRouteMeta(href, signal) {
    try {
      const res = await fetch(href, { credentials: 'include', signal });
      if (!res.ok) return null;
      const text = await res.text();
      return {
        video: /class\s*=\s*["']tag\s+video/.test(text),
        comment: /class\s*=\s*["']tag\s+comment/.test(text),
      };
    } catch (err) {
      if (err && err.name !== 'AbortError' && err.name !== 'TypeError') {
        warn('fetchRouteMeta failed', href, err);
      }
      return null;
    }
  }

  async function fetchPhotosBatch(ids, signal) {
    const map = new Map();
    if (!ids.length) return map;
    try {
      const u = `/api/web01/search/photos?ids=${ids.join(',')}`;
      const res = await fetch(u, { credentials: 'include', signal });
      if (!res.ok) return map;
      const data = await res.json();
      for (const r of (data && data.routes) || []) {
        map.set(Number(r.id), r.photo_url || '');
      }
    } catch (err) {
      // Network blips, navigations, aborts — non-essential, stay quiet.
      // Only log truly unexpected error types.
      if (err && err.name !== 'AbortError' && err.name !== 'TypeError') {
        warn('photos batch failed', err);
      }
    }
    return map;
  }

  // Keyed diff between the current tbody and a filtered route list. Rows that
  // survive keep their DOM node (and image observer state). Only added /
  // removed / moved rows pay DOM cost. First chunk runs sync; the tail
  // streams in via ric so long lists don't block input handlers.
  // All state comes in explicitly: `getTbody()`/`getTotal()` read live caller
  // state; `buildRowEl` / `observeRowImg` / `unobserveRowImg` /

  Object.assign(RL, { ROUTE_IMG_CACHE, ROUTE_META_CACHE, detectUsername, fetchPhotosBatch, fetchRouteKeySet, fetchRouteMeta, hydrateMetaCache, loadSavedState, persistCragTotals, persistMetaCacheSoon, persistState, persistUsername, readEmbeddedStore });
})();

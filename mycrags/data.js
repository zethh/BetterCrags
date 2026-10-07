// BetterCrags — My Crags dashboard: fetching + parsing thetopo pages
// (ascents, todos, crag pages, area routelists) and the per-route caches.
(() => {
  'use strict';
  // One namespace object shared by every mycrags/*.js file (see core.js).
  const MC = (window.BCMyCrags = window.BCMyCrags || {});
  const { CRAG_FETCH_CACHE_KEY, CRAG_PAGE_TTL_MS, CRAG_TOTALS_KEY, FEATURE_KEYS, PROJECT_SUGGESTIONS_KEY, ROUTE_FEATURES_KEY, ROUTE_STATS_KEY, ROUTE_STATS_TTL_MS, findGradeInText, gradeLabelExact, looksLikeLoginPage, maxPageInPager, noteSiteProblem, parseGradeToken, readRouteListStore, routeKeyOf, setStatus, state, storageGet, storageSet } = MC;

  function findDateInRow(row) {
    const timeEl = row.querySelector('time[datetime]');
    if (timeEl) {
      const d = timeEl.getAttribute('datetime');
      if (d) return d.slice(0, 10);
    }
    if (timeEl && timeEl.textContent) {
      const parsed = Date.parse(timeEl.textContent);
      if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
    }
    const text = row.textContent || '';
    const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (slash) {
      const mm = String(slash[1]).padStart(2, '0');
      const dd = String(slash[2]).padStart(2, '0');
      return `${slash[3]}-${mm}-${dd}`;
    }
    return null;
  }


  async function loadDismissedProjects(user) {
    const stored = (await storageGet(PROJECT_SUGGESTIONS_KEY)) || {};
    state.dismissedProjectsByUser = stored;
    state.dismissedProjectKeys = new Set(Array.isArray(stored[user]) ? stored[user] : []);
  }

  function saveDismissedProjects() {
    if (!state.user) return;
    state.dismissedProjectsByUser[state.user] = [...state.dismissedProjectKeys];
    return storageSet({ [PROJECT_SUGGESTIONS_KEY]: state.dismissedProjectsByUser });
  }

  // Serialize read-modify-write merges of shared cache keys (route stats,
  // crag totals) so concurrent triggers can't interleave and lose updates.
  let storageChain = Promise.resolve();
  function serialized(fn) {
    const p = storageChain.then(fn, fn);
    storageChain = p.then(() => {}, () => {});
    return p;
  }

  // ── Fetching ──────────────────────────────────────────────────────
  // The page itself is served from chrome-extension:// — anything path-relative
  // needs to be rewritten to thetopo.com or it'll 404 against the extension origin.
  const ORIGIN = 'https://thetopo.com';
  function absoluteUrl(url) {
    if (/^https?:\/\//.test(url)) return url;
    return ORIGIN + (url.startsWith('/') ? url : `/${url}`);
  }
  async function fetchHtml(url) {
    const abs = absoluteUrl(url);
    const res = await fetch(abs, { credentials: 'include', headers: { 'Accept': 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${abs}`);
    const text = await res.text();
    return new DOMParser().parseFromString(text, 'text/html');
  }


  // Parse an ascents-page document (or one page of it) into [{key, cragId, cragName, routeName, gradeInt, gradeLabel, genre, date}].
  // We keep every row (don't dedupe) so callers can pick the earliest date
  // for "first at grade" calculations. Some ascent views group several routes
  // in a single activity container, so dedupe duplicate anchors per *route*,
  // rather than skipping the entire container after its first route.
  function parseAscentRows(doc) {
    const rows = [];
    const handledRoutesByRow = new WeakMap();
    for (const a of doc.querySelectorAll('a[href*="/crags/"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^(?:https?:\/\/[^/]+)?\/crags\/([^/?#]+)\/routes\/([^/?#]+)/);
      if (!m) continue;
      const cragId = decodeURIComponent(m[1]);
      const routeId = decodeURIComponent(m[2]);

      const row = a.closest('tr, li, article, .feed-item, .ascent-row, .activity-item, .ascent') || a.parentElement;
      if (!row) continue;
      const routeKey = `${cragId}/${routeId}`;
      let handled = handledRoutesByRow.get(row);
      if (!handled) { handled = new Set(); handledRoutesByRow.set(row, handled); }
      if (handled.has(routeKey)) continue;
      handled.add(routeKey);

      // crag name: bare /crags/X anchor in the same row
      let cragName = '';
      for (const c of row.querySelectorAll('a[href]')) {
        const ch = c.getAttribute('href') || '';
        const cm = ch.match(/^(?:https?:\/\/[^/]+)?\/crags\/([^/?#]+)\/?$/);
        if (cm && decodeURIComponent(cm[1]) === cragId) {
          cragName = (c.textContent || '').trim();
          if (cragName) break;
        }
      }

      // route name: the matched anchor is sometimes a thumbnail/icon link with
      // no text — fall back to a text anchor for this exact route (not another
      // route that happens to live in the same grouped activity item).
      let routeName = (a.textContent || '').trim();
      if (!routeName) {
        for (const ra of row.querySelectorAll('a[href]')) {
          const rh = ra.getAttribute('href') || '';
          const rm = rh.match(/^(?:https?:\/\/[^/]+)?\/crags\/([^/?#]+)\/routes\/([^/?#]+)/);
          if (rm && decodeURIComponent(rm[1]) === cragId && decodeURIComponent(rm[2]) === routeId) {
            const t = (ra.textContent || '').trim();
            if (t) { routeName = t; break; }
          }
        }
      }
      // grade: scan row text but exclude the route name to avoid name-collisions
      const rowText = (row.textContent || '').replace(routeName, ' ');
      const grade = findGradeInText(rowText);
      const date = findDateInRow(row);

      rows.push({
        key: routeKey,
        cragId,
        cragName,
        routeName,
        gradeInt: grade ? grade.gi : 0,
        gradeLabel: grade ? grade.label : '',
        genre: grade ? grade.genre : '',
        date: date || '',
      });
    }
    return rows;
  }

  // Collapse multi-event ascent rows down to one entry per route, keeping the
  // *earliest* date. That's what "first at grade" should reflect, regardless
  // of how many times you've redpointed it since.
  function dedupeKeepEarliest(rows) {
    const byKey = new Map();
    for (const r of rows) {
      const prev = byKey.get(r.key);
      if (!prev) { byKey.set(r.key, r); continue; }
      const prevHasDate = !!prev.date;
      const nextHasDate = !!r.date;
      if (nextHasDate && (!prevHasDate || r.date < prev.date)) {
        // Take the earlier-dated row but keep any non-empty fields the first row had.
        byKey.set(r.key, {
          ...prev,
          ...r,
          cragName: r.cragName || prev.cragName,
          routeName: r.routeName || prev.routeName,
          gradeInt: r.gradeInt || prev.gradeInt,
          gradeLabel: r.gradeLabel || prev.gradeLabel,
          genre: r.genre || prev.genre,
        });
      } else if (!prevHasDate && !nextHasDate) {
        // Neither dated — keep whichever has more metadata.
        if ((r.gradeInt && !prev.gradeInt) || (r.cragName && !prev.cragName)) {
          byKey.set(r.key, r);
        }
      }
    }
    return [...byKey.values()];
  }

  async function fetchUserList(user, kind, onProgress) {
    // kind: 'done' (→ /climbers/U/ascents) or 'todo' (→ /climbers/U/ascents/todo)
    const base = kind === 'todo'
      ? `/climbers/${encodeURIComponent(user)}/ascents/todo`
      : `/climbers/${encodeURIComponent(user)}/ascents`;
    if (onProgress) onProgress(`Fetching ${kind} (page 1)…`);
    const doc0 = await fetchHtml(base);
    const rows = parseAscentRows(doc0);
    if (!rows.length) {
      // Distinguish "empty list" from "we didn't get the page we expected":
      // thetopo serves the login form (same 200 status) when logged out, and
      // an unrecognised page layout means the parser needs updating.
      if (looksLikeLoginPage(doc0)) throw new Error('thetopo.com served the login page — log in there (in this browser), then hit Refresh');
      if (!doc0.querySelector(`a[href*="/climbers/${encodeURIComponent(user)}"], a[href*="/climbers/${user}"]`)) {
        noteSiteProblem(`ascents-${kind}`, `Your ${kind === 'todo' ? 'todo' : 'ascents'} page on thetopo.com didn't look like a list of ascents (no route links, no account links). If you do have ${kind === 'todo' ? 'todos' : 'sends'} there, the site layout may have changed — check for a BetterCrags update.`);
      }
    }
    const maxPage = maxPageInPager(doc0);
    if (maxPage > 0) {
      // Bounded fan-out — same ~4-worker pattern as the crag-totals fetches.
      const pageRows = new Array(maxPage);
      let next = 0, completed = 0;
      const worker = async () => {
        while (next < maxPage) {
          const idx = next++;
          const p = idx + 1;
          try {
            const u = `${base}?page=${p}`;
            const d = await fetchHtml(u);
            pageRows[idx] = parseAscentRows(d);
          } catch { pageRows[idx] = []; }
          completed++;
          if (onProgress) onProgress(`Fetching ${kind} (${completed + 1} of ${maxPage + 1} pages)…`);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      for (const batch of pageRows) rows.push(...batch);
    }
    return dedupeKeepEarliest(rows);
  }

  // The crag page shows "Area, Country" as a link in .area-container (e.g.
  // "Åland, Finland"). Split it into { area, country } so we can group crags
  // by region in "Where to go next".
  function parseCragLocation(doc) {
    const a = doc.querySelector('.area-container a');
    const txt = a ? (a.textContent || '').trim() : '';
    // The area link points at /areas/<param_id> — that slug is what the
    // routelist endpoint needs to pull per-route rating/ascent data.
    let areaParamId = '';
    const areaA = doc.querySelector('.area-container a[href^="/areas/"]') || doc.querySelector('a[href^="/areas/"]');
    if (areaA) {
      const m = (areaA.getAttribute('href') || '').match(/^\/areas\/([^/?#]+)/);
      if (m) areaParamId = decodeURIComponent(m[1]);
    }
    if (!txt) return { area: '', country: '', areaParamId };
    const i = txt.lastIndexOf(',');
    if (i === -1) return { area: txt, country: '', areaParamId };
    return { area: txt.slice(0, i).trim(), country: txt.slice(i + 1).trim(), areaParamId };
  }

  // Fetch a single crag page and try to derive total route counts + grade
  // histogram. Best-effort: tries embedded RouteList JSON first, then falls
  // back to counting unique route links on the page.
  async function fetchCragTotal(cragId) {
    try {
      const doc = await fetchHtml(`/crags/${encodeURIComponent(cragId)}`);
      const loc = parseCragLocation(doc);
      const store = readRouteListStore(doc);
      if (store && Array.isArray(store.routes)) {
        const byGenre = {};
        const byGrade = {};
        const byGenreGrade = {};
        let name = '';
        for (const r of store.routes) {
          const g = r.genre || 'Other';
          byGenre[g] = (byGenre[g] || 0) + 1;
          const gi = r.grade_int || 0;
          if (gi) {
            byGrade[gi] = (byGrade[gi] || 0) + 1;
            const genreGrade = byGenreGrade[g] || (byGenreGrade[g] = {});
            genreGrade[gi] = (genreGrade[gi] || 0) + 1;
          }
          if (!name) name = r.crag_name || '';
        }
        return { name, total: store.routes.length, byGenre, byGrade, byGenreGrade, ...loc };
      }
      // Fallback: count distinct route hrefs.
      const seen = new Set();
      for (const a of doc.querySelectorAll(`a[href*="/crags/${encodeURIComponent(cragId)}/routes/"]`)) {
        const m = (a.getAttribute('href') || '').match(/\/routes\/([^/?#]+)/);
        if (m) seen.add(decodeURIComponent(m[1]));
      }
      const nameEl = doc.querySelector('h1, .crag-title, .crag-header h1');
      const name = nameEl ? (nameEl.textContent || '').trim() : '';
      return { name, total: seen.size, byGenre: {}, byGrade: {}, ...loc };
    } catch {
      return null;
    }
  }

  // The area routelist page (/areas/<param_id>/routelist) embeds a RouteList
  // store with every route in the area, each carrying rating + ascent counts —
  // the only place those per-route stats are exposed. One fetch covers a whole
  // area, so we enrich all todos in an area with a single request.
  async function fetchAreaRoutes(areaParamId) {
    const qs = new URLSearchParams({ grade_min: '100', grade_max: '1500' });
    for (const g of ['Boulder', 'Sport', 'Traditional', 'DWS', 'Other']) qs.set(g, '1');
    try {
      const doc = await fetchHtml(`/areas/${encodeURIComponent(areaParamId)}/routelist?${qs.toString()}`);
      const store = readRouteListStore(doc);
      if (!store) {
        noteSiteProblem('area-store', `The area routelist for "${areaParamId}" no longer embeds route data, so ratings, ascent counts and feature tags can't be loaded. thetopo.com may have changed — check for a BetterCrags update.`);
        return [];
      }
      return Array.isArray(store.routes) ? store.routes : [];
    } catch {
      return [];
    }
  }

  // Pull rating + ascent counts for every todo route by fetching each area
  // (that has todos) once and indexing the routes we care about. Cached per
  // area with a TTL so repeat opens are instant.
  function enrichTodoStats(force) {
    return serialized(() => enrichTodoStatsNow(force));
  }
  async function enrichTodoStatsNow(force) {
    const myKeys = new Set(state.todo.map(r => r.key));
    if (!myKeys.size) { state.routeStats = {}; return; }
    const cache = (await storageGet(ROUTE_STATS_KEY)) || { stats: {}, areas: {} };
    cache.stats = cache.stats || {};
    cache.areas = cache.areas || {};
    const now = Date.now();

    const areaIds = new Set();
    for (const r of state.todo) {
      const tot = state.cragTotals[r.cragId];
      if (tot && tot.areaParamId) areaIds.add(tot.areaParamId);
    }
    const stale = [...areaIds].filter(a => force || !cache.areas[a] || (now - cache.areas[a]) > ROUTE_STATS_TTL_MS);
    if (stale.length) {
      let done = 0;
      setStatus(`Fetching route ratings (0/${stale.length} areas)…`, true);
      for (const areaId of stale) {
        const routes = await fetchAreaRoutes(areaId);
        for (const rt of routes) {
          const key = routeKeyOf(rt);
          if (myKeys.has(key)) {
            cache.stats[key] = {
              rating: parseFloat(rt.rating) || 0,
              ascents: rt.ascents_done_count || 0,
              gradeInt: rt.grade_int || 0,
              genre: rt.genre || '',
            };
          }
        }
        cache.areas[areaId] = now;
        done++;
        setStatus(`Fetching route ratings (${done}/${stale.length} areas)…`, true);
      }
      await storageSet({ [ROUTE_STATS_KEY]: cache });
    }
    state.routeStats = cache.stats;
  }

  // Fetch feature tags for both sends and todos. The area response also gives
  // Suggested Projects a full discovery pool, not just routes already on todo.
  function enrichDoneFeatures(force) {
    return serialized(() => enrichDoneFeaturesNow(force));
  }
  async function enrichDoneFeaturesNow(force) {
    const routeRows = [...state.done, ...state.todo];
    const wantedKeys = new Set(routeRows.map(r => r.key));
    if (!wantedKeys.size) { state.routeFeatures = {}; return; }
    const cache = (await storageGet(ROUTE_FEATURES_KEY)) || { features: {}, areas: {} };
    cache.features = cache.features || {}; cache.areas = cache.areas || {};
    const now = Date.now();
    const areaIds = new Set();
    for (const r of routeRows) {
      const total = state.cragTotals[r.cragId];
      if (total && total.areaParamId) areaIds.add(total.areaParamId);
    }
    const stale = [...areaIds].filter(id => force || !state.areaRoutes[id] || !cache.areas[id] || (now - cache.areas[id]) > ROUTE_STATS_TTL_MS ||
      routeRows.some(r => {
        const total = state.cragTotals[r.cragId];
        return total && total.areaParamId === id && !Object.prototype.hasOwnProperty.call(cache.features, r.key);
      }));
    if (stale.length) {
      let completed = 0;
      setStatus(`Reading climb features (0/${stale.length} areas)…`, true);
      for (const areaId of stale) {
        const routes = await fetchAreaRoutes(areaId);
        state.areaRoutes[areaId] = routes;
        for (const route of routes) {
          const key = routeKeyOf(route);
          if (!wantedKeys.has(key)) continue;
          const features = {};
          for (const tag of FEATURE_KEYS) if (route[tag]) features[tag] = true;
          cache.features[key] = features;
        }
        cache.areas[areaId] = now;
        completed++;
        setStatus(`Reading climb features (${completed}/${stale.length} areas)…`, true);
      }
      await storageSet({ [ROUTE_FEATURES_KEY]: cache });
    }
    state.routeFeatures = cache.features;
  }

  // thetopo's universal search. Returns mixed matches (routes, crags, areas),
  // normalised; crags/areas can be "browsed" to list all their routes.
  async function searchAll(query) {
    try {
      const res = await fetch(`https://thetopo.com/api/web01/search?query=${encodeURIComponent(query)}`,
        { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      return ((data && data.search_keys) || []).map(parseSearchResult).filter(Boolean);
    } catch {
      return [];
    }
  }

  function parseSearchResult(k) {
    const path = k.path || '';
    const subtitle = (k.description || '').replace(/^[^,]*,\s*/, '').trim(); // drop leading "name (grade)"
    const routeM = path.match(/^\/crags\/([^/?#]+)\/routes\/([^/?#]+)/);
    if (routeM) {
      const cragId = decodeURIComponent(routeM[1]);
      let routeName = (k.name || '').trim();
      let gradeLabel = '', gradeInt = 0, genre = '';
      const gm = routeName.match(/\(([^)]+)\)\s*$/);
      if (gm) {
        const parsed = parseGradeToken(gm[1]);
        if (parsed) { gradeLabel = parsed.label; gradeInt = parsed.gi; genre = parsed.genre; routeName = routeName.slice(0, gm.index).trim(); }
      }
      const parts = (k.description || '').split(',').map(s => s.trim()).filter(Boolean);
      const cragName = parts.length ? parts[parts.length - 1] : cragId;
      return { type: 'route', key: `${cragId}/${decodeURIComponent(routeM[2])}`, cragId, routeName, gradeLabel, gradeInt, genre, cragName };
    }
    const cragM = path.match(/^\/crags\/([^/?#]+)\/?$/);
    if (cragM) return { type: 'crag', id: decodeURIComponent(cragM[1]), name: (k.name || '').trim(), subtitle };
    const areaM = path.match(/^\/areas\/([^/?#]+)\/?$/);
    if (areaM) return { type: 'area', id: decodeURIComponent(areaM[1]), name: (k.name || '').trim(), subtitle };
    return null;
  }

  // Map a raw routelist-store route into a browse item with stats baked in.
  function mapStoreRoute(rt, area) {
    return {
      key: routeKeyOf(rt),
      routeName: rt.name || '',
      gradeInt: rt.grade_int || 0,
      gradeLabel: gradeLabelExact(rt.grade_int || 0, rt.genre || ''),
      genre: rt.genre || '',
      bucket: MC.bucketOf(rt.genre || ''),
      rating: parseFloat(rt.rating) || 0,
      ascents: rt.ascents_done_count || 0,
      cragName: rt.crag_name || '',
      area: area || '',
    };
  }

  // Load all routes for a crag or area (for the browse panel), and cache their
  // stats so added routes show ratings immediately.
  async function loadBrowseScope(type, id, name) {
    let routes = [], area = '';
    if (type === 'area') {
      routes = (await fetchAreaRoutes(id)).map(rt => mapStoreRoute(rt, name));
      area = name;
    } else {
      let tot = state.cragTotals[id];
      if (!(tot && tot.areaParamId)) {
        const result = await fetchCragTotal(id);
        if (result) { state.cragTotals[id] = { ...(state.cragTotals[id] || {}), ...result }; tot = state.cragTotals[id]; }
      }
      area = (tot && tot.area) || '';
      if (tot && tot.areaParamId) {
        routes = (await fetchAreaRoutes(tot.areaParamId))
          .filter(rt => rt.crag_param_id === id)
          .map(rt => mapStoreRoute(rt, area));
      }
    }
    // Cache stats in memory for the session so added routes show ratings
    // immediately. Not persisted (a big area would bloat storage) — added
    // routes re-enrich on demand next session.
    for (const it of routes) {
      state.routeStats[it.key] = { rating: it.rating, ascents: it.ascents, gradeInt: it.gradeInt, genre: it.genre };
      state.enrichTried.add(it.key);
    }
    return { type, id, name, area, routes };
  }

  // Enrich arbitrary route keys (for dream/imported lists) with rating + ascents.
  // Resolves each crag's area (fetching the crag page if we don't know it yet),
  // then pulls the area routelist store. Each key is attempted once per session.
  function enrichRouteStats(keys) {
    return serialized(() => enrichRouteStatsNow(keys));
  }
  async function enrichRouteStatsNow(keys) {
    const want = new Set(keys.filter(Boolean));
    if (!want.size) return;
    const cache = (await storageGet(ROUTE_STATS_KEY)) || { stats: {}, areas: {} };
    cache.stats = cache.stats || {}; cache.areas = cache.areas || {};
    state.routeStats = cache.stats;
    const now = Date.now();

    const pending = [...want].filter(k => !cache.stats[k] && !state.enrichTried.has(k));
    if (!pending.length) return;
    pending.forEach(k => state.enrichTried.add(k));

    // 1) Resolve area param_ids for crags we haven't fetched.
    const cragsNeedingPage = new Set();
    for (const k of pending) {
      const tot = state.cragTotals[k.split('/')[0]];
      if (!(tot && tot.areaParamId)) cragsNeedingPage.add(k.split('/')[0]);
    }
    if (cragsNeedingPage.size) {
      const totalsRaw = (await storageGet(CRAG_TOTALS_KEY)) || {};
      const ids = [...cragsNeedingPage];
      setStatus(`Looking up ${ids.length} crag${ids.length > 1 ? 's' : ''}…`, true);
      let i = 0;
      const worker = async () => {
        while (i < ids.length) {
          const id = ids[i++];
          const result = await fetchCragTotal(id);
          if (result && (result.total > 0 || result.area)) {
            const prev = totalsRaw[id] || {};
            totalsRaw[id] = { ...prev, ...result, total: result.total > 0 ? result.total : prev.total, t: now };
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      await storageSet({ [CRAG_TOTALS_KEY]: totalsRaw });
      state.cragTotals = totalsRaw;
    }

    // 2) Fetch each needed area store; index stats for the wanted keys.
    const areaIds = new Set();
    for (const k of pending) {
      const tot = state.cragTotals[k.split('/')[0]];
      if (tot && tot.areaParamId) areaIds.add(tot.areaParamId);
    }
    const stale = [...areaIds].filter(a => !cache.areas[a] || (now - cache.areas[a]) > ROUTE_STATS_TTL_MS);
    if (stale.length) {
      let done = 0;
      setStatus(`Fetching route ratings (0/${stale.length} areas)…`, true);
      for (const areaId of stale) {
        const routes = await fetchAreaRoutes(areaId);
        for (const rt of routes) {
          const key = routeKeyOf(rt);
          if (want.has(key)) {
            cache.stats[key] = {
              rating: parseFloat(rt.rating) || 0,
              ascents: rt.ascents_done_count || 0,
              gradeInt: rt.grade_int || 0,
              genre: rt.genre || '',
            };
          }
        }
        cache.areas[areaId] = now;
        done++;
        setStatus(`Fetching route ratings (${done}/${stale.length} areas)…`, true);
      }
    }
    await storageSet({ [ROUTE_STATS_KEY]: cache });
    state.routeStats = cache.stats;
    setStatus('', false);
  }


  // ── Lazy-fill totals for crags we don't yet know about ─────────────
  function fillMissingCragTotals() {
    return serialized(() => fillMissingCragTotalsNow());
  }
  async function fillMissingCragTotalsNow() {
    const missing = [];
    for (const c of state.cragsAggregated.values()) {
      const totals = state.cragTotals[c.id];
      const needTotal = c.total == null || c.total <= 0;
      // Backfill location for older cache entries — area name AND its param_id
      // (needed to fetch per-route rating/ascents from the routelist endpoint).
      const needArea = !(totals && totals.area && totals.areaParamId);
      if (needTotal || needArea) missing.push(c.id);
    }
    if (!missing.length) return;

    const fetchedRaw = (await storageGet(CRAG_FETCH_CACHE_KEY)) || {};
    const now = Date.now();
    const toFetch = missing.filter(id => {
      const f = fetchedRaw[id];
      return !f || (now - (f.t || 0)) > CRAG_PAGE_TTL_MS;
    });
    if (!toFetch.length) return;

    setStatus(`Fetching crag totals (0/${toFetch.length})…`, true);
    const CONCURRENCY = 4;
    let i = 0, completed = 0;
    const totalsRaw = (await storageGet(CRAG_TOTALS_KEY)) || {};

    async function worker() {
      while (i < toFetch.length) {
        const id = toFetch[i++];
        const result = await fetchCragTotal(id);
        completed++;
        // Keep the result if it has a route total OR a location — the route
        // list is sometimes client-rendered (total comes back 0), but the area
        // still parses and is worth caching. Merge so a 0 total never clobbers
        // a previously-known one.
        if (result && (result.total > 0 || result.area)) {
          const prev = totalsRaw[id] || {};
          totalsRaw[id] = { ...prev, ...result, total: result.total > 0 ? result.total : prev.total, t: now };
        }
        fetchedRaw[id] = { t: now };
        if (completed % 3 === 0 || completed === toFetch.length) {
          setStatus(`Fetching crag totals (${completed}/${toFetch.length})…`, true);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await storageSet({ [CRAG_TOTALS_KEY]: totalsRaw });
    await storageSet({ [CRAG_FETCH_CACHE_KEY]: fetchedRaw });
    state.cragTotals = totalsRaw;
  }

  // Exposed for the unit tests in test/ (not used by other files).
  Object.assign(MC, { dedupeKeepEarliest, parseSearchResult, mapStoreRoute, findDateInRow });

  Object.assign(MC, { enrichDoneFeatures, enrichRouteStats, enrichTodoStats, fetchUserList, fillMissingCragTotals, loadBrowseScope, loadDismissedProjects, saveDismissedProjects, searchAll });
})();

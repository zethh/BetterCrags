// BetterCrags — My Crags dashboard.
// Reads username + cached crag totals, fetches user's ascents and todo,
// aggregates per crag and renders a dashboard.
(() => {
  'use strict';

  const USERNAME_KEY = 'bc_username_v1';
  const CRAG_TOTALS_KEY = 'bc_crag_totals_v1';
  const ASCENTS_CACHE_KEY = 'bc_mycrags_ascents_v1';
  const CRAG_FETCH_CACHE_KEY = 'bc_mycrags_crag_fetched_v4'; // v4: capture area param_id for routelist fetches
  const ROUTE_STATS_KEY = 'bc_route_stats_v1';  // routeKey → { rating, ascents, gradeInt, genre }
  const BOARD_KEY = 'bc_project_board_v2';       // tier-list board: named lists + global notes
  const BOARD_KEY_V1 = 'bc_project_board_v1';    // legacy single-list board (migrated on load)
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for ascents (cheap to refetch)
  const CRAG_PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const ROUTE_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // Grade tables mirror content.js. Font is upper-case letters, French lower-case.
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

  function intToLabel(gi, genre) {
    const map = genre === 'Boulder' ? FONT_INT_TO_LABEL : FRENCH_INT_TO_LABEL;
    return map.get(gi) || String(gi);
  }

  // Try Font first (uppercase indicates boulder); fall back to French.
  // Returns { gi, genre, label } or null.
  function parseGradeToken(token) {
    if (!token) return null;
    const t = token.trim().replace(/\s+/g, '');
    // 7A, 7A+, 8B/8B+, 5, 5+ → Font (boulder)
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
    // Bare-number grades like "5" or "4+" — assume Font but mark genre unknown.
    const numMatch = t.match(/^([3-5])(\+)?$/);
    if (numMatch) {
      const label = numMatch[1] + (numMatch[2] || '');
      const gi = FONT_LABEL_TO_INT.get(label) || FRENCH_LABEL_TO_INT.get(label);
      if (gi) return { gi, genre: '', label };
    }
    return null;
  }

  // Grade tokens within longer text — extract the first reasonable token.
  // NB: a trailing \b can never sit after a "+" (a "+" before whitespace/end has
  // no word boundary), so \b would make the engine backtrack and silently drop the
  // "+", folding every plus-grade into its base (7A+ → 7A). Use a no-alnum lookahead.
  const GRADE_TOKEN_RE = /\b\d[A-Da-c]\+?(?![A-Za-z0-9])|\b\d\+?(?![A-Za-z0-9])/g;
  function findGradeInText(text) {
    if (!text) return null;
    const candidates = text.match(GRADE_TOKEN_RE) || [];
    for (const c of candidates) {
      const parsed = parseGradeToken(c);
      if (parsed) return parsed;
    }
    return null;
  }

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

  // ── Storage helpers ───────────────────────────────────────────────
  function get(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (o) => resolve((o && o[key]) || null)); }
      catch { resolve(null); }
    });
  }
  function set(key, val) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [key]: val }, () => resolve()); }
      catch { resolve(); }
    });
  }
  function remove(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.remove(keys, () => resolve()); }
      catch { resolve(); }
    });
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

  // Parse an ascents-page document (or one page of it) into [{key, cragId, cragName, routeName, gradeInt, gradeLabel, genre, date}].
  // We keep every row (don't dedupe) so callers can pick the earliest date
  // for "first at grade" calculations. The same row container is only walked
  // once even if it carries multiple anchors pointing at the same route.
  function parseAscentRows(doc) {
    const rows = [];
    const handledRows = new WeakSet();
    for (const a of doc.querySelectorAll('a[href*="/crags/"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^(?:https?:\/\/[^/]+)?\/crags\/([^/?#]+)\/routes\/([^/?#]+)/);
      if (!m) continue;
      const cragId = decodeURIComponent(m[1]);
      const routeId = decodeURIComponent(m[2]);

      const row = a.closest('tr, li, article, .feed-item, .ascent-row, .activity-item, .ascent') || a.parentElement;
      if (!row || handledRows.has(row)) continue;
      handledRows.add(row);

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
      // no text — fall back to any route anchor in the row that actually has text.
      let routeName = (a.textContent || '').trim();
      if (!routeName) {
        for (const ra of row.querySelectorAll('a[href]')) {
          const rh = ra.getAttribute('href') || '';
          if (/\/crags\/[^/?#]+\/routes\/[^/?#]+/.test(rh)) {
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
        key: `${cragId}/${routeId}`,
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
    const maxPage = maxPageInPager(doc0);
    if (maxPage > 0) {
      const pageRows = await Promise.all(
        Array.from({ length: maxPage }, (_, i) => i + 1).map(async (p) => {
          try {
            const u = `${base}?page=${p}`;
            const d = await fetchHtml(u);
            if (onProgress) onProgress(`Fetching ${kind} (page ${p + 1} of ${maxPage + 1})…`);
            return parseAscentRows(d);
          } catch { return []; }
        })
      );
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
      const tag = doc.querySelector('script[data-component-name="RouteList"]');
      if (tag) {
        try {
          const store = JSON.parse(tag.textContent);
          if (store && Array.isArray(store.routes)) {
            const byGenre = {};
            const byGrade = {};
            let name = '';
            for (const r of store.routes) {
              const g = r.genre || 'Other';
              byGenre[g] = (byGenre[g] || 0) + 1;
              const gi = r.grade_int || 0;
              if (gi) byGrade[gi] = (byGrade[gi] || 0) + 1;
              if (!name) name = r.crag_name || '';
            }
            return { name, total: store.routes.length, byGenre, byGrade, ...loc };
          }
        } catch {}
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
      const tag = doc.querySelector('script[data-component-name="RouteList"]');
      if (!tag) return [];
      const store = JSON.parse(tag.textContent);
      return Array.isArray(store.routes) ? store.routes : [];
    } catch {
      return [];
    }
  }

  // Pull rating + ascent counts for every todo route by fetching each area
  // (that has todos) once and indexing the routes we care about. Cached per
  // area with a TTL so repeat opens are instant.
  async function enrichTodoStats(force) {
    const myKeys = new Set(state.todo.map(r => r.key));
    if (!myKeys.size) { state.routeStats = {}; return; }
    const cache = (await get(ROUTE_STATS_KEY)) || { stats: {}, areas: {} };
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
          const key = `${rt.crag_param_id || ''}/${rt.param_id || ''}`;
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
      await set(ROUTE_STATS_KEY, cache);
    }
    state.routeStats = cache.stats;
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
      key: `${rt.crag_param_id || ''}/${rt.param_id || ''}`,
      routeName: rt.name || '',
      gradeInt: rt.grade_int || 0,
      gradeLabel: intToLabel(rt.grade_int || 0, rt.genre || ''),
      genre: rt.genre || '',
      bucket: bucketOf(rt.genre || ''),
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
  async function enrichRouteStats(keys) {
    const want = new Set(keys.filter(Boolean));
    if (!want.size) return;
    const cache = (await get(ROUTE_STATS_KEY)) || { stats: {}, areas: {} };
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
      const totalsRaw = (await get(CRAG_TOTALS_KEY)) || {};
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
      await set(CRAG_TOTALS_KEY, totalsRaw);
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
          const key = `${rt.crag_param_id || ''}/${rt.param_id || ''}`;
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
    await set(ROUTE_STATS_KEY, cache);
    state.routeStats = cache.stats;
    setStatus('', false);
  }

  // ── State & rendering ─────────────────────────────────────────────
  const state = {
    user: '',
    done: [],         // [{key, cragId, ...}]
    todo: [],         // [{key, cragId, ...}]
    cragTotals: {},   // cragId → { name, total, byGenre, byGrade, t }
    cragsAggregated: new Map(), // cragId → aggregated stats
    activeGenreNext: 'all',
    activeAreaNext: 'all',
    activeGenreCrags: 'all',
    cragSort: { col: 'todo', dir: 'desc' },
    activeYear: null,     // 'all' or 'YYYY'
    compareYear: null,    // 'YYYY' to compare against, or null
    selectedMonth: null,  // 1..12 or null
    activeGenreMonth: 'all', // 'all' | 'Boulder' | 'Sport' | 'Other'
    selectedCragId: null, // crag spotlight
    routeStats: {},       // routeKey → { rating, ascents, gradeInt, genre }
    enrichTried: new Set(), // route keys we've already tried to enrich this session
    board: null,          // tier-list board (loaded from storage)
  };

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

  function uniqGenres(rows) {
    const s = new Set();
    for (const r of rows) if (r.genre) s.add(r.genre);
    return [...s].sort();
  }

  function aggregate() {
    // Build per-crag aggregation including a "firsts" map per genre.
    const crags = new Map();
    function get(id) {
      if (!crags.has(id)) {
        crags.set(id, {
          id,
          name: '',
          done: [],
          todo: [],
          total: null,
          area: '',
          country: '',
          totalsByGenre: {},
          totalsByGrade: {},
          firsts: {}, // `${genre}:${gi}` → { date, routeName } for the earliest send of that grade
        });
      }
      return crags.get(id);
    }
    for (const r of state.done) {
      const c = get(r.cragId);
      c.done.push(r);
      if (r.cragName && !c.name) c.name = r.cragName;
    }
    for (const r of state.todo) {
      const c = get(r.cragId);
      c.todo.push(r);
      if (r.cragName && !c.name) c.name = r.cragName;
    }
    for (const [id, totals] of Object.entries(state.cragTotals)) {
      const c = get(id);
      if (totals && totals.total != null) c.total = totals.total;
      if (totals && totals.byGenre) c.totalsByGenre = totals.byGenre;
      if (totals && totals.byGrade) c.totalsByGrade = totals.byGrade;
      if (totals && totals.name && !c.name) c.name = totals.name;
      if (totals && totals.area) c.area = totals.area;
      if (totals && totals.country) c.country = totals.country;
    }

    // Compute global "first at grade" per genre across all done routes.
    // A crag earns the "first 7A" badge if it contains the user's earliest
    // dated send at that grade (per genre).
    const firstsByGenreGrade = {}; // genre → gi → { date, cragId, routeName }
    for (const r of state.done) {
      if (!r.gradeInt || !r.date) continue;
      const g = r.genre || 'Unknown';
      const byGrade = firstsByGenreGrade[g] = firstsByGenreGrade[g] || {};
      const prev = byGrade[r.gradeInt];
      if (!prev || r.date < prev.date) {
        byGrade[r.gradeInt] = { date: r.date, cragId: r.cragId, routeName: r.routeName, gradeLabel: r.gradeLabel };
      }
    }
    for (const [genre, byGrade] of Object.entries(firstsByGenreGrade)) {
      for (const [gi, entry] of Object.entries(byGrade)) {
        const c = crags.get(entry.cragId);
        if (!c) continue;
        c.firsts[`${genre}:${gi}`] = entry;
      }
    }

    state.cragsAggregated = crags;
    state.firstsByGenreGrade = firstsByGenreGrade;
  }

  function genresPresent() {
    const s = new Set();
    for (const r of state.done) if (r.genre) s.add(r.genre);
    for (const r of state.todo) if (r.genre) s.add(r.genre);
    return [...s].sort();
  }

  function renderTabs(container, current, onSelect) {
    container.innerHTML = '';
    const genres = ['all', ...genresPresent()];
    for (const g of genres) {
      const btn = document.createElement('button');
      btn.textContent = g === 'all' ? 'All' : g;
      if (g === current) btn.dataset.active = '1';
      btn.addEventListener('click', () => onSelect(g));
      container.appendChild(btn);
    }
  }

  // ── Render: summary ───────────────────────────────────────────────
  // For each genre with any dated send, return the highest grade hit.
  // Genres without a determinable type land under "Other" so they don't get
  // misleadingly compared against Boulder/Sport.
  function hardestByGenre(rows) {
    const map = new Map(); // genre → { gi, label }
    for (const r of rows) {
      if (!r.gradeInt) continue;
      const g = r.genre || 'Other';
      const prev = map.get(g);
      if (!prev || r.gradeInt > prev.gi) {
        map.set(g, { gi: r.gradeInt, label: r.gradeLabel || intToLabel(r.gradeInt, g) });
      }
    }
    return map;
  }

  const GENRE_ORDER = ['Boulder', 'Sport', 'Traditional', 'DWS', 'Other'];
  function sortedGenres(map) {
    const present = [...map.keys()];
    present.sort((a, b) => {
      const ia = GENRE_ORDER.indexOf(a); const ib = GENRE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return present;
  }

  function renderSummary() {
    const el = $('#mc-summary');
    const cragCount = state.cragsAggregated.size;
    const knownTotals = [...state.cragsAggregated.values()].filter(c => c.total != null && c.total > 0);
    const completionPct = knownTotals.length === 0 ? null : (
      knownTotals.reduce((s, c) => s + Math.min(1, c.done.length / Math.max(1, c.total)), 0) / knownTotals.length * 100
    );
    const cards = [
      { v: state.done.length, l: 'Sends logged' },
      { v: state.todo.length, l: 'On todo' },
      { v: cragCount, l: 'Crags touched' },
      {
        v: completionPct == null ? '—' : `${completionPct.toFixed(1)}%`,
        l: 'Avg completion (known crags)',
      },
    ];
    const hardest = hardestByGenre(state.done);
    for (const g of sortedGenres(hardest)) {
      const h = hardest.get(g);
      cards.push({ v: h.label, l: `Hardest ${g}` });
    }
    if (!hardest.size) cards.push({ v: '—', l: 'Hardest send' });

    el.innerHTML = cards.map(c => `
      <div class="mc-summary-card">
        <div class="v">${escapeHtml(String(c.v))}</div>
        <div class="l">${escapeHtml(c.l)}</div>
      </div>
    `).join('');
    el.hidden = false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Render: where to go next ──────────────────────────────────────
  // Score = (open todos in genre) * (1 + ln(1 + done_at_crag_in_genre)) — favours
  // crags where you have an active project list AND some history, but doesn't
  // ignore brand-new wishlists.
  const UNKNOWN_AREA = '__unknown__';

  // Render the area-filter chips for "Where to go next". Areas are derived from
  // the crags that have open todos in the current genre, so the list only ever
  // offers places you could actually go. Crags whose area we haven't fetched
  // yet fall under an "Unknown" chip.
  function renderAreaTabs(genreItems) {
    const container = $('#mc-next-areas');
    const counts = new Map(); // areaKey → { label, count }
    for (const { c } of genreItems) {
      const key = c.area || UNKNOWN_AREA;
      const label = c.area || 'Unknown';
      const entry = counts.get(key) || { label, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
    // Reset a stale selection (e.g. switching genre dropped the chosen area).
    if (state.activeAreaNext !== 'all' && !counts.has(state.activeAreaNext)) {
      state.activeAreaNext = 'all';
    }
    container.innerHTML = '';
    // Only worth showing the filter when there's more than one area in play.
    if (counts.size <= 1) return;
    const ordered = [...counts.entries()].sort((a, b) =>
      b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    const make = (key, label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (key === state.activeAreaNext) btn.dataset.active = '1';
      btn.addEventListener('click', () => { state.activeAreaNext = key; renderNext(); });
      container.appendChild(btn);
    };
    make('all', 'All areas');
    for (const [key, { label, count }] of ordered) make(key, `${label} (${count})`);
  }

  function renderNext() {
    const card = $('#mc-next-card');
    const list = $('#mc-next-list');
    const genre = state.activeGenreNext;
    renderTabs($('#mc-next-tabs'), genre, (g) => { state.activeGenreNext = g; renderNext(); });
    const genreItems = [];
    for (const c of state.cragsAggregated.values()) {
      const todos = c.todo.filter(r => genre === 'all' || r.genre === genre);
      if (!todos.length) continue;
      const doneAtCrag = c.done.filter(r => genre === 'all' || r.genre === genre).length;
      const hardestTodoGi = todos.reduce((mx, r) => Math.max(mx, r.gradeInt || 0), 0);
      const score = todos.length * (1 + Math.log1p(doneAtCrag));
      genreItems.push({ c, todos, doneAtCrag, hardestTodoGi, score });
    }
    renderAreaTabs(genreItems);
    const area = state.activeAreaNext;
    const items = genreItems.filter(({ c }) =>
      area === 'all' || (c.area || UNKNOWN_AREA) === area);
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, 8);
    if (!top.length) {
      list.innerHTML = `<div class="mc-card-sub" style="padding:14px 16px;">No open todos ${area === 'all' ? 'in this genre' : 'in this area'} yet.</div>`;
      card.hidden = false;
      return;
    }
    list.innerHTML = top.map(({ c, todos, doneAtCrag, hardestTodoGi, score }) => {
      const name = c.name || c.id;
      const totalKnown = c.total != null && c.total > 0;
      const pct = totalKnown ? Math.min(100, (doneAtCrag / c.total) * 100) : null;
      const hardestG = hardestTodoGi
        ? intToLabel(hardestTodoGi, (todos.find(t => t.gradeInt === hardestTodoGi) || {}).genre)
        : '';
      return `
        <div class="mc-next-item">
          <div class="n"><a href="https://thetopo.com/crags/${escapeHtml(c.id)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>${c.area ? `<span class="area">${escapeHtml(c.area)}</span>` : ''}</div>
          <div class="b">
            <span class="pill">${todos.length} todo</span>
            <span class="pill">${doneAtCrag} done${totalKnown ? ` / ${c.total}` : ''}</span>
            ${hardestG ? `<span class="pill">top todo ${escapeHtml(hardestG)}</span>` : ''}
          </div>
          <div class="m">${pct != null ? `${pct.toFixed(0)}% of this crag climbed` : 'completion unknown — visit area routelist'}</div>
          <div class="score">priority ${score.toFixed(1)}</div>
        </div>
      `;
    }).join('');
    card.hidden = false;
  }

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

  // ── To-do tierlists: drag todos into S/A/B/C tiers, saved as lists ──
  const PB_TIERS = ['S', 'A', 'B', 'C'];

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
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function slug(s) {
    return String(s || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
  }
  function defaultList(name) {
    return { id: genId(), name: name || 'My projects', genre: 'all', areas: null, gradeMin: null, gradeMax: null, tiers: {}, order: {}, notes: {} };
  }
  // A "dream"/custom list isn't backed by your todos — you build it by searching
  // and adding routes, which are stored on the list itself (like imported lists).
  function defaultCustomList(name) {
    const l = defaultList(name || 'Dream list');
    l.custom = true;
    l.items = [];
    return l;
  }
  function defaultBoard() {
    const l = defaultList('My projects');
    return { version: 2, lists: [l], activeListId: l.id };
  }
  // A list is "stored" (self-contained) when it carries its own item snapshot —
  // true for both dream/custom lists and imported lists. Otherwise it's live
  // over your todos.
  function listIsStored(list) {
    return Array.isArray(list.items);
  }

  let boardSaveTimer = null;
  function saveBoard() {
    if (boardSaveTimer) clearTimeout(boardSaveTimer);
    boardSaveTimer = setTimeout(() => { set(BOARD_KEY, state.board); boardSaveTimer = null; }, 250);
  }

  async function loadBoard() {
    let b = await get(BOARD_KEY);
    if (!b) {
      // Migrate from the v1 single-list board if present.
      b = defaultBoard();
      const old = await get(BOARD_KEY_V1);
      if (old) {
        if (old.tiers) b.lists[0].tiers = old.tiers;
        if (old.notes) b.lists[0].notes = old.notes;
        if (old.genre) b.lists[0].genre = old.genre;
        if (old.areas) b.lists[0].areas = old.areas;
      }
    }
    if (!Array.isArray(b.lists) || !b.lists.length) b.lists = [defaultList('My projects')];
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
        gradeLabel: r.gradeLabel || (gradeInt ? intToLabel(gradeInt, genre) : ''),
        gradeInt,
        bucket: bucketOf(genre),
        rating: s.rating || 0,
        ascents: s.ascents || 0,
        hasStats: !!stats,
      };
    });
  }

  // Decorate a stored item (dream/imported) with live area + stats lookups, so
  // ratings/ascents fill in once enriched and area shows once the crag is known.
  function decorateStored(it) {
    const cragId = it.key.split('/')[0];
    const tot = state.cragTotals[cragId] || {};
    const stats = state.routeStats[it.key];
    const s = stats || {};
    const gradeInt = it.gradeInt || s.gradeInt || 0;
    const genre = it.genre || s.genre || '';
    return {
      key: it.key,
      routeName: it.routeName || '',
      cragName: it.cragName || tot.name || cragId,
      area: it.area || tot.area || '',
      gradeLabel: it.gradeLabel || (gradeInt ? intToLabel(gradeInt, genre) : ''),
      gradeInt,
      bucket: bucketOf(genre),
      rating: s.rating || it.rating || 0,
      ascents: s.ascents || it.ascents || 0,
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
      if (list.genre !== 'all' && it.bucket !== list.genre) return false;
      if (list.areas && !list.areas.includes(it.area || '')) return false;
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
      const l = defaultList(name);
      b.lists.push(l); b.activeListId = l.id; boardBrowse = null; saveBoard(); renderBoard();
    });
    mkBtn('+ Dream', 'New dream/trip list — add any routes by search', () => {
      const name = (prompt('Name for the dream/trip list:', 'Dream list') || '').trim();
      if (!name) return;
      const l = defaultCustomList(name);
      b.lists.push(l); b.activeListId = l.id; boardBrowse = null; saveBoard(); renderBoard();
    });
    mkBtn('Rename', 'Rename this list', () => {
      const name = (prompt('Rename list:', list.name) || '').trim();
      if (!name) return;
      list.name = name; saveBoard(); renderBoard();
    });
    mkBtn('Duplicate', 'Duplicate this list', () => {
      const copy = JSON.parse(JSON.stringify(list));
      copy.id = genId(); copy.name = `${list.name} copy`;
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
        o.textContent = intToLabel(gi, labelGenre);
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
    const cragId = it.key.split('/')[0] || '';
    const routeHref = `https://thetopo.com/crags/${it.key.split('/').map(encodeURIComponent).join('/routes/')}`;
    const cragHref = `https://thetopo.com/crags/${encodeURIComponent(cragId)}`;
    const hasNote = !!note;
    const markers = opts.markers
      ? `${it.done ? '<span class="mk done" title="You\'ve sent this">✓ sent</span>' : ''}${it.onTodo ? '<span class="mk todo" title="On your todo list">todo</span>' : ''}`
      : '';
    const rm = opts.removable ? '<button class="rm" draggable="false" title="Remove from list">×</button>' : '';
    return `
      <div class="mc-tl-card" draggable="true" data-key="${escapeHtml(it.key)}">
        <span class="g">${escapeHtml(it.gradeLabel || '—')}</span>
        <a class="nm" href="${routeHref}" target="_blank" rel="noopener" draggable="false" title="Open route on thetopo">${escapeHtml(it.routeName || '(unnamed)')}</a>
        ${markers}
        <span class="rt ${it.hasStats ? '' : 'unk'}" title="${it.hasStats ? it.rating.toFixed(1) + ' / 3' : 'rating not fetched'}">${starsHtml(it.rating)}</span>
        <span class="as" title="ascents logged">${it.hasStats ? it.ascents : '–'}</span>
        <span class="cr"><a href="${cragHref}" target="_blank" rel="noopener" draggable="false" title="Open crag on thetopo">${escapeHtml(it.cragName)}</a>${it.area ? ` · ${escapeHtml(it.area)}` : ''}</span>
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

    // Lazily fetch ratings/ascents for stored items we don't know yet.
    if (stored) {
      const missing = list.items.map(i => i.key).filter(k => !state.routeStats[k] && !state.enrichTried.has(k));
      if (missing.length) enrichRouteStats(list.items.map(i => i.key)).then(() => renderTierArea(list));
    }

    const opts = { markers: stored, removable: stored };
    const groups = { '': [] };
    for (const t of PB_TIERS) groups[t] = [];
    for (const it of items) {
      const t = list.tiers[it.key];
      groups[PB_TIERS.includes(t) ? t : ''].push(it);
    }
    const ord = k => (list.order[k] == null ? 1e9 : list.order[k]);
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => ord(a.key) - ord(b.key));

    const tierRows = PB_TIERS.map(t => `
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
    if (!state.routeStats[m.key]) enrichRouteStats([m.key]).then(() => renderTierArea(list));
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
    const gradeOpt = (val) => `<option value="">Any</option>` + gis.map(gi => `<option value="${gi}"${val === gi ? ' selected' : ''}>${escapeHtml(intToLabel(gi, labelGenre))}</option>`).join('');
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
      tiers: PB_TIERS,
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
    const l = defaultList(obj.name || 'Imported list');
    l.imported = true;
    l.sourceUser = obj.username || '';
    l.items = obj.items.map(it => ({
      key: it.key,
      routeName: it.routeName || '',
      cragName: it.cragName || '',
      area: it.area || '',
      gradeLabel: it.gradeLabel || '',
      gradeInt: it.gradeInt || 0,
      genre: it.genre || '',
      rating: it.rating || 0,
      ascents: it.ascents || 0,
    }));
    for (const it of obj.items) {
      if (it.tier) l.tiers[it.key] = it.tier;
      if (it.order != null) l.order[it.key] = it.order;
      if (it.note) l.notes[it.key] = it.note;
    }
    state.board.lists.push(l);
    state.board.activeListId = l.id;
    boardBrowse = null;
    saveBoard();
    renderBoard();
    setStatus(`Imported list "${l.name}"${l.sourceUser ? ` from ${l.sourceUser}` : ''} (${l.items.length} routes).`, false);
  }

  let boardWired = false;
  function wireBoard() {
    if (boardWired) return;
    const root = $('#mc-pb-list');
    if (!root) return;
    boardWired = true;

    root.addEventListener('dragstart', (e) => {
      const cardEl = e.target.closest('.mc-tl-card');
      if (!cardEl || e.target.closest('textarea, a, button')) { e.preventDefault(); return; }
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
    root.addEventListener('drop', (e) => e.preventDefault());
    root.addEventListener('dragend', () => {
      const dragging = root.querySelector('.mc-tl-card.dragging');
      if (dragging) dragging.classList.remove('dragging');
      commitBoardFromDom();
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

  // ── Render: crags table ───────────────────────────────────────────
  function renderHardestCell(map) {
    if (!map || !map.size) return '—';
    const parts = sortedGenres(map).map(g => {
      const v = map.get(g);
      const tag = g === 'Boulder' ? 'B' : g === 'Sport' ? 'S' : g === 'Traditional' ? 'T' : g === 'DWS' ? 'D' : g.slice(0, 1);
      return `<span class="mc-hardest-pill" title="${escapeHtml(g)}"><span class="t">${tag}</span> ${escapeHtml(v.label)}</span>`;
    });
    return parts.join(' ');
  }

  function rowMatchesGenre(crag, genre) {
    if (genre === 'all') return true;
    return (crag.totalsByGenre && crag.totalsByGenre[genre] > 0)
      || crag.done.some(r => r.genre === genre)
      || crag.todo.some(r => r.genre === genre);
  }

  function cragGenreTotals(crag, genre) {
    if (genre === 'all') return {
      done: crag.done.length,
      todo: crag.todo.length,
      total: crag.total,
      hardestByGenre: hardestByGenre(crag.done), // Map<genre, {gi, label}>
      firsts: Object.values(crag.firsts),
    };
    const doneInGenre = crag.done.filter(r => r.genre === genre);
    return {
      done: doneInGenre.length,
      todo: crag.todo.filter(r => r.genre === genre).length,
      total: (crag.totalsByGenre && crag.totalsByGenre[genre]) || null,
      hardestByGenre: hardestByGenre(doneInGenre),
      firsts: Object.entries(crag.firsts).filter(([k]) => k.startsWith(`${genre}:`)).map(([, v]) => v),
    };
  }

  function renderCrags() {
    const card = $('#mc-crags-card');
    const tbody = $('#mc-crags-tbody');
    const genre = state.activeGenreCrags;
    renderTabs($('#mc-crags-tabs'), genre, (g) => { state.activeGenreCrags = g; renderCrags(); });

    const q = ($('#mc-crag-search').value || '').toLowerCase().trim();
    const hideZeroDone = $('#mc-hide-zero-done').checked;
    const onlyTodo = $('#mc-only-todo').checked;
    const knownOnly = $('#mc-known-totals').checked;

    const rows = [];
    for (const c of state.cragsAggregated.values()) {
      if (!rowMatchesGenre(c, genre)) continue;
      const t = cragGenreTotals(c, genre);
      if (hideZeroDone && t.done === 0 && t.todo === 0) continue;
      if (onlyTodo && t.todo === 0) continue;
      if (knownOnly && (t.total == null || t.total <= 0)) continue;
      const name = c.name || c.id;
      if (q && !name.toLowerCase().includes(q)) continue;
      const pct = (t.total != null && t.total > 0) ? Math.min(100, (t.done / t.total) * 100) : null;
      // sort proxy for the "hardest" column: max grade_int across the genres
      // this row covers — within-genre comparisons stay sensible, cross-genre
      // ordering is a rough convenience only.
      let hardestSortKey = 0;
      for (const v of t.hardestByGenre.values()) hardestSortKey = Math.max(hardestSortKey, v.gi);
      rows.push({ id: c.id, name, ...t, pct, hardestSortKey });
    }

    const { col, dir } = state.cragSort;
    rows.sort((a, b) => {
      let va, vb;
      if (col === 'hardest') { va = a.hardestSortKey; vb = b.hardestSortKey; }
      else { va = a[col]; vb = b[col]; }
      let c;
      if (col === 'name') c = String(va || '').localeCompare(String(vb || ''));
      else if (col === 'pct') {
        // sort unknowns last regardless of direction
        const ax = va == null ? -1 : va;
        const bx = vb == null ? -1 : vb;
        c = ax - bx;
      } else c = (va || 0) - (vb || 0);
      return dir === 'asc' ? c : -c;
    });

    tbody.innerHTML = rows.map(r => {
      const pctCell = r.pct == null
        ? `<span class="unknown">?</span>`
        : `${r.pct.toFixed(0)}%<span class="pct-bar"><span class="pct-fill" style="width:${r.pct.toFixed(0)}%"></span></span>`;
      const hardestCell = renderHardestCell(r.hardestByGenre);
      const totalCell = r.total == null ? `<span class="unknown">?</span>` : r.total;
      const notable = (r.firsts || []).slice().sort((a, b) => (b.gradeLabel || '').localeCompare(a.gradeLabel || '')).slice(0, 3).map(f => {
        return `<span class="mc-firsts-pill" title="${escapeHtml(f.routeName || '')} — ${escapeHtml(f.date || '')}">★ first ${escapeHtml(f.gradeLabel || '')}</span>`;
      }).join('');
      const selected = state.selectedCragId === r.id ? '1' : '0';
      return `<tr data-mc-crag="${escapeHtml(r.id)}" data-selected="${selected}">
        <td><a href="https://thetopo.com/crags/${escapeHtml(r.id)}" target="_blank" rel="noopener" data-mc-stop>${escapeHtml(r.name)}</a></td>
        <td class="mc-num">${r.done}</td>
        <td class="mc-num">${r.todo}</td>
        <td class="mc-num">${totalCell}</td>
        <td class="mc-num">${pctCell}</td>
        <td class="mc-num">${hardestCell}</td>
        <td>${notable}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-mc-crag]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        // Let the crag-name anchor open in a new tab as a normal link.
        if (e.target.closest('[data-mc-stop]')) return;
        const id = tr.getAttribute('data-mc-crag');
        state.selectedCragId = state.selectedCragId === id ? null : id;
        renderCrags();
        renderSpotlight();
      });
    });

    document.querySelectorAll('#mc-crags-table th[data-sort]').forEach(th => {
      const isActive = th.getAttribute('data-sort') === col;
      th.dataset.sorted = isActive ? dir : '';
    });

    card.hidden = false;
  }

  // ── Render: firsts ────────────────────────────────────────────────
  function renderFirsts() {
    const card = $('#mc-firsts-card');
    const wrap = $('#mc-firsts');
    const genres = Object.keys(state.firstsByGenreGrade || {}).sort();
    if (!genres.length) { card.hidden = true; return; }
    wrap.innerHTML = genres.map(genre => {
      const byGrade = state.firstsByGenreGrade[genre];
      const entries = Object.entries(byGrade).map(([gi, v]) => ({ gi: +gi, ...v }));
      entries.sort((a, b) => b.gi - a.gi);
      const rows = entries.map(e => {
        const cragName = (state.cragsAggregated.get(e.cragId) || {}).name || e.cragId;
        return `<div class="mc-firsts-row">
          <span class="g">${escapeHtml(e.gradeLabel || intToLabel(e.gi, genre))}</span>
          <span class="c"><a href="https://thetopo.com/crags/${escapeHtml(e.cragId)}" target="_blank" rel="noopener">${escapeHtml(cragName)}</a> — ${escapeHtml(e.routeName || '')}</span>
          <span class="d">${escapeHtml(e.date || '')}</span>
        </div>`;
      }).join('');
      return `<div class="mc-firsts-genre">
        <h3>${escapeHtml(genre)}</h3>
        ${rows}
      </div>`;
    }).join('');
    card.hidden = false;
  }

  // ── Render: fun stats ─────────────────────────────────────────────
  function renderStats() {
    const card = $('#mc-stats-card');
    const wrap = $('#mc-stats');
    const stats = [];

    // Most-climbed crag
    let bestCrag = null;
    for (const c of state.cragsAggregated.values()) {
      if (!bestCrag || c.done.length > bestCrag.done.length) bestCrag = c;
    }
    if (bestCrag && bestCrag.done.length) {
      stats.push({ l: 'Most-climbed crag', v: bestCrag.name || bestCrag.id, h: `${bestCrag.done.length} sends` });
    }

    // Most-active day: any single calendar date with the most sends.
    const byDay = new Map();
    for (const r of state.done) {
      if (!r.date) continue;
      byDay.set(r.date, (byDay.get(r.date) || 0) + 1);
    }
    if (byDay.size) {
      const top = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
      const sample = state.done.find(r => r.date === top[0]);
      stats.push({ l: 'Biggest day', v: `${top[1]} sends`, h: `${top[0]}${sample && sample.cragName ? ` at ${sample.cragName}` : ''}` });
    }

    // Longest send streak (consecutive calendar days with at least one send).
    if (byDay.size) {
      const dates = [...byDay.keys()].sort();
      let best = 1, run = 1, bestEnd = dates[0];
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const cur = new Date(dates[i]);
        const diff = Math.round((cur - prev) / (24 * 3600 * 1000));
        if (diff === 1) { run++; if (run > best) { best = run; bestEnd = dates[i]; } }
        else run = 1;
      }
      if (best > 1) stats.push({ l: 'Longest send streak', v: `${best} days`, h: `ending ${bestEnd}` });
    }

    // Closest-to-finished crag (highest known completion % under 100)
    let closest = null;
    for (const c of state.cragsAggregated.values()) {
      if (!c.total || c.total <= 0) continue;
      const pct = (c.done.length / c.total) * 100;
      if (pct >= 100) continue;
      if (!closest || pct > closest.pct) closest = { c, pct };
    }
    if (closest) {
      stats.push({
        l: 'Closest to finishing',
        v: closest.c.name || closest.c.id,
        h: `${closest.pct.toFixed(0)}% — ${closest.c.total - closest.c.done.length} routes left`,
      });
    }

    // Fully sent crags
    const fullySent = [...state.cragsAggregated.values()].filter(c => c.total > 0 && c.done.length >= c.total);
    if (fullySent.length) {
      stats.push({ l: 'Crags fully sent', v: fullySent.length, h: fullySent.slice(0, 3).map(c => c.name || c.id).join(', ') });
    }

    // Hardest-grade stats, split per genre — comparing 7A boulder to 7a sport
    // is apples-to-oranges, so each genre gets its own card.
    const peakByGenre = new Map(); // genre → { gi, count }
    for (const r of state.done) {
      if (!r.gradeInt) continue;
      const g = r.genre || 'Other';
      const prev = peakByGenre.get(g);
      if (!prev || r.gradeInt > prev.gi) peakByGenre.set(g, { gi: r.gradeInt, count: 0 });
    }
    for (const r of state.done) {
      if (!r.gradeInt) continue;
      const g = r.genre || 'Other';
      const peak = peakByGenre.get(g);
      if (peak && r.gradeInt === peak.gi) peak.count++;
    }
    for (const g of sortedGenres(peakByGenre)) {
      const p = peakByGenre.get(g);
      stats.push({
        l: `Sends at hardest ${g}`,
        v: p.count,
        h: intToLabel(p.gi, g),
      });
    }

    if (!stats.length) { card.hidden = true; return; }
    wrap.innerHTML = stats.map(s => `
      <div class="mc-stat">
        <div class="l">${escapeHtml(s.l)}</div>
        <div class="v">${escapeHtml(String(s.v))}</div>
        ${s.h ? `<div class="h">${escapeHtml(s.h)}</div>` : ''}
      </div>
    `).join('');
    card.hidden = false;
  }

  // ── Render: activity (year/month/compare) ─────────────────────────
  function buildYearMonthCounts(rows) {
    // returns { yearTotals: {YYYY: n}, byYearMonth: {YYYY: [12]int}, years: [YYYY...] sorted asc }
    const yearTotals = {};
    const byYearMonth = {};
    for (const r of rows) {
      if (!r.date) continue;
      const m = r.date.match(/^(\d{4})-(\d{2})/);
      if (!m) continue;
      const y = m[1]; const mo = +m[2];
      yearTotals[y] = (yearTotals[y] || 0) + 1;
      const arr = byYearMonth[y] || (byYearMonth[y] = new Array(12).fill(0));
      if (mo >= 1 && mo <= 12) arr[mo - 1]++;
    }
    const years = Object.keys(yearTotals).sort();
    return { yearTotals, byYearMonth, years };
  }

  function deltaPill(curr, prev) {
    if (prev == null) return '';
    const diff = curr - prev;
    const cls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'flat';
    const sign = diff > 0 ? '+' : diff < 0 ? '' : '±';
    return `<span class="delta ${cls}">${sign}${diff} vs ${escapeHtml(state.compareYear || 'prev')}</span>`;
  }

  function renderActivity() {
    const card = $('#mc-activity-card');
    const ctrls = $('#mc-activity-controls');
    const body = $('#mc-activity-body');
    const { yearTotals, byYearMonth, years } = buildYearMonthCounts(state.done);
    if (!years.length) { card.hidden = true; return; }

    // Default active year: most-recent. Compare default: previous year if exists.
    if (state.activeYear == null) state.activeYear = years[years.length - 1];
    if (state.activeYear !== 'all' && !years.includes(state.activeYear)) {
      state.activeYear = years[years.length - 1];
    }

    const yearChips = ['all', ...years].map(y => {
      const lbl = y === 'all' ? 'All time' : y;
      const count = y === 'all' ? state.done.filter(r => r.date).length : (yearTotals[y] || 0);
      return `<button class="mc-chip" data-mc-year="${y}" data-active="${y === state.activeYear ? '1' : '0'}">${lbl}<span class="m" style="opacity:0.7;margin-left:6px;">${count}</span></button>`;
    }).join('');

    const yearsForCompare = years.filter(y => y !== state.activeYear);
    const compareOptions = ['off', ...yearsForCompare].map(y => {
      const lbl = y === 'off' ? 'Off' : y;
      const active = state.compareYear === y || (y === 'off' && !state.compareYear);
      return `<button class="mc-chip" data-mc-compare="${y}" data-active="${active ? '1' : '0'}">${lbl}</button>`;
    }).join('');

    ctrls.innerHTML = `
      <div class="mc-chip-row"><span class="lbl">Year</span>${yearChips}</div>
      <div class="mc-chip-row"><span class="lbl">Compare</span>${compareOptions}</div>
    `;

    ctrls.querySelectorAll('[data-mc-year]').forEach(b => {
      b.addEventListener('click', () => {
        state.activeYear = b.getAttribute('data-mc-year');
        state.selectedMonth = null;
        if (state.compareYear === state.activeYear) state.compareYear = null;
        renderActivity();
      });
    });
    ctrls.querySelectorAll('[data-mc-compare]').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.getAttribute('data-mc-compare');
        state.compareYear = v === 'off' ? null : v;
        renderActivity();
      });
    });

    function chartFor(year) {
      const counts = byYearMonth[year] || new Array(12).fill(0);
      const max = Math.max(1, ...counts);
      const months = MONTHS.map((name, i) => {
        const n = counts[i];
        const pct = (n / max) * 100;
        const selected = state.selectedMonth === (i + 1) ? '1' : '0';
        const zero = n === 0 ? '1' : '0';
        return `<div class="mc-month" data-mc-month="${i + 1}" data-selected="${selected}" data-zero="${zero}" title="${escapeHtml(name)} ${escapeHtml(year)}: ${n} sends">
          <div class="num">${n ? n : ''}</div>
          <div class="bar" style="height:${pct.toFixed(1)}%"></div>
          <div class="lbl">${escapeHtml(name.slice(0, 1))}</div>
        </div>`;
      }).join('');
      return `<div class="mc-months-row">
        <div class="ylabel">${escapeHtml(year)} · ${counts.reduce((a, b) => a + b, 0)} sends</div>
        <div class="mc-months">${months}</div>
      </div>`;
    }

    let bodyHtml = '';
    if (state.activeYear === 'all') {
      // Stack each year row when "all" is selected — gives the historical view.
      bodyHtml = years.map(y => chartFor(y)).join('');
    } else {
      bodyHtml = chartFor(state.activeYear);
      if (state.compareYear) bodyHtml += chartFor(state.compareYear);
    }

    // Summary tiles for the active scope.
    const tiles = [];
    if (state.activeYear !== 'all') {
      const total = yearTotals[state.activeYear] || 0;
      const prev = state.compareYear ? (yearTotals[state.compareYear] || 0) : null;
      const counts = byYearMonth[state.activeYear] || new Array(12).fill(0);
      const topIdx = counts.indexOf(Math.max(...counts));
      const daysSet = new Set();
      for (const r of state.done) {
        if (r.date && r.date.startsWith(state.activeYear + '-')) daysSet.add(r.date);
      }
      tiles.push({ l: `Sends in ${state.activeYear}`, v: total, delta: deltaPill(total, prev) });
      tiles.push({ l: 'Days climbed', v: daysSet.size });
      tiles.push({ l: 'Top month', v: counts[topIdx] ? MONTHS[topIdx] : '—', h: counts[topIdx] ? `${counts[topIdx]} sends` : '' });

      // Hardest per genre for this year
      const yearRows = state.done.filter(r => r.date && r.date.startsWith(state.activeYear + '-'));
      const hardest = hardestByGenre(yearRows);
      for (const g of sortedGenres(hardest)) {
        const cur = hardest.get(g);
        let dlt = '';
        if (state.compareYear) {
          const cmpRows = state.done.filter(r => r.date && r.date.startsWith(state.compareYear + '-'));
          const cmpHard = hardestByGenre(cmpRows).get(g);
          if (cmpHard) {
            const diff = cur.gi - cmpHard.gi;
            const cls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'flat';
            dlt = `<span class="delta ${cls}">${diff === 0 ? '±0' : (diff > 0 ? '+' : '') + (diff / 50).toFixed(0) + ' steps'}</span>`;
          }
        }
        tiles.push({ l: `Hardest ${g}`, v: cur.label, delta: dlt });
      }
    } else {
      tiles.push({ l: 'Total dated sends', v: state.done.filter(r => r.date).length });
      tiles.push({ l: 'Years climbing', v: years.length });
    }

    // Selected month detail
    let detailHtml = '';
    if (state.activeYear !== 'all' && state.selectedMonth) {
      const prefix = `${state.activeYear}-${String(state.selectedMonth).padStart(2, '0')}-`;
      const genreOf = (r) => (r.genre === 'Boulder' ? 'Boulder' : r.genre === 'Sport' ? 'Sport' : 'Other');
      const monthRows = state.done.filter(r => r.date && r.date.startsWith(prefix));

      // Genre filter — only offer chips for genres actually present this month.
      const present = new Set(monthRows.map(genreOf));
      const genreChips = ['all', 'Boulder', 'Sport', 'Other']
        .filter(g => g === 'all' || present.has(g))
        .map(g => {
          const lbl = g === 'all' ? 'All' : g;
          return `<button class="mc-chip" data-mc-genre="${g}" data-active="${g === state.activeGenreMonth ? '1' : '0'}">${escapeHtml(lbl)}</button>`;
        }).join('');
      const genreRow = present.size > 1 ? `<div class="mc-chip-row"><span class="lbl">Type</span>${genreChips}</div>` : '';

      const gFilter = state.activeGenreMonth;
      const rows = monthRows.filter(r => gFilter === 'all' || genreOf(r) === gFilter);
      rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const cmpRows = state.compareYear
        ? state.done.filter(r => r.date && r.date.startsWith(`${state.compareYear}-${String(state.selectedMonth).padStart(2, '0')}-`) && (gFilter === 'all' || genreOf(r) === gFilter))
        : null;
      const cmpDelta = cmpRows ? deltaPill(rows.length, cmpRows.length) : '';
      detailHtml = `
        <div class="mc-month-detail">
          <h4>${escapeHtml(MONTHS[state.selectedMonth - 1])} ${escapeHtml(state.activeYear)} — ${rows.length} sends ${cmpDelta}</h4>
          ${genreRow}
          <ul>
            ${rows.length === 0
              ? '<li class="mc-status-text">No sends this month.</li>'
              : rows.map(r => {
                  const routeHref = r.key ? `https://thetopo.com/crags/${r.key.split('/').map(encodeURIComponent).join('/routes/')}` : '';
                  const route = r.routeName
                    ? (routeHref
                        ? `<a href="${routeHref}" target="_blank" rel="noopener">${escapeHtml(r.routeName)}</a>`
                        : escapeHtml(r.routeName))
                    : '';
                  const crag = r.cragName
                    ? ` · <a class="crag" href="https://thetopo.com/crags/${encodeURIComponent(r.cragId)}" target="_blank" rel="noopener">${escapeHtml(r.cragName)}</a>`
                    : '';
                  return `<li>
                  <span class="d">${escapeHtml(r.date)}</span>
                  <span class="g">${escapeHtml(r.gradeLabel || '')}</span>
                  <span class="ty">${escapeHtml(genreOf(r))}</span>
                  <span class="r">${route}${crag}</span>
                </li>`;
                }).join('')}
          </ul>
        </div>
      `;
    }

    body.innerHTML = `
      ${bodyHtml}
      ${tiles.length ? `<div class="mc-activity-summary">${tiles.map(t => `
        <div class="mc-stat">
          <div class="l">${escapeHtml(t.l)}</div>
          <div class="v">${escapeHtml(String(t.v))} ${t.delta || ''}</div>
          ${t.h ? `<div class="h">${escapeHtml(t.h)}</div>` : ''}
        </div>
      `).join('')}</div>` : ''}
      ${detailHtml}
    `;

    body.querySelectorAll('[data-mc-month]').forEach(el => {
      el.addEventListener('click', () => {
        const m = +el.getAttribute('data-mc-month');
        state.selectedMonth = state.selectedMonth === m ? null : m;
        state.activeGenreMonth = 'all';
        renderActivity();
      });
    });

    body.querySelectorAll('[data-mc-genre]').forEach(el => {
      el.addEventListener('click', () => {
        state.activeGenreMonth = el.getAttribute('data-mc-genre');
        renderActivity();
      });
    });

    card.hidden = false;
  }

  // ── Render: crag spotlight ────────────────────────────────────────
  function renderSpotlight() {
    const card = $('#mc-spotlight-card');
    const title = $('#mc-spotlight-title');
    const sub = $('#mc-spotlight-sub');
    const body = $('#mc-spotlight-body');

    if (!state.selectedCragId) {
      card.hidden = true;
      return;
    }
    const c = state.cragsAggregated.get(state.selectedCragId);
    if (!c) {
      state.selectedCragId = null;
      card.hidden = true;
      return;
    }

    title.innerHTML = `Crag spotlight — <a href="https://thetopo.com/crags/${escapeHtml(c.id)}" target="_blank" rel="noopener">${escapeHtml(c.name || c.id)}</a>
      <button class="mc-spotlight-close" id="mc-spotlight-close" title="Clear">×</button>`;
    title.querySelector('#mc-spotlight-close').addEventListener('click', () => {
      state.selectedCragId = null;
      renderCrags();
      renderSpotlight();
    });
    sub.textContent = `${c.done.length} sends · ${c.todo.length} todos${c.total ? ` · ${c.total} total routes` : ''}`;

    // Day & year aggregates
    const days = new Set();
    const byYear = new Map(); // YYYY → { count, hardestByGenre: Map }
    for (const r of c.done) {
      if (r.date) days.add(r.date);
      const y = r.date ? r.date.slice(0, 4) : '—';
      let entry = byYear.get(y);
      if (!entry) { entry = { count: 0, rows: [] }; byYear.set(y, entry); }
      entry.count++;
      entry.rows.push(r);
    }

    const tiles = [];
    tiles.push({ l: 'Sends here', v: c.done.length });
    tiles.push({ l: 'Days climbed', v: days.size });
    if (c.total && c.total > 0) {
      const pct = Math.min(100, (c.done.length / c.total) * 100);
      tiles.push({ l: 'Crag completion', v: `${pct.toFixed(0)}%`, h: `${c.total - c.done.length} routes left` });
    }
    if (c.todo.length) tiles.push({ l: 'Todos here', v: c.todo.length });
    const dated = c.done.filter(r => r.date);
    if (dated.length) {
      const sorted = dated.slice().sort((a, b) => a.date.localeCompare(b.date));
      tiles.push({ l: 'First visit', v: sorted[0].date });
      tiles.push({ l: 'Last visit', v: sorted[sorted.length - 1].date });
    }
    const hardest = hardestByGenre(c.done);
    for (const g of sortedGenres(hardest)) {
      tiles.push({ l: `Hardest ${g}`, v: hardest.get(g).label });
    }

    const yearsHtml = [...byYear.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, entry]) => {
        const hardest = hardestByGenre(entry.rows);
        const hardestStrs = sortedGenres(hardest).map(g => `${g[0]} ${hardest.get(g).label}`).join(' · ');
        return `<div class="yr">
          <div class="y">${escapeHtml(y)}</div>
          <div class="n">${entry.count} sends</div>
          ${hardestStrs ? `<div class="h">${escapeHtml(hardestStrs)}</div>` : ''}
        </div>`;
      }).join('');

    // Days list
    const dayCounts = new Map(); // date → { count, rows }
    for (const r of c.done) {
      if (!r.date) continue;
      let entry = dayCounts.get(r.date);
      if (!entry) { entry = { count: 0, rows: [] }; dayCounts.set(r.date, entry); }
      entry.count++;
      entry.rows.push(r);
    }
    const daysList = [...dayCounts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, e]) => {
        const sample = e.rows.slice().sort((a, b) => (b.gradeInt || 0) - (a.gradeInt || 0));
        const hardestRoute = sample[0];
        return `<li>
          <span class="d">${escapeHtml(date)}</span>
          <span class="c">${e.count}</span>
          <span class="r">${hardestRoute ? `${escapeHtml(hardestRoute.gradeLabel || '')} ${escapeHtml(hardestRoute.routeName || '')}${e.count > 1 ? ` <span style="color:var(--text-muted)">+ ${e.count - 1} more</span>` : ''}` : ''}</span>
        </li>`;
      }).join('');

    body.innerHTML = `
      <div class="mc-spotlight-stats">
        ${tiles.map(t => `
          <div class="mc-stat">
            <div class="l">${escapeHtml(t.l)}</div>
            <div class="v">${escapeHtml(String(t.v))}</div>
            ${t.h ? `<div class="h">${escapeHtml(t.h)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ${yearsHtml ? `<div class="mc-spotlight-years">${yearsHtml}</div>` : ''}
      ${daysList ? `<div class="mc-spotlight-days">
        <h4>Days you've climbed here</h4>
        <ul>${daysList}</ul>
      </div>` : ''}
    `;
    card.hidden = false;
    // Scroll into view so the spotlight is visible after clicking a row.
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderAll() {
    aggregate();
    renderSummary();
    renderActivity();
    renderNext();
    renderBoard();
    renderCrags();
    renderSpotlight();
    renderFirsts();
    renderStats();
    updateCacheInfo();
  }

  function updateCacheInfo() {
    const knownTotals = [...state.cragsAggregated.values()].filter(c => c.total != null && c.total > 0).length;
    const unknownTotals = [...state.cragsAggregated.values()].filter(c => c.total == null || c.total <= 0).length;
    $('#mc-cache-info').textContent = `Cache: ${knownTotals} crags with totals, ${unknownTotals} unknown · click Refresh to re-fetch your ascents.`;
  }

  // ── Lazy-fill totals for crags we don't yet know about ─────────────
  async function fillMissingCragTotals() {
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

    const fetchedRaw = (await get(CRAG_FETCH_CACHE_KEY)) || {};
    const now = Date.now();
    const toFetch = missing.filter(id => {
      const f = fetchedRaw[id];
      return !f || (now - (f.t || 0)) > CRAG_PAGE_TTL_MS;
    });
    if (!toFetch.length) return;

    setStatus(`Fetching crag totals (0/${toFetch.length})…`, true);
    const CONCURRENCY = 4;
    let i = 0, completed = 0;
    const totalsRaw = (await get(CRAG_TOTALS_KEY)) || {};

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
    await set(CRAG_TOTALS_KEY, totalsRaw);
    await set(CRAG_FETCH_CACHE_KEY, fetchedRaw);
    state.cragTotals = totalsRaw;
  }

  // ── Boot ──────────────────────────────────────────────────────────
  async function ensureUsername() {
    const stored = await get(USERNAME_KEY);
    const input = $('#mc-user-input');
    if (stored) {
      input.value = stored;
      return stored;
    }
    return null;
  }

  async function loadAscents(useCache, user) {
    const cached = await get(ASCENTS_CACHE_KEY);
    const now = Date.now();
    if (useCache && cached && cached.user === user && (now - (cached.t || 0)) < CACHE_TTL_MS) {
      state.done = cached.done || [];
      state.todo = cached.todo || [];
      setStatus(`Loaded ${state.done.length} sends and ${state.todo.length} todos from cache.`, false);
      return;
    }
    setStatus('Fetching your ascents…', true);
    const [done, todo] = await Promise.all([
      fetchUserList(user, 'done', (t) => setStatus(t, true)),
      fetchUserList(user, 'todo', (t) => setStatus(t, true)),
    ]);
    state.done = done;
    state.todo = todo;
    await set(ASCENTS_CACHE_KEY, { user, t: Date.now(), done, todo });
    setStatus(`Fetched ${done.length} sends and ${todo.length} todos.`, false);
  }

  async function loadAllForUser(user, useCache) {
    state.user = user;
    state.cragTotals = (await get(CRAG_TOTALS_KEY)) || {};
    await loadBoard();
    try {
      await loadAscents(useCache, user);
    } catch (err) {
      setStatus(`Couldn't fetch ascents: ${err && err.message || err}. Make sure you're logged in to thetopo.com.`, false, true);
      return;
    }
    if (!state.done.length && !state.todo.length) {
      setStatus(`No ascents or todos found for "${user}". Either the username is wrong or you're not logged in to thetopo.com in this browser.`, false, true);
      renderAll();
      return;
    }
    aggregate();
    renderSummary();
    renderNext();
    renderCrags();
    renderFirsts();
    renderStats();
    updateCacheInfo();

    await fillMissingCragTotals();
    await enrichTodoStats(!useCache);
    renderAll();
    setStatus(`Showing ${state.done.length} sends · ${state.todo.length} todos · ${state.cragsAggregated.size} crags.`, false);
  }

  async function init() {
    // Wire UI
    $('#mc-refresh').addEventListener('click', async () => {
      const user = ($('#mc-user-input').value || '').trim();
      if (!user) { setStatus('Enter a username first.', false, true); return; }
      await set(USERNAME_KEY, user);
      await loadAllForUser(user, false);
    });
    $('#mc-clear').addEventListener('click', async () => {
      // Caches only — the project board (priorities/tiers/notes) is personal
      // data and deliberately survives a cache clear.
      await remove([ASCENTS_CACHE_KEY, CRAG_FETCH_CACHE_KEY, ROUTE_STATS_KEY]);
      setStatus('Cache cleared. Hit Refresh to re-fetch.', false);
      updateCacheInfo();
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

  init();
})();

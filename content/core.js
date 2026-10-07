// BetterCrags — routelist content script: constants and pure filter/sort
// logic (no DOM). Loaded first; the other content/*.js files hang their
// functions off window.BCRoutelist and pull what they need from it.
(() => {
  'use strict';
  // One namespace object shared by every content/*.js file (see core.js).
  const RL = (window.BCRoutelist = window.BCRoutelist || {});

  const {
    FONT_GRADES, FRENCH_GRADES, escapeHtml, gradeLabelFor, openListMenu,
    FEATURE_TAGS: TAGS, FEATURE_LABELS: TAG_LABELS, FEATURE_GROUPS,
    STORAGE_KEYS, storageGet, storageSet, routeKeyOf, readRouteListStore, maxPageInPager,
  } = window.BCShared;
  // Display groupings for the feature pills: [groupLabel, [key, …]].
  const TAG_GROUPS = FEATURE_GROUPS.map(([label, tags]) => [label, tags.map(([k]) => k)]);

  const PROMO_MARKERS = [
    'climbing guide to your smartphone',
    'subscription also includes access',
    "Use topos even when there's no Internet",
    'high-quality topo images',
  ];

  const SORT_OPTIONS = [
    ['rating_desc', 'Rating ↓'],
    ['rating_asc', 'Rating ↑'],
    ['ascents_desc', 'Ascents ↓'],
    ['ascents_asc', 'Ascents ↑'],
    ['grade_desc', 'Grade ↓'],
    ['grade_asc', 'Grade ↑'],
    ['name_asc', 'Name A→Z'],
    ['name_desc', 'Name Z→A'],
  ];


  const warn = (...a) => console.warn('[BetterCrags]', ...a);

  // Tuning constants.
  const ASC_SLIDER_MAX = 200;   // values >= this are treated as no upper cap
  const FIRST_CHUNK = 30;       // first synchronous batch — keep tiny for fast first paint
  const RENDER_CHUNK = 60;      // subsequent batches; small enough that each chunk leaves room for input handlers between ric ticks
  const DEFAULT_VISIBLE = 200;  // initial pagination window per filter change
  const VISIBLE_INCREMENT = 200; // rows added per "Show more" click
  const SEARCH_DEBOUNCE_MS = 180;
  const PROMO_SCAN_INTERVAL_MS = 500;
  const ric = (cb) => ('requestIdleCallback' in window)
    ? requestIdleCallback(cb, { timeout: 250 })
    : requestAnimationFrame(cb);
  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';


  // Build per-crag totals (counts + grade histogram) from a route array, so
  // visiting an area routelist incrementally fills the My Crags cache for
  // every crag that area contains — no extra fetches needed.
  function harvestCragTotals(routes) {
    const byCrag = new Map();
    for (const r of routes) {
      const id = r.crag_param_id;
      if (!id) continue;
      let entry = byCrag.get(id);
      if (!entry) {
        entry = { name: r.crag_name || '', byGenre: {}, byGrade: {}, byGenreGrade: {}, total: 0 };
        byCrag.set(id, entry);
      }
      entry.total += 1;
      const genre = r.genre || 'Other';
      entry.byGenre[genre] = (entry.byGenre[genre] || 0) + 1;
      const gi = r.grade_int || 0;
      if (gi) {
        entry.byGrade[gi] = (entry.byGrade[gi] || 0) + 1;
        const byGrade = entry.byGenreGrade[genre] || (entry.byGenreGrade[genre] = {});
        byGrade[gi] = (byGrade[gi] || 0) + 1;
      }
    }
    return byCrag;
  }



  function dominantGenre(routes) {
    const counts = new Map();
    for (const r of routes) {
      if (r.genre) counts.set(r.genre, (counts.get(r.genre) || 0) + 1);
    }
    let best = 'Boulder', bestN = 0;
    for (const [g, n] of counts) if (n > bestN) { best = g; bestN = n; }
    return best;
  }

  function pickGradeTable(routes) {
    return dominantGenre(routes) === 'Boulder' ? FONT_GRADES : FRENCH_GRADES;
  }

  function nearestGradeIndex(table, value) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < table.length; i++) {
      const d = Math.abs(table[i][0] - value);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }



  function uniq(arr) { return [...new Set(arr)].filter(x => x != null && x !== ''); }



  function matchesFilter(r, s) {
    if (s.names.length) {
      const nm = (r.name || '').toLowerCase();
      if (!s.names.some(n => nm.includes(n))) return false;
    }
    if (s.crags.length) {
      const cn = (r.crag_name || '').toLowerCase();
      if (!s.crags.some(c => cn.includes(c))) return false;
    }
    if (s.genres.size && !s.genres.has(r.genre)) return false;
    const g = r.grade_int || 0;
    if (g < s.gradeMin || g > s.gradeMax) return false;
    if (parseFloat(r.rating || 0) < s.minRating) return false;
    const ac = r.ascents_done_count || 0;
    if (ac < s.minAscents) return false;
    if (ac > s.maxAscents) return false;
    for (const t of s.include) if (!r[t]) return false;
    for (const t of s.exclude) if (r[t]) return false;
    return true;
  }

  function compareRoutes(a, b, sorts) {
    const num = (x) => (typeof x === 'number' ? x : parseFloat(x) || 0);
    for (const sort of sorts) {
      let c = 0;
      switch (sort) {
        case 'rating_desc': c = num(b.rating) - num(a.rating); break;
        case 'rating_asc':  c = num(a.rating) - num(b.rating); break;
        case 'ascents_desc': c = (b.ascents_done_count || 0) - (a.ascents_done_count || 0); break;
        case 'ascents_asc':  c = (a.ascents_done_count || 0) - (b.ascents_done_count || 0); break;
        case 'grade_desc': c = (b.grade_int || 0) - (a.grade_int || 0); break;
        case 'grade_asc':  c = (a.grade_int || 0) - (b.grade_int || 0); break;
        case 'name_asc':  c = (a.name || '').localeCompare(b.name || ''); break;
        case 'name_desc': c = (b.name || '').localeCompare(a.name || ''); break;
      }
      if (c !== 0) return c;
    }
    return 0;
  }

  // Exposed for the unit tests in test/ (not used by other files).
  Object.assign(RL, { dominantGenre });

  Object.assign(RL, { ASC_SLIDER_MAX, DEFAULT_VISIBLE, FIRST_CHUNK, PLACEHOLDER_IMG, PROMO_MARKERS, PROMO_SCAN_INTERVAL_MS, RENDER_CHUNK, SEARCH_DEBOUNCE_MS, SORT_OPTIONS, STORAGE_KEYS, TAGS, TAG_GROUPS, TAG_LABELS, VISIBLE_INCREMENT, compareRoutes, escapeHtml, gradeLabelFor, harvestCragTotals, matchesFilter, maxPageInPager, nearestGradeIndex, openListMenu, pickGradeTable, readRouteListStore, ric, routeKeyOf, storageGet, storageSet, uniq, warn });
})();

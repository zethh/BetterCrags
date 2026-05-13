(() => {
  'use strict';

  const TAGS = [
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

  const PROMO_MARKERS = [
    'climbing guide to your smartphone',
    'subscription also includes access',
    "Use topos even when there's no Internet",
    'high-quality topo images',
  ];

  // 27crags-style numeric → climbing label. Source values empirically chosen.
  // Boulder uses Font, sport/trad uses French.
  const FONT_GRADES = [
    [100, '1'], [200, '2'], [300, '3'],
    [400, '4'], [450, '4+'],
    [500, '5'], [550, '5+'],
    [600, '6A'], [625, '6A+'], [650, '6B'], [675, '6B+'],
    [700, '6C'], [725, '6C+'],
    [750, '7A'], [775, '7A+'], [800, '7B'], [825, '7B+'],
    [850, '7C'], [875, '7C+'],
    [900, '8A'], [925, '8A+'], [950, '8B'], [975, '8B+'],
    [1000, '8C'], [1025, '8C+'],
    [1050, '9A'], [1075, '9A+'], [1100, '9B'], [1125, '9B+'],
    [1150, '9C'], [1175, '9C+'],
  ];
  const FRENCH_GRADES = [
    [100, '1'], [200, '2'], [300, '3'],
    [400, '4a'], [425, '4a+'], [450, '4b'], [475, '4b+'],
    [500, '4c'], [525, '5a'], [550, '5a+'], [575, '5b'],
    [600, '5b+'], [625, '5c'], [650, '5c+'],
    [675, '6a'], [700, '6a+'], [725, '6b'], [750, '6b+'],
    [775, '6c'], [800, '6c+'],
    [825, '7a'], [850, '7a+'], [875, '7b'], [900, '7b+'],
    [925, '7c'], [950, '7c+'],
    [975, '8a'], [1000, '8a+'], [1025, '8b'], [1050, '8b+'],
    [1075, '8c'], [1100, '8c+'],
    [1125, '9a'], [1150, '9a+'], [1175, '9b'], [1200, '9b+'],
    [1225, '9c'], [1250, '9c+'],
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

  const log = (...a) => console.log('[BetterCrags]', ...a);
  const warn = (...a) => console.warn('[BetterCrags]', ...a);

  // Tuning constants.
  const ASC_SLIDER_MAX = 200;   // values >= this are treated as no upper cap
  const FIRST_CHUNK = 80;       // first synchronous batch — keep tiny for fast first paint
  const RENDER_CHUNK = 350;     // subsequent batches (one per idle/raf tick)
  const SEARCH_DEBOUNCE_MS = 180;
  const PROMO_SCAN_INTERVAL_MS = 500;
  const ric = (cb) => ('requestIdleCallback' in window)
    ? requestIdleCallback(cb, { timeout: 250 })
    : requestAnimationFrame(cb);
  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const STATE_KEY = 'bc_filter_state_v1';
  function loadSavedState() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(STATE_KEY, (o) => resolve((o && o[STATE_KEY]) || null));
      } catch { resolve(null); }
    });
  }
  function persistState(state) {
    try { chrome.storage.local.set({ [STATE_KEY]: state }); } catch {}
  }
  function captureState(panel) {
    return {
      search: panel.querySelector('[data-tt-xf-search]').value,
      sort: panel.querySelector('[data-tt-xf-sort]').value,
      gminIdx: +panel.querySelector('[data-tt-xf-gmin]').value,
      gmaxIdx: +panel.querySelector('[data-tt-xf-gmax]').value,
      minStar: +(panel.dataset.minStar || 0),
      ascMin: +panel.querySelector('[data-tt-xf-asc-min]').value,
      ascMax: +panel.querySelector('[data-tt-xf-asc-max]').value,
      genres: [...panel.querySelectorAll('[data-tt-xf-genre]')].filter(b => b.dataset.state === 'on').map(b => b.getAttribute('data-tt-xf-genre')),
      include: [...panel.querySelectorAll('[data-tt-xf-tag]')].filter(b => b.dataset.state === 'include').map(b => b.getAttribute('data-tt-xf-tag')),
      exclude: [...panel.querySelectorAll('[data-tt-xf-tag]')].filter(b => b.dataset.state === 'exclude').map(b => b.getAttribute('data-tt-xf-tag')),
      hideNative: panel.querySelector('[data-tt-xf-hide-native]').checked,
      enabled: !panel.classList.contains('tt-xf-off'),
      todo: panel.querySelector('[data-tt-xf-list="todo"]')?.dataset.state || 'ignore',
      done: panel.querySelector('[data-tt-xf-list="done"]')?.dataset.state || 'ignore',
    };
  }
  function applyState(panel, state) {
    if (!state) return;
    if (typeof state.search === 'string') panel.querySelector('[data-tt-xf-search]').value = state.search;
    if (state.sort) {
      const sortEl = panel.querySelector('[data-tt-xf-sort]');
      if ([...sortEl.options].some(o => o.value === state.sort)) sortEl.value = state.sort;
    }
    const gmin = panel.querySelector('[data-tt-xf-gmin]');
    const gmax = panel.querySelector('[data-tt-xf-gmax]');
    if (typeof state.gminIdx === 'number') gmin.value = Math.min(+gmin.max, Math.max(+gmin.min, state.gminIdx));
    if (typeof state.gmaxIdx === 'number') gmax.value = Math.min(+gmax.max, Math.max(+gmax.min, state.gmaxIdx));
    if (typeof state.minStar === 'number') panel.dataset.minStar = String(state.minStar);
    const ascMin = panel.querySelector('[data-tt-xf-asc-min]');
    const ascMax = panel.querySelector('[data-tt-xf-asc-max]');
    if (typeof state.ascMin === 'number') ascMin.value = Math.min(ASC_SLIDER_MAX, Math.max(0, state.ascMin));
    if (typeof state.ascMax === 'number') ascMax.value = Math.min(ASC_SLIDER_MAX, Math.max(0, state.ascMax));
    if (Array.isArray(state.genres)) {
      panel.querySelectorAll('[data-tt-xf-genre]').forEach(b => {
        b.dataset.state = state.genres.includes(b.getAttribute('data-tt-xf-genre')) ? 'on' : 'off';
      });
    }
    panel.querySelectorAll('[data-tt-xf-tag]').forEach(b => {
      const k = b.getAttribute('data-tt-xf-tag');
      if (Array.isArray(state.include) && state.include.includes(k)) b.dataset.state = 'include';
      else if (Array.isArray(state.exclude) && state.exclude.includes(k)) b.dataset.state = 'exclude';
      else b.dataset.state = 'ignore';
    });
    if (typeof state.hideNative === 'boolean') panel.querySelector('[data-tt-xf-hide-native]').checked = state.hideNative;
    if (typeof state.enabled === 'boolean') panel.classList.toggle('tt-xf-off', !state.enabled);
    const todoBtn = panel.querySelector('[data-tt-xf-list="todo"]');
    const doneBtn = panel.querySelector('[data-tt-xf-list="done"]');
    if (todoBtn && typeof state.todo === 'string') todoBtn.dataset.state = state.todo;
    if (doneBtn && typeof state.done === 'string') doneBtn.dataset.state = state.done;
  }

  function readEmbeddedStore() {
    const tag = document.querySelector('script[data-component-name="RouteList"]');
    if (!tag) return null;
    try {
      return JSON.parse(tag.textContent);
    } catch (err) {
      warn('failed to parse RouteList JSON', err);
      return null;
    }
  }

  function detectUsername() {
    for (const a of document.querySelectorAll('a[href^="/climbers/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/climbers\/([^/?#]+)(?:[/?#]|$)/);
      if (m && m[1] && !['top', 'index', 'search'].includes(m[1])) return m[1];
    }
    return null;
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
  function maxPageInPager(doc) {
    const pager = doc.querySelector('#table-pager');
    if (!pager) return 0;
    let mx = 0;
    for (const a of pager.querySelectorAll('a[data-page]')) {
      const p = +a.getAttribute('data-page');
      if (!isNaN(p)) mx = Math.max(mx, p);
    }
    return mx;
  }
  async function fetchPage(url, page, signal) {
    const u = new URL(url, location.origin);
    if (page > 0) u.searchParams.set('page', String(page));
    const res = await fetch(u.toString(), { credentials: 'include', signal });
    if (!res.ok) return null;
    const text = await res.text();
    return new DOMParser().parseFromString(text, 'text/html');
  }

  // Fetch page 0 to discover total page count, then fire pages 1..N in parallel.
  async function fetchRouteKeySet(url, signal) {
    const set = new Set();
    try {
      if (signal && signal.aborted) return set;
      const doc0 = await fetchPage(url, 0, signal);
      if (!doc0) return set;
      extractRouteKeysInto(doc0, set);
      const maxPage = maxPageInPager(doc0);
      if (maxPage <= 0) return set;

      const tasks = [];
      for (let p = 1; p <= Math.min(maxPage, 99); p++) {
        tasks.push(
          fetchPage(url, p, signal).then(doc => doc && extractRouteKeysInto(doc, set))
            .catch(err => {
              if (err && err.name !== 'AbortError' && err.name !== 'TypeError') {
                warn('fetchRouteKeySet page failed', url, p, err);
              }
            })
        );
      }
      await Promise.all(tasks);
      return set;
    } catch (err) {
      if (err && err.name === 'AbortError') return set.size ? set : null;
      if (err && err.name !== 'TypeError') warn('fetchRouteKeySet failed', url, err);
      return set.size ? set : null;
    }
  }

  // thetopo has a batch endpoint: /api/web01/search/photos?ids=A,B,C → { routes: [{id, photo_url}] }
  const ROUTE_IMG_CACHE = new Map(); // id (number) -> string url | '' (none)

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

  async function fetchUnrestrictedRoutes() {
    try {
      const u = new URL(location.href);
      u.searchParams.set('grade_min', '100');
      u.searchParams.set('grade_max', '1500');
      u.searchParams.delete('rating');
      // include all genres
      for (const g of ['Boulder', 'Sport', 'Traditional', 'DWS', 'Other']) {
        u.searchParams.set(g, '1');
      }
      const res = await fetch(u.toString(), { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!res.ok) { warn('unrestricted fetch failed', res.status); return null; }
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const tag = doc.querySelector('script[data-component-name="RouteList"]');
      if (!tag) { warn('unrestricted fetch had no RouteList store'); return null; }
      return JSON.parse(tag.textContent);
    } catch (err) {
      warn('unrestricted fetch threw', err);
      return null;
    }
  }

  function gradeLabelFor(gi, genre) {
    const table = genre === 'Boulder' ? FONT_GRADES : FRENCH_GRADES;
    let best = String(gi), bestD = Infinity;
    for (const [v, l] of table) {
      const d = Math.abs(v - gi);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Cache built HTML strings per route. Filter changes re-use; only invalidated
  // when the routes array itself is replaced (background-fetch expansion).
  const ROW_HTML_CACHE = new Map(); // routeId -> htmlString

  function rowHtml(route, noImageUrl) {
    const cached = ROW_HTML_CACHE.get(route.id);
    if (cached) return cached;
    const tagsHtml = TAGS
      .filter(([k]) => route[k])
      .map(([k, l]) => `<span class="tag ${k} show-tooltip" title="" data-original-title="${escapeHtml(l)}"><i class="icon icon27 icon-${k}"></i></span>`)
      .join('');
    const ratingFull = Math.round(parseFloat(route.rating) || 0);
    const starsHtml = [0, 1, 2].map(i =>
      i < ratingFull
        ? '<div class="star full glyphicon glyphicon-star"></div>'
        : '<div class="star empty glyphicon glyphicon-star-empty"></div>'
    ).join('');
    const grade = gradeLabelFor(route.grade_int || 0, route.genre);
    const routeHref = `/crags/${encodeURIComponent(route.crag_param_id || '')}/routes/${encodeURIComponent(route.param_id || '')}`;
    const cragHref = `/crags/${encodeURIComponent(route.crag_param_id || '')}`;
    const name = escapeHtml(route.name);
    const cragName = escapeHtml(route.crag_name || '');
    const genre = escapeHtml(route.genre || '');
    const ascents = route.ascents_done_count || 0;
    const rid = escapeHtml(String(route.id));
    const html = `<tr role="row" data-tt-xf-own="1" data-route-id="${rid}">
      <td><a href="${routeHref}"><div class="hidden">${name}</div><div class="tiny-topo-image"><img src="${escapeHtml(noImageUrl)}" data-bc-img-id="${rid}" alt="" loading="lazy"></div><div class="route-block"><div class="flex-container"><div class="route-block__name_container"><div class="route-block__name">${name}<div class="visible-xs-inline-block">, ${escapeHtml(grade)} <span class="stars star-span">${starsHtml}</span></div></div><div class="visible-xs-block route-block__description"><p class="route-details">${genre} at ${cragName}</p></div></div><div class="route-block__properties"><div class="visible-xs-inline-block route-property"><div class="tags visible-xs-inline-block">${tagsHtml}</div></div></div></div></div></a></td>
      <td class="hidden-xs">${escapeHtml(grade)}</td>
      <td class="hidden-xs">${genre}</td>
      <td class="hidden-xs">${ascents}</td>
      <td class="hidden-xs"><div class="tags">${tagsHtml}</div></td>
      <td class="hidden-xs"><span class="stars star-span">${starsHtml}</span></td>
      <td class="hidden-xs"><a class="lfont" href="${cragHref}">${cragName}</a></td>
    </tr>`;
    ROW_HTML_CACHE.set(route.id, html);
    return html;
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


  const PROMO_SELECTORS = ['#get-topo', 'section.buy-topo'];
  function hidePromos() {
    // Exact known selectors first — fast and reliable.
    for (const sel of PROMO_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.dataset.ttXfPromoHidden === '1') continue;
        el.style.setProperty('display', 'none', 'important');
        el.dataset.ttXfPromoHidden = '1';
      }
    }
    // Fallback keyword scan only if the known selectors miss (future-proof).
    if (document.querySelector(`[data-tt-xf-promo-hidden="1"]`)) return;
    const candidates = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.tt-xf-panel')) continue;
      if (el.dataset.ttXfPromoHidden === '1') continue;
      const text = el.textContent || '';
      if (text.length > 4000) continue;
      let hits = 0;
      for (const m of PROMO_MARKERS) if (text.includes(m)) hits++;
      if (hits >= 2) candidates.push(el);
    }
    candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const hidden = [];
    for (const c of candidates) {
      if (hidden.some(h => c.contains(h))) continue;
      c.style.setProperty('display', 'none', 'important');
      c.dataset.ttXfPromoHidden = '1';
      hidden.push(c);
    }
  }

  const NATIVE_FILTER_SELECTORS = [
    '.routelist__filter-buttons',
  ];

  const nativeHiddenSet = new Set();
  function hideNativeFilters(_listContainer, enabled) {
    if (!enabled) {
      for (const el of nativeHiddenSet) {
        el.style.removeProperty('display');
        delete el.dataset.ttXfNativeHidden;
      }
      nativeHiddenSet.clear();
      return;
    }
    for (const sel of NATIVE_FILTER_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.tt-xf-panel')) continue;
        el.dataset.ttXfNativeHidden = '1';
        el.style.setProperty('display', 'none', 'important');
        nativeHiddenSet.add(el);
      }
    }
  }

  function uniq(arr) { return [...new Set(arr)].filter(x => x != null && x !== ''); }

  function createPanel(routes, gradeTable) {
    const genres = uniq(routes.map(r => r.genre)).sort();
    const ascentsMax = Math.max(50, ...routes.map(r => r.ascents_done_count || 0));
    const minGI = Math.min(...routes.map(r => r.grade_int).filter(g => g > 0), gradeTable[0][0]);
    const maxGI = Math.max(...routes.map(r => r.grade_int).filter(g => g > 0), gradeTable[gradeTable.length - 1][0]);
    const lo = nearestGradeIndex(gradeTable, minGI);
    const hi = nearestGradeIndex(gradeTable, maxGI);

    const panel = document.createElement('div');
    panel.className = 'tt-xf-panel';
    panel.dataset.minStar = '0';
    panel.innerHTML = `
      <div class="tt-xf-row tt-xf-row-top">
        <div class="tt-xf-brand">
          <span class="tt-xf-title">BetterCrags</span>
          <span class="tt-xf-count" data-tt-xf-count></span>
        </div>
        <input type="search" placeholder="Search by name…" data-tt-xf-search>
        <label class="tt-xf-field">
          <span class="tt-xf-lbl">Sort</span>
          <select data-tt-xf-sort>
            ${SORT_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <label class="tt-xf-check"><input type="checkbox" checked data-tt-xf-hide-native> Hide site filters</label>
        <button type="button" data-tt-xf-reset class="tt-xf-reset">Reset</button>
        <button type="button" class="tt-xf-toggle" data-tt-xf-toggle aria-label="Collapse filters" title="Collapse / expand filters">Hide</button>
      </div>
      <div class="tt-xf-body">
        <div class="tt-xf-row">
          ${genres.length > 1 ? `
            <div class="tt-xf-field tt-xf-field-genre">
              <span class="tt-xf-lbl">Genre</span>
              <div class="tt-xf-pills" data-tt-xf-genres>
                ${genres.map(g => `<button type="button" class="tt-xf-pill" data-tt-xf-genre="${g}" data-state="off">${g}</button>`).join('')}
              </div>
            </div>` : ''}
          <div class="tt-xf-field tt-xf-field-grade">
            <span class="tt-xf-lbl">Grade <span class="tt-xf-meta"><span data-tt-xf-gmin-val>${gradeTable[lo][1]}</span>–<span data-tt-xf-gmax-val>${gradeTable[hi][1]}</span></span></span>
            <div class="tt-xf-range-dual" data-tt-xf-range="grade">
              <div class="tt-xf-range-track"></div>
              <div class="tt-xf-range-fill"></div>
              <input type="range" min="0" max="${gradeTable.length - 1}" step="1" value="${lo}" data-tt-xf-gmin>
              <input type="range" min="0" max="${gradeTable.length - 1}" step="1" value="${hi}" data-tt-xf-gmax>
            </div>
          </div>
          <div class="tt-xf-field tt-xf-field-stars">
            <span class="tt-xf-lbl">Min stars</span>
            <div class="tt-xf-stars" data-tt-xf-stars>
              ${[1, 2, 3].map(n => `<button type="button" class="tt-xf-star" data-tt-xf-star="${n}" aria-label="${n} stars">★</button>`).join('')}
            </div>
          </div>
          <div class="tt-xf-field tt-xf-field-asc">
            <span class="tt-xf-lbl">Ascents <span class="tt-xf-meta">
              <input type="number" class="tt-xf-num-mini" min="0" step="1" value="0" data-tt-xf-asc-min-num aria-label="Min ascents">–<input type="number" class="tt-xf-num-mini" min="0" step="1" value="${ASC_SLIDER_MAX}" data-tt-xf-asc-max-num aria-label="Max ascents (${ASC_SLIDER_MAX} = no cap)">
            </span></span>
            <div class="tt-xf-range-dual" data-tt-xf-range="ascents">
              <div class="tt-xf-range-track"></div>
              <div class="tt-xf-range-fill"></div>
              <input type="range" min="0" max="${ASC_SLIDER_MAX}" step="1" value="0" data-tt-xf-asc-min>
              <input type="range" min="0" max="${ASC_SLIDER_MAX}" step="1" value="${ASC_SLIDER_MAX}" data-tt-xf-asc-max>
            </div>
          </div>
        </div>
        <div class="tt-xf-row tt-xf-row-tags">
          <span class="tt-xf-lbl tt-xf-lbl-inline">My lists</span>
          <div class="tt-xf-pills">
            <button type="button" class="tt-xf-tag-pill" data-tt-xf-list="todo" data-state="ignore" title="On todo list">On todo</button>
            <button type="button" class="tt-xf-tag-pill" data-tt-xf-list="done" data-state="ignore" title="Already done">Done</button>
            <span class="tt-xf-hint" data-tt-xf-lists-status></span>
          </div>
        </div>
        <div class="tt-xf-row tt-xf-row-tags">
          <span class="tt-xf-lbl tt-xf-lbl-inline">Features</span>
          <div class="tt-xf-pills tt-xf-tags" data-tt-xf-tags>
            ${TAGS.map(([k, l]) => `<button type="button" class="tt-xf-tag-pill" data-tt-xf-tag="${k}" data-state="ignore">${l}</button>`).join('')}
          </div>
        </div>
        <div class="tt-xf-warn" data-tt-xf-warn hidden></div>
      </div>
    `;
    return panel;
  }

  function readFilterState(panel, gradeTable) {
    const q = (sel) => panel.querySelector(sel);
    const search = q('[data-tt-xf-search]').value.trim().toLowerCase();
    const sort = q('[data-tt-xf-sort]').value;
    const gminIdx = +q('[data-tt-xf-gmin]').value;
    const gmaxIdx = +q('[data-tt-xf-gmax]').value;
    const gradeMin = gradeTable[gminIdx][0];
    const gradeMax = gradeTable[gmaxIdx][0];
    const minRating = +(panel.dataset.minStar || 0);
    // Min: use the number input directly (allows typing past the slider's max if desired).
    const minAscNum = +q('[data-tt-xf-asc-min-num]').value;
    const minAscents = isFinite(minAscNum) ? Math.max(0, minAscNum) : +q('[data-tt-xf-asc-min]').value;
    const maxAscNum = +q('[data-tt-xf-asc-max-num]').value;
    const maxAscRaw = isFinite(maxAscNum) ? Math.max(0, maxAscNum) : +q('[data-tt-xf-asc-max]').value;
    const maxAscents = maxAscRaw >= ASC_SLIDER_MAX ? Infinity : maxAscRaw;
    const genres = new Set();
    panel.querySelectorAll('[data-tt-xf-genre]').forEach(b => {
      if (b.dataset.state === 'on') genres.add(b.getAttribute('data-tt-xf-genre'));
    });
    const include = new Set(), exclude = new Set();
    panel.querySelectorAll('[data-tt-xf-tag]').forEach(b => {
      const k = b.getAttribute('data-tt-xf-tag');
      if (b.dataset.state === 'include') include.add(k);
      else if (b.dataset.state === 'exclude') exclude.add(k);
    });
    const hideNative = q('[data-tt-xf-hide-native]').checked;
    const todo = panel.querySelector('[data-tt-xf-list="todo"]')?.dataset.state || 'ignore';
    const done = panel.querySelector('[data-tt-xf-list="done"]')?.dataset.state || 'ignore';
    return { search, sort, gradeMin, gradeMax, minRating, minAscents, maxAscents, genres, include, exclude, hideNative, todo, done };
  }

  function matchesFilter(r, s) {
    if (s.search && !((r.name || '').toLowerCase().includes(s.search))) return false;
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

  function compareRoutes(a, b, sort) {
    const num = (x) => (typeof x === 'number' ? x : parseFloat(x) || 0);
    switch (sort) {
      case 'rating_desc': return num(b.rating) - num(a.rating);
      case 'rating_asc':  return num(a.rating) - num(b.rating);
      case 'ascents_desc': return (b.ascents_done_count || 0) - (a.ascents_done_count || 0);
      case 'ascents_asc':  return (a.ascents_done_count || 0) - (b.ascents_done_count || 0);
      case 'grade_desc': return (b.grade_int || 0) - (a.grade_int || 0);
      case 'grade_asc':  return (a.grade_int || 0) - (b.grade_int || 0);
      case 'name_asc':  return (a.name || '').localeCompare(b.name || '');
      case 'name_desc': return (b.name || '').localeCompare(a.name || '');
      default: return 0;
    }
  }

  function findNavBottom() {
    const selectors = ['nav.navbar', '[data-component-name="Nav"]', 'header', '.navbar', 'nav'];
    let bottom = 0;
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.tt-xf-panel')) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky' && cs.position !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.top > 120) continue;
        if (r.bottom > bottom) bottom = r.bottom;
      }
    }
    return bottom;
  }

  function attachPanel(panel) {
    const table = document.querySelector('table.route-list');
    const target = table && table.parentElement;
    if (target && panel.parentElement !== target) {
      target.insertBefore(panel, table);
    } else if (!panel.parentElement) {
      document.body.insertBefore(panel, document.body.firstChild);
    }
    // ensure no leftover body padding from earlier versions
    if (document.body.style.paddingTop) document.body.style.removeProperty('padding-top');
  }

  function setStickyTop(panel) {
    panel.style.top = findNavBottom() + 'px';
  }

  function init() {
    const store = readEmbeddedStore();
    let routes = store && Array.isArray(store.routes) ? store.routes : [];
    if (!routes.length) { warn('no routes found in embedded store'); return; }
    const noImageUrl = (store && store.noImageUrl) || PLACEHOLDER_IMG;
    log(`loaded ${routes.length} routes; dominant genre: ${dominantGenre(routes)}`);

    const gradeTable = pickGradeTable(routes);
    const panel = createPanel(routes, gradeTable);
    attachPanel(panel);

    // If the URL has narrowing filters, fetch a wider dataset in the background.
    const urlParams = new URL(location.href).searchParams;
    const gMin = +urlParams.get('grade_min') || 100;
    const gMax = +urlParams.get('grade_max') || 1500;
    const needsWider = gMin > 100 || gMax < 1500 || urlParams.has('rating');
    if (needsWider) {
      const initialCount = routes.length;
      fetchUnrestrictedRoutes().then(wider => {
        if (!wider || !Array.isArray(wider.routes)) return;
        if (wider.routes.length <= initialCount) return;
        log(`expanded to ${wider.routes.length} routes (was ${initialCount}) via background fetch`);
        routes = wider.routes;
        ROW_HTML_CACHE.clear();
        // force re-render with new data
        renderedKey = '';
        if (typeof scheduleApply === 'function') scheduleApply();
      });
    }

    const countEl = panel.querySelector('[data-tt-xf-count]');
    const warnEl = panel.querySelector('[data-tt-xf-warn]');

    let saveTimer = null;
    let hydrated = false;
    function saveState() {
      if (!hydrated) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        persistState(captureState(panel));
      }, 200);
    }
    // Load saved state asynchronously, then mark as hydrated so saves can begin.
    loadSavedState().then(saved => {
      if (saved) applyState(panel, saved);
      try { syncGrade(); } catch {}
      try { syncAsc(); } catch {}
      try { refreshStars(); } catch {}
      hydrated = true;
      renderedKey = '';
      if (typeof scheduleApply === 'function') scheduleApply();
    });

    function setCollapsed(c) {
      panel.classList.toggle('tt-xf-collapsed', c);
      panel.querySelector('[data-tt-xf-toggle]').textContent = c ? 'Show' : 'Hide';
      setStickyTop(panel);
    }
    panel.querySelector('[data-tt-xf-toggle]').addEventListener('click', e => {
      e.stopPropagation();
      setCollapsed(!panel.classList.contains('tt-xf-collapsed'));
    });

    function setEnabled(on) {
      panel.classList.toggle('tt-xf-off', !on);
      if (on) {
        // re-engage
        const native = document.querySelector('table.route-list[data-tt-xf-native-table="1"]');
        if (native) native.style.setProperty('display', 'none', 'important');
        if (ourTable) ourTable.style.removeProperty('display');
        renderedKey = '';
        scheduleApply();
      } else {
        // restore site state
        if (ourTable) ourTable.style.setProperty('display', 'none', 'important');
        const native = document.querySelector('table.route-list[data-tt-xf-native-table="1"]');
        if (native) native.style.removeProperty('display');
        // unhide native filter bar
        hideNativeFilters(null, false);
        // unhide readmore
        const link = document.querySelector('a.readmore-toggle');
        if (link) {
          const wrap = link.closest('.text-center') || link;
          wrap.style.removeProperty('display');
          delete wrap.dataset.ttXfHidden;
        }
        readmoreHidden = false;
      }
      setStickyTop(panel);
    }
    function syncBadge() {
      try {
        chrome.runtime.sendMessage({ type: 'BC_STATE', enabled: !panel.classList.contains('tt-xf-off') });
      } catch (_) {}
    }

    // Listen for toolbar icon clicks (relayed from background.js).
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'BC_TOGGLE') {
          const wasEnabled = !panel.classList.contains('tt-xf-off');
          log(`toolbar toggle received: ${wasEnabled ? 'ON→OFF' : 'OFF→ON'}`);
          setEnabled(!wasEnabled);
          saveState();
          syncBadge();
          sendResponse({ ok: true, enabled: !wasEnabled });
        }
        return false;
      });
    }
    // Tell the background the initial state so the badge is correct from the start.
    syncBadge();

    // Save state on any user-driven change in the panel.
    panel.addEventListener('input', saveState);
    panel.addEventListener('change', saveState);
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-tt-xf-tag],[data-tt-xf-genre],[data-tt-xf-star],[data-tt-xf-reset]')) {
        saveState();
      }
    });

    panel.querySelectorAll('[data-tt-xf-tag]').forEach(b => {
      b.addEventListener('click', () => {
        const cur = b.dataset.state || 'ignore';
        b.dataset.state = cur === 'ignore' ? 'include' : cur === 'include' ? 'exclude' : 'ignore';
        scheduleApply();
      });
    });
    panel.querySelectorAll('[data-tt-xf-list]').forEach(b => {
      b.addEventListener('click', () => {
        const cur = b.dataset.state || 'ignore';
        b.dataset.state = cur === 'ignore' ? 'include' : cur === 'include' ? 'exclude' : 'ignore';
        scheduleApply();
      });
    });
    panel.querySelectorAll('[data-tt-xf-genre]').forEach(b => {
      b.addEventListener('click', () => {
        b.dataset.state = b.dataset.state === 'on' ? 'off' : 'on';
        scheduleApply();
      });
    });

    function updateDualFill(wrapper) {
      const inputs = wrapper.querySelectorAll('input[type="range"]');
      if (inputs.length < 2) return;
      const min = +inputs[0].min, max = +inputs[0].max;
      const span = max - min || 1;
      const a = (+inputs[0].value - min) / span * 100;
      const b = (+inputs[1].value - min) / span * 100;
      const fill = wrapper.querySelector('.tt-xf-range-fill');
      fill.style.left = Math.min(a, b) + '%';
      fill.style.width = Math.max(0, Math.abs(b - a)) + '%';
    }

    const gradeWrap = panel.querySelector('[data-tt-xf-range="grade"]');
    const gminEl = panel.querySelector('[data-tt-xf-gmin]');
    const gmaxEl = panel.querySelector('[data-tt-xf-gmax]');
    const gminVal = panel.querySelector('[data-tt-xf-gmin-val]');
    const gmaxVal = panel.querySelector('[data-tt-xf-gmax-val]');
    function syncGrade() {
      if (+gminEl.value > +gmaxEl.value) {
        // swap-ish: clamp the one being dragged
        const mid = (+gminEl.value + +gmaxEl.value) / 2;
        if (+gminEl.value > mid) gminEl.value = gmaxEl.value;
        else gmaxEl.value = gminEl.value;
      }
      gminVal.textContent = gradeTable[+gminEl.value][1];
      gmaxVal.textContent = gradeTable[+gmaxEl.value][1];
      updateDualFill(gradeWrap);
    }
    gminEl.addEventListener('input', () => { syncGrade(); scheduleApply(); });
    gmaxEl.addEventListener('input', () => { syncGrade(); scheduleApply(); });
    syncGrade();

    function refreshStars() {
      const v = +(panel.dataset.minStar || 0);
      panel.querySelectorAll('[data-tt-xf-star]').forEach(b => {
        const n = +b.getAttribute('data-tt-xf-star');
        b.dataset.on = n <= v ? '1' : '0';
      });
    }
    panel.querySelectorAll('[data-tt-xf-star]').forEach(b => {
      b.addEventListener('click', () => {
        const n = +b.getAttribute('data-tt-xf-star');
        const cur = +(panel.dataset.minStar || 0);
        panel.dataset.minStar = String(cur === n ? 0 : n);
        refreshStars(); scheduleApply();
      });
    });

    const ascWrap = panel.querySelector('[data-tt-xf-range="ascents"]');
    const ascMinEl = panel.querySelector('[data-tt-xf-asc-min]');
    const ascMaxEl = panel.querySelector('[data-tt-xf-asc-max]');
    const ascMinNum = panel.querySelector('[data-tt-xf-asc-min-num]');
    const ascMaxNum = panel.querySelector('[data-tt-xf-asc-max-num]');
    function syncAsc() {
      if (+ascMinEl.value > +ascMaxEl.value) {
        const mid = (+ascMinEl.value + +ascMaxEl.value) / 2;
        if (+ascMinEl.value > mid) ascMinEl.value = ascMaxEl.value;
        else ascMaxEl.value = ascMinEl.value;
      }
      ascMinNum.value = ascMinEl.value;
      ascMaxNum.value = +ascMaxEl.value >= ASC_SLIDER_MAX ? String(ASC_SLIDER_MAX) : ascMaxEl.value;
      updateDualFill(ascWrap);
    }
    ascMinEl.addEventListener('input', () => { syncAsc(); scheduleApply(); });
    ascMaxEl.addEventListener('input', () => { syncAsc(); scheduleApply(); });
    function applyNumToSliders() {
      const lo = Math.max(0, +ascMinNum.value || 0);
      const hi = Math.max(0, +ascMaxNum.value || 0);
      ascMinEl.value = String(Math.min(ASC_SLIDER_MAX, lo));
      ascMaxEl.value = String(Math.min(ASC_SLIDER_MAX, hi));
      // keep min<=max in the numbers
      if (lo > hi) ascMinNum.value = String(hi);
      updateDualFill(ascWrap);
      scheduleApply();
    }
    ascMinNum.addEventListener('input', applyNumToSliders);
    ascMaxNum.addEventListener('input', applyNumToSliders);
    syncAsc();

    let searchDebounce = null;
    panel.querySelector('[data-tt-xf-search]').addEventListener('input', () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => { searchDebounce = null; scheduleApply(); }, SEARCH_DEBOUNCE_MS);
    });
    panel.querySelector('[data-tt-xf-sort]').addEventListener('change', scheduleApply);
    panel.querySelector('[data-tt-xf-hide-native]').addEventListener('change', scheduleApply);

    panel.querySelector('[data-tt-xf-reset]').addEventListener('click', () => {
      panel.querySelector('[data-tt-xf-search]').value = '';
      panel.querySelector('[data-tt-xf-sort]').value = SORT_OPTIONS[0][0];
      gminEl.value = '0'; gmaxEl.value = String(gradeTable.length - 1);
      syncGrade();
      panel.dataset.minStar = '0'; refreshStars();
      ascMinEl.value = '0'; ascMaxEl.value = String(ASC_SLIDER_MAX);
      ascMinNum.value = '0'; ascMaxNum.value = String(ASC_SLIDER_MAX);
      syncAsc();
      panel.querySelectorAll('[data-tt-xf-tag]').forEach(b => { b.dataset.state = 'ignore'; });
      panel.querySelectorAll('[data-tt-xf-genre]').forEach(b => { b.dataset.state = 'off'; });
      panel.querySelectorAll('[data-tt-xf-list]').forEach(b => { b.dataset.state = 'ignore'; });
      scheduleApply();
    });

    // Track body offset (panel size + window resize)
    const ro = new ResizeObserver(() => setStickyTop(panel));
    ro.observe(panel);
    window.addEventListener('resize', () => setStickyTop(panel));
    setStickyTop(panel);
    setTimeout(() => setStickyTop(panel), 500);
    setTimeout(() => setStickyTop(panel), 1500);

    let pending = null;
    let lastApply = 0;
    let renderedKey = '';
    let readmoreHidden = false;
    let ourTable = null;
    let ourTbody = null;
    let cancelRender = null;
    let renderingRows = false;
    let lastPromoScan = 0;
    let todoSet = null;
    let doneSet = null;
    const userListsAbort = new AbortController();

    // Lazy image loading via batched API.
    const BATCH_SIZE = 100;        // max ids per /api/web01/search/photos request
    const BATCH_DEBOUNCE_MS = 80;  // coalesce intersections briefly into one request
    const MAX_BATCH_CONCURRENT = 3;
    const pendingIds = new Set();
    const idToImgs = new Map();    // id -> Set<HTMLImageElement>
    let batchTimer = null;
    let inFlightBatches = 0;
    const queuedBatches = [];
    function runNextBatch() {
      while (inFlightBatches < MAX_BATCH_CONCURRENT && queuedBatches.length) {
        const slice = queuedBatches.shift();
        inFlightBatches++;
        fetchPhotosBatch(slice)
          .then(map => { for (const id of slice) applyImageUrl(id, map.get(id) || ''); })
          .finally(() => { inFlightBatches--; runNextBatch(); });
      }
    }

    function applyImageUrl(id, url) {
      ROUTE_IMG_CACHE.set(id, url || '');
      const imgs = idToImgs.get(id);
      if (!imgs) return;
      if (url) {
        for (const img of imgs) if (img.isConnected) img.src = url;
      }
      idToImgs.delete(id);
    }

    async function flushBatch() {
      batchTimer = null;
      if (!pendingIds.size) return;
      const ids = [...pendingIds];
      pendingIds.clear();
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        queuedBatches.push(ids.slice(i, i + BATCH_SIZE));
      }
      runNextBatch();
    }
    function queueImage(id, img) {
      if (ROUTE_IMG_CACHE.has(id)) {
        const url = ROUTE_IMG_CACHE.get(id);
        if (url && img.isConnected) img.src = url;
        return;
      }
      let bucket = idToImgs.get(id);
      if (!bucket) { bucket = new Set(); idToImgs.set(id, bucket); }
      bucket.add(img);
      pendingIds.add(id);
      if (!batchTimer) batchTimer = setTimeout(flushBatch, BATCH_DEBOUNCE_MS);
    }

    const imgObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        imgObserver.unobserve(img);
        const id = Number(img.getAttribute('data-bc-img-id'));
        if (id) queueImage(id, img);
      }
    }, { rootMargin: '400px 0px' }) : null;

    // Walk only the newly inserted rows (rows[startIdx..end]) instead of the whole tbody —
    // avoids quadratic re-scans during chunked render.
    function observeImgsFromIndex(startIdx) {
      if (!ourTbody) return;
      const rows = ourTbody.children;
      for (let i = startIdx; i < rows.length; i++) {
        const img = rows[i].querySelector && rows[i].querySelector('img[data-bc-img-id]');
        if (!img || img.dataset.bcObserved === '1') continue;
        img.dataset.bcObserved = '1';
        const id = Number(img.getAttribute('data-bc-img-id'));
        if (ROUTE_IMG_CACHE.has(id)) {
          const url = ROUTE_IMG_CACHE.get(id);
          if (url) img.src = url;
          continue;
        }
        if (imgObserver) imgObserver.observe(img);
        else queueImage(id, img);
      }
    }

    function loadUserLists() {
      const user = detectUsername();
      const statusEl = panel.querySelector('[data-tt-xf-lists-status]');
      if (!user) {
        if (statusEl) statusEl.textContent = '(log in to use)';
        return;
      }
      if (statusEl) statusEl.textContent = `loading ${user}'s lists…`;

      function updateStatus() {
        if (!statusEl) return;
        const t = todoSet ? todoSet.size : '…';
        const d = doneSet ? doneSet.size : '…';
        statusEl.textContent = `${t} todo · ${d} done`;
      }
      // Each list populates independently — UI becomes usable as soon as either lands.
      fetchRouteKeySet(`/climbers/${encodeURIComponent(user)}/ascents/todo`, userListsAbort.signal)
        .then(s => {
          todoSet = s || new Set();
          log(`user ${user}: ${todoSet.size} on todo`);
          updateStatus();
          renderedKey = '';
          scheduleApply();
        });
      fetchRouteKeySet(`/climbers/${encodeURIComponent(user)}/ascents`, userListsAbort.signal)
        .then(s => {
          doneSet = s || new Set();
          log(`user ${user}: ${doneSet.size} done`);
          updateStatus();
          renderedKey = '';
          scheduleApply();
        });
    }
    loadUserLists();

    function ensureOurTable() {
      if (ourTable && document.contains(ourTable)) return ourTable;
      const nativeTbody = document.querySelector('table.route-list > tbody');
      if (!nativeTbody) return null;
      const nativeTable = nativeTbody.closest('table');
      if (!nativeTable) return null;
      ourTable = document.createElement('table');
      ourTable.className = (nativeTable.className || '') + ' tt-xf-our-table';
      const thead = nativeTable.querySelector('thead');
      if (thead) ourTable.appendChild(thead.cloneNode(true));
      ourTbody = document.createElement('tbody');
      ourTable.appendChild(ourTbody);
      nativeTable.insertAdjacentElement('afterend', ourTable);
      nativeTable.dataset.ttXfNativeTable = '1';
      nativeTable.style.setProperty('display', 'none', 'important');
      return ourTable;
    }

    function hideReadmore() {
      const link = document.querySelector('a.readmore-toggle');
      if (!link || link.dataset.ttXfHidden === '1') return;
      const wrapper = link.closest('.text-center') || link;
      wrapper.dataset.ttXfHidden = '1';
      wrapper.style.setProperty('display', 'none', 'important');
      readmoreHidden = true;
    }

    function apply() {
      try {
        if (panel.classList.contains('tt-xf-off')) return;
        const state = readFilterState(panel, gradeTable);

        if (!panel.parentNode) {
          attachPanel(panel);
          setStickyTop(panel);
        }

        hideNativeFilters(null, state.hideNative);
        hideReadmore();
        // Promo walk is expensive (body * scan); throttle to a few seconds.
        if (Date.now() - lastPromoScan > PROMO_SCAN_INTERVAL_MS) {
          hidePromos();
          lastPromoScan = Date.now();
        }

        const table = ensureOurTable();
        if (!table) {
          countEl.textContent = '';
          warnEl.hidden = false;
          warnEl.textContent = 'Waiting for the route list to render…';
          return;
        }

        const filtered = routes.filter(r => {
          if (!matchesFilter(r, state)) return false;
          if (state.todo !== 'ignore' || state.done !== 'ignore') {
            const key = `${r.crag_param_id}/${r.param_id}`;
            if (state.todo === 'include' && !(todoSet && todoSet.has(key))) return false;
            if (state.todo === 'exclude' && todoSet && todoSet.has(key)) return false;
            if (state.done === 'include' && !(doneSet && doneSet.has(key))) return false;
            if (state.done === 'exclude' && doneSet && doneSet.has(key)) return false;
          }
          return true;
        });
        filtered.sort((a, b) => compareRoutes(a, b, state.sort));
        // Cheap fingerprint: length + endpoints + sort + first 5 ids.
        const fp = filtered.length === 0 ? '0' :
          `${filtered.length}|${state.sort}|${filtered[0].id}|${filtered[filtered.length - 1].id}|${filtered.slice(0, 5).map(r => r.id).join(',')}`;

        if (fp !== renderedKey) {
          renderedKey = fp;
          if (cancelRender) { cancelRender(); cancelRender = null; }
          renderingRows = true;

          const FIRST = Math.min(FIRST_CHUNK, filtered.length);
          let firstHtml = '';
          for (let i = 0; i < FIRST; i++) firstHtml += rowHtml(filtered[i], noImageUrl);
          ourTbody.innerHTML = firstHtml;
          observeImgsFromIndex(0);

          if (filtered.length > FIRST) {
            let i = FIRST;
            let cancelled = false;
            cancelRender = () => { cancelled = true; renderingRows = false; };
            const tick = () => {
              if (cancelled) return;
              const end = Math.min(i + RENDER_CHUNK, filtered.length);
              let html = '';
              for (let j = i; j < end; j++) html += rowHtml(filtered[j], noImageUrl);
              const prevRowCount = ourTbody.childElementCount;
              ourTbody.insertAdjacentHTML('beforeend', html);
              observeImgsFromIndex(prevRowCount);
              i = end;
              countEl.textContent = ` ${i}/${filtered.length}…`;
              if (i < filtered.length) {
                ric(tick);
              } else {
                countEl.textContent = ` ${filtered.length}/${routes.length}`;
                cancelRender = null;
                renderingRows = false;
              }
            };
            ric(tick);
          } else {
            renderingRows = false;
          }
        }

        countEl.textContent = ` ${filtered.length}/${routes.length}`;
        warnEl.hidden = true;
        lastApply = Date.now();
      } catch (err) {
        warn('apply() threw', err);
        warnEl.hidden = false;
        warnEl.textContent = 'BetterCrags error — see console.';
      }
    }

    function scheduleApply() {
      if (pending) return;
      const wait = Math.max(0, 60 - (Date.now() - lastApply));
      pending = setTimeout(() => { pending = null; apply(); }, wait);
    }

    // Dual-range slider: drive both inputs entirely via JS pointer events on the wrapper.
    function setupDualDrag(wrapper) {
      const inputs = wrapper.querySelectorAll('input[type="range"]');
      if (inputs.length < 2) return;
      const [a, b] = inputs;
      let active = null;

      function valueFromEvent(e) {
        const rect = wrapper.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / Math.max(1, rect.width);
        const min = +a.min, max = +a.max;
        return Math.round(min + Math.max(0, Math.min(1, pct)) * (max - min));
      }
      function setVal(input, val) {
        if (+input.value === val) return;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      wrapper.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const val = valueFromEvent(e);
        const da = Math.abs(val - +a.value);
        const db = Math.abs(val - +b.value);
        active = da <= db ? a : b;
        setVal(active, val);
        try { wrapper.setPointerCapture(e.pointerId); } catch (_) {}
      });
      wrapper.addEventListener('pointermove', (e) => {
        if (!active) return;
        setVal(active, valueFromEvent(e));
      });
      function endDrag(e) {
        if (!active) return;
        try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}
        active = null;
      }
      wrapper.addEventListener('pointerup', endDrag);
      wrapper.addEventListener('pointercancel', endDrag);
    }
    setupDualDrag(gradeWrap);
    setupDualDrag(ascWrap);

    const mo = new MutationObserver(() => {
      if (renderingRows) return; // our own row inserts; ignore.
      if (!ourTable || !document.contains(ourTable)) { renderedKey = ''; scheduleApply(); return; }
      if (!readmoreHidden && document.querySelector('a.readmore-toggle')) { scheduleApply(); return; }
      if (!panel.parentNode) { attachPanel(panel); }
    });
    // Scope the observer to the routelist container if we can find one — much cheaper
    // than watching the whole document body subtree.
    const moRoot = document.querySelector('.routelist-container')
      || (document.querySelector('table.route-list') && document.querySelector('table.route-list').parentElement)
      || document.body;
    mo.observe(moRoot, { childList: true, subtree: true });

    apply();
    setTimeout(apply, 300);
    setTimeout(apply, 1200);
    // Direct promo sweeps — the section sits outside our MutationObserver scope, so
    // apply() won't fire for it. Hit a few delayed scans on init.
    hidePromos();
    setTimeout(hidePromos, 200);
    setTimeout(hidePromos, 800);
    setTimeout(hidePromos, 2500);
    setTimeout(hidePromos, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

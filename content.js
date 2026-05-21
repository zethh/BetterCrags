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

  // Display groupings for the feature pills.
  const TAG_GROUPS = [
    ['Hold type', ['crimpers', 'slopers', 'jugs', 'pockets', 'tufas', 'crack']],
    ['Wall angle', ['roof', 'overhang', 'vertical', 'slab']],
    ['Style', ['fingery', 'powerful', 'dyno', 'endurance', 'technical', 'mental', 'traverse']],
    ['Other', ['sitstart', 'topslasthold', 'tradgear_required', 'dangerous']],
  ];
  const TAG_LABELS = Object.fromEntries(TAGS);

  const PROMO_MARKERS = [
    'climbing guide to your smartphone',
    'subscription also includes access',
    "Use topos even when there's no Internet",
    'high-quality topo images',
  ];

  // 27crags-style numeric → climbing label. Source values empirically chosen.
  // Boulder uses Font, sport/trad uses French.
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

  function renderSortLevels(container, sorts) {
    const list = sorts.length ? sorts : [SORT_OPTIONS[0][0]];
    container.innerHTML = list.map((val, i) => `
      <div class="tt-xf-sort-level">
        ${i > 0 ? '<span class="tt-xf-sort-then">then by</span>' : ''}
        <select data-tt-xf-sort-select>
          ${SORT_OPTIONS.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        ${i > 0 ? `<button type="button" class="tt-xf-sort-remove" data-idx="${i}" title="Remove this sort level">×</button>` : ''}
      </div>
    `).join('');
  }

  const log = (...a) => console.log('[BetterCrags]', ...a);
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

  const META_CACHE_KEY = 'bc_meta_cache_v1';
  const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const CRAG_TOTALS_KEY = 'bc_crag_totals_v1';

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
        entry = { name: r.crag_name || '', byGenre: {}, byGrade: {}, total: 0 };
        byCrag.set(id, entry);
      }
      entry.total += 1;
      const genre = r.genre || 'Other';
      entry.byGenre[genre] = (entry.byGenre[genre] || 0) + 1;
      const gi = r.grade_int || 0;
      if (gi) entry.byGrade[gi] = (entry.byGrade[gi] || 0) + 1;
    }
    return byCrag;
  }
  function persistCragTotals(byCrag) {
    if (!byCrag || !byCrag.size) return;
    try {
      chrome.storage.local.get(CRAG_TOTALS_KEY, (o) => {
        const existing = (o && o[CRAG_TOTALS_KEY]) || {};
        const now = Date.now();
        for (const [id, data] of byCrag) {
          existing[id] = { ...data, t: now };
        }
        chrome.storage.local.set({ [CRAG_TOTALS_KEY]: existing });
      });
    } catch {}
  }
  function loadMetaCacheRaw() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(META_CACHE_KEY, (o) => resolve((o && o[META_CACHE_KEY]) || {}));
      } catch { resolve({}); }
    });
  }
  function saveMetaCacheRaw(obj) {
    try { chrome.storage.local.set({ [META_CACHE_KEY]: obj }); } catch {}
  }
  function captureState(panel) {
    return {
      search: panel.querySelector('[data-tt-xf-search]').value,
      crag: panel.querySelector('[data-tt-xf-crag]')?.value || '',
      sorts: [...panel.querySelectorAll('[data-tt-xf-sort-select]')].map(s => s.value),
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
      hasVideo: panel.querySelector('[data-tt-xf-meta="video"]')?.dataset.state || 'ignore',
      hasComment: panel.querySelector('[data-tt-xf-meta="comment"]')?.dataset.state || 'ignore',
    };
  }
  function applyState(panel, state) {
    if (!state) return;
    if (typeof state.search === 'string') panel.querySelector('[data-tt-xf-search]').value = state.search;
    if (typeof state.crag === 'string') {
      const cragEl = panel.querySelector('[data-tt-xf-crag]');
      if (cragEl) cragEl.value = state.crag;
    }
    const sortContainer = panel.querySelector('[data-tt-xf-sorts]');
    if (sortContainer) {
      const valid = new Set(SORT_OPTIONS.map(([v]) => v));
      let list = [];
      if (Array.isArray(state.sorts)) list = state.sorts.filter(v => valid.has(v));
      else if (typeof state.sort === 'string' && valid.has(state.sort)) list = [state.sort];
      if (!list.length) list = [SORT_OPTIONS[0][0]];
      renderSortLevels(sortContainer, list);
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
    const videoBtn = panel.querySelector('[data-tt-xf-meta="video"]');
    const commentBtn = panel.querySelector('[data-tt-xf-meta="comment"]');
    if (videoBtn && typeof state.hasVideo === 'string') videoBtn.dataset.state = state.hasVideo;
    if (commentBtn && typeof state.hasComment === 'string') commentBtn.dataset.state = state.hasComment;
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

  const USERNAME_KEY = 'bc_username_v1';
  function detectUsername() {
    for (const a of document.querySelectorAll('a[href^="/climbers/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/climbers\/([^/?#]+)(?:[/?#]|$)/);
      if (m && m[1] && !['top', 'index', 'search'].includes(m[1])) return m[1];
    }
    return null;
  }
  function persistUsername(user) {
    if (!user) return;
    try { chrome.storage.local.set({ [USERNAME_KEY]: user }); } catch {}
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
      let kept = 0, dropped = 0;
      for (const [id, entry] of Object.entries(obj)) {
        if (entry && entry.t && (now - entry.t) < META_TTL_MS) {
          ROUTE_META_CACHE.set(+id, entry);
          kept++;
        } else { dropped++; }
      }
      if (kept || dropped) log(`meta cache hydrated: ${kept} kept, ${dropped} expired`);
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

  // Crag routelist pages (/crags/<slug>/routelist) use a server-rendered
  // template with none of the rich fields the filters need — no embedded
  // RouteList JSON, no feature-tag markup, no numeric route ids. The parent
  // area's routelist (/areas/<area>/routelist) does embed a full JSON store
  // with every route in the area. So when we're on a crag page we derive the
  // area from the on-page link, fetch the area's store, and filter to just
  // this crag's routes.
  function detectCragRoutelistContext() {
    const m = location.pathname.match(/^\/crags\/([^/]+)\/routelist\/?$/);
    if (!m) return null;
    const crag_param_id = decodeURIComponent(m[1]);
    const areaLink = document.querySelector('.area-container a[href^="/areas/"]')
      || document.querySelector('a[href^="/areas/"]');
    const href = (areaLink && areaLink.getAttribute('href')) || '';
    const am = href.match(/^\/areas\/([^/?#]+)/);
    return { crag_param_id, area_param_id: am ? decodeURIComponent(am[1]) : null };
  }
  async function fetchAreaStore(areaParamId) {
    try {
      const u = new URL(`/areas/${encodeURIComponent(areaParamId)}/routelist`, location.origin);
      u.searchParams.set('grade_min', '100');
      u.searchParams.set('grade_max', '1500');
      for (const g of ['Boulder', 'Sport', 'Traditional', 'DWS', 'Other']) {
        u.searchParams.set(g, '1');
      }
      const res = await fetch(u.toString(), { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!res.ok) { warn('area fetch failed', res.status, areaParamId); return null; }
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const tag = doc.querySelector('script[data-component-name="RouteList"]');
      if (!tag) { warn('area fetch had no RouteList store', areaParamId); return null; }
      return JSON.parse(tag.textContent);
    } catch (err) {
      warn('area fetch threw', areaParamId, err);
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

  // ── "Add to todo" / "Mark as done" modal ────────────────────────────
  // Thetopo's add-ascent endpoint (/climbers/<user>/ascents/new) returns a
  // full HTML page with a server-rendered form (CSRF token included). We
  // fetch it, lift out the <form>, drop it into an in-page modal, and POST
  // back to the form's action when the user submits — saving without a
  // page navigation. Rails forms typically include a hidden `_method` to
  // override POST → PUT/PATCH/DELETE; FormData carries it through, so we
  // never strip or rewrite it.
  let ascentModalEl = null;
  let ascentModalKeyHandler = null;
  let ascentModalOpenToken = 0; // bumped on every open(); closures compare to detect supersession

  // Drop attributes / nodes that could execute script. The form comes from
  // the same origin so the risk is mainly defense-in-depth against a future
  // thetopo XSS leaking server-rendered content into our injected DOM.
  function sanitizeInjectedForm(form) {
    for (const node of form.querySelectorAll('script, iframe, object, embed, link[rel="import"]')) {
      node.remove();
    }
    const all = [form, ...form.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); continue; }
        const v = attr.value || '';
        if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'formaction') &&
            /^\s*javascript:/i.test(v)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  // Heuristic: did the POST response come back as another ascent-form re-render
  // (Rails-style validation failure) or contain an error flash? We can't trust
  // res.ok alone — Rails returns 200 + the new.html.erb on validation failure.
  function ascentResponseHasError(doc) {
    if (doc.querySelector('.field_with_errors, #error_explanation, .alert-danger, .alert-error, .form-error, .flash-error, .flash.error, .has-error')) {
      return true;
    }
    // The new-ascent form is the only place this hidden field appears; if it
    // shows up in the response, the form was re-rendered (validation failed).
    if (doc.querySelector('form input[name="route_id"][type="hidden"]')) return true;
    return false;
  }

  function ensureAscentModal() {
    if (ascentModalEl && document.body.contains(ascentModalEl)) return ascentModalEl;
    const overlay = document.createElement('div');
    overlay.className = 'tt-xf-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="tt-xf-modal" role="dialog" aria-modal="true">
        <div class="tt-xf-modal-header">
          <span class="tt-xf-modal-title" data-tt-xf-modal-title>Add ascent</span>
          <button type="button" class="tt-xf-modal-close" data-tt-xf-modal-close aria-label="Close">×</button>
        </div>
        <div class="tt-xf-modal-body" data-tt-xf-modal-body>Loading…</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-tt-xf-modal-close]')) {
        closeAscentModal();
      }
    });
    document.body.appendChild(overlay);
    ascentModalEl = overlay;
    return overlay;
  }
  function closeAscentModal() {
    if (!ascentModalEl) return;
    ascentModalEl.hidden = true;
    const body = ascentModalEl.querySelector('[data-tt-xf-modal-body]');
    if (body) body.innerHTML = '';
    if (ascentModalKeyHandler) {
      document.removeEventListener('keydown', ascentModalKeyHandler, true);
      ascentModalKeyHandler = null;
    }
  }
  async function openAscentModal({ user, routeId, mode, routeLabel, onSuccess }) {
    const myToken = ++ascentModalOpenToken;
    const isCurrent = () => myToken === ascentModalOpenToken;
    const overlay = ensureAscentModal();
    const title = overlay.querySelector('[data-tt-xf-modal-title]');
    const body = overlay.querySelector('[data-tt-xf-modal-body]');
    title.textContent = mode === 'todo'
      ? `Add to todo${routeLabel ? ` — ${routeLabel}` : ''}`
      : `Log ascent${routeLabel ? ` — ${routeLabel}` : ''}`;
    body.innerHTML = '<div class="tt-xf-modal-status">Loading form…</div>';
    overlay.hidden = false;

    if (ascentModalKeyHandler) document.removeEventListener('keydown', ascentModalKeyHandler, true);
    ascentModalKeyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAscentModal(); } };
    document.addEventListener('keydown', ascentModalKeyHandler, true);

    // Path-only URL by construction — we never let an external string become
    // the URL scheme, so a later `escapeHtml(formUrl)` interpolation can't
    // be turned into `javascript:` via this code path.
    const params = new URLSearchParams({ route_id: String(routeId) });
    if (mode === 'todo') params.set('todo', '1');
    const formUrl = `/climbers/${encodeURIComponent(user)}/ascents/new?${params.toString()}`;

    let html;
    try {
      const res = await fetch(formUrl, { credentials: 'include', headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      warn('ascent form fetch failed', err);
      if (!isCurrent()) return;
      body.innerHTML = `<div class="tt-xf-modal-status tt-xf-modal-error">Couldn't load the form. <a href="${escapeHtml(formUrl)}" target="_blank" rel="noreferrer noopener">Open in new tab</a> instead.</div>`;
      return;
    }
    if (!isCurrent()) return; // a newer open() superseded us while fetching

    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Prefer a form whose action posts to /ascents (route-specific); fall back to first form.
    const forms = Array.from(doc.querySelectorAll('form'));
    const form = forms.find(f => /\/ascents(\b|\/|\?|$)/.test(f.getAttribute('action') || '')) || forms[0];
    if (!form) {
      body.innerHTML = `<div class="tt-xf-modal-status tt-xf-modal-error">No form found on the page. <a href="${escapeHtml(formUrl)}" target="_blank" rel="noreferrer noopener">Open in new tab</a>.</div>`;
      return;
    }

    // Resolve relative action against the form page URL.
    const action = new URL(form.getAttribute('action') || formUrl, location.origin + formUrl).toString();
    form.setAttribute('action', action);
    sanitizeInjectedForm(form);

    body.innerHTML = '';
    body.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // FormData skips the submit button's name/value unless we add it explicitly.
      // `e.submitter` is null when the form is submitted via Enter; fall back to
      // the first [type=submit] so the server still sees the expected button.
      const submitter = e.submitter || form.querySelector('button[type="submit"], input[type="submit"]');
      const data = new FormData(form);
      if (submitter && submitter.name) data.append(submitter.name, submitter.value || '');
      const statusBar = document.createElement('div');
      statusBar.className = 'tt-xf-modal-status';
      statusBar.textContent = 'Saving…';
      body.appendChild(statusBar);
      // Disable inputs to prevent double-submit.
      for (const el of form.elements) el.disabled = true;
      try {
        const res = await fetch(action, {
          method: (form.getAttribute('method') || 'POST').toUpperCase(),
          credentials: 'include',
          body: data,
          headers: { Accept: 'text/html' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resHtml = await res.text();
        const resDoc = new DOMParser().parseFromString(resHtml, 'text/html');
        if (ascentResponseHasError(resDoc)) {
          throw new Error('the server reported a validation error');
        }
        if (typeof onSuccess === 'function') onSuccess();
        if (isCurrent()) closeAscentModal();
      } catch (err) {
        warn('ascent submit failed', err);
        if (!isCurrent()) return; // superseded modal — don't mutate the new one
        for (const el of form.elements) el.disabled = false;
        statusBar.classList.add('tt-xf-modal-error');
        statusBar.textContent = `Save failed (${err.message || err}). Try the "Open in new tab" fallback.`;
      }
    });
  }

  // Cache built HTML strings per route. Filter changes re-use; only invalidated
  // when the routes array itself is replaced (background-fetch expansion).
  // Bump when the row template's cell count or structure changes so stale
  // cached HTML from older builds doesn't survive into a new column layout.
  const ROW_HTML_VERSION = 'v3';
  const ROW_HTML_CACHE = new Map(); // `${version}:${routeId}` -> htmlString

  function rowHtml(route, noImageUrl) {
    const cacheKey = `${ROW_HTML_VERSION}:${route.id}`;
    const cached = ROW_HTML_CACHE.get(cacheKey);
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
    const routeKey = escapeHtml(`${route.crag_param_id || ''}/${route.param_id || ''}`);
    const html = `<tr role="row" data-tt-xf-own="1" data-route-id="${rid}">
      <td><a href="${routeHref}"><div class="hidden">${name}</div><div class="tiny-topo-image"><img src="${escapeHtml(noImageUrl)}" data-bc-img-id="${rid}" alt="" loading="lazy"></div><div class="route-block"><div class="flex-container"><div class="route-block__name_container"><div class="route-block__name">${name}<div class="visible-xs-inline-block">, ${escapeHtml(grade)} <span class="stars star-span">${starsHtml}</span></div></div><div class="visible-xs-block route-block__description"><p class="route-details">${genre} at ${cragName}</p></div></div><div class="route-block__properties"><div class="visible-xs-inline-block route-property"><div class="tags visible-xs-inline-block">${tagsHtml}</div></div></div></div></div></a></td>
      <td class="hidden-xs">${escapeHtml(grade)}</td>
      <td class="hidden-xs">${genre}</td>
      <td class="hidden-xs">${ascents}</td>
      <td class="hidden-xs"><div class="tags">${tagsHtml}</div></td>
      <td class="hidden-xs"><span class="stars star-span">${starsHtml}</span></td>
      <td class="hidden-xs"><a class="lfont" href="${cragHref}">${cragName}</a></td>
      <td class="hidden-xs tt-xf-row-actions-cell"><button type="button" class="tt-xf-row-act" data-bc-act="todo" data-bc-route-id="${rid}" data-bc-route-key="${routeKey}" title="Add to my todo list">+ todo</button><button type="button" class="tt-xf-row-act" data-bc-act="done" data-bc-route-id="${rid}" data-bc-route-key="${routeKey}" title="Log as done">+ done</button></td>
    </tr>`;
    ROW_HTML_CACHE.set(cacheKey, html);
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
          <span class="tt-xf-meta-progress" data-tt-xf-meta-progress hidden></span>
        </div>
        <input type="search" placeholder="Names (comma-separated)…" data-tt-xf-search>
        <input type="text" placeholder="Crags (comma-separated)…" data-tt-xf-crag>
        <label class="tt-xf-check"><input type="checkbox" checked data-tt-xf-hide-native> Hide site filters</label>
        <button type="button" data-tt-xf-mycrags class="tt-xf-reset" title="Open the My Crags dashboard">My Crags</button>
        <button type="button" data-tt-xf-reset class="tt-xf-reset">Reset</button>
        <button type="button" class="tt-xf-toggle" data-tt-xf-toggle aria-label="Collapse filters" title="Collapse / expand filters">Hide</button>
      </div>
      <div class="tt-xf-body">
        <div class="tt-xf-row tt-xf-row-sort" data-tt-xf-sort-row>
          <span class="tt-xf-lbl tt-xf-lbl-inline">Sort by</span>
          <div class="tt-xf-sort-levels" data-tt-xf-sorts></div>
          <button type="button" class="tt-xf-sort-add" data-tt-xf-sort-add title="Add a tie-breaker sort">+ Add</button>
        </div>
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
        ${TAG_GROUPS.map(([label, keys]) => {
          const extra = label === 'Other'
            ? `<button type="button" class="tt-xf-tag-pill" data-tt-xf-meta="video" data-state="ignore" title="Routes with video beta (lazy-fetched)">Has video</button>`
              + `<button type="button" class="tt-xf-tag-pill" data-tt-xf-meta="comment" data-state="ignore" title="Routes with comments (lazy-fetched)">Has comments</button>`
            : '';
          return `<div class="tt-xf-row tt-xf-row-tags">
            <span class="tt-xf-lbl tt-xf-lbl-inline">${label}</span>
            <div class="tt-xf-pills tt-xf-tags">
              ${keys.map(k => `<button type="button" class="tt-xf-tag-pill" data-tt-xf-tag="${k}" data-state="ignore">${TAG_LABELS[k]}</button>`).join('')}
              ${extra}
            </div>
          </div>`;
        }).join('')}
        <div class="tt-xf-warn" data-tt-xf-warn hidden></div>
      </div>
    `;
    return panel;
  }

  function readFilterState(panel, gradeTable) {
    const q = (sel) => panel.querySelector(sel);
    const splitCsv = (v) => (v || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const names = splitCsv(q('[data-tt-xf-search]').value);
    const crags = splitCsv(q('[data-tt-xf-crag]')?.value);
    const sortSelects = panel.querySelectorAll('[data-tt-xf-sort-select]');
    const sorts = sortSelects.length ? [...sortSelects].map(s => s.value) : [SORT_OPTIONS[0][0]];
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
    const hasVideo = panel.querySelector('[data-tt-xf-meta="video"]')?.dataset.state || 'ignore';
    const hasComment = panel.querySelector('[data-tt-xf-meta="comment"]')?.dataset.state || 'ignore';
    return { names, crags, sorts, gradeMin, gradeMax, minRating, minAscents, maxAscents, genres, include, exclude, hideNative, todo, done, hasVideo, hasComment };
  }

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

  async function init() {
    let store = readEmbeddedStore();
    let cragCtx = null;
    let allAreaRoutes = null; // full area route list when we fetched via crag fallback

    // No embedded store usually means we're on a crag routelist (different
    // template). Derive routes by fetching the parent area's store.
    if (!store || !Array.isArray(store.routes) || !store.routes.length) {
      cragCtx = detectCragRoutelistContext();
      if (cragCtx) {
        if (!cragCtx.area_param_id) {
          warn(`crag routelist "${cragCtx.crag_param_id}": no parent area link on page`);
          return;
        }
        log(`crag routelist: fetching parent area "${cragCtx.area_param_id}" for full route data…`);
        const areaStore = await fetchAreaStore(cragCtx.area_param_id);
        if (areaStore && Array.isArray(areaStore.routes)) {
          const matched = areaStore.routes.filter(r => r.crag_param_id === cragCtx.crag_param_id);
          if (matched.length) {
            allAreaRoutes = areaStore.routes;
            store = { ...areaStore, routes: matched };
            log(`derived ${matched.length} routes for crag "${cragCtx.crag_param_id}" (out of ${areaStore.routes.length} in area)`);
          } else {
            warn(`no routes matched crag "${cragCtx.crag_param_id}" in area "${cragCtx.area_param_id}"`);
          }
        }
      }
    }

    let routes = store && Array.isArray(store.routes) ? store.routes : [];
    if (!routes.length) { warn('no routes found in embedded store'); return; }
    const noImageUrl = (store && store.noImageUrl) || PLACEHOLDER_IMG;
    log(`loaded ${routes.length} routes; dominant genre: ${dominantGenre(routes)}`);

    const gradeTable = pickGradeTable(routes);
    const panel = createPanel(routes, gradeTable);
    attachPanel(panel);
    // Harvest the full area when we have it — sibling crags get free updates.
    persistCragTotals(harvestCragTotals(allAreaRoutes || routes));

    // If the URL has narrowing filters, fetch a wider dataset in the background.
    // Skip on crag routelist — we already fetched the full area.
    const urlParams = new URL(location.href).searchParams;
    const gMin = +urlParams.get('grade_min') || 100;
    const gMax = +urlParams.get('grade_max') || 1500;
    const needsWider = !cragCtx && (gMin > 100 || gMax < 1500 || urlParams.has('rating'));
    if (needsWider) {
      const initialCount = routes.length;
      fetchUnrestrictedRoutes().then(wider => {
        if (!wider || !Array.isArray(wider.routes)) return;
        if (wider.routes.length <= initialCount) return;
        log(`expanded to ${wider.routes.length} routes (was ${initialCount}) via background fetch`);
        routes = wider.routes;
        ROW_HTML_CACHE.clear();
        persistCragTotals(harvestCragTotals(routes));
        // re-warm cache so the next filter change is instant
        if (typeof warmRowCache === 'function') warmRowCache();
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
    // Load saved state + persisted meta cache in parallel, then mark hydrated.
    Promise.all([loadSavedState(), hydrateMetaCache()]).then(([saved]) => {
      if (saved) applyState(panel, saved);
      try { syncGrade(); } catch {}
      try { syncAsc(); } catch {}
      try { refreshStars(); } catch {}
      // If the saved state says disabled, run the full disengage flow so
      // promos / native filter bar / readmore are restored.
      if (saved && saved.enabled === false) setEnabled(false);
      hydrated = true;
      renderedKey = '';
      syncBadge();
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
        // Re-engage: show our panel + table, hide native ones, re-hide promos.
        panel.style.removeProperty('display');
        const native = document.querySelector('table.route-list[data-tt-xf-native-table="1"]');
        if (native) native.style.setProperty('display', 'none', 'important');
        if (ourTable) ourTable.style.removeProperty('display');
        hidePromos();
        renderedKey = '';
        scheduleApply();
      } else {
        // Disengage entirely — page should look as if the extension wasn't installed.
        panel.style.setProperty('display', 'none', 'important');
        if (ourTable) ourTable.style.setProperty('display', 'none', 'important');
        const native = document.querySelector('table.route-list[data-tt-xf-native-table="1"]');
        if (native) native.style.removeProperty('display');
        hideNativeFilters(null, false);
        const link = document.querySelector('a.readmore-toggle');
        if (link) {
          const wrap = link.closest('.text-center') || link;
          wrap.style.removeProperty('display');
          delete wrap.dataset.ttXfHidden;
        }
        readmoreHidden = false;
        // Restore promo blocks we previously hid.
        for (const el of document.querySelectorAll('[data-tt-xf-promo-hidden="1"]')) {
          el.style.removeProperty('display');
          delete el.dataset.ttXfPromoHidden;
        }
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
      if (e.target.closest('[data-tt-xf-tag],[data-tt-xf-genre],[data-tt-xf-star],[data-tt-xf-list],[data-tt-xf-meta],[data-tt-xf-reset]')) {
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
    panel.querySelectorAll('[data-tt-xf-list], [data-tt-xf-meta]').forEach(b => {
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
    let cragDebounce = null;
    panel.querySelector('[data-tt-xf-crag]')?.addEventListener('input', () => {
      if (cragDebounce) clearTimeout(cragDebounce);
      cragDebounce = setTimeout(() => { cragDebounce = null; scheduleApply(); }, SEARCH_DEBOUNCE_MS);
    });
    const sortRow = panel.querySelector('[data-tt-xf-sort-row]');
    const sortContainerInit = panel.querySelector('[data-tt-xf-sorts]');
    if (sortContainerInit && !sortContainerInit.children.length) {
      renderSortLevels(sortContainerInit, [SORT_OPTIONS[0][0]]);
    }
    sortRow?.addEventListener('change', (e) => {
      if (e.target.closest('[data-tt-xf-sort-select]')) scheduleApply();
    });
    sortRow?.addEventListener('click', (e) => {
      const rem = e.target.closest('[data-tt-xf-sort-remove]');
      if (rem) {
        const idx = +rem.dataset.idx;
        const current = [...sortContainerInit.querySelectorAll('[data-tt-xf-sort-select]')].map(s => s.value);
        current.splice(idx, 1);
        renderSortLevels(sortContainerInit, current.length ? current : [SORT_OPTIONS[0][0]]);
        scheduleApply();
        return;
      }
      if (e.target.closest('[data-tt-xf-sort-add]')) {
        const current = [...sortContainerInit.querySelectorAll('[data-tt-xf-sort-select]')].map(s => s.value);
        current.push(SORT_OPTIONS[0][0]);
        renderSortLevels(sortContainerInit, current);
        scheduleApply();
      }
    });
    panel.querySelector('[data-tt-xf-hide-native]').addEventListener('change', scheduleApply);

    panel.querySelector('[data-tt-xf-mycrags]')?.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'BC_OPEN_MYCRAGS' }); } catch (_) {}
    });

    panel.querySelector('[data-tt-xf-reset]').addEventListener('click', () => {
      panel.querySelector('[data-tt-xf-search]').value = '';
      const cragInput = panel.querySelector('[data-tt-xf-crag]');
      if (cragInput) cragInput.value = '';
      renderSortLevels(sortContainerInit, [SORT_OPTIONS[0][0]]);
      gminEl.value = '0'; gmaxEl.value = String(gradeTable.length - 1);
      syncGrade();
      panel.dataset.minStar = '0'; refreshStars();
      ascMinEl.value = '0'; ascMaxEl.value = String(ASC_SLIDER_MAX);
      ascMinNum.value = '0'; ascMaxNum.value = String(ASC_SLIDER_MAX);
      syncAsc();
      panel.querySelectorAll('[data-tt-xf-tag]').forEach(b => { b.dataset.state = 'ignore'; });
      panel.querySelectorAll('[data-tt-xf-genre]').forEach(b => { b.dataset.state = 'off'; });
      panel.querySelectorAll('[data-tt-xf-list], [data-tt-xf-meta]').forEach(b => { b.dataset.state = 'ignore'; });
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
    let visibleLimit = DEFAULT_VISIBLE;
    let lastFilterFp = '';
    let readmoreHidden = false;
    let ourTable = null;
    let ourTbody = null;
    let cancelRender = null;
    let renderingRows = false;
    let lastPromoScan = 0;
    let todoSet = null;
    let doneSet = null;
    const userListsAbort = new AbortController();

    // Per-route meta (video/comment) loading. Eagerly queued for the full
    // filtered candidate set when the filter is active so the user gets a
    // visible progress count. Results are persisted (7-day TTL) so subsequent
    // sessions resolve from cache.
    const MAX_META_CONCURRENT = 3;
    const metaQueue = [];
    let metaInFlight = 0;
    let metaCheckTotal = 0;
    let metaCheckDone = 0;
    // Bumped on cancel so any in-flight tasks queued under a prior run skip
    // counter updates (prevents progress drift after filter toggles).
    let metaRunId = 0;
    const metaProgressEl = panel.querySelector('[data-tt-xf-meta-progress]');

    // Batch meta-completion-triggered applies — without this each of 3000+
    // route fetches calls scheduleApply, causing a full filter+sort pass on
    // every fetch result. ~400ms batches mean newly-filtered routes fade
    // out a few times per second instead of continuously thrashing CPU.
    const META_APPLY_INTERVAL_MS = 400;
    let metaApplyTimer = null;
    function scheduleApplyFromMeta() {
      if (metaApplyTimer) return;
      metaApplyTimer = setTimeout(() => {
        metaApplyTimer = null;
        scheduleApply();
      }, META_APPLY_INTERVAL_MS);
    }

    function updateMetaProgress() {
      if (!metaProgressEl) return;
      const remaining = metaCheckTotal - metaCheckDone;
      if (metaCheckTotal === 0 || remaining <= 0) {
        metaProgressEl.hidden = true;
        metaProgressEl.textContent = '';
        if (metaCheckTotal > 0 && remaining <= 0) {
          metaCheckTotal = 0;
          metaCheckDone = 0;
        }
      } else {
        metaProgressEl.hidden = false;
        metaProgressEl.textContent = ` · checking ${metaCheckDone}/${metaCheckTotal}…`;
      }
    }

    function pumpMetaQueue() {
      while (metaInFlight < MAX_META_CONCURRENT && metaQueue.length) {
        const task = metaQueue.shift();
        metaInFlight++;
        Promise.resolve().then(task).finally(() => { metaInFlight--; pumpMetaQueue(); });
      }
    }

    function queueMetaForRoutes(candidates) {
      const runId = metaRunId;
      let queued = 0;
      for (const r of candidates) {
        if (ROUTE_META_CACHE.has(r.id)) continue;
        if (!r.crag_param_id || !r.param_id) continue;
        const href = `/crags/${encodeURIComponent(r.crag_param_id)}/routes/${encodeURIComponent(r.param_id)}`;
        ROUTE_META_CACHE.set(r.id, null);
        queued++;
        metaQueue.push(async () => {
          const meta = await fetchRouteMeta(href);
          if (meta) {
            ROUTE_META_CACHE.set(r.id, { video: meta.video, comment: meta.comment, t: Date.now() });
            persistMetaCacheSoon();
          } else {
            ROUTE_META_CACHE.delete(r.id);
          }
          if (runId === metaRunId) {
            metaCheckDone++;
            updateMetaProgress();
          }
          // Batched via scheduleApplyFromMeta — routes flip out in ~400ms
          // bursts during a fetch storm instead of per-completion.
          scheduleApplyFromMeta();
        });
      }
      if (queued > 0) {
        metaCheckTotal += queued;
        updateMetaProgress();
        pumpMetaQueue();
      }
    }

    function cancelMetaQueue() {
      // Drop pending work and invalidate in-flight counter updates.
      metaQueue.length = 0;
      metaCheckTotal = 0;
      metaCheckDone = 0;
      metaRunId++;
      updateMetaProgress();
    }

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

    function observeRowImg(tr) {
      const img = tr.querySelector && tr.querySelector('img[data-bc-img-id]');
      if (!img || img.dataset.bcObserved === '1') return;
      img.dataset.bcObserved = '1';
      const id = Number(img.getAttribute('data-bc-img-id'));
      if (ROUTE_IMG_CACHE.has(id)) {
        const url = ROUTE_IMG_CACHE.get(id);
        if (url) img.src = url;
        return;
      }
      if (imgObserver) imgObserver.observe(img);
      else queueImage(id, img);
    }

    // Used during keyed reconcile to build single rows. tbody is the only
    // element whose innerHTML setter parses `<tr>` correctly.
    const _rowFactory = document.createElement('tbody');
    function buildRowEl(r) {
      _rowFactory.innerHTML = rowHtml(r, noImageUrl);
      return _rowFactory.firstElementChild;
    }

    // Keyed diff between the current tbody and `filtered`. Rows that survive
    // keep their DOM node (and image observer state). Only added/removed/moved
    // rows pay DOM cost. First chunk runs sync; the tail streams in via ric so
    // long lists don't block input handlers.
    function updateMoreButton(remaining) {
      if (!ourTbody) return;
      const existing = ourTbody.querySelector('tr[data-tt-xf-more]');
      if (remaining <= 0) {
        if (existing) existing.remove();
        return;
      }
      const showN = Math.min(VISIBLE_INCREMENT, remaining);
      const label = `Show ${showN} more (${remaining} hidden)`;
      if (!existing) {
        const tr = document.createElement('tr');
        tr.dataset.ttXfMore = '1';
        tr.innerHTML = `<td colspan="99" class="tt-xf-more-cell"><button type="button" class="tt-xf-more-btn" data-tt-xf-more-btn></button></td>`;
        ourTbody.appendChild(tr);
        tr.querySelector('[data-tt-xf-more-btn]').textContent = label;
      } else {
        if (existing !== ourTbody.lastChild) ourTbody.appendChild(existing);
        existing.querySelector('[data-tt-xf-more-btn]').textContent = label;
      }
    }

    // Reflect whether a route is already on the user's todo / done list on the
    // row's quick-action buttons. Called for every placed row in reconcileTbody,
    // so both freshly-built and reused rows pick up state changes (e.g. after
    // loadUserLists resolves or a successful add-ascent submit).
    function applyRowActionStates(tr) {
      if (!tr) return;
      const todoBtn = tr.querySelector('[data-bc-act="todo"]');
      const doneBtn = tr.querySelector('[data-bc-act="done"]');
      const anyBtn = todoBtn || doneBtn;
      if (!anyBtn) return;
      const key = anyBtn.dataset.bcRouteKey || '';
      const onTodo = !!(todoSet && key && todoSet.has(key));
      const isDone = !!(doneSet && key && doneSet.has(key));
      if (todoBtn) {
        todoBtn.classList.toggle('is-on', onTodo);
        todoBtn.textContent = onTodo ? '✓ todo' : '+ todo';
        todoBtn.title = onTodo
          ? 'Already on your todo list — click to add another ascent entry'
          : 'Add to my todo list';
      }
      if (doneBtn) {
        doneBtn.classList.toggle('is-on', isDone);
        doneBtn.textContent = isDone ? '✓ done' : '+ done';
        doneBtn.title = isDone
          ? 'Already logged as done — click to log another ascent'
          : 'Log as done';
      }
    }

    function reconcileTbody(filtered) {
      const tbody = ourTbody;
      const have = new Map();
      for (let i = 0, n = tbody.children.length; i < n; i++) {
        const tr = tbody.children[i];
        const id = +tr.dataset.routeId;
        if (id) have.set(id, tr);
      }
      const wantIds = new Set();
      for (let i = 0, n = filtered.length; i < n; i++) wantIds.add(filtered[i].id);

      for (const [id, tr] of have) {
        if (!wantIds.has(id)) {
          tr.remove();
          have.delete(id);
        }
      }

      if (filtered.length === 0) {
        renderingRows = false;
        return;
      }

      function placeRange(start, end) {
        let prev = start === 0 ? null : have.get(filtered[start - 1].id) || null;
        for (let i = start; i < end; i++) {
          const r = filtered[i];
          let tr = have.get(r.id);
          if (!tr) {
            tr = buildRowEl(r);
            have.set(r.id, tr);
          }
          const expected = prev ? prev.nextSibling : tbody.firstChild;
          if (tr !== expected) tbody.insertBefore(tr, expected);
          observeRowImg(tr);
          applyRowActionStates(tr);
          prev = tr;
        }
      }

      let cancelled = false;
      cancelRender = () => { cancelled = true; renderingRows = false; };
      renderingRows = true;

      const FIRST = Math.min(FIRST_CHUNK, filtered.length);
      placeRange(0, FIRST);
      let cursor = FIRST;

      if (cursor >= filtered.length) {
        cancelRender = null;
        renderingRows = false;
        return;
      }

      const tick = () => {
        if (cancelled) return;
        const end = Math.min(cursor + RENDER_CHUNK, filtered.length);
        placeRange(cursor, end);
        cursor = end;
        countEl.textContent = ` ${cursor}/${filtered.length}…`;
        if (cursor < filtered.length) {
          ric(tick);
        } else {
          countEl.textContent = ` ${filtered.length}/${routes.length}`;
          cancelRender = null;
          renderingRows = false;
        }
      };
      ric(tick);
    }

    function loadUserLists() {
      const user = detectUsername();
      const statusEl = panel.querySelector('[data-tt-xf-lists-status]');
      if (!user) {
        if (statusEl) statusEl.textContent = '(log in to use)';
        return;
      }
      persistUsername(user);
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
      if (thead) {
        const cloned = thead.cloneNode(true);
        const headerRow = cloned.querySelector('tr');
        if (headerRow) {
          const th = document.createElement('th');
          th.className = 'hidden-xs tt-xf-row-actions-cell';
          th.setAttribute('aria-label', 'Add to todo or mark done');
          headerRow.appendChild(th);
        }
        ourTable.appendChild(cloned);
      }
      ourTbody = document.createElement('tbody');
      ourTable.appendChild(ourTbody);
      ourTbody.addEventListener('click', (e) => {
        if (e.target.closest('[data-tt-xf-more-btn]')) {
          visibleLimit += VISIBLE_INCREMENT;
          scheduleApply();
          return;
        }
        const actBtn = e.target.closest('[data-bc-act]');
        if (actBtn) {
          e.preventDefault();
          e.stopPropagation();
          handleRowAction(actBtn);
        }
      });
      nativeTable.insertAdjacentElement('afterend', ourTable);
      nativeTable.dataset.ttXfNativeTable = '1';
      nativeTable.style.setProperty('display', 'none', 'important');
      return ourTable;
    }

    function handleRowAction(btn) {
      const mode = btn.dataset.bcAct; // 'todo' | 'done'
      const routeId = +btn.dataset.bcRouteId;
      if (!routeId || (mode !== 'todo' && mode !== 'done')) return;
      const user = detectUsername();
      if (!user) {
        warnEl.hidden = false;
        warnEl.textContent = 'Log in to thetopo to add routes to your todo / done lists.';
        setTimeout(() => { warnEl.hidden = true; }, 4000);
        return;
      }
      const route = routes.find(r => r.id === routeId);
      if (!route) { warn('route lookup failed', routeId); return; }
      const key = `${route.crag_param_id}/${route.param_id}`;
      const label = `${route.name}${route.crag_name ? ` (${route.crag_name})` : ''}`;
      openAscentModal({
        user,
        routeId,
        mode,
        routeLabel: label,
        onSuccess: () => {
          if (mode === 'todo') {
            if (!todoSet) todoSet = new Set();
            todoSet.add(key);
          } else {
            if (!doneSet) doneSet = new Set();
            doneSet.add(key);
          }
          const statusEl = panel.querySelector('[data-tt-xf-lists-status]');
          if (statusEl) {
            const t = todoSet ? todoSet.size : '…';
            const d = doneSet ? doneSet.size : '…';
            statusEl.textContent = `${t} todo · ${d} done`;
          }
          renderedKey = '';
          scheduleApply();
        },
      });
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

        const needMeta = state.hasVideo !== 'ignore' || state.hasComment !== 'ignore';
        const filtered = routes.filter(r => {
          if (!matchesFilter(r, state)) return false;
          if (state.todo !== 'ignore' || state.done !== 'ignore') {
            const key = `${r.crag_param_id}/${r.param_id}`;
            if (state.todo === 'include' && !(todoSet && todoSet.has(key))) return false;
            if (state.todo === 'exclude' && todoSet && todoSet.has(key)) return false;
            if (state.done === 'include' && !(doneSet && doneSet.has(key))) return false;
            if (state.done === 'exclude' && doneSet && doneSet.has(key)) return false;
          }
          if (needMeta) {
            const meta = ROUTE_META_CACHE.get(r.id);
            // unknown (undefined) or pending (null) → keep visible; will be re-evaluated as data lands
            if (meta && typeof meta === 'object') {
              if (state.hasVideo === 'include' && !meta.video) return false;
              if (state.hasVideo === 'exclude' && meta.video) return false;
              if (state.hasComment === 'include' && !meta.comment) return false;
              if (state.hasComment === 'exclude' && meta.comment) return false;
            }
          }
          return true;
        });
        filtered.sort((a, b) => compareRoutes(a, b, state.sorts));
        // Two-level fingerprint: filterFp resets pagination when the filter
        // outcome shifts; renderFp drives whether reconcile runs.
        const sortKey = state.sorts.join('>');
        const filterFp = filtered.length === 0 ? '0' :
          `${filtered.length}|${sortKey}|${filtered[0].id}|${filtered[filtered.length - 1].id}|${filtered.slice(0, 5).map(r => r.id).join(',')}`;
        if (filterFp !== lastFilterFp) {
          visibleLimit = DEFAULT_VISIBLE;
          lastFilterFp = filterFp;
        }
        const visibleCount = Math.min(visibleLimit, filtered.length);
        const visible = visibleCount === filtered.length ? filtered : filtered.slice(0, visibleCount);
        const fp = `${filterFp}|${visibleCount}`;

        if (fp !== renderedKey) {
          renderedKey = fp;
          if (cancelRender) { cancelRender(); cancelRender = null; }
          reconcileTbody(visible);
          updateMoreButton(filtered.length - visibleCount);
        }
        if (needMeta) queueMetaForRoutes(visible); else cancelMetaQueue();

        countEl.textContent = visibleCount < filtered.length
          ? ` ${visibleCount} of ${filtered.length} (${routes.length} total)`
          : ` ${filtered.length}/${routes.length}`;
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
      pending = setTimeout(() => {
        pending = null;
        // rAF defers apply until just before next paint, which lets any pending
        // user-action style changes (button colors, slider thumbs) paint first.
        requestAnimationFrame(apply);
      }, wait);
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

    // Warm the rowHtml cache in the background so the first filter change
    // doesn't have to pay the per-row build cost.
    function warmRowCache() {
      let i = 0;
      function step(deadline) {
        const isIdle = deadline && typeof deadline.timeRemaining === 'function';
        while (i < routes.length && (!isIdle || deadline.timeRemaining() > 2)) {
          rowHtml(routes[i], noImageUrl);
          i++;
          if (!isIdle && i % 200 === 0) break;
        }
        if (i < routes.length) ric(step);
      }
      ric(step);
    }
    warmRowCache();
    // Direct promo sweeps — the section sits outside our MutationObserver scope, so
    // apply() won't fire for it. Hit a few delayed scans on init, but only while enabled.
    function maybeHidePromos() {
      if (!panel.classList.contains('tt-xf-off')) hidePromos();
    }
    maybeHidePromos();
    setTimeout(maybeHidePromos, 200);
    setTimeout(maybeHidePromos, 800);
    setTimeout(maybeHidePromos, 2500);
    setTimeout(maybeHidePromos, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

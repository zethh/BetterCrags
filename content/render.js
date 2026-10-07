// BetterCrags — routelist content script: the filter panel, row
// rendering (keyed reconciler, lazy images, lazy meta), promo hiding and
// the sticky-top / dual-slider plumbing.
(() => {
  'use strict';
  // One namespace object shared by every content/*.js file (see core.js).
  const RL = (window.BCRoutelist = window.BCRoutelist || {});
  const { ASC_SLIDER_MAX, FIRST_CHUNK, PROMO_MARKERS, RENDER_CHUNK, SORT_OPTIONS, TAGS, TAG_GROUPS, TAG_LABELS, escapeHtml, gradeLabelFor, nearestGradeIndex, readRouteListStore, ric, routeKeyOf, uniq, warn } = RL;

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

  // `applyRowActionStates` do per-row work; `countEl` shows streaming progress.
  function createRowReconciler({ getTbody, getTotal, buildRowEl, observeRowImg, unobserveRowImg, applyRowActionStates, countEl }) {
    let cancelRender = null;
    let renderingRows = false;

    function reconcile(filtered) {
      const tbody = getTbody();
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
          unobserveRowImg(tr);
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
          countEl.textContent = ` ${filtered.length}/${getTotal()}`;
          cancelRender = null;
          renderingRows = false;
        }
      };
      ric(tick);
    }

    function cancel() {
      if (cancelRender) { cancelRender(); cancelRender = null; }
    }

    return { reconcile, cancel, isRendering: () => renderingRows };
  }

  // Per-route metadata (video/comment) fetch queue with a small concurrency
  // cap, a progress counter rendered into `progressEl`, and ~400ms-batched
  // `onApply` notifications so a fetch storm doesn't thrash the filter pass.
  // `metaCache`: Map<id, {video,comment,t}|null>; `fetchMeta(href, signal)`;
  // `persistSoon()` schedules cache persistence; `onApply()` re-applies filters.
  function createMetaQueue({ progressEl, metaCache, fetchMeta, persistSoon, onApply }) {
    const MAX_META_CONCURRENT = 3;
    const metaQueue = [];
    let metaInFlight = 0;
    let metaCheckTotal = 0;
    let metaCheckDone = 0;
    // Bumped on cancel so any in-flight tasks queued under a prior run skip
    // counter updates (prevents progress drift after filter toggles).
    let metaRunId = 0;
    // Per-run controller so cancelMetaQueue can abort in-flight fetches too.
    let metaAbort = new AbortController();

    // Batch meta-completion-triggered applies — without this each of 3000+
    // route fetches calls onApply, causing a full filter+sort pass on
    // every fetch result. ~400ms batches mean newly-filtered routes fade
    // out a few times per second instead of continuously thrashing CPU.
    const META_APPLY_INTERVAL_MS = 400;
    let metaApplyTimer = null;
    function scheduleApplyFromMeta() {
      if (metaApplyTimer) return;
      metaApplyTimer = setTimeout(() => {
        metaApplyTimer = null;
        onApply();
      }, META_APPLY_INTERVAL_MS);
    }

    function updateMetaProgress() {
      if (!progressEl) return;
      const remaining = metaCheckTotal - metaCheckDone;
      if (metaCheckTotal === 0 || remaining <= 0) {
        progressEl.hidden = true;
        progressEl.textContent = '';
        if (metaCheckTotal > 0 && remaining <= 0) {
          metaCheckTotal = 0;
          metaCheckDone = 0;
        }
      } else {
        progressEl.hidden = false;
        progressEl.textContent = ` · checking ${metaCheckDone}/${metaCheckTotal}…`;
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
      const signal = metaAbort.signal;
      let queued = 0;
      for (const r of candidates) {
        if (metaCache.has(r.id)) continue;
        if (!r.crag_param_id || !r.param_id) continue;
        const href = `/crags/${encodeURIComponent(r.crag_param_id)}/routes/${encodeURIComponent(r.param_id)}`;
        metaCache.set(r.id, null);
        queued++;
        metaQueue.push(async () => {
          const meta = await fetchMeta(href, signal);
          if (meta) {
            metaCache.set(r.id, { video: meta.video, comment: meta.comment, t: Date.now() });
            persistSoon();
          } else {
            metaCache.delete(r.id);
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
      // Drop pending work, abort in-flight fetches, and invalidate
      // in-flight counter updates.
      if (metaApplyTimer) { clearTimeout(metaApplyTimer); metaApplyTimer = null; }
      metaQueue.length = 0;
      metaCheckTotal = 0;
      metaCheckDone = 0;
      metaRunId++;
      metaAbort.abort();
      metaAbort = new AbortController();
      updateMetaProgress();
    }

    return { queueMetaForRoutes, cancelMetaQueue };
  }

  // Lazy image loading via the batched photos API. Visible row images are
  // observed; intersecting ids are coalesced into batch requests through a
  // small concurrency-capped queue.
  // `imgCache`: Map<id, url|''>; `fetchBatch(ids) -> Promise<Map<id, url>>`.
  function createImageLazyLoader({ imgCache, fetchBatch }) {
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
        fetchBatch(slice)
          .then(map => { for (const id of slice) applyImageUrl(id, map.get(id) || ''); })
          .finally(() => { inFlightBatches--; runNextBatch(); });
      }
    }

    function applyImageUrl(id, url) {
      imgCache.set(id, url || '');
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
      if (imgCache.has(id)) {
        const url = imgCache.get(id);
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
      if (imgCache.has(id)) {
        const url = imgCache.get(id);
        if (url) img.src = url;
        return;
      }
      if (imgObserver) imgObserver.observe(img);
      else queueImage(id, img);
    }

    // Called when a row leaves the DOM during reconcile — drop its observer
    // registration and any pending-batch bucket entry so they don't accumulate.
    function unobserveRowImg(tr) {
      const img = tr.querySelector && tr.querySelector('img[data-bc-img-id]');
      if (!img) return;
      if (imgObserver && img.dataset.bcObserved === '1') imgObserver.unobserve(img);
      delete img.dataset.bcObserved;
      const id = Number(img.getAttribute('data-bc-img-id'));
      const bucket = idToImgs.get(id);
      if (bucket) {
        bucket.delete(img);
        if (!bucket.size) idToImgs.delete(id);
      }
    }

    return { observeRowImg, unobserveRowImg };
  }

  // Fetch a routelist page with all filters widened (full grade span, every
  // genre, no rating cut) and return its embedded RouteList JSON store.
  async function fetchRouteListStore(baseUrl, label) {
    try {
      const u = new URL(baseUrl, location.origin);
      u.searchParams.set('grade_min', '100');
      u.searchParams.set('grade_max', '1500');
      u.searchParams.delete('rating');
      // include all genres
      for (const g of ['Boulder', 'Sport', 'Traditional', 'DWS', 'Other']) {
        u.searchParams.set(g, '1');
      }
      const res = await fetch(u.toString(), { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!res.ok) { warn(`${label} fetch failed`, res.status); return null; }
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const store = readRouteListStore(doc);
      if (!store) { warn(`${label} fetch had no RouteList store`); return null; }
      return store;
    } catch (err) {
      warn(`${label} fetch threw`, err);
      return null;
    }
  }

  function fetchUnrestrictedRoutes() {
    return fetchRouteListStore(location.href, 'unrestricted');
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
  function fetchAreaStore(areaParamId) {
    return fetchRouteListStore(`/areas/${encodeURIComponent(areaParamId)}/routelist`, `area "${areaParamId}"`);
  }

  const ROW_HTML_VERSION = 'v4';
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
    const ascents = Number(route.ascents_done_count) || 0;
    const rid = escapeHtml(String(route.id));
    const routeKey = escapeHtml(routeKeyOf(route));
    const html = `<tr role="row" data-tt-xf-own="1" data-route-id="${rid}">
      <td><a href="${routeHref}"><div class="hidden">${name}</div><div class="tiny-topo-image"><img src="${escapeHtml(noImageUrl)}" data-bc-img-id="${rid}" alt="" loading="lazy"></div><div class="route-block"><div class="flex-container"><div class="route-block__name_container"><div class="route-block__name">${name}<div class="visible-xs-inline-block">, ${escapeHtml(grade)} <span class="stars star-span">${starsHtml}</span></div></div><div class="visible-xs-block route-block__description"><p class="route-details">${genre} at ${cragName}</p></div></div><div class="route-block__properties"><div class="visible-xs-inline-block route-property"><div class="tags visible-xs-inline-block">${tagsHtml}</div></div></div></div></div></a></td>
      <td class="hidden-xs">${escapeHtml(grade)}</td>
      <td class="hidden-xs">${genre}</td>
      <td class="hidden-xs">${ascents}</td>
      <td class="hidden-xs"><div class="tags">${tagsHtml}</div></td>
      <td class="hidden-xs"><span class="stars star-span">${starsHtml}</span></td>
      <td class="hidden-xs"><a class="lfont" href="${cragHref}">${cragName}</a></td>
      <td class="hidden-xs tt-xf-row-actions-cell"><button type="button" class="tt-xf-row-act" data-bc-act="todo" data-bc-route-id="${rid}" data-bc-route-key="${routeKey}" title="Add to my todo list">+ todo</button><button type="button" class="tt-xf-row-act" data-bc-act="done" data-bc-route-id="${rid}" data-bc-route-key="${routeKey}" title="Log as done">+ done</button><button type="button" class="tt-xf-row-act" data-bc-act="list" data-bc-route-id="${rid}" data-bc-route-key="${routeKey}" title="Add to a custom tier-list">+ list</button></td>
    </tr>`;
    ROW_HTML_CACHE.set(cacheKey, html);
    return html;
  }


  const PROMO_SELECTORS = ['#get-topo', 'section.buy-topo'];
  // The fallback keyword scan walks every body element; give up after a few
  // empty scans — a promo that hasn't appeared by then isn't coming.
  const PROMO_SCAN_MAX_MISSES = 8;
  let promoScanMisses = 0;
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
    if (promoScanMisses >= PROMO_SCAN_MAX_MISSES) return;
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
    if (hidden.length) promoScanMisses = 0;
    else promoScanMisses++;
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
                ${genres.map(g => `<button type="button" class="tt-xf-pill" data-tt-xf-genre="${escapeHtml(g)}" data-state="off">${escapeHtml(g)}</button>`).join('')}
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

  // We matched a routelist URL but couldn't find thetopo's route data on it.
  // Say so in the page: a silent bail looks exactly like a disabled
  // extension, which sends people hunting through chrome://extensions
  // instead of realising the site changed under us.
  function showBreakageNotice(detail) {
    warn(detail);
    if (document.querySelector('.tt-xf-notice')) return;
    const el = document.createElement('div');
    el.className = 'tt-xf-notice';
    el.setAttribute('role', 'status');
    el.innerHTML = `<strong>BetterCrags:</strong> ${escapeHtml(detail)} thetopo.com may have changed its page layout — check for a BetterCrags update. <button type="button" class="tt-xf-notice-close" aria-label="Dismiss">×</button>`;
    el.querySelector('.tt-xf-notice-close').addEventListener('click', () => el.remove());
    const table = document.querySelector('table.route-list');
    if (table && table.parentElement) table.parentElement.insertBefore(el, table);
    else document.body.insertBefore(el, document.body.firstChild);
  }


  Object.assign(RL, { ROW_HTML_CACHE, applyState, attachPanel, captureState, createImageLazyLoader, createMetaQueue, createPanel, createRowReconciler, detectCragRoutelistContext, fetchAreaStore, fetchUnrestrictedRoutes, hideNativeFilters, hidePromos, readFilterState, renderSortLevels, rowHtml, setStickyTop, setupDualDrag, showBreakageNotice });
})();

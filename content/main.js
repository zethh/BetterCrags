// BetterCrags — routelist content script: init() wires everything
// together on an area / crag routelist page. Loaded last.
(() => {
  'use strict';
  // One namespace object shared by every content/*.js file (see core.js).
  const RL = (window.BCRoutelist = window.BCRoutelist || {});
  const { ASC_SLIDER_MAX, DEFAULT_VISIBLE, PLACEHOLDER_IMG, PROMO_SCAN_INTERVAL_MS, ROUTE_IMG_CACHE, ROUTE_META_CACHE, ROW_HTML_CACHE, SEARCH_DEBOUNCE_MS, SORT_OPTIONS, VISIBLE_INCREMENT, applyState, attachPanel, captureState, compareRoutes, createImageLazyLoader, createMetaQueue, createPanel, createRowReconciler, detectCragRoutelistContext, detectUsername, escapeHtml, fetchAreaStore, fetchPhotosBatch, fetchRouteKeySet, fetchRouteMeta, fetchUnrestrictedRoutes, harvestCragTotals, hideNativeFilters, hidePromos, hydrateMetaCache, loadSavedState, matchesFilter, openAscentModal, openListMenu, persistCragTotals, persistMetaCacheSoon, persistState, persistUsername, pickGradeTable, readEmbeddedStore, readFilterState, renderSortLevels, ric, routeKeyOf, rowHtml, setStickyTop, setupDualDrag, showBreakageNotice, uniq, warn } = RL;

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
          showBreakageNotice(`couldn't find this crag's parent area link on the page, so the filters can't load its routes.`);
          return;
        }
        const areaStore = await fetchAreaStore(cragCtx.area_param_id);
        if (areaStore && Array.isArray(areaStore.routes)) {
          const matched = areaStore.routes.filter(r => r.crag_param_id === cragCtx.crag_param_id);
          if (matched.length) {
            allAreaRoutes = areaStore.routes;
            store = { ...areaStore, routes: matched };
          } else {
            showBreakageNotice(`no routes for crag "${cragCtx.crag_param_id}" were found in the area "${cragCtx.area_param_id}" data, so the filters can't load here.`);
            return;
          }
        } else {
          showBreakageNotice(`the area routelist for "${cragCtx.area_param_id}" didn't include its route data, so the filters can't load.`);
          return;
        }
      }
    }

    let routes = store && Array.isArray(store.routes) ? store.routes : [];
    if (!routes.length) {
      // An embedded store with zero routes is a legitimately empty area; no
      // store at all on a routelist URL means the page isn't what we expect.
      if (!store) showBreakageNotice('couldn\'t find the route data this page normally embeds, so the filters are unavailable here.');
      else warn('no routes found in embedded store');
      return;
    }
    const noImageUrl = (store && store.noImageUrl) || PLACEHOLDER_IMG;

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
        routes = wider.routes;
        ROW_HTML_CACHE.clear();
        persistCragTotals(harvestCragTotals(routes));
        // the wider set may contain genres the initial pills didn't cover
        rebuildGenrePills();
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
        persistState(captureState(panel)).then(ok => {
          if (ok) return;
          warnEl.hidden = false;
          warnEl.textContent = 'Couldn\'t save your filter settings (storage error) — they\'ll reset on reload.';
        });
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

    function bindTriStatePill(b) {
      b.addEventListener('click', () => {
        const cur = b.dataset.state || 'ignore';
        b.dataset.state = cur === 'ignore' ? 'include' : cur === 'include' ? 'exclude' : 'ignore';
        scheduleApply();
      });
    }
    panel.querySelectorAll('[data-tt-xf-tag], [data-tt-xf-list], [data-tt-xf-meta]').forEach(bindTriStatePill);
    function bindGenrePill(b) {
      b.addEventListener('click', () => {
        b.dataset.state = b.dataset.state === 'on' ? 'off' : 'on';
        scheduleApply();
      });
    }
    panel.querySelectorAll('[data-tt-xf-genre]').forEach(bindGenrePill);

    // The wider background fetch can introduce genres that were absent from
    // the initial route set (and the whole pill group is omitted when the
    // initial set has <= 1 genre). Rebuild the pills from the current
    // `routes` so mixed results stay filterable, preserving active states.
    function rebuildGenrePills() {
      const genres = uniq(routes.map(r => r.genre)).sort();
      let pills = panel.querySelector('[data-tt-xf-genres]');
      if (genres.length <= 1 && !pills) return;
      const prevOn = new Set([...panel.querySelectorAll('[data-tt-xf-genre]')]
        .filter(b => b.dataset.state === 'on')
        .map(b => b.getAttribute('data-tt-xf-genre')));
      if (!pills) {
        const gradeField = panel.querySelector('.tt-xf-field-grade');
        if (!gradeField) return;
        const field = document.createElement('div');
        field.className = 'tt-xf-field tt-xf-field-genre';
        field.innerHTML = '<span class="tt-xf-lbl">Genre</span><div class="tt-xf-pills" data-tt-xf-genres></div>';
        gradeField.parentElement.insertBefore(field, gradeField);
        pills = field.querySelector('[data-tt-xf-genres]');
      }
      pills.innerHTML = genres.map(g => `<button type="button" class="tt-xf-pill" data-tt-xf-genre="${escapeHtml(g)}" data-state="${prevOn.has(g) ? 'on' : 'off'}">${escapeHtml(g)}</button>`).join('');
      pills.querySelectorAll('[data-tt-xf-genre]').forEach(bindGenrePill);
    }

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
    let lastPromoScan = 0;
    let todoSet = null;
    let doneSet = null;
    const userListsAbort = new AbortController();
    // Teardown: cancel in-flight list-page fetches when the page goes away.
    window.addEventListener('pagehide', () => userListsAbort.abort(), { once: true });

    // Per-route meta (video/comment) loading. Queued for the currently
    // visible slice each time apply() runs while the filter is active, with
    // a visible progress count. Results are persisted (7-day TTL) so
    // subsequent sessions resolve from cache.
    const { queueMetaForRoutes, cancelMetaQueue } = createMetaQueue({
      progressEl: panel.querySelector('[data-tt-xf-meta-progress]'),
      metaCache: ROUTE_META_CACHE,
      fetchMeta: fetchRouteMeta,
      persistSoon: persistMetaCacheSoon,
      onApply: () => scheduleApply(),
    });

    // Lazy image loading via batched API.
    const { observeRowImg, unobserveRowImg } = createImageLazyLoader({
      imgCache: ROUTE_IMG_CACHE,
      fetchBatch: fetchPhotosBatch,
    });

    // Used during keyed reconcile to build single rows. tbody is the only
    // element whose innerHTML setter parses `<tr>` correctly.
    const _rowFactory = document.createElement('tbody');
    function buildRowEl(r) {
      _rowFactory.innerHTML = rowHtml(r, noImageUrl);
      return _rowFactory.firstElementChild;
    }

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
    // row's quick-action buttons. Called for every row the reconciler places,
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

    const rowReconciler = createRowReconciler({
      getTbody: () => ourTbody,
      getTotal: () => routes.length,
      buildRowEl,
      observeRowImg,
      unobserveRowImg,
      applyRowActionStates,
      countEl,
    });

    function updateListsStatus() {
      const statusEl = panel.querySelector('[data-tt-xf-lists-status]');
      if (!statusEl) return;
      const t = todoSet ? todoSet.size : '…';
      const d = doneSet ? doneSet.size : '…';
      statusEl.textContent = `${t} todo · ${d} done`;
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
      // Each list populates independently — UI becomes usable as soon as either lands.
      fetchRouteKeySet(`/climbers/${encodeURIComponent(user)}/ascents/todo`, userListsAbort.signal)
        .then(s => {
          todoSet = s || new Set();
          updateListsStatus();
          renderedKey = '';
          scheduleApply();
        });
      fetchRouteKeySet(`/climbers/${encodeURIComponent(user)}/ascents`, userListsAbort.signal)
        .then(s => {
          doneSet = s || new Set();
          updateListsStatus();
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
      const mode = btn.dataset.bcAct; // 'todo' | 'done' | 'list'
      const routeId = +btn.dataset.bcRouteId;
      if (!routeId) return;
      const route = routes.find(r => r.id === routeId);
      if (!route) { warn('route lookup failed', routeId); return; }
      // Custom tier-lists are stored locally — no login needed.
      if (mode === 'list') { openListMenu(btn, route); return; }
      if (mode !== 'todo' && mode !== 'done') return;
      const user = detectUsername();
      if (!user) {
        warnEl.hidden = false;
        warnEl.textContent = 'Log in to thetopo to add routes to your todo / done lists.';
        setTimeout(() => { warnEl.hidden = true; }, 4000);
        return;
      }
      const key = routeKeyOf(route);
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
          updateListsStatus();
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
        // Promo walk is expensive (body * scan); throttle to one scan per
        // PROMO_SCAN_INTERVAL_MS (500ms). The fallback body scan inside
        // hidePromos additionally stops itself after a few empty passes.
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
            const key = routeKeyOf(r);
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
        // Fingerprint the full ordered id list — sampled fingerprints can
        // collide across distinct filter outcomes and skip the reconcile.
        const filterFp = filtered.length === 0 ? '0' :
          `${sortKey}|${filtered.map(r => r.id).join(',')}`;
        if (filterFp !== lastFilterFp) {
          visibleLimit = DEFAULT_VISIBLE;
          lastFilterFp = filterFp;
        }
        const visibleCount = Math.min(visibleLimit, filtered.length);
        const visible = visibleCount === filtered.length ? filtered : filtered.slice(0, visibleCount);
        const fp = `${filterFp}|${visibleCount}`;

        if (fp !== renderedKey) {
          renderedKey = fp;
          rowReconciler.cancel();
          rowReconciler.reconcile(visible);
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

    setupDualDrag(gradeWrap);
    setupDualDrag(ascWrap);

    const mo = new MutationObserver(() => {
      if (rowReconciler.isRendering()) return; // our own row inserts; ignore.
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

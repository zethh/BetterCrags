// BetterCrags — My Crags dashboard: the Dashboard tab (profile, summary,
// where-to-go-next, suggested projects, crags table, spotlight, firsts,
// fun stats, activity).
(() => {
  'use strict';
  // One namespace object shared by every mycrags/*.js file (see core.js).
  const MC = (window.BCMyCrags = window.BCMyCrags || {});
  const { $, FEATURE_GROUPS, FEATURE_KEYS, FONT_GRADES, FRENCH_GRADES, MONTHS, escapeHtml, gradeLabelExact, routeKeyOf, saveDismissedProjects, state } = MC;

  function uniqGenres(rows) {
    const s = new Set();
    for (const r of rows) if (r.genre) s.add(r.genre);
    return [...s].sort();
  }

  function aggregate() {
    // Build per-crag aggregation including a "firsts" map per genre.
    const crags = new Map();
    // NB: named getCrag (not get) so it doesn't shadow the storage helper.
    function getCrag(id) {
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
          totalsByGenreGrade: {},
          firsts: {}, // `${genre}:${gi}` → { date, routeName } for the earliest send of that grade
        });
      }
      return crags.get(id);
    }
    for (const r of state.done) {
      const c = getCrag(r.cragId);
      c.done.push(r);
      if (r.cragName && !c.name) c.name = r.cragName;
    }
    for (const r of state.todo) {
      const c = getCrag(r.cragId);
      c.todo.push(r);
      if (r.cragName && !c.name) c.name = r.cragName;
    }
    for (const [id, totals] of Object.entries(state.cragTotals)) {
      const c = getCrag(id);
      if (totals && totals.total != null) c.total = totals.total;
      if (totals && totals.byGenre) c.totalsByGenre = totals.byGenre;
      if (totals && totals.byGrade) c.totalsByGrade = totals.byGrade;
      if (totals && totals.byGenreGrade) c.totalsByGenreGrade = totals.byGenreGrade;
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
        map.set(g, { gi: r.gradeInt, label: r.gradeLabel || gradeLabelExact(r.gradeInt, g) });
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

  // A grade step is 50 points in the source data. This gives a 6A roughly 1x
  // credit, a 7A 1.6x, and an 8A 2.2x, while still allowing easier sends to
  // count. It intentionally measures the features represented in sends, not
  // an objective assessment of ability.
  function profileGradeWeight(gradeInt) {
    return Math.max(0.75, 0.75 + (Math.max(0, Number(gradeInt) || 0) - 300) / 500);
  }

  function profileYears() {
    return [...new Set(state.done.map(r => (r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort();
  }

  function profileRadarSvg(tags, values) {
    const size = 190, center = 95, radius = 58, n = tags.length;
    const point = (i, scale) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2 / n);
      return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
    };
    const poly = (scale) => tags.map((_, i) => point(i, scale).map(v => v.toFixed(1)).join(',')).join(' ');
    const max = Math.max(1, ...values);
    const shape = values.map((v, i) => point(i, Math.min(1, v / max)).map(x => x.toFixed(1)).join(',')).join(' ');
    const axes = tags.map(([, label], i) => {
      const [x, y] = point(i, 1.18);
      const anchor = x < center - 8 ? 'end' : x > center + 8 ? 'start' : 'middle';
      return `<line x1="${center}" y1="${center}" x2="${point(i, 1)[0].toFixed(1)}" y2="${point(i, 1)[1].toFixed(1)}" />` +
        `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(label)}</text>`;
    }).join('');
    return `<svg class="mc-radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="Feature profile radar"><polygon class="grid outer" points="${poly(1)}" /><polygon class="grid" points="${poly(.5)}" />${axes}<polygon class="shape" points="${shape}" /></svg>`;
  }

  function renderProfile() {
    const card = $('#mc-profile-card');
    const controls = $('#mc-profile-controls');
    const body = $('#mc-profile-body');
    const years = profileYears();
    if (!state.done.length) { card.hidden = true; return; }
    const options = (selected, label) => `<label>${label}<select data-mc-profile-${label.toLowerCase()}><option value="all"${selected === 'all' ? ' selected' : ''}>All time</option>${years.map(y => `<option value="${y}"${selected === y ? ' selected' : ''}>${y}</option>`).join('')}</select></label>`;
    controls.innerHTML = `${options(state.profileFromYear, 'From')}${options(state.profileToYear, 'To')}`;

    const rows = state.done.filter(r => {
      const year = (r.date || '').slice(0, 4);
      if (state.profileFromYear !== 'all' && (!year || year < state.profileFromYear)) return false;
      if (state.profileToYear !== 'all' && (!year || year > state.profileToYear)) return false;
      return true;
    });
    const groupHtml = [];
    const allScores = [];
    const taggedRoutes = rows.filter(r => FEATURE_KEYS.some(tag => (state.routeFeatures[r.key] || {})[tag])).length;
    for (const [group, tags] of FEATURE_GROUPS) {
      const values = tags.map(([tag]) => rows.reduce((sum, r) => (state.routeFeatures[r.key] || {})[tag] ? sum + profileGradeWeight(r.gradeInt) : sum, 0));
      const max = Math.max(0, ...values);
      if (!max) continue;
      tags.forEach(([tag, label], i) => allScores.push({ tag, label, value: values[i], group }));
      const ranked = tags.map(([, label], i) => ({ label, value: values[i] })).sort((a, b) => b.value - a.value);
      groupHtml.push(`<article class="mc-profile-group"><h3>${escapeHtml(group)}</h3>${profileRadarSvg(tags, values)}<div class="mc-profile-rank">${ranked.map(x => `<span>${escapeHtml(x.label)} <b>${Math.round(x.value / max * 100)}</b></span>`).join('')}</div></article>`);
    }
    const represented = allScores.filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    const strongest = represented.slice(0, 3).map(x => x.label).join(', ');
    const lowest = represented.slice(-3).reverse().map(x => x.label).join(', ');
    const scope = state.profileFromYear === 'all' && state.profileToYear === 'all' ? 'all time' : `${state.profileFromYear === 'all' ? 'start' : state.profileFromYear}–${state.profileToYear === 'all' ? 'now' : state.profileToYear}`;
    body.innerHTML = groupHtml.length ? `
      <div class="mc-profile-insight"><b>Strength signals:</b> ${escapeHtml(strongest)}. <b>Growth areas:</b> ${escapeHtml(lowest)}.<span>${rows.length} sends in ${escapeHtml(scope)} · ${taggedRoutes} with matching tags · grade weighting: 6A ≈ 1×, 7A ≈ 1.6×, 8A ≈ 2.2×.</span></div>
      <div class="mc-profile-grid">${groupHtml.join('')}</div>` :
      `<div class="mc-profile-empty">No feature tags were found for sends in this period yet. Refresh will fetch them from the relevant area routelists.</div>`;
    controls.querySelector('[data-mc-profile-from]').addEventListener('change', e => {
      state.profileFromYear = e.target.value;
      if (state.profileToYear !== 'all' && state.profileFromYear !== 'all' && state.profileFromYear > state.profileToYear) state.profileToYear = state.profileFromYear;
      renderProfile();
    });
    controls.querySelector('[data-mc-profile-to]').addEventListener('change', e => {
      state.profileToYear = e.target.value;
      if (state.profileFromYear !== 'all' && state.profileToYear !== 'all' && state.profileToYear < state.profileFromYear) state.profileFromYear = state.profileToYear;
      renderProfile();
    });
    card.hidden = false;
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

  // Hover tooltip for the "N todo" pill: lists each open todo's route name and
  // grade. The tooltip is appended to <body> (position:fixed) because the card
  // it lives in is overflow:hidden and would clip an in-flow popup.
  const nextTodosByCrag = new Map(); // crag id → its (genre-filtered) todos
  let nextTooltipEl = null;
  let nextTooltipWired = false;

  function hideNextTooltip() {
    if (nextTooltipEl) { nextTooltipEl.remove(); nextTooltipEl = null; }
  }
  function showNextTooltip(pill) {
    const todos = nextTodosByCrag.get(pill.getAttribute('data-bc-crag'));
    if (!todos || !todos.length) return;
    hideNextTooltip();
    const CAP = 25;
    const sorted = todos.slice().sort((a, b) => (b.gradeInt || 0) - (a.gradeInt || 0));
    const rows = sorted.slice(0, CAP).map(t => {
      const g = t.gradeLabel || (t.gradeInt ? gradeLabelExact(t.gradeInt, t.genre) : '') || '—';
      return `<div class="row"><span class="r">${escapeHtml(t.routeName || 'Unnamed route')}</span><span class="g">${escapeHtml(g)}</span></div>`;
    }).join('');
    const more = sorted.length > CAP ? `<div class="more">+${sorted.length - CAP} more…</div>` : '';
    const tip = document.createElement('div');
    tip.className = 'mc-next-tooltip';
    tip.innerHTML = `<div class="hd">${todos.length} open todo${todos.length === 1 ? '' : 's'}</div>${rows}${more}`;
    document.body.appendChild(tip);
    nextTooltipEl = tip;
    const r = pill.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = Math.round(r.left);
    if (left + tw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - tw);
    let top = Math.round(r.bottom + 6);
    if (top + th > window.innerHeight - 8) top = Math.max(8, Math.round(r.top - 6 - th));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function renderNext() {
    const card = $('#mc-next-card');
    const list = $('#mc-next-list');
    // Wire the hover tooltip once; #mc-next-list persists across re-renders.
    if (!nextTooltipWired) {
      nextTooltipWired = true;
      list.addEventListener('mouseover', (e) => {
        const pill = e.target.closest('.mc-next-todo-pill');
        if (pill && list.contains(pill)) showNextTooltip(pill);
      });
      list.addEventListener('mouseout', (e) => {
        const pill = e.target.closest('.mc-next-todo-pill');
        if (pill && (!e.relatedTarget || !pill.contains(e.relatedTarget))) hideNextTooltip();
      });
      window.addEventListener('scroll', hideNextTooltip, true);
    }
    nextTodosByCrag.clear();
    hideNextTooltip();
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
      nextTodosByCrag.set(c.id, todos);
      const totalKnown = c.total != null && c.total > 0;
      const pct = totalKnown ? Math.min(100, (doneAtCrag / c.total) * 100) : null;
      const hardestG = hardestTodoGi
        ? gradeLabelExact(hardestTodoGi, (todos.find(t => t.gradeInt === hardestTodoGi) || {}).genre)
        : '';
      return `
        <div class="mc-next-item">
          <div class="n"><a href="https://thetopo.com/crags/${escapeHtml(encodeURIComponent(c.id))}" target="_blank" rel="noopener">${escapeHtml(name)}</a>${c.area ? `<span class="area">${escapeHtml(c.area)}</span>` : ''}</div>
          <div class="b">
            <span class="pill mc-next-todo-pill" data-bc-crag="${escapeHtml(c.id)}">${todos.length} todo</span>
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

  // ── Render: feature-aware project suggestions ────────────────────
  function featureAffinity() {
    const totals = {}, maxima = {};
    for (const [, tags] of FEATURE_GROUPS) {
      let max = 0;
      for (const [tag] of tags) {
        const score = state.done.reduce((sum, r) => (state.routeFeatures[r.key] || {})[tag]
          ? sum + profileGradeWeight(r.gradeInt) : sum, 0);
        totals[tag] = score;
        max = Math.max(max, score);
      }
      for (const [tag] of tags) maxima[tag] = max;
    }
    return { totals, maxima };
  }

  function renderProjectSuggestions() {
    const card = $('#mc-project-card');
    const list = $('#mc-project-list');
    const genreControls = $('#mc-project-genres');
    const areaControls = $('#mc-project-areas');
    const projectControls = $('#mc-project-controls');
    if (!state.done.length) { card.hidden = true; return; }
    const affinity = featureAffinity();
    // One standout send proves the grade is a realistic project, but doesn't
    // yet promote the next half-grade to the user's default target. After
    // three sends at a level, gently advance the target by one half-grade.
    const PROJECT_GRADE_PROMOTION_SENDS = 3;
    const gradeTargetByGenre = new Map();
    for (const genre of new Set(state.done.map(r => r.genre || 'Other'))) {
      const grades = new Map();
      for (const r of state.done) {
        if ((r.genre || 'Other') !== genre || !r.gradeInt) continue;
        grades.set(r.gradeInt, (grades.get(r.gradeInt) || 0) + 1);
      }
      const highest = Math.max(0, ...grades.keys());
      if (highest) gradeTargetByGenre.set(genre, highest + ((grades.get(highest) || 0) >= PROJECT_GRADE_PROMOTION_SENDS ? 50 : 0));
    }
    const targetText = [...gradeTargetByGenre.entries()]
      .map(([genre, grade]) => `${genre} through ${gradeLabelExact(grade, genre)}`).join(' · ');
    const sub = card.querySelector('.mc-card-sub');
    if (sub && targetText) sub.textContent = `Full grade match: ${targetText}. A level advances after ${PROJECT_GRADE_PROMOTION_SENDS} sends at your current top grade.`;
    const doneKeys = new Set(state.done.map(r => r.key));
    const todoKeys = new Set(state.todo.map(r => r.key));
    const areaLabelById = new Map();
    for (const total of Object.values(state.cragTotals)) {
      if (total && total.areaParamId) areaLabelById.set(total.areaParamId, total.area || 'Unknown');
    }
    const candidates = [];
    for (const [areaId, routes] of Object.entries(state.areaRoutes)) {
      for (const raw of routes) {
        const key = routeKeyOf(raw);
        if (!key || doneKeys.has(key) || state.dismissedProjectKeys.has(key)) continue;
        candidates.push({
          key, cragId: raw.crag_param_id || '', cragName: raw.crag_name || '',
          routeName: raw.name || '', gradeInt: raw.grade_int || 0,
          gradeLabel: gradeLabelExact(raw.grade_int || 0, raw.genre || ''), genre: raw.genre || '',
          areaId, area: areaLabelById.get(areaId) || 'Unknown', raw,
          isTodo: todoKeys.has(key),
        });
      }
    }
    const areas = new Map();
    const genres = [...new Set(candidates.map(route => route.genre).filter(Boolean))].sort();
    if (state.activeGenreProjects !== 'all' && !genres.includes(state.activeGenreProjects)) state.activeGenreProjects = 'all';
    genreControls.innerHTML = '';
    for (const genre of ['all', ...genres]) {
      const btn = document.createElement('button');
      btn.textContent = genre === 'all' ? 'All' : genre;
      if (genre === state.activeGenreProjects) btn.dataset.active = '1';
      btn.addEventListener('click', () => { state.activeGenreProjects = genre; renderProjectSuggestions(); });
      genreControls.appendChild(btn);
    }
    // Only offer areas that have routes in the selected climbing type.
    areas.clear();
    for (const route of candidates) {
      if (state.activeGenreProjects !== 'all' && route.genre !== state.activeGenreProjects) continue;
      const entry = areas.get(route.areaId) || { label: route.area, count: 0 };
      entry.count++;
      areas.set(route.areaId, entry);
    }
    if (state.activeAreaProjects !== 'all' && !areas.has(state.activeAreaProjects)) state.activeAreaProjects = 'all';
    areaControls.innerHTML = '';
    if (areas.size > 1) {
      const add = (key, label) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        if (key === state.activeAreaProjects) btn.dataset.active = '1';
        btn.addEventListener('click', () => { state.activeAreaProjects = key; renderProjectSuggestions(); });
        areaControls.appendChild(btn);
      };
      add('all', 'All areas');
      [...areas.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
        .forEach(([key, entry]) => add(key, `${entry.label} (${entry.count})`));
    }
    const routesInArea = candidates.filter(route => {
      if (state.activeGenreProjects !== 'all' && route.genre !== state.activeGenreProjects) return false;
      return state.activeAreaProjects === 'all' || route.areaId === state.activeAreaProjects;
    });
    const suggestions = routesInArea.map(route => {
      const target = gradeTargetByGenre.get(route.genre || 'Other') || route.gradeInt;
      // Centre fit on the current target rather than treating all lower grades
      // as equal. A 7B target means 7A+ is still an excellent 97% option,
      // while 6C+ (91%) is mileage rather than the first project suggestion.
      // Above target, use a slightly steeper five points per half-grade:
      // 7B → 7B+ = 95%, 7C = 90%.
      const gradeFit = route.gradeInt
        ? (route.gradeInt <= target
          ? Math.max(0.3, 1 - (target - route.gradeInt) * 0.0006)
          : Math.max(0.15, 1 - (route.gradeInt - target) / 1000))
        : .5;
      const tags = FEATURE_KEYS.filter(tag => route.raw[tag]);
      const featureFit = tags.length
        ? tags.reduce((sum, tag) => sum + ((affinity.totals[tag] || 0) / Math.max(1, affinity.maxima[tag] || 0)), 0) / tags.length
        : .45; // unknown tags are neutral rather than silently penalised
      const stats = { rating: Number(route.raw.rating) || 0, ascents: Number(route.raw.ascents_done_count) || 0 };
      // Ratings need evidence. Blend the displayed rating with a neutral 1.5★
      // prior; its influence fades over roughly 25 ascents. Thus a lone 3★
      // vote is promising but not equivalent to a 3★ consensus from 150 sends.
      const ratingConfidence = 1 - Math.exp(-stats.ascents / 25);
      const adjustedRating = stats.rating
        ? stats.rating * ratingConfidence + 1.5 * (1 - ratingConfidence)
        : 1.5;
      const quality = Math.min(1, adjustedRating / 3);
      const traffic = Math.min(1, Math.log1p(stats.ascents) / Math.log(101));
      const score = gradeFit * .45 + featureFit * .3 + quality * .18 + traffic * .07;
      return { route, tags, score, gradeFit, featureFit, stats, adjustedRating };
    }).sort((a, b) => b.score - a.score).slice(0, 6);
    if (!suggestions.length) {
      list.innerHTML = '<div class="mc-project-empty">No unsent routes match these filters.</div>';
      projectControls.innerHTML = state.dismissedProjectKeys.size
        ? `<button type="button" data-mc-project-restore>Restore ${state.dismissedProjectKeys.size} hidden suggestion${state.dismissedProjectKeys.size === 1 ? '' : 's'}</button>`
        : '';
      projectControls.querySelector('[data-mc-project-restore]')?.addEventListener('click', () => {
        state.dismissedProjectKeys.clear();
        saveDismissedProjects();
        renderProjectSuggestions();
      });
      card.hidden = false;
      return;
    }
    list.innerHTML = suggestions.map(({ route, tags, score, gradeFit, featureFit, stats, adjustedRating }) => {
      const href = `https://thetopo.com/crags/${encodeURIComponent(route.cragId)}/routes/${encodeURIComponent(route.key.split('/')[1] || '')}`;
      const tagLabels = tags.slice(0, 4).map(tag => {
        for (const [, group] of FEATURE_GROUPS) {
          const found = group.find(([key]) => key === tag);
          if (found) return found[1];
        }
        return tag;
      });
      return `<article class="mc-project-item">
        <div class="mc-project-name"><span class="mc-project-grade">${escapeHtml(route.gradeLabel || gradeLabelExact(route.gradeInt, route.genre))}</span><a href="${href}" target="_blank" rel="noopener">${escapeHtml(route.routeName || 'Unnamed route')}</a></div>
        <div class="mc-project-crag">${escapeHtml(route.cragName || route.cragId)}${route.area ? ` · ${escapeHtml(route.area)}` : ''}</div>
        <div class="mc-project-pills"><span class="${route.isTodo ? 'is-todo' : 'is-new'}">${route.isTodo ? 'On todo' : 'New suggestion'}</span>${tagLabels.map(label => `<span>${escapeHtml(label)}</span>`).join('') || '<span>Untagged</span>'}</div>
        <div class="mc-project-why">${Math.round(gradeFit * 100)}% grade fit · ${Math.round(featureFit * 100)}% style fit · ${stats.rating ? `${adjustedRating.toFixed(1)}★ confidence` : 'unrated'} · ${stats.ascents} ascents</div>
        <div class="mc-project-score">${Math.round(score * 100)} match</div>
        <button type="button" class="mc-project-hide" data-mc-project-hide="${escapeHtml(route.key)}" title="Remove this route from suggestions">Hide</button>
      </article>`;
    }).join('');
    projectControls.innerHTML = state.dismissedProjectKeys.size
      ? `<button type="button" data-mc-project-restore>Restore ${state.dismissedProjectKeys.size} hidden suggestion${state.dismissedProjectKeys.size === 1 ? '' : 's'}</button>`
      : '';
    list.querySelectorAll('[data-mc-project-hide]').forEach(btn => btn.addEventListener('click', () => {
      state.dismissedProjectKeys.add(btn.getAttribute('data-mc-project-hide'));
      saveDismissedProjects();
      renderProjectSuggestions();
    }));
    projectControls.querySelector('[data-mc-project-restore]')?.addEventListener('click', () => {
      state.dismissedProjectKeys.clear();
      saveDismissedProjects();
      renderProjectSuggestions();
    });
    card.hidden = false;
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
    const rangeSelect = $('#mc-completion-range');
    const rangeTable = genre === 'Boulder' ? FONT_GRADES : FRENCH_GRADES;
    // Completion can be scoped to a grade ceiling: useful for separating a
    // finished warm-up/mileage band from aspirational high-grade routes.
    if (rangeSelect.options.length !== rangeTable.length + 1 || rangeSelect.dataset.genre !== genre) {
      rangeSelect.dataset.genre = genre;
      rangeSelect.innerHTML = `<option value="all">All grades</option>${rangeTable.map(([gi, label]) => `<option value="${gi}">Up to ${escapeHtml(label)}</option>`).join('')}`;
    }
    rangeSelect.value = state.completionGradeMax;
    if (rangeSelect.value !== state.completionGradeMax) state.completionGradeMax = 'all';
    const gradeMax = state.completionGradeMax === 'all' ? null : Number(state.completionGradeMax);

    const rows = [];
    for (const c of state.cragsAggregated.values()) {
      if (!rowMatchesGenre(c, genre)) continue;
      const t = cragGenreTotals(c, genre);
      if (gradeMax) {
        const scopeRows = (rows) => rows.filter(r => (genre === 'all' || r.genre === genre) && r.gradeInt && r.gradeInt <= gradeMax);
        const doneRows = scopeRows(c.done);
        const todoRows = scopeRows(c.todo);
        t.done = doneRows.length;
        t.todo = todoRows.length;
        const gradeHistogram = genre === 'all'
          ? c.totalsByGrade
          : (c.totalsByGenreGrade || {})[genre] || c.totalsByGrade;
        t.total = Object.entries(gradeHistogram || {}).reduce((sum, [gi, count]) => +gi <= gradeMax ? sum + count : sum, 0) || null;
        t.hardestByGenre = hardestByGenre(doneRows);
      }
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
        <td><a href="https://thetopo.com/crags/${escapeHtml(encodeURIComponent(r.id))}" target="_blank" rel="noopener" data-mc-stop>${escapeHtml(r.name)}</a></td>
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
          <span class="g">${escapeHtml(e.gradeLabel || gradeLabelExact(e.gi, genre))}</span>
          <span class="c"><a href="https://thetopo.com/crags/${escapeHtml(encodeURIComponent(e.cragId))}" target="_blank" rel="noopener">${escapeHtml(cragName)}</a> — ${escapeHtml(e.routeName || '')}</span>
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
        h: gradeLabelExact(p.gi, g),
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

    // A compact grade timeline complements the monthly volume chart: it makes
    // sustained progression visible even when one exceptional send dominates a
    // year's headline hardest grade.
    const progressionGenres = sortedGenres(new Map([...hardestByGenre(state.done)].map(([g]) => [g, true])));
    const progressionHtml = progressionGenres.length ? `<div class="mc-progression"><h4>Progression timeline</h4>${progressionGenres.map(genre => {
      const entries = years.map(year => ({ year, peak: hardestByGenre(state.done.filter(r => r.genre === genre && r.date && r.date.startsWith(year + '-'))).get(genre) })).filter(x => x.peak);
      if (!entries.length) return '';
      return `<div class="mc-progression-genre"><span class="g">${escapeHtml(genre)}</span><div class="mc-progression-rows">${entries.map(({ year, peak }) => {
        const width = Math.max(8, Math.min(100, ((peak.gi - 100) / 1400) * 100));
        return `<div class="mc-progression-year" title="${escapeHtml(year)}: ${escapeHtml(peak.label)}"><span>${escapeHtml(year)}</span><i><b style="width:${width.toFixed(1)}%"></b></i><strong>${escapeHtml(peak.label)}</strong></div>`;
      }).join('')}</div></div>`;
    }).join('')}</div>` : '';

    body.innerHTML = `
      ${bodyHtml}
      ${tiles.length ? `<div class="mc-activity-summary">${tiles.map(t => `
        <div class="mc-stat">
          <div class="l">${escapeHtml(t.l)}</div>
          <div class="v">${escapeHtml(String(t.v))} ${t.delta || ''}</div>
          ${t.h ? `<div class="h">${escapeHtml(t.h)}</div>` : ''}
        </div>
      `).join('')}</div>` : ''}
      ${progressionHtml}
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

    title.innerHTML = `Crag spotlight — <a href="https://thetopo.com/crags/${escapeHtml(encodeURIComponent(c.id))}" target="_blank" rel="noopener">${escapeHtml(c.name || c.id)}</a>
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


  Object.assign(MC, { aggregate, renderActivity, renderCrags, renderFirsts, renderNext, renderProfile, renderProjectSuggestions, renderSpotlight, renderStats, renderSummary });
})();

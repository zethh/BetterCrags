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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  // ── Custom tier-list board (shared store with the My Crags dashboard) ──
  // Mirrors mycrags.js's storage shape (bc_project_board_v2):
  //   { version: 2, lists: [ {id,name,…,items:[…]} ], activeListId }
  // We only ever read and append to "stored" lists — those carrying their own
  // `items` array (dream/custom/imported lists). Live lists (backed by your
  // todos) have no items array and aren't writable from here.
  const BOARD_KEY = 'bc_project_board_v2';

  function getBoard() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(BOARD_KEY, (o) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve((o && o[BOARD_KEY]) || null);
        });
      } catch { resolve(null); }
    });
  }
  function setBoard(board) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [BOARD_KEY]: board }, () => resolve());
      } catch { resolve(); }
    });
  }
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
  // Shape a fresh custom list exactly as mycrags.js's defaultCustomList does,
  // so the dashboard renders it without migration surprises.
  function makeCustomList(name) {
    return {
      id: bcGenId(),
      name: name || 'Dream list',
      genre: 'all', areas: null, gradeMin: null, gradeMax: null,
      tiers: {}, order: {}, notes: {},
      custom: true, items: [],
    };
  }
  // A page route → a stored-list item, matching mycrags.js addRouteToList.
  // `area` is left blank: the dashboard fills it in from cached crag totals.
  function routeToItem(route) {
    const genre = route.genre || '';
    const gradeInt = route.grade_int || 0;
    return {
      key: `${route.crag_param_id || ''}/${route.param_id || ''}`,
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

    const key = `${route.crag_param_id || ''}/${route.param_id || ''}`;

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
    gradeLabelFor, gradeIntFromLabel,
    getBoard, mutateBoard, makeCustomList,
    addRouteToBoardList, createBoardListWithRoute, routeToItem,
    openListMenu, closeListMenu,
  };
})();

'use strict';
const test = require('node:test');
// Loose deepEqual on purpose: values built inside the vm context have that
// realm's Array/Object prototypes, which strict deepEqual would reject.
const assert = require('node:assert');
const { loadScripts, MYCRAGS_FILES } = require('./load.js');

function boot(store = {}) {
  const ctx = loadScripts(MYCRAGS_FILES, { store });
  return { ctx, MC: ctx.BCMyCrags, S: ctx.BCShared, store };
}
const { MC } = boot();

test('dedupeKeepEarliest keeps the earliest dated row and merges metadata', () => {
  const rows = [
    { key: 'c/r', date: '2024-06-01', gradeInt: 0, cragName: '', routeName: 'R' },
    { key: 'c/r', date: '2023-01-15', gradeInt: 650, cragName: 'Crag', routeName: '' },
    { key: 'c/r', date: '2025-01-01', gradeInt: 700, cragName: 'Other', routeName: 'R2' },
    { key: 'c/s', date: '', gradeInt: 0, cragName: '' },
    { key: 'c/s', date: '', gradeInt: 500, cragName: 'Crag' },
  ];
  const out = MC.dedupeKeepEarliest(rows);
  assert.strictEqual(out.length, 2);
  const r = out.find(x => x.key === 'c/r');
  assert.strictEqual(r.date, '2023-01-15');
  assert.strictEqual(r.gradeInt, 650);
  assert.strictEqual(r.cragName, 'Crag');
  assert.strictEqual(r.routeName, 'R', 'empty fields fall back to the earlier row');
  const s = out.find(x => x.key === 'c/s');
  assert.strictEqual(s.gradeInt, 500, 'undated rows: the one with more metadata wins');
});

test('parseSearchResult normalises thetopo search hits', () => {
  const route = MC.parseSearchResult({ path: '/crags/hieno/routes/mystery', name: 'Mystery (7A+)', description: 'Mystery (7A+), Helsinki, Hieno' });
  assert.deepEqual(route, { type: 'route', key: 'hieno/mystery', cragId: 'hieno', routeName: 'Mystery', gradeLabel: '7A+', gradeInt: 750, genre: 'Boulder', cragName: 'Hieno' });
  assert.deepEqual(MC.parseSearchResult({ path: '/crags/hieno', name: 'Hieno', description: 'Hieno, Helsinki' }), { type: 'crag', id: 'hieno', name: 'Hieno', subtitle: 'Helsinki' });
  assert.strictEqual(MC.parseSearchResult({ path: '/areas/helsinki', name: 'Helsinki', description: '' }).type, 'area');
  assert.strictEqual(MC.parseSearchResult({ path: '/climbers/me' }), null);
});

test('mapStoreRoute bakes stats into a browse item', () => {
  const it = MC.mapStoreRoute({ crag_param_id: 'c', param_id: 'r', name: 'R', grade_int: 600, genre: 'Boulder', rating: '2.0', ascents_done_count: 9, crag_name: 'C' }, 'Area');
  assert.strictEqual(it.key, 'c/r');
  assert.strictEqual(it.gradeLabel, '6C');
  assert.strictEqual(it.bucket, 'Boulder');
  assert.strictEqual(it.rating, 2);
  assert.strictEqual(it.area, 'Area');
});

test('filterItems: unknown genre/area stay visible, unknown grade hides once a grade filter is set (v0.35.1)', () => {
  const items = [
    { key: 'a', bucket: 'Boulder', genreKnown: true, area: 'X', gradeInt: 600 },
    { key: 'b', bucket: 'Other', genreKnown: false, area: '', gradeInt: 0 },
    { key: 'c', bucket: 'Sport', genreKnown: true, area: 'Y', gradeInt: 700 },
  ];
  const keys = (list) => MC.filterItems(items, { genre: 'all', areas: null, gradeMin: null, gradeMax: null, ...list }).map(i => i.key);
  assert.deepEqual(keys({}), ['a', 'b', 'c']);
  assert.deepEqual(keys({ genre: 'Boulder' }), ['a', 'b']);
  assert.deepEqual(keys({ areas: ['X'] }), ['a', 'b']);
  assert.deepEqual(keys({ gradeMin: 650 }), ['c']);
  assert.deepEqual(keys({ gradeMax: 650 }), ['a']);
});

test('bucketOf and starsHtml (thetopo rates out of 3)', () => {
  assert.strictEqual(MC.bucketOf('Boulder'), 'Boulder');
  assert.strictEqual(MC.bucketOf('Traditional'), 'Other');
  assert.strictEqual(MC.starsHtml(2.4), '★★☆');
  assert.strictEqual(MC.starsHtml(0), '☆☆☆');
});

test('importListObject validates the file and never reuses its id', async () => {
  const { MC, store } = boot();
  await MC.loadBoard();
  const before = MC.state.board.lists.length;
  MC.importListObject({ bettercrags_tierlist: 1, name: 'From a friend', username: 'pal', items: [
    { key: 'c/r', routeName: 'R', tier: 'S', order: 2, note: 'hi', gradeInt: '650' },
    { key: 'bad' },
  ] });
  const list = MC.state.board.lists[MC.state.board.lists.length - 1];
  assert.strictEqual(MC.state.board.lists.length, before + 1);
  assert.strictEqual(list.imported, true);
  assert.strictEqual(list.sourceUser, 'pal');
  assert.deepEqual(list.items.map(i => i.key), ['c/r']);
  assert.deepEqual(list.tiers, { 'c/r': 'S' });
  assert.deepEqual(list.order, { 'c/r': 2 });
  assert.deepEqual(list.notes, { 'c/r': 'hi' });
  assert.strictEqual(MC.state.board.activeListId, list.id);
  // Garbage is rejected without touching the board.
  MC.importListObject({ nope: true });
  assert.strictEqual(MC.state.board.lists.length, before + 1);
});

test('restoreBackup merges by id, keeps local lists, restores settings', async () => {
  const { MC, S, store, ctx } = boot();
  await MC.loadBoard();
  const local = MC.state.board.lists[0];
  local.name = 'Local edits';
  local.tiers['x/y'] = 'A';
  const backup = {
    bettercrags_backup: 1,
    exportedAt: '2026-10-01T00:00:00.000Z',
    username: 'me',
    board: { version: 2, activeListId: 'trip1', lists: [
      { id: local.id, name: 'Local from backup', tiers: { 'x/y': 'S' }, order: {}, notes: {} },
      { id: 'trip1', name: 'Trip', custom: true, items: [{ key: 'c/r', routeName: 'R' }], tiers: { 'c/r': 'B' }, order: {}, notes: {} },
      { garbage: true, items: 'no' },
    ] },
    dismissedProjects: { me: ['c/hidden', 5] },
    filterState: { enabled: false },
    darkMode: true,
  };
  await MC.restoreBackup(backup);
  const lists = MC.state.board.lists;
  assert.deepEqual(lists.map(l => l.name), ['Local from backup', 'Trip', 'Untitled list'], 'same id replaced, new ids appended (garbage still yields a sanitized empty list)');
  assert.deepEqual(lists[0].tiers, { 'x/y': 'S' });
  assert.strictEqual(MC.state.board.activeListId, 'trip1');
  // Persisted: the debounced board write is flushed on the next tick…
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(store[S.STORAGE_KEYS.BOARD].lists.length, 3);
  assert.deepEqual(store[S.STORAGE_KEYS.PROJECT_SUGGESTIONS], { me: ['c/hidden'] });
  assert.deepEqual(store[S.STORAGE_KEYS.FILTER_STATE], { enabled: false });
  assert.strictEqual(store[S.STORAGE_KEYS.DARK_MODE], true);
  assert.strictEqual(store[S.STORAGE_KEYS.USERNAME], 'me', 'username adopted when none was known');
});

test('restoreBackup refuses non-backup files', async () => {
  const { MC, ctx } = boot();
  const alerts = [];
  ctx.alert = (m) => alerts.push(m);
  await MC.restoreBackup({ bettercrags_tierlist: 1, items: [] });
  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0], /backup/);
});

test('a failed board save raises the personal-data alert', async () => {
  const { MC, store, ctx } = boot();
  await MC.loadBoard();
  const shown = [];
  // showAlert renders into #mc-alerts; capture through the stub document.
  const host = ctx.document.querySelector('#mc-alerts');
  ctx.document.querySelector = (sel) => (sel === '#mc-alerts' ? host : require('./load.js').stubElement());
  host.querySelector = () => null;
  host.appendChild = (el) => {
    // Memoize lookups on the appended banner so the text showAlert writes
    // into '.mc-alert-text' afterwards is observable.
    const parts = new Map();
    el.querySelector = (sel) => parts.get(sel) || (parts.set(sel, require('./load.js').stubElement()), parts.get(sel));
    shown.push(el);
    return el;
  };
  store.__failWrites = true;
  await MC.storageSet({ [MC.BOARD_KEY]: MC.state.board });
  assert.strictEqual(shown.length, 1);
  assert.strictEqual(shown[0].className, 'mc-alert error');
  assert.match(shown[0].querySelector('.mc-alert-text').textContent, /NOT saved/);
});

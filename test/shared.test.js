'use strict';
const test = require('node:test');
// Loose deepEqual on purpose: values built inside the vm context have that
// realm's Array/Object prototypes, which strict deepEqual would reject.
const assert = require('node:assert');
const { loadScripts } = require('./load.js');

const { BCShared: S } = loadScripts(['shared.js']);

test('grade labels round-trip through the Font and French tables', () => {
  assert.strictEqual(S.gradeLabelFor(750, 'Boulder'), '7A+');
  assert.strictEqual(S.gradeLabelFor(750, 'Sport'), '7a');
  assert.strictEqual(S.gradeLabelFor(760, 'Boulder'), '7A+', 'nearest value wins for off-table ints');
  assert.strictEqual(S.gradeLabelExact(750, 'Boulder'), '7A+');
  assert.strictEqual(S.gradeLabelExact(760, 'Boulder'), '760', 'exact lookup falls back to the number');
  assert.strictEqual(S.gradeIntFromLabel('7A+', 'Boulder'), 750);
  assert.strictEqual(S.gradeIntFromLabel('7a+', 'Boulder'), 750, 'case-insensitive fallback');
  assert.strictEqual(S.gradeIntFromLabel('6b', 'Sport'), 550);
  assert.strictEqual(S.gradeIntFromLabel('nope', 'Sport'), 0);
});

test('parseGradeToken tells Font from French and keeps the plus', () => {
  assert.deepEqual(S.parseGradeToken('7A+'), { gi: 750, genre: 'Boulder', label: '7A+' });
  assert.deepEqual(S.parseGradeToken(' 7a+ '), { gi: 800, genre: 'Sport', label: '7a+' });
  assert.deepEqual(S.parseGradeToken('6b'), { gi: 550, genre: 'Sport', label: '6b' });
  assert.deepEqual(S.parseGradeToken('5+'), { gi: 350, genre: '', label: '5+' });
  assert.strictEqual(S.parseGradeToken('9Z'), null);
  assert.strictEqual(S.parseGradeToken(''), null);
});

test('findGradeInText does not fold plus-grades into their base (v0.35 regression)', () => {
  assert.strictEqual(S.findGradeInText('Sent Mystery 7A+ at Hienostoalue').label, '7A+');
  assert.strictEqual(S.findGradeInText('7A+').label, '7A+');
  assert.strictEqual(S.findGradeInText('Boulder, 6C on Wall').gi, 600);
  assert.strictEqual(S.findGradeInText('2024-05-01 nothing here'), null, 'dates are not grades');
});

test('routeKeyOf builds the canonical crag/route key', () => {
  assert.strictEqual(S.routeKeyOf({ crag_param_id: 'hienostoalue', param_id: 'mystery' }), 'hienostoalue/mystery');
  assert.strictEqual(S.routeKeyOf({}), '/');
  assert.strictEqual(S.routeKeyOf(null), '/');
});

test('sanitizeList keeps valid data and drops the rest', () => {
  const l = S.sanitizeList({
    id: ' abc ', name: 'Trip', genre: 'Boulder', areas: ['Helsinki', 7], gradeMin: '500', gradeMax: null, custom: true,
    items: [
      { key: 'crag/one', routeName: 'One', gradeInt: '650', rating: '2.5', ascents: 12 },
      { key: 'crag/one', routeName: 'dupe' },
      { key: 'nokey' },
      null,
      { key: 'crag/two' },
    ],
    tiers: { 'crag/one': 'S', 'crag/two': 'Z', 'bad': 'A' },
    order: { 'crag/one': '3', 'crag/two': 'x' },
    notes: { 'crag/two': 'go early', 'crag/one': '' },
  });
  assert.strictEqual(l.id, 'abc');
  assert.strictEqual(l.name, 'Trip');
  assert.strictEqual(l.genre, 'Boulder');
  assert.deepEqual(l.areas, ['Helsinki']);
  assert.strictEqual(l.gradeMin, 500);
  assert.strictEqual(l.gradeMax, null);
  assert.strictEqual(l.custom, true);
  assert.deepEqual(l.items.map(i => i.key), ['crag/one', 'crag/two']);
  assert.strictEqual(l.items[0].gradeInt, 650);
  assert.strictEqual(l.items[0].rating, 2.5);
  assert.deepEqual(l.tiers, { 'crag/one': 'S' });
  assert.deepEqual(l.order, { 'crag/one': 3 });
  assert.deepEqual(l.notes, { 'crag/two': 'go early' });
});

test('sanitizeList rejects garbage and defaults a nameless live list', () => {
  assert.strictEqual(S.sanitizeList(null), null);
  assert.strictEqual(S.sanitizeList('x'), null);
  const l = S.sanitizeList({});
  assert.strictEqual(l.name, 'Untitled list');
  assert.strictEqual(l.items, undefined, 'no items array ⇒ live list');
  assert.ok(l.id);
});

test('makeCustomList / makeList shapes match what the dashboard expects', () => {
  const c = S.makeCustomList('Dream');
  assert.strictEqual(c.custom, true);
  assert.deepEqual(c.items, []);
  assert.deepEqual([c.genre, c.areas, c.gradeMin, c.gradeMax], ['all', null, null, null]);
  const l = S.makeList();
  assert.strictEqual(l.name, 'My projects');
  assert.strictEqual('items' in l, false);
});

test('storage wrappers round-trip and report failed writes', async () => {
  const store = {};
  const ctx = loadScripts(['shared.js'], { store });
  const errors = [];
  ctx.BCShared.onStorageError(e => errors.push(e));
  assert.strictEqual(await ctx.BCShared.storageSet({ a: { x: 1 } }), true);
  assert.deepEqual(await ctx.BCShared.storageGet('a'), { x: 1 });
  assert.deepEqual(await ctx.BCShared.storageGet(['a', 'missing']), { a: { x: 1 } });
  assert.strictEqual(await ctx.BCShared.storageGet('missing'), null);
  store.__failWrites = true;
  assert.strictEqual(await ctx.BCShared.storageSet({ b: 2 }), false);
  assert.strictEqual(errors.length, 1);
  assert.deepEqual(errors[0].keys, ['b']);
  assert.match(errors[0].message, /quota/i);
  store.__failWrites = false;
  assert.strictEqual(await ctx.BCShared.storageRemove(['a']), true);
  assert.strictEqual(await ctx.BCShared.storageGet('a'), null);
});

test('formatBytes', () => {
  assert.strictEqual(S.formatBytes(512), '512 B');
  assert.strictEqual(S.formatBytes(20 * 1024), '20 kB');
  assert.strictEqual(S.formatBytes(3.25 * 1024 * 1024), '3.3 MB');
  assert.strictEqual(S.formatBytes(null), '?');
});

// Minimal fake documents for the DOM-reading helpers.
function fakeDoc({ pagerLinks = null, password = false, store = null } = {}) {
  const anchors = (pagerLinks || []).map(([dp, href]) => ({ getAttribute: (n) => (n === 'data-page' ? dp : n === 'href' ? href : null) }));
  return {
    querySelector(sel) {
      if (sel.includes('#table-pager')) return pagerLinks ? { querySelectorAll: () => anchors } : null;
      if (sel.includes('password')) return password ? {} : null;
      if (sel.includes('RouteList')) return store == null ? null : { textContent: store };
      return null;
    },
  };
}

test('maxPageInPager reads data-page and ?page= links', () => {
  assert.strictEqual(S.maxPageInPager(fakeDoc()), 0);
  assert.strictEqual(S.maxPageInPager(fakeDoc({ pagerLinks: [['1', '?page=1'], ['4', '?page=4'], [null, '/x?page=9']] })), 9);
});

test('readRouteListStore parses the embedded JSON or returns null', () => {
  assert.strictEqual(S.readRouteListStore(fakeDoc()), null);
  assert.strictEqual(S.readRouteListStore(fakeDoc({ store: '{not json' })), null);
  assert.deepEqual(S.readRouteListStore(fakeDoc({ store: '{"routes":[1]}' })), { routes: [1] });
});

test('looksLikeLoginPage', () => {
  assert.strictEqual(S.looksLikeLoginPage(fakeDoc()), false);
  assert.strictEqual(S.looksLikeLoginPage(fakeDoc({ password: true })), true);
});

test('escapeHtml', () => {
  assert.strictEqual(S.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(S.escapeHtml(null), '');
});

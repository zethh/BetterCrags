'use strict';
const test = require('node:test');
// Loose deepEqual on purpose: values built inside the vm context have that
// realm's Array/Object prototypes, which strict deepEqual would reject.
const assert = require('node:assert');
const { loadScripts, CONTENT_FILES } = require('./load.js');

const { BCRoutelist: RL, BCShared: S } = loadScripts(CONTENT_FILES);

const routes = [
  { id: 1, name: 'Alpha', crag_name: 'Hieno', genre: 'Boulder', grade_int: 600, rating: '2.5', ascents_done_count: 40, crimpers: true, crag_param_id: 'hieno', param_id: 'alpha' },
  { id: 2, name: 'Beta', crag_name: 'Hieno', genre: 'Boulder', grade_int: 700, rating: '3.0', ascents_done_count: 5, slopers: true, crag_param_id: 'hieno', param_id: 'beta' },
  { id: 3, name: 'Gamma', crag_name: 'Kallio', genre: 'Sport', grade_int: 650, rating: '1.0', ascents_done_count: 300, crimpers: true, dyno: true, crag_param_id: 'kallio', param_id: 'gamma' },
  { id: 4, name: 'Delta', crag_name: 'Kallio', genre: 'Boulder', grade_int: 400, rating: null, ascents_done_count: 0, crag_param_id: 'kallio', param_id: 'delta' },
];

// The shape readFilterState() produces, with everything wide open.
function filter(over = {}) {
  return {
    names: [], crags: [], sorts: ['rating_desc'], gradeMin: 100, gradeMax: 1500, minRating: 0,
    minAscents: 0, maxAscents: Infinity, genres: new Set(), include: new Set(), exclude: new Set(),
    hideNative: true, todo: 'ignore', done: 'ignore', hasVideo: 'ignore', hasComment: 'ignore',
    ...over,
  };
}
const ids = (s) => routes.filter(r => RL.matchesFilter(r, s)).map(r => r.id);

test('matchesFilter: wide-open filter keeps everything', () => {
  assert.deepEqual(ids(filter()), [1, 2, 3, 4]);
});

test('matchesFilter: name and crag search are case-insensitive substring ORs', () => {
  assert.deepEqual(ids(filter({ names: ['alp', 'gam'] })), [1, 3]);
  assert.deepEqual(ids(filter({ crags: ['kall'] })), [3, 4]);
});

test('matchesFilter: genre, grade, rating and ascent bounds', () => {
  assert.deepEqual(ids(filter({ genres: new Set(['Sport']) })), [3]);
  assert.deepEqual(ids(filter({ gradeMin: 650, gradeMax: 700 })), [2, 3]);
  assert.strictEqual(RL.matchesFilter({ grade_int: 0 }, filter()), false, 'an ungraded route never clears the grade floor');
  assert.deepEqual(ids(filter({ minRating: 2 })), [1, 2]);
  assert.deepEqual(ids(filter({ minAscents: 10 })), [1, 3]);
  assert.deepEqual(ids(filter({ maxAscents: 50 })), [1, 2, 4]);
  assert.deepEqual(ids(filter({ minAscents: 10, maxAscents: 50 })), [1]);
});

test('matchesFilter: tri-state feature pills (must have / must not have)', () => {
  assert.deepEqual(ids(filter({ include: new Set(['crimpers']) })), [1, 3]);
  assert.deepEqual(ids(filter({ exclude: new Set(['crimpers']) })), [2, 4]);
  assert.deepEqual(ids(filter({ include: new Set(['crimpers']), exclude: new Set(['dyno']) })), [1]);
});

test('compareRoutes: multi-level sort with tie-breakers', () => {
  const by = (sorts) => [...routes].sort((a, b) => RL.compareRoutes(a, b, sorts)).map(r => r.id);
  assert.deepEqual(by(['rating_desc']), [2, 1, 3, 4]);
  assert.deepEqual(by(['grade_asc']), [4, 1, 3, 2]);
  assert.deepEqual(by(['ascents_desc']), [3, 1, 2, 4]);
  assert.deepEqual(by(['name_desc']), [3, 4, 2, 1]);
  // Both Hieno routes tie on crag, so the second level decides.
  const tied = [{ name: 'b', rating: '2' }, { name: 'a', rating: '2' }, { name: 'c', rating: '3' }];
  assert.deepEqual(tied.sort((a, b) => RL.compareRoutes(a, b, ['rating_desc', 'name_asc'])).map(r => r.name), ['c', 'a', 'b']);
  assert.strictEqual(RL.compareRoutes(routes[0], routes[0], ['bogus']), 0, 'unknown sort keys are inert');
});

test('harvestCragTotals aggregates per crag with genre + grade histograms', () => {
  const byCrag = RL.harvestCragTotals(routes);
  assert.deepEqual([...byCrag.keys()], ['hieno', 'kallio']);
  const h = byCrag.get('hieno');
  assert.strictEqual(h.total, 2);
  assert.strictEqual(h.name, 'Hieno');
  assert.deepEqual(h.byGenre, { Boulder: 2 });
  assert.deepEqual(h.byGrade, { 600: 1, 700: 1 });
  const k = byCrag.get('kallio');
  assert.deepEqual(k.byGenre, { Sport: 1, Boulder: 1 });
  assert.deepEqual(k.byGrade, { 650: 1, 400: 1 });
  assert.deepEqual(k.byGenreGrade, { Sport: { 650: 1 }, Boulder: { 400: 1 } });
  const ungraded = RL.harvestCragTotals([{ crag_param_id: 'x', grade_int: 0 }, { name: 'no crag' }]);
  assert.strictEqual(ungraded.size, 1);
  assert.deepEqual(ungraded.get('x').byGrade, {}, 'grade 0 is not counted');
  assert.strictEqual(ungraded.get('x').total, 1);
});

test('grade table selection follows the dominant genre', () => {
  assert.strictEqual(RL.dominantGenre(routes), 'Boulder');
  assert.strictEqual(RL.dominantGenre([]), 'Boulder');
  assert.strictEqual(RL.pickGradeTable(routes), S.FONT_GRADES);
  assert.strictEqual(RL.pickGradeTable([{ genre: 'Sport' }]), S.FRENCH_GRADES);
  assert.strictEqual(RL.nearestGradeIndex(S.FONT_GRADES, 760), S.FONT_GRADES.findIndex(([v]) => v === 750));
  assert.strictEqual(RL.nearestGradeIndex(S.FONT_GRADES, -5), 0);
});

test('uniq drops empties and duplicates, keeps order', () => {
  assert.deepEqual(RL.uniq(['b', 'a', 'b', '', null, 'a']), ['b', 'a']);
});

test('feature pill groups cover every tag exactly once', () => {
  const grouped = RL.TAG_GROUPS.flatMap(([, keys]) => keys);
  assert.deepEqual([...grouped].sort(), RL.TAGS.map(([k]) => k).sort());
  for (const k of grouped) assert.ok(RL.TAG_LABELS[k], `label for ${k}`);
});

// BetterCrags — helpers shared by content.js (content script) and mycrags.js
// (dashboard page). Must be loaded before each consumer; exposes window.BCShared.
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

  window.BCShared = { FONT_GRADES, FRENCH_GRADES, escapeHtml };
})();

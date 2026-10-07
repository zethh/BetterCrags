# Changelog

Versions are the `version` in `manifest.json`. Older releases are described by their commit messages (`git log --oneline`).

## 0.36.0 — 2026-10-07

Reliability and maintainability release; no new climbing features.

### Added
- **Backup / Restore** buttons on the My Crags header. Backup downloads every tier-list (live and dream/imported), every note, dismissed project suggestions and your filter / dark-mode settings as one JSON file. Restore merges a backup back in: lists with a matching id are replaced, new ones added, other local lists kept.
- **Visible save failures.** If `chrome.storage` refuses a write (quota, extension reloaded underneath the page, …) the dashboard shows a dismissible banner instead of silently dropping the edit — loudest when it's your tier-lists. The routelist panel shows a one-line warning when filter settings can't be saved.
- **Storage usage** in the dashboard footer (lists vs caches), and the manifest now requests `unlimitedStorage` so caches for large areas can't hit the 10 MB cap.
- **"thetopo changed" notices.** When a routelist URL matches but the page has no embedded route data (or a crag's parent area has none), a notice says so in the page instead of the extension just doing nothing. The dashboard likewise tells you when thetopo served the login page instead of your ascents, when an ascents page doesn't look like one, or when an area routelist stops embedding its data.
- **Unit tests** (`npm test`, Node's built-in runner, no dependencies) for grade parsing, filter matching / sorting, crag total harvesting, ascent de-duplication, search-result parsing, tier-list filtering, import validation, backup restore and the storage wrappers.

### Changed
- `content.js` and `mycrags.js` (2 000 and 3 000 lines) are split into `content/*.js` and `mycrags/*.js` feature files that share a namespace object. Behaviour is unchanged; load order is listed in `manifest.json` / `mycrags.html`.
- `shared.js` is now the single home for the storage key registry, promise-based `chrome.storage` wrappers, grade tables + parsing, feature-tag tables, route keys, pager / RouteList-store readers and the tier-list shapes (`makeList`, `makeCustomList`, `sanitizeList`). The copies that had drifted between `content.js` and `mycrags.js` are gone.
- "Clear cache" now clears every cache key (including the routelist's video/comment meta cache) and still never touches your lists.
- Imported tier-list files get a fresh local id, so importing can't collide with one of your own lists.

## 0.35.1 and earlier

See `git log`.

# BetterCrags

A personal-use Chrome extension that augments [thetopo.com](https://thetopo.com)'s premium route-list page with the filters it's missing.

## What it does

- **Exclude features** — filter out routes with crimps, slopers, dynos, etc. (tri-state: ignore / must have / exclude)
- **Ascent range** — min/max ascent count with editable number inputs (0–200+)
- **Todo / Done** — filter against your own todo list and completed ascents (auto-fetched when you're logged in)
- **My Crags dashboard** — a standalone page (button in the filter panel) with: where-to-go-next ranking by open todos, per-crag completion % across all your visited areas, grade firsts (the crag where each grade became real for you), and assorted fun stats
- **To-do tierlists** — a tab on the My Crags dashboard: drag your todos (or any route found via search, or a whole area/crag browse) into S/A/B/C tiers; lists are saved locally and can be exported/imported as JSON
- **Add to a list while browsing** — every route row has a `+ list` button alongside `+ todo` / `+ done`, and each individual route page gets one too: drop the route straight into any custom tier-list (or spin up a new list on the spot) without leaving the page. Open dashboard tabs pick up the change live
- **Backup / Restore** — one JSON file with every list, note, dismissed suggestion and setting; restore merges it back (same-id lists replaced, new ones added). Take one before reloading the unpacked folder from a new path or reinstalling — that wipes the extension's storage
- **Tells you when something's wrong** — a failed save shows a banner instead of silently losing the edit, and if thetopo changes a page so the extension can't read it, a notice says so in the page
- **Dark mode** — a site-wide dark theme for thetopo.com, toggled from the popup
- **Name search**, sort by rating / ascents / grade / name, dual-thumb grade slider, 3-star min rating
- **Filters everything client-side** over all 5400+ routes per area — no more clicking "Show more"
- **Works on a single crag's routelist too** — derives full feature/tag data from the parent area so every filter still applies
- **Removes the premium upsell** on the page
- **Filter state persists** across page reloads
- **Lazy-loads route thumbnails** via thetopo's photo API

Clicking the BetterCrags icon in your Chrome toolbar opens a popup with toggles for the filters (active tab) and dark mode (site-wide), plus a button to open the My Crags dashboard.

## Install

1. **Download** this repo as a zip (`Code → Download ZIP`) or `git clone` it. Keep the folder somewhere permanent.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and pick the unzipped/cloned folder.
5. Visit any thetopo area routelist (e.g. <https://thetopo.com/areas/helsinki/routelist>) or a specific crag's routelist (e.g. <https://thetopo.com/crags/hienostoalue/routelist>). The BetterCrags filter bar appears at the top of the list.

## Tips

- Feature pills cycle on click: **white** = ignore, **green** = must have, **red** = must not have
- Drag the slider thumbs, or type values into the ascent number boxes
- Login required for the **Todo** / **Done** filters (the extension scans the page for your username automatically)
- The `–` button at the right collapses the filter body; click again to expand
- The toolbar icon (top of Chrome) opens the popup — toggle filters or dark mode there; the badge shows OFF when filters are disabled on a tab
- The **My Crags** button opens a dashboard page in a new tab. It uses cached crag totals from the area routelists you've visited; visit more areas to fill in completion % for those crags. Crag pages it doesn't know yet are fetched on demand and cached for a week.
- The dashboard footer shows how much storage the extension uses. **Clear cache** drops the re-fetchable crag/route data and keeps your lists; **Backup** is the thing to click before you reinstall.

## Development

No build step — the folder is loaded as-is. Layout:

| Path | What |
| --- | --- |
| `shared.js` | Loaded first everywhere: storage keys + `chrome.storage` wrappers, grade tables and parsing, feature-tag tables, tier-list shapes, the `+ list` menu |
| `content/` | Routelist content script, in load order: `core.js` (constants, pure filter/sort logic) → `caches.js` → `ascent-modal.js` → `render.js` → `main.js` (`init()`) |
| `mycrags/` | Dashboard page, in load order: `core.js` (state, status line, alerts) → `data.js` (fetching/parsing) → `dashboard.js` → `tierlists.js` → `main.js` (boot) |
| `routepage.js`, `nav.js`, `darkmode.js`, `popup.js`, `background.js` | Single-route `+ list` button, navbar link, dark theme, toolbar popup, badge/service worker |
| `test/` | Unit tests for the pure logic, run with `npm test` (Node ≥ 20, no dependencies). `test/load.js` loads the browser files into a stub DOM, so a file that destructures something a later file defines fails here instead of in Chrome |

Files in `content/` and `mycrags/` share one namespace object (`window.BCRoutelist` / `window.BCMyCrags`): each file destructures what it needs from files loaded before it, and exports what later files use with `Object.assign(…)` at the bottom. Keep the load order in `manifest.json` / `mycrags.html` in sync when adding a file.

## Caveats

- Personal-use only. Not on the Chrome Web Store.
- Tied to thetopo's current HTML/API. If they redeploy with significant changes, things might break — the extension now says so on the page / dashboard when it can't find what it expects, rather than silently doing nothing.
- The bundled icon is a copy of thetopo's favicon (32×32, upscaled for larger sizes).

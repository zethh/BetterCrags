// BetterCrags — add a "+ list" button to a single route's page so you can
// drop the route straight into a custom tier-list (or a new one) without
// going back to the routelist. Reuses the board + menu helpers in shared.js.
(() => {
  'use strict';

  const { gradeIntFromLabel, openListMenu } = window.BCShared || {};
  if (!openListMenu) return; // shared.js failed to load — nothing to do.

  const BTN_ID = 'bc-routepage-add-list';

  // Route pages live at /crags/<crag>/routes/<route>. Bail on anything else
  // (routelist, topo, area, …) so we don't inject on the wrong page.
  function routeKeyFromUrl() {
    const m = location.pathname.match(/^\/crags\/([^/]+)\/routes\/([^/?#]+)/);
    if (!m) return null;
    const cragParamId = decodeURIComponent(m[1]);
    const paramId = decodeURIComponent(m[2]);
    // /routes/<x>/edit, /ascents, etc. — only the bare route page.
    if (paramId === 'new') return null;
    return { cragParamId, paramId };
  }

  // The header is server-rendered:
  //   <h1 class="cragname">Teknikko <span class="stars">…</span></h1>
  //   <div class="location"><div class="area-container">
  //     Boulder, 7B on <a href="/crags/…/topos/…">Wall,</a> <a href="/areas/…">…</a>
  //   </div></div>
  function readRoute(ids) {
    const h1 = document.querySelector('.banner-placeholder h1.cragname, h1.cragname');
    if (!h1) return null;
    // Route name = h1 text minus the stars span.
    const nameClone = h1.cloneNode(true);
    nameClone.querySelectorAll('.stars, span, a').forEach(n => n.remove());
    const name = (nameClone.textContent || '').trim();

    let genre = '';
    let gradeLabel = '';
    let cragName = '';
    const areaC = document.querySelector('.location .area-container') ||
                  document.querySelector('.banner-placeholder .location');
    if (areaC) {
      // Leading text node holds "Boulder, 7B" (before the "on <crag>" links).
      const lead = Array.from(areaC.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join(' ')
        .split('\n').map(s => s.trim()).filter(Boolean)
        .find(s => /[0-9]/.test(s) || s.includes(',')) || '';
      const comma = lead.indexOf(',');
      if (comma >= 0) {
        genre = lead.slice(0, comma).trim();
        gradeLabel = lead.slice(comma + 1).trim().replace(/\bon\b\s*$/i, '').trim();
      } else if (lead) {
        gradeLabel = lead.replace(/\bon\b\s*$/i, '').trim();
      }
      const cragLink = areaC.querySelector('a[href*="/crags/"]');
      if (cragLink) cragName = (cragLink.textContent || '').trim().replace(/,\s*$/, '');
    }

    const gradeInt = gradeLabel ? gradeIntFromLabel(gradeLabel, genre) : 0;
    return {
      crag_param_id: ids.cragParamId,
      param_id: ids.paramId,
      name,
      genre,
      grade_int: gradeInt,
      gradeLabel,
      crag_name: cragName,
    };
  }

  function ensureStyles() {
    if (document.getElementById(BTN_ID + '-style')) return;
    const style = document.createElement('style');
    style.id = BTN_ID + '-style';
    // The route header sits on a dark banner, so style the button for contrast
    // here rather than leaning on panel.css's light-table styling.
    style.textContent = `
      .bc-routepage-list-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 6px 14px;
        border: 1px solid rgba(255,255,255,0.55);
        border-radius: 16px;
        background: rgba(255,255,255,0.12);
        color: #fff;
        font: 600 13px/1.2 inherit;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
      }
      .bc-routepage-list-btn:hover {
        background: rgba(255,255,255,0.22);
        border-color: #fff;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function inject(ids) {
    if (document.getElementById(BTN_ID)) return true;
    const header = document.querySelector('.banner-placeholder .container') ||
                   document.querySelector('h1.cragname')?.parentElement;
    if (!header) return false;
    const route = readRoute(ids);
    if (!route || !route.name) return false; // header not fully rendered yet

    ensureStyles();
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'bc-routepage-list-btn';
    btn.textContent = '+ list';
    btn.title = 'Add this route to a custom tier-list';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Re-read the header at click time in case the grade/name hydrated late.
      const fresh = readRoute(ids) || route;
      openListMenu(btn, fresh);
    });

    const fav = header.querySelector('.add-to-favourites');
    if (fav) fav.appendChild(btn);
    else header.appendChild(btn);
    return true;
  }

  const ids = routeKeyFromUrl();
  if (!ids) return;

  if (!inject(ids)) {
    const mo = new MutationObserver(() => {
      if (inject(ids)) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }
})();

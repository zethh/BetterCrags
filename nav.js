// BetterCrags — inject a "My Crags" link into thetopo's top navbar.
// Runs on every thetopo page so the dashboard is always one click away.
(() => {
  'use strict';

  const LINK_ID = 'bc-mycrags-nav';
  const STYLE_ID = 'bc-mycrags-nav-style';
  const MYCRAGS_URL = chrome.runtime.getURL('mycrags.html');

  function injected() {
    return document.getElementById(LINK_ID);
  }

  // nav.js's manifest entry loads no CSS file, so carry the link's styling
  // in a small injected <style> block instead of inline element styles.
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bc-mycrags-nav-link {
        display: inline-flex;
        align-items: center;
        padding: 14px 14px;
        color: #d8dde3;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-decoration: none;
        gap: 6px;
      }
      .bc-mycrags-nav-link:hover { color: #fff; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Find the right-hand nav cluster (where the bell / user avatar live), or
  // fall back to any reasonable nav container. We try a few selectors to
  // survive minor markup tweaks on thetopo's side.
  function findNavTarget() {
    const selectors = [
      'nav.navbar .navbar-right',
      'nav.navbar .nav.navbar-nav.navbar-right',
      '.navbar .nav.navbar-nav.navbar-right',
      'nav.navbar ul.nav',
      'nav.navbar',
      '.navbar',
      'header nav',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function buildLinkElement(target) {
    // If the target is a <ul> nav list, build an <li> matching that idiom.
    const isList = target.tagName === 'UL';
    const a = document.createElement('a');
    a.id = LINK_ID;
    a.href = MYCRAGS_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'My Crags';
    a.title = 'BetterCrags — open the My Crags dashboard';
    a.className = 'bc-mycrags-nav-link';

    if (isList) {
      const li = document.createElement('li');
      li.id = LINK_ID + '-li';
      li.appendChild(a);
      return li;
    }
    return a;
  }

  function inject() {
    if (injected()) return true;
    const target = findNavTarget();
    if (!target) return false;
    ensureStyles();
    const node = buildLinkElement(target);

    // Try to land next to "Feed" or before the notification bell / avatar.
    let anchor = null;
    if (target.tagName === 'UL') {
      // Prefer to insert just before the first item that looks like the bell or avatar.
      for (const li of target.children) {
        const t = (li.textContent || '').toLowerCase();
        if (li.querySelector('.glyphicon-bell, .fa-bell, img.avatar, .user-avatar') || t.includes('notif')) {
          anchor = li;
          break;
        }
      }
      if (anchor) target.insertBefore(node, anchor);
      else target.appendChild(node);
    } else {
      // Non-list nav: append at the end.
      target.appendChild(node);
    }
    return true;
  }

  // First attempt at document_idle. If markup hasn't loaded yet, watch for it.
  if (!inject()) {
    const mo = new MutationObserver(() => {
      if (inject()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // Stop watching after a reasonable timeout — no point monitoring forever.
    setTimeout(() => mo.disconnect(), 15000);
  }
})();

// BetterCrags — routelist content script: the in-page "+ todo" /
// "+ done" modal that wraps thetopo's add-ascent form.
(() => {
  'use strict';
  // One namespace object shared by every content/*.js file (see core.js).
  const RL = (window.BCRoutelist = window.BCRoutelist || {});
  const { escapeHtml, warn } = RL;



  // ── "Add to todo" / "Mark as done" modal ────────────────────────────
  // Thetopo's add-ascent endpoint (/climbers/<user>/ascents/new) returns a
  // full HTML page with a server-rendered form (CSRF token included). We
  // fetch it, lift out the <form>, drop it into an in-page modal, and POST
  // back to the form's action when the user submits — saving without a
  // page navigation. Rails forms typically include a hidden `_method` to
  // override POST → PUT/PATCH/DELETE; FormData carries it through, so we
  // never strip or rewrite it.
  let ascentModalEl = null;
  let ascentModalKeyHandler = null;
  let ascentModalOpenToken = 0; // bumped on every open(); closures compare to detect supersession

  // Drop attributes / nodes that could execute script. The form comes from
  // the same origin so the risk is mainly defense-in-depth against a future
  // thetopo XSS leaking server-rendered content into our injected DOM.
  function sanitizeInjectedForm(form) {
    for (const node of form.querySelectorAll('script, iframe, object, embed, link[rel="import"]')) {
      node.remove();
    }
    const all = [form, ...form.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); continue; }
        // Browsers strip ASCII control chars / spaces inside the scheme, so
        // "java\tscript:" still executes — normalize the same way before testing.
        const v = (attr.value || '').replace(/[\x00-\x20]/g, '');
        if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'formaction') &&
            /^javascript:/i.test(v)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  // Heuristic: did the POST response come back as another ascent-form re-render
  // (Rails-style validation failure) or contain an error flash? We can't trust
  // res.ok alone — Rails returns 200 + the new.html.erb on validation failure.
  function ascentResponseHasError(doc) {
    if (doc.querySelector('.field_with_errors, #error_explanation, .alert-danger, .alert-error, .form-error, .flash-error, .flash.error, .has-error')) {
      return true;
    }
    // The new-ascent form is the only place this hidden field appears; if it
    // shows up in the response, the form was re-rendered (validation failed).
    if (doc.querySelector('form input[name="route_id"][type="hidden"]')) return true;
    return false;
  }

  function ensureAscentModal() {
    if (ascentModalEl && document.body.contains(ascentModalEl)) return ascentModalEl;
    const overlay = document.createElement('div');
    overlay.className = 'tt-xf-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="tt-xf-modal" role="dialog" aria-modal="true">
        <div class="tt-xf-modal-header">
          <span class="tt-xf-modal-title" data-tt-xf-modal-title>Add ascent</span>
          <button type="button" class="tt-xf-modal-close" data-tt-xf-modal-close aria-label="Close">×</button>
        </div>
        <div class="tt-xf-modal-body" data-tt-xf-modal-body>Loading…</div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-tt-xf-modal-close]')) {
        closeAscentModal();
      }
    });
    document.body.appendChild(overlay);
    ascentModalEl = overlay;
    return overlay;
  }
  function closeAscentModal() {
    if (!ascentModalEl) return;
    ascentModalEl.hidden = true;
    const body = ascentModalEl.querySelector('[data-tt-xf-modal-body]');
    if (body) body.innerHTML = '';
    if (ascentModalKeyHandler) {
      document.removeEventListener('keydown', ascentModalKeyHandler, true);
      ascentModalKeyHandler = null;
    }
  }
  async function openAscentModal({ user, routeId, mode, routeLabel, onSuccess }) {
    const myToken = ++ascentModalOpenToken;
    const isCurrent = () => myToken === ascentModalOpenToken;
    const overlay = ensureAscentModal();
    const title = overlay.querySelector('[data-tt-xf-modal-title]');
    const body = overlay.querySelector('[data-tt-xf-modal-body]');
    title.textContent = mode === 'todo'
      ? `Add to todo${routeLabel ? ` — ${routeLabel}` : ''}`
      : `Log ascent${routeLabel ? ` — ${routeLabel}` : ''}`;
    body.innerHTML = '<div class="tt-xf-modal-status">Loading form…</div>';
    overlay.hidden = false;

    if (ascentModalKeyHandler) document.removeEventListener('keydown', ascentModalKeyHandler, true);
    ascentModalKeyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAscentModal(); } };
    document.addEventListener('keydown', ascentModalKeyHandler, true);

    // Path-only URL by construction — we never let an external string become
    // the URL scheme, so a later `escapeHtml(formUrl)` interpolation can't
    // be turned into `javascript:` via this code path.
    const params = new URLSearchParams({ route_id: String(routeId) });
    if (mode === 'todo') params.set('todo', '1');
    const formUrl = `/climbers/${encodeURIComponent(user)}/ascents/new?${params.toString()}`;

    let html;
    try {
      const res = await fetch(formUrl, { credentials: 'include', headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      warn('ascent form fetch failed', err);
      if (!isCurrent()) return;
      body.innerHTML = `<div class="tt-xf-modal-status tt-xf-modal-error">Couldn't load the form. <a href="${escapeHtml(formUrl)}" target="_blank" rel="noreferrer noopener">Open in new tab</a> instead.</div>`;
      return;
    }
    if (!isCurrent()) return; // a newer open() superseded us while fetching

    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Prefer a form whose action posts to /ascents (route-specific); fall back to first form.
    const forms = Array.from(doc.querySelectorAll('form'));
    const form = forms.find(f => /\/ascents(\b|\/|\?|$)/.test(f.getAttribute('action') || '')) || forms[0];
    if (!form) {
      body.innerHTML = `<div class="tt-xf-modal-status tt-xf-modal-error">No form found on the page. <a href="${escapeHtml(formUrl)}" target="_blank" rel="noreferrer noopener">Open in new tab</a>.</div>`;
      return;
    }

    // Resolve relative action against the form page URL, and refuse to POST
    // credentials anywhere but our own origin.
    const action = new URL(form.getAttribute('action') || formUrl, location.origin + formUrl).toString();
    if (new URL(action, location.href).origin !== location.origin) {
      warn('ascent form action is cross-origin; refusing to submit', action);
      body.innerHTML = `<div class="tt-xf-modal-status tt-xf-modal-error">Unexpected form target. <a href="${escapeHtml(formUrl)}" target="_blank" rel="noreferrer noopener">Open in new tab</a> instead.</div>`;
      return;
    }
    form.setAttribute('action', action);
    sanitizeInjectedForm(form);

    body.innerHTML = '';
    body.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // FormData skips the submit button's name/value unless we add it explicitly.
      // `e.submitter` is null when the form is submitted via Enter; fall back to
      // the first [type=submit] so the server still sees the expected button.
      const submitter = e.submitter || form.querySelector('button[type="submit"], input[type="submit"]');
      const data = new FormData(form);
      if (submitter && submitter.name) data.append(submitter.name, submitter.value || '');
      const statusBar = document.createElement('div');
      statusBar.className = 'tt-xf-modal-status';
      statusBar.textContent = 'Saving…';
      body.appendChild(statusBar);
      // Disable inputs to prevent double-submit.
      for (const el of form.elements) el.disabled = true;
      try {
        const res = await fetch(action, {
          method: (form.getAttribute('method') || 'POST').toUpperCase(),
          credentials: 'include',
          body: data,
          headers: { Accept: 'text/html' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resHtml = await res.text();
        const resDoc = new DOMParser().parseFromString(resHtml, 'text/html');
        if (ascentResponseHasError(resDoc)) {
          throw new Error('the server reported a validation error');
        }
        if (typeof onSuccess === 'function') onSuccess();
        if (isCurrent()) closeAscentModal();
      } catch (err) {
        warn('ascent submit failed', err);
        if (!isCurrent()) return; // superseded modal — don't mutate the new one
        for (const el of form.elements) el.disabled = false;
        statusBar.classList.add('tt-xf-modal-error');
        statusBar.textContent = `Save failed (${err.message || err}). Try the "Open in new tab" fallback.`;
      }
    });
  }

  // Cache built HTML strings per route. Filter changes re-use; only invalidated
  // when the routes array itself is replaced (background-fetch expansion).
  // Bump when the row template's cell count or structure changes so stale
  // cached HTML from older builds doesn't survive into a new column layout.

  Object.assign(RL, { openAscentModal });
})();

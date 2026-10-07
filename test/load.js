// Loads the extension's browser scripts into a bare vm context with a stub
// DOM + chrome.storage, so the pure logic can be unit-tested under node:test
// and load-order mistakes (a file destructuring something a later file
// defines) fail loudly here instead of in the browser.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function stubElement() {
  const el = {
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], childNodes: [],
    hidden: false, textContent: '', innerHTML: '', value: '',
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(c) { el.children.push(c); return c; }, insertBefore(c) { el.children.push(c); return c; },
    insertAdjacentElement() {}, remove() {}, closest() { return null; },
    // Lookups yield fresh throwaway elements (never null) so render code can be
    // driven end-to-end; querySelectorAll stays empty so loops are no-ops.
    querySelector() { return stubElement(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    cloneNode() { return stubElement(); }, contains() { return false; }, focus() {},
  };
  return el;
}

// In-memory chrome.storage.local. `store` is shared with the caller so tests
// can seed and inspect it.
function makeChrome(store) {
  let lastError = null;
  const done = (cb, v) => { if (cb) cb(v); };
  return {
    runtime: {
      get lastError() { return lastError; },
      getManifest: () => ({ version: '0.0.0-test' }),
      sendMessage() {}, onMessage: { addListener() {} }, getURL: (p) => `chrome-extension://test/${p}`,
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(keys, cb) {
          const out = {};
          const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
          for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          done(cb, out);
        },
        set(obj, cb) {
          if (store.__failWrites) { lastError = { message: 'QUOTA_BYTES quota exceeded' }; done(cb); lastError = null; return; }
          for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v));
          done(cb);
        },
        remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; done(cb); },
        getBytesInUse(keys, cb) {
          const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
          done(cb, list.reduce((n, k) => n + (k in store ? JSON.stringify(store[k]).length : 0), 0));
        },
      },
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    tabs: { create: async () => ({}), query: async () => [], sendMessage: async () => ({}) },
  };
}

// Load the given files (relative to the repo root) in order. Returns the
// context: ctx.BCShared, ctx.BCMyCrags, ctx.BCRoutelist, ctx.store.
function loadScripts(files, { store = {} } = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    requestIdleCallback: (cb) => setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 0),
    CSS: { escape: (s) => String(s) },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: 'https://thetopo.com/', origin: 'https://thetopo.com', pathname: '/', hostname: 'thetopo.com' },
    fetch: async () => { throw new Error('fetch is stubbed out in tests'); },
    DOMParser: function () { this.parseFromString = () => stubElement(); },
    Blob: function () {}, FileReader: function () {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    IntersectionObserver: function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; },
    alert() {}, confirm() { return true; }, prompt() { return ''; },
    getComputedStyle() { return { position: 'static' }; },
    innerHeight: 800, innerWidth: 1200,
    addEventListener() {}, removeEventListener() {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    store,
  };
  ctx.chrome = makeChrome(store);
  const doc = stubElement();
  doc.body = stubElement(); doc.head = stubElement(); doc.documentElement = stubElement();
  doc.createElement = () => stubElement();
  doc.activeElement = null; doc.visibilityState = 'visible';
  // Every lookup yields a throwaway element so boot-time wiring (addEventListener
  // on '#mc-refresh' etc.) is harmless; code that branches on null still gets
  // exercised through querySelectorAll's empty list.
  doc.querySelector = () => stubElement();
  doc.getElementById = () => stubElement();
  doc.contains = () => false;
  ctx.document = doc;
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    const abs = path.join(ROOT, f);
    vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: abs });
  }
  return ctx;
}

const MYCRAGS_FILES = ['shared.js', 'mycrags/core.js', 'mycrags/data.js', 'mycrags/dashboard.js', 'mycrags/tierlists.js', 'mycrags/main.js'];
// content/main.js boots against the live page and is left out: everything
// below it is loadable (and the load-order check covers its imports).
const CONTENT_FILES = ['shared.js', 'content/core.js', 'content/caches.js', 'content/ascent-modal.js', 'content/render.js'];

module.exports = { loadScripts, stubElement, MYCRAGS_FILES, CONTENT_FILES };

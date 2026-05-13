// BetterCrags dark mode applier.
//
// Runs at document_start on every thetopo.com page. Reads bc_dark_mode_v1
// from chrome.storage.local and toggles the `bettercrags-dark` class on
// <html> so the rules in darkmode.css take effect. Listens for storage
// changes so toggling from the popup applies live without a reload.

(() => {
  const DARK_KEY = 'bc_dark_mode_v1';
  const DARK_CLASS = 'bettercrags-dark';

  function apply(enabled) {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle(DARK_CLASS, !!enabled);
  }

  try {
    chrome.storage.local.get(DARK_KEY, (o) => apply(o && o[DARK_KEY]));
  } catch (_) {}

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (DARK_KEY in changes) apply(changes[DARK_KEY].newValue);
    });
  } catch (_) {}
})();

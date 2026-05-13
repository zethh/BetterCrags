// BetterCrags popup — two toggles: filters (per active tab) and dark mode (site-wide).

const DARK_KEY = 'bc_dark_mode_v1';
const FILTER_KEY = 'bc_filter_state_v1';

const darkInput = document.getElementById('bc-dark');
const filtersInput = document.getElementById('bc-filters');
const note = document.getElementById('bc-note');

function setNote(text) {
  note.textContent = text || '';
}

chrome.storage.local.get([DARK_KEY, FILTER_KEY], (o) => {
  darkInput.checked = !!(o && o[DARK_KEY]);
  const saved = o && o[FILTER_KEY];
  // Filters default to ON when nothing has been saved yet.
  filtersInput.checked = !saved || saved.enabled !== false;
});

darkInput.addEventListener('change', () => {
  chrome.storage.local.set({ [DARK_KEY]: darkInput.checked });
});

document.getElementById('bc-open-mycrags').addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('mycrags.html') });
    window.close();
  } catch (err) {
    setNote(`Couldn't open dashboard: ${err && err.message || err}`);
  }
});

filtersInput.addEventListener('change', async () => {
  setNote('');
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  } catch (_) {}
  if (!tab || !tab.id) {
    setNote('No active tab.');
    return;
  }
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'BC_TOGGLE' });
    if (resp && typeof resp.enabled === 'boolean') {
      filtersInput.checked = resp.enabled;
    }
  } catch (_) {
    // Content script not present — likely not a route list page.
    setNote('Filters apply on route list pages only.');
    chrome.storage.local.get(FILTER_KEY, (o) => {
      const s = o && o[FILTER_KEY];
      filtersInput.checked = !s || s.enabled !== false;
    });
  }
});

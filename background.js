// BetterCrags background service worker.
//
// Toolbar icon click → tell the active tab's content script to toggle.
// The content script also pings us on init/toggle so we can keep the
// per-tab badge in sync ("OFF" when disabled, blank when enabled).

function setBadge(tabId, enabled) {
  if (tabId == null) return;
  try {
    chrome.action.setBadgeText({ text: enabled ? '' : 'OFF', tabId });
    if (!enabled) {
      chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
    }
  } catch (_) {}
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  console.log('[BetterCrags bg] toolbar click on tab', tab.id, tab.url);
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'BC_TOGGLE' });
    console.log('[BetterCrags bg] toggle response:', resp);
    if (resp && typeof resp.enabled === 'boolean') {
      setBadge(tab.id, resp.enabled);
    }
  } catch (err) {
    console.warn('[BetterCrags bg] toggle failed (content script not loaded on this tab?):', err && err.message);
    setBadge(tab.id, true); // clear badge if anything weird
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'BC_STATE' && sender && sender.tab && sender.tab.id != null) {
    setBadge(sender.tab.id, !!msg.enabled);
  }
});

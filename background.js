// BetterCrags background service worker.
//
// Two jobs:
//   1. Keep the per-tab badge in sync with the filter on/off state.
//   2. Open the standalone My Crags dashboard when the content script asks.

function setBadge(tabId, enabled) {
  if (tabId == null) return;
  try {
    chrome.action.setBadgeText({ text: enabled ? '' : 'OFF', tabId });
    if (!enabled) {
      chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
    }
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BC_STATE' && sender && sender.tab && sender.tab.id != null) {
    setBadge(sender.tab.id, !!msg.enabled);
    return false;
  }
  if (msg && msg.type === 'BC_OPEN_MYCRAGS') {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('mycrags.html') });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
  return false;
});

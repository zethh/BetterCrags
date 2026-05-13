chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'BC_TOGGLE' });
  } catch (err) {
    // Content script not loaded on this tab (not a thetopo routelist).
  }
});

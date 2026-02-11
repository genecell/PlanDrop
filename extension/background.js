/**
 * PlanDrop Background Service Worker
 * Handles native messaging and context menu
 */

const NATIVE_HOST = 'com.plandrop.host';
let nativePort = null;
let pendingCallbacks = new Map();
let messageId = 0;

/**
 * Connect to native messaging host
 */
function connectNative() {
  if (nativePort) {
    return nativePort;
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);

    nativePort.onMessage.addListener((message) => {
      console.log('Native message received:', message);
      // Route response to pending callback
      const callbacks = Array.from(pendingCallbacks.values());
      if (callbacks.length > 0) {
        const callback = callbacks[0];
        pendingCallbacks.delete(callbacks[0].id);
        callback.resolve(message);
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('Native port disconnected:', error?.message || 'unknown reason');

      // Reject all pending callbacks
      pendingCallbacks.forEach((callback) => {
        callback.reject(new Error(error?.message || 'Disconnected'));
      });
      pendingCallbacks.clear();
      nativePort = null;
    });

    console.log('Connected to native host');
    return nativePort;
  } catch (e) {
    console.error('Failed to connect to native host:', e);
    nativePort = null;
    throw e;
  }
}

/**
 * Send message to native host and wait for response
 */
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      const port = connectNative();
      const id = ++messageId;

      pendingCallbacks.set(id, { id, resolve, reject });

      // Set timeout - 30 seconds to allow for first SSH connection
      // Subsequent calls use ControlMaster connection reuse and are fast
      setTimeout(() => {
        if (pendingCallbacks.has(id)) {
          pendingCallbacks.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 30000); // 30 second timeout

      port.postMessage(message);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Message handler for popup/options communication
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'native') {
    console.log('[Background] Native request:', request.payload.action, request.payload);
    sendNativeMessage(request.payload)
      .then((response) => {
        console.log('[Background] Native response:', response);
        sendResponse({ success: true, data: response });
      })
      .catch((error) => {
        console.error('[Background] Native error:', error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (request.type === 'openPopupWithContent') {
    // Store content for popup to retrieve
    chrome.storage.local.set({ pendingContent: request.content });
    sendResponse({ success: true });
    return false;
  }
});

/**
 * Context menu setup and side panel configuration
 */
chrome.runtime.onInstalled.addListener(() => {
  // Context menu
  chrome.contextMenus.create({
    id: 'send-to-plandrop',
    title: 'Send to PlanDrop',
    contexts: ['selection']
  });

  // Make extension icon open side panel directly (no popup)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.log('Side panel behavior error:', error));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'send-to-plandrop' && info.selectionText) {
    // Store selection and action for side panel to pick up
    await chrome.storage.session.set({
      pendingContent: info.selectionText,
      pendingAction: 'quickdrop' // Go to Quick Drop tab
    });

    // Open side panel
    if (tab && tab.id) {
      chrome.sidePanel.open({ tabId: tab.id })
        .catch((error) => console.log('Could not open side panel:', error));
    }
  }
});

/**
 * Tab activation listener - notify side panel when active tab changes
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Broadcast to all extension views (including side panel)
  chrome.runtime.sendMessage({
    type: 'tabActivated',
    tabId: activeInfo.tabId
  }).catch(() => {
    // Ignore errors if no listeners (side panel not open)
  });
});

console.log('PlanDrop background service worker loaded');

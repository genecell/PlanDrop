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

      // Set timeout
      setTimeout(() => {
        if (pendingCallbacks.has(id)) {
          pendingCallbacks.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 60000); // 60 second timeout

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
    sendNativeMessage(request.payload)
      .then((response) => {
        sendResponse({ success: true, data: response });
      })
      .catch((error) => {
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
 * Context menu setup
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-plandrop',
    title: 'Send to PlanDrop',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-plandrop' && info.selectionText) {
    // Store selection for popup
    chrome.storage.local.set({
      pendingContent: info.selectionText
    }, () => {
      // Open popup (by simulating click on extension icon)
      // Note: Manifest V3 doesn't allow programmatic popup opening
      // So we'll open as a new tab/window instead
      chrome.windows.create({
        url: 'popup.html?source=contextmenu',
        type: 'popup',
        width: 650,
        height: 500
      });
    });
  }
});

console.log('PlanDrop background service worker loaded');

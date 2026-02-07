// Background Service Worker
// ESM format. Message router between popup and content scripts.
// No audio processing -- pure coordination.

import { loadSettings, saveSettings } from "../shared/storage";
import {
  isPopupToContentMessage,
  isContentToPopupMessage,
  type ExtensionMessage,
} from "../shared/messages";

// -- Badge state --

function updateBadge(enabled: boolean): void {
  const text = enabled ? "ON" : "";
  const color = enabled ? "#4CAF50" : "#9E9E9E";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// -- Forward message to YouTube tabs --

async function findYouTubeTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(
    (t) =>
      t.url?.includes("youtube.com/watch") ||
      t.url?.includes("youtube.com/shorts") ||
      t.url?.includes("music.youtube.com")
  );
}

async function sendToContentScript(
  msg: ExtensionMessage
): Promise<unknown> {
  const ytTabs = await findYouTubeTabs();
  if (ytTabs.length === 0) return undefined;

  // For GET_STATUS, send to the first YouTube tab and return response
  // For other messages, broadcast to all YouTube tabs
  const results = await Promise.allSettled(
    ytTabs.map((tab) =>
      tab.id ? chrome.tabs.sendMessage(tab.id, msg) : Promise.resolve(undefined)
    )
  );

  // Return the first fulfilled response (for GET_STATUS)
  const fulfilled = results.find((r) => r.status === "fulfilled" && r.value);
  return fulfilled?.status === "fulfilled" ? fulfilled.value : undefined;
}

// Send to the currently active YouTube tab (for GET_STATUS)
async function sendToActiveYouTubeTab(
  msg: ExtensionMessage
): Promise<unknown> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (
    activeTab?.id &&
    (activeTab.url?.includes("youtube.com/watch") ||
      activeTab.url?.includes("youtube.com/shorts") ||
      activeTab.url?.includes("music.youtube.com"))
  ) {
    try {
      return await chrome.tabs.sendMessage(activeTab.id, msg);
    } catch {
      return undefined;
    }
  }
  // Fallback to first YouTube tab
  return sendToContentScript(msg);
}

// -- Message listener --

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From popup -> forward to content script
  if (isPopupToContentMessage(msg)) {
    // Also persist state changes
    if (msg.type === "SET_ENABLED") {
      saveSettings({ enabled: msg.enabled });
      updateBadge(msg.enabled);
    } else if (msg.type === "SET_PRESET") {
      saveSettings({ presetId: msg.presetId });
    }

    if (msg.type === "GET_STATUS") {
      // Send to the active YouTube tab instead of picking an arbitrary one
      sendToActiveYouTubeTab(msg).then((response) => {
        sendResponse(response);
      });
      return true; // async response
    }

    sendToContentScript(msg);
    return;
  }

  // From content script -> forward to popup
  if (isContentToPopupMessage(msg) && sender.tab) {
    if (msg.type === "STATUS") {
      updateBadge(msg.data.enabled);
    }
    // Forward to popup (will be received by popup's onMessage listener)
    // MV3: sendMessage is async -- sync try/catch cannot catch the rejection.
    // Use .catch() to suppress "Receiving end does not exist" when popup is closed.
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }
});

// -- Extension lifecycle --

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await saveSettings({
      enabled: false,
      presetId: "sleep",
      masterGainDb: 0,
    });
  }
  const settings = await loadSettings();
  updateBadge(settings.enabled);
});

// Restore badge on startup
chrome.runtime.onStartup.addListener(async () => {
  const settings = await loadSettings();
  updateBadge(settings.enabled);
});

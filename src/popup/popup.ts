// popup.ts -- Sleep Mode Popup Control Panel
// Bundled as IIFE. Communicates with content script via chrome.runtime messaging.
// All state sourced from chrome.storage.sync + live metering from content script.

import { loadSettings, saveSettings } from "../shared/storage";
import { getPresetById } from "../shared/constants";
import type { PipelineStatus } from "../shared/types";
import type {
  PopupToContentMessage,
  ContentToPopupMessage,
} from "../shared/messages";

// --- DOM References ---

const $ = (sel: string) => document.querySelector(sel)!;
const $$ = (sel: string) => document.querySelectorAll(sel);

const statusDot = $("#statusDot") as HTMLElement;
const statusText = $("#statusText") as HTMLElement;
const toggleBtn = $("#toggleBtn") as HTMLButtonElement;
const toggleLabel = $("#toggleLabel") as HTMLElement;
const eqToggle = $("#eqToggle") as HTMLButtonElement;
const lufsValue = $("#lufsValue") as HTMLElement;
const grValue = $("#grValue") as HTMLElement;
const presetCards = $$(".preset-card") as NodeListOf<HTMLButtonElement>;
const vocalToggle = $("#vocalToggle") as HTMLButtonElement;

// --- State ---

interface PopupState {
  enabled: boolean;
  presetId: string;
  eqEnabled: boolean;
  vocalEnhance: boolean;
  currentLufs: number | null;
  gainReductionDb: number | null;
}

const state: PopupState = {
  enabled: false,
  presetId: "sleep",
  eqEnabled: true,
  vocalEnhance: false,
  currentLufs: null,
  gainReductionDb: null,
};

// --- Render ---

function render(): void {
  // Toggle button
  toggleBtn.classList.toggle("active", state.enabled);
  toggleLabel.textContent = state.enabled
    ? "Sleep Mode active"
    : "Tap to activate";

  // Status indicator
  statusDot.classList.toggle("active", state.enabled);
  statusText.textContent = state.enabled ? "Processing" : "Standby";

  // Presets
  presetCards.forEach((card) => {
    const isActive = card.dataset.preset === state.presetId;
    card.classList.toggle("active", isActive);
  });

  // EQ toggle
  eqToggle.classList.toggle("active", state.eqEnabled);

  // Vocal enhance toggle
  vocalToggle.classList.toggle("active", state.vocalEnhance);

  // Metering values
  lufsValue.textContent =
    state.currentLufs !== null ? state.currentLufs.toFixed(1) : "--";

  grValue.textContent =
    state.gainReductionDb !== null
      ? `${state.gainReductionDb.toFixed(1)} dB`
      : "-- dB";
}

// --- Messaging ---

function sendMessage(msg: PopupToContentMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function requestStatus(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_STATUS",
    })) as { type: "STATUS"; data: PipelineStatus } | undefined;

    if (response?.type === "STATUS") {
      state.enabled = response.data.enabled;
      state.presetId = response.data.presetId;
      state.vocalEnhance = response.data.vocalEnhance;
      render();
    }
  } catch {
    // Content script not available
  }
}

// Listen for metering data from content script (relayed via background)
chrome.runtime.onMessage.addListener((msg: ContentToPopupMessage) => {
  if (msg.type === "METERING") {
    state.currentLufs = msg.data.currentLufs;
    state.gainReductionDb = msg.data.gainReductionDb;
    render();
  } else if (msg.type === "STATUS") {
    state.enabled = msg.data.enabled;
    state.presetId = msg.data.presetId;
    state.vocalEnhance = msg.data.vocalEnhance;
    render();
  }
});

// --- Event Handlers ---

function onToggle(): void {
  state.enabled = !state.enabled;
  saveSettings({ enabled: state.enabled });
  sendMessage({ type: "SET_ENABLED", enabled: state.enabled });

  if (!state.enabled) {
    state.currentLufs = null;
    state.gainReductionDb = null;
  }
  render();
}

function onPresetSelect(presetId: string): void {
  state.presetId = presetId;
  const preset = getPresetById(presetId);
  if (preset) {
    state.eqEnabled = preset.params.eqEnabled;
    state.vocalEnhance = preset.params.vocal.separator.enabled;
  }
  saveSettings({
    presetId,
    eqEnabled: state.eqEnabled,
    vocalEnhance: state.vocalEnhance,
  });
  sendMessage({ type: "SET_PRESET", presetId });
  render();
}

function onEqToggle(): void {
  state.eqEnabled = !state.eqEnabled;
  saveSettings({ eqEnabled: state.eqEnabled });
  sendMessage({ type: "SET_EQ_ENABLED", enabled: state.eqEnabled });
  render();
}

function onVocalToggle(): void {
  state.vocalEnhance = !state.vocalEnhance;
  saveSettings({ vocalEnhance: state.vocalEnhance });
  sendMessage({ type: "SET_VOCAL_ENHANCE", enabled: state.vocalEnhance });
  render();
}

// --- Initialization ---

function bindEvents(): void {
  toggleBtn.addEventListener("click", onToggle);

  presetCards.forEach((card) => {
    card.addEventListener("click", () => {
      const presetId = card.dataset.preset;
      if (presetId) {
        onPresetSelect(presetId);
      }
    });
  });

  eqToggle.addEventListener("click", onEqToggle);
  vocalToggle.addEventListener("click", onVocalToggle);
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  state.enabled = settings.enabled;
  state.presetId = settings.presetId;
  state.eqEnabled = settings.eqEnabled;
  state.vocalEnhance = settings.vocalEnhance;

  bindEvents();
  render();

  // Request current status from content script
  requestStatus();
}

document.addEventListener("DOMContentLoaded", init);

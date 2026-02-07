// Content Script main entry point
// Bundled as IIFE, runs in YouTube page context.

import { YouTubeObserver } from "./youtube-observer";
import { buildPipeline, type AudioPipeline } from "./audio-pipeline";
import {
  getPresetById,
  DEFAULT_PRESET_ID,
  DEFAULT_EQ,
} from "../shared/constants";
import { loadSettings, onSettingsChanged } from "../shared/storage";
import type { PipelineStatus, StorageSchema } from "../shared/types";
import {
  isPopupToContentMessage,
  type ContentToPopupMessage,
} from "../shared/messages";

let pipeline: AudioPipeline | null = null;
let currentPresetId = DEFAULT_PRESET_ID;
let masterGainDb = 0;
let currentEqEnabled = true;
let enabled = false;
let pipelineReady = false;
let currentPlaybackRate = 1.0;
let currentVocalEnhance = false;
let currentVideo: HTMLVideoElement | null = null;
// Track which video elements already have a MediaElementSource attached
const attachedVideos = new WeakSet<HTMLVideoElement>();
// Store resume listener for cleanup
let resumeListener: (() => void) | null = null;

function getStatus(): PipelineStatus {
  return {
    enabled,
    presetId: currentPresetId,
    masterGainDb,
    pipelineReady,
    audioContextState: pipeline
      ? (pipeline.ctx.state as "suspended" | "running" | "closed")
      : "closed",
    vocalEnhance: currentVocalEnhance,
  };
}

function sendToBackground(msg: ContentToPopupMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function applyPlaybackRate(): void {
  if (!currentVideo) return;
  if (enabled) {
    currentVideo.playbackRate = currentPlaybackRate;
    currentVideo.preservesPitch = false;
  } else {
    currentVideo.playbackRate = 1.0;
    currentVideo.preservesPitch = true;
  }
}

async function initPipeline(video: HTMLVideoElement): Promise<void> {
  // createMediaElementSource can only be called once per element
  if (attachedVideos.has(video)) {
    return;
  }

  // Destroy old pipeline if it exists (SPA navigation may create new video elements)
  if (pipeline) {
    pipeline.destroy();
    pipeline = null;
    pipelineReady = false;
  }

  const preset = getPresetById(currentPresetId);
  if (!preset) return;

  try {
    const params = {
      ...preset.params,
      masterGainDb,
      eqEnabled: currentEqEnabled,
      vocal: {
        separator: {
          enabled: currentVocalEnhance,
          vocalGainDb: preset.params.vocal.separator.vocalGainDb,
          musicReductionDb: preset.params.vocal.separator.musicReductionDb,
        },
      },
    };
    pipeline = await buildPipeline(video, params);
    currentVideo = video;
    attachedVideos.add(video);
    pipelineReady = true;

    // Apply playback rate (pitch via native resampling)
    applyPlaybackRate();

    // Handle AudioContext suspension (autoplay policy)
    // Clean up any previous resume listener
    if (resumeListener) {
      document.removeEventListener("click", resumeListener);
      document.removeEventListener("keydown", resumeListener);
      resumeListener = null;
    }
    if (pipeline.ctx.state === "suspended") {
      resumeListener = () => {
        pipeline?.ctx.resume();
        if (resumeListener) {
          document.removeEventListener("click", resumeListener);
          document.removeEventListener("keydown", resumeListener);
          resumeListener = null;
        }
      };
      document.addEventListener("click", resumeListener);
      document.addEventListener("keydown", resumeListener);
    }

    // Apply enabled state
    if (!enabled) {
      pipeline.bypass();
    }

    // Metering -> relay to popup
    pipeline.onMetering((data) => {
      if (enabled) {
        sendToBackground({ type: "METERING", data });
      }
    });

    sendToBackground({ type: "STATUS", data: getStatus() });
  } catch (err) {
    console.error("[Sleep Mode] Pipeline init failed:", err);
    pipelineReady = false;
  }
}

function applyPreset(presetId: string): void {
  const preset = getPresetById(presetId);
  if (!preset || !pipeline) return;
  currentPresetId = presetId;
  currentPlaybackRate = preset.playbackRate;
  masterGainDb = preset.params.masterGainDb;
  currentEqEnabled = preset.params.eqEnabled;
  currentVocalEnhance = preset.params.vocal.separator.enabled;
  pipeline.setPreset(preset.params);
  applyPlaybackRate();
}

function setEnabled(value: boolean): void {
  enabled = value;
  if (!pipeline) return;
  if (enabled) {
    pipeline.engage();
    pipeline.ctx.resume();
  } else {
    pipeline.bypass();
  }
  applyPlaybackRate();
  sendToBackground({ type: "STATUS", data: getStatus() });
}

function setVocalEnhance(value: boolean): void {
  currentVocalEnhance = value;
  const preset = getPresetById(currentPresetId);
  pipeline?.setVocalParams({
    separator: {
      enabled: value,
      vocalGainDb: preset?.params.vocal.separator.vocalGainDb ?? 0,
      musicReductionDb: preset?.params.vocal.separator.musicReductionDb ?? -12,
    },
  });
}

// -- Message handling from popup/background --

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isPopupToContentMessage(msg)) return;

  switch (msg.type) {
    case "SET_ENABLED":
      setEnabled(msg.enabled);
      break;
    case "SET_PRESET":
      applyPreset(msg.presetId);
      break;
    case "SET_MASTER_GAIN":
      masterGainDb = msg.gainDb;
      pipeline?.setMasterGain(msg.gainDb);
      break;
    case "SET_EQ_ENABLED":
      currentEqEnabled = msg.enabled;
      pipeline?.setEqParams(
        getPresetById(currentPresetId)?.params.eq ?? DEFAULT_EQ,
        msg.enabled
      );
      break;
    case "SET_VOCAL_ENHANCE":
      setVocalEnhance(msg.enabled);
      break;
    case "GET_STATUS":
      sendResponse({ type: "STATUS", data: getStatus() });
      return true; // indicates async response
  }
});

// -- Storage change listener (secondary sync) --

onSettingsChanged((changes: Partial<StorageSchema>) => {
  if (changes.enabled !== undefined) {
    setEnabled(changes.enabled);
  }
  if (changes.presetId !== undefined) {
    applyPreset(changes.presetId);
  }
  if (changes.masterGainDb !== undefined) {
    masterGainDb = changes.masterGainDb;
    pipeline?.setMasterGain(changes.masterGainDb);
  }
  if (changes.eqEnabled !== undefined) {
    currentEqEnabled = changes.eqEnabled;
    pipeline?.setEqParams(
      getPresetById(currentPresetId)?.params.eq ?? DEFAULT_EQ,
      changes.eqEnabled
    );
  }
  if (changes.vocalEnhance !== undefined) {
    setVocalEnhance(changes.vocalEnhance);
  }
});

// -- YouTube observer --

const observer = new YouTubeObserver({
  onVideoFound(video) {
    initPipeline(video);
  },
  onNavigate() {
    // Pipeline stays connected; YouTube reuses the video element
    sendToBackground({ type: "STATUS", data: getStatus() });
  },
});

// -- Initialize --

async function init(): Promise<void> {
  const settings = await loadSettings();
  enabled = settings.enabled;
  currentPresetId = settings.presetId;
  masterGainDb = settings.masterGainDb;
  currentEqEnabled = settings.eqEnabled;
  currentVocalEnhance = settings.vocalEnhance;

  // Load playback rate from preset
  const preset = getPresetById(currentPresetId);
  if (preset) {
    currentPlaybackRate = preset.playbackRate;
  }

  observer.start();
}

init();

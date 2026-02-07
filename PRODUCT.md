# Sleep Mode for YouTube -- Product Design Document

## 1. Problem Discovery

### User Pain Points

Through user research (Reddit threads, YouTube comments, sleep app reviews, forum discussions), we identified six core pain points that prevent YouTube from being a good sleep audio source:

| # | Pain Point | Severity | Frequency |
|---|-----------|----------|-----------|
| 1 | Background music drowns out the speaker | High | Very common in podcasts, audiobooks |
| 2 | Volume inconsistency across and within videos | High | Universal -- different uploaders, different loudness |
| 3 | Sudden transient sounds (laughter, applause, coughing, sound effects) | Critical | The #1 reason people get jolted awake |
| 4 | Speaking speed too fast for a drowsy brain | Medium | Common in lectures, fast-paced podcasts |
| 5 | High-pitched voices feel harsh at night | Medium | Subjective but widely reported |
| 6 | No "sleep-optimized" mode exists anywhere | High | YouTube, Spotify, and podcast apps all lack this |

### Key Insight

These problems are all **audio signal processing problems**, not UI problems. The solution must operate on the audio stream itself, in real time, with zero user configuration required.

### Design Principle

**Audio can only get quieter and smoother, never louder or harsher.** Every processing stage enforces this constraint. A sleeping user must never be disturbed by the tool itself.

## 2. Product Form Decision

### Options Evaluated

| Form Factor | Pros | Cons | Verdict |
|------------|------|------|---------|
| Standalone web app | Cross-platform | Can't intercept YouTube audio stream | Rejected |
| Mobile app | Portable | iOS/Android can't modify other apps' audio | Rejected |
| Desktop app (Tauri) | Full system audio access | Heavy install, permission complexity, macOS coreaudio/Windows WASAPI divergence | Deprioritized |
| Chrome Extension | Direct access to `<video>` element, Web Audio API, zero install friction | Chrome-only | **Selected** |

### Why Chrome Extension

1. **Direct audio access**: `MediaElementAudioSourceNode` connects directly to YouTube's `<video>` element. No system audio capture, no virtual audio devices, no permissions dialogs.
2. **Web Audio API**: AudioWorklet provides dedicated audio processing threads with 2.67ms time budget per 128-sample block at 48kHz. Professional-grade real-time DSP in the browser.
3. **Zero friction**: One click install from Chrome Web Store. No downloads, no setup, no configuration.
4. **Manifest V3**: Modern extension platform with good security model. Content scripts run in page context with access to DOM and Web Audio.

### What We Deprioritized

We also explored a Tauri desktop app with system-level audio capture (CoreAudio on macOS, WASAPI on Windows). This approach provides deeper integration but adds significant complexity:
- Platform-specific audio drivers
- Permission dialogs for screen/audio capture
- Heavy binary distribution (~20MB)
- Two separate platform codebases to maintain

The Chrome extension solves the same problems with 1% of the complexity. The desktop app remains a future option if we need to support non-Chrome browsers or non-YouTube sources.

## 3. Technical Architecture

### Architecture: Manifest V3 Chrome Extension

```
manifest.json
  |
  +-- Background Service Worker (ESM)
  |     Pure message router. No audio processing.
  |     Routes messages between popup <-> content script.
  |
  +-- Content Script (IIFE)
  |     Runs in YouTube page context.
  |     Owns the Web Audio pipeline lifecycle.
  |     Observes YouTube DOM for video element changes (SPA navigation).
  |
  +-- AudioWorklet Processors (IIFE, dedicated audio threads)
  |     sleep-processor.ts: Normalizer + Compressor + Limiter + TruePeak
  |     vocal-processor.ts: STFT mid/side vocal separator
  |
  +-- Popup (IIFE)
        Stateless control panel.
        All state lives in chrome.storage.sync.
        Shows preset selection and live metering.
```

### Signal Chain

The audio processing pipeline is designed as a layered defense system. Each layer handles a different time scale and threat:

```
YouTube <video> element
    |
    MediaElementSourceNode
    |
    [1] Vocal Separator (AudioWorklet)
    |     STFT mid/side decomposition, 2048-point FFT
    |     Attenuates background music, preserves speech
    |     Solves: Pain Point #1 (background music)
    |
    [2] High-Pass Filter (BiquadFilterNode, 80Hz)
    |     Removes sub-bass rumble
    |
    [3] 3-Band EQ (BiquadFilterNode x3)
    |     Low shelf + peaking + high shelf
    |     Solves: Pain Point #5 (high-pitched harshness)
    |
    [4] Loudness Normalizer (AudioWorklet)
    |     BS.1770 K-weighted LUFS measurement
    |     3-second sliding window, 1dB/s rate limit
    |     Slow, long-term loudness correction
    |     Solves: Pain Point #2 (volume inconsistency)
    |
    [5] Fast RMS Compressor (AudioWorklet)
    |     100ms sliding window, 15ms attack
    |     Soft knee, per-preset ratio (3:1 to 6:1)
    |     Fast transient loudness protection
    |     Solves: Pain Point #3 (sudden sounds)
    |
    [6] Lookahead Peak Limiter (AudioWorklet)
    |     5ms lookahead delay, 1ms attack
    |     Hard ceiling at -3dBFS
    |
    [7] True Peak Limiter (AudioWorklet)
    |     4x linear interpolation oversampling
    |     Catches inter-sample peaks
    |     Safety ceiling at -2dBTP
    |
    [8] Master Gain (GainNode)
    |     Per-preset volume offset
    |
    AudioContext.destination
```

Additionally, `video.playbackRate` with `preservesPitch=false` provides speed reduction and pitch lowering via the browser's native C++ resampler, solving Pain Point #4 (speaking speed) and contributing to Pain Point #5 (voice pitch).

### Why 4 Layers of Gain Control

The signal chain has 4 distinct gain-reduction stages. This is intentional, not redundant:

| Stage | Time Scale | What It Catches | Why the Others Can't |
|-------|-----------|-----------------|---------------------|
| Normalizer | 3 seconds | Track-to-track loudness differences (podcast A is -16 LUFS, podcast B is -22 LUFS) | Too slow for transients |
| Compressor | 100ms | Sudden laughter, applause, coughing within a track | Too fast for track-level normalization, too slow for sample peaks |
| Limiter | 5ms | Sample-level peaks that exceed -3dBFS | No perceptual loudness awareness |
| True Peak | Sub-sample | Inter-sample peaks from digital reconstruction | Only the limiter above sees sample peaks, not what happens between samples |

### Key Design Decisions and Why

**No DynamicsCompressorNode**

The Web Audio API provides `DynamicsCompressorNode`, a built-in compressor. We explicitly do not use it because it has automatic makeup gain that cannot be disabled. Makeup gain boosts the output to compensate for compression -- the exact opposite of our design principle ("never louder"). Our custom AudioWorklet compressor provides gain reduction only.

**Normalizer Measures Raw Input**

The LUFS measurement in the normalizer runs on the K-weighted input signal before gain is applied. The gain adjustment is applied to the original (unweighted) signal. This prevents a feedback loop: if we measured the output, the normalizer would see its own gain changes and chase its own tail.

**Conditional Boost (boostBelowLufs)**

The normalizer's default behavior is attenuation-only: it can turn things down but never up. However, some content is genuinely very quiet (e.g., a whispered ASMR track at -40 LUFS). Without any boost capability, the normalizer would leave it inaudible.

The solution: `boostBelowLufs = -35`. Only when content is quieter than -35 LUFS does the normalizer allow up to +3dB of boost. Normal content (above -35 LUFS) can only be attenuated. This is safe because the downstream limiter and true peak limiter provide a hard ceiling.

**Native Pitch Shifting**

We initially explored DSP-based pitch shifting (WSOLA time stretching + resampling). The problem: AudioWorklet processes 128 samples per block (2.67ms at 48kHz). WSOLA needs ~2400-sample analysis windows. The mismatch between the algorithm's window size and the worklet's block size produces audible artifacts (electrical noise, clicks).

The solution: `video.playbackRate = 0.94` with `video.preservesPitch = false`. The browser's native C++ audio resampler handles pitch shifting with zero artifacts and zero CPU overhead. The coupling of speed and pitch is actually desirable for sleep -- slower + deeper = more soothing.

**Soft Knee Compression**

The fast compressor uses a soft knee (6dB default) with quadratic interpolation in the knee zone. This means compression starts gradually before the threshold, avoiding the audible "pumping" effect of a hard-knee compressor. The formula:

- Below knee: no compression (0 dB gain change)
- In knee zone: quadratic curve provides gentle onset
- Above knee: full ratio compression

### Preset Design

Four presets cover the major sleep-listening content categories. Each preset is a complete configuration -- switching presets changes all parameters automatically with zero user interaction.

| Preset | Target LUFS | Compressor | Speed | Vocal Sep | EQ | Master Gain |
|--------|------------|------------|-------|-----------|-----|-------------|
| Sleep | -26 | 6:1, -24dB threshold | 0.94x | ON (-6dB music) | Warm (high shelf -4dB) | -6dB |
| ASMR | -28 | 6:1, -26dB threshold | 1.0x | OFF | Flat | -6dB |
| Podcast | -24 | 3:1, -20dB threshold | 0.94x | ON (+3dB voice) | Clarity (low shelf -3dB) | -3dB |
| White Noise | -26 | 3:1, -22dB threshold | 1.0x | OFF | Disabled | -3dB |

**Design rationale for each preset:**

- **Sleep**: Most aggressive processing. Background music reduced, speech slowed and deepened, warm EQ removes high-frequency harshness. Designed for falling asleep to a podcast or audiobook.
- **ASMR**: Quietest target (-28 LUFS). Full frequency spectrum preserved because ASMR relies on high-frequency detail (tapping, scratching, breathing). No speed change because tempo is part of the ASMR experience.
- **Podcast**: Clearest speech. Vocal separator boosts voice by +3dB while reducing music. Moderate compression (3:1) preserves natural dynamics. Slightly louder (-24 LUFS) because podcast listeners want to hear every word.
- **White Noise**: Minimal processing. EQ disabled to preserve the pure spectral character of rain, ocean, or fan sounds. Light compression prevents volume drift. No vocal separator because there are no vocals.

## 4. Build System

- **esbuild**: Sub-second builds. Each entry point (content script, popup, worklets, service worker) is bundled separately as IIFE or ESM.
- **TypeScript**: Strict mode. Types shared between content script and worklets are defined once in `src/shared/types.ts` and inlined by esbuild into each bundle.
- **No framework**: The popup is vanilla TypeScript + HTML/CSS. The content script is vanilla TypeScript. No React, no build-time CSS processors. The total bundle size stays small and there are zero runtime dependencies.

## 5. Zero-Configuration Philosophy

The extension is designed for "install and forget":

1. **First install**: Default preset is "Sleep". All processing parameters are pre-configured.
2. **Enable**: One tap on the power button. Everything activates.
3. **Preset switch**: Changing preset updates ALL parameters automatically -- EQ, compressor, normalizer target, vocal separator, speed, pitch, master gain. No individual settings to manage.
4. **Cross-session persistence**: Settings are saved to `chrome.storage.sync` and restored automatically.
5. **YouTube SPA navigation**: The content script observes YouTube's DOM for navigation events and video element changes. The pipeline stays connected through YouTube's single-page app transitions.

The user never needs to touch a slider, adjust a threshold, or understand what "LUFS" means. The presets encode our domain knowledge about what sounds good for sleep.

## 6. File Structure

```
sleep-mode-extension/
  manifest.json              # Chrome Extension manifest (V3)
  package.json               # Node dependencies (dev only)
  build.config.ts            # esbuild configuration
  tsconfig.json              # TypeScript configuration
  src/
    shared/
      types.ts               # Shared type definitions
      constants.ts            # Preset configs, default params
      storage.ts              # chrome.storage.sync wrapper
      messages.ts             # Message type guards
    content/
      content-script.ts       # Main entry: pipeline lifecycle
      audio-pipeline.ts       # Web Audio graph builder
      youtube-observer.ts     # YouTube DOM observer
    worklet/
      sleep-processor.ts      # Normalizer + Compressor + Limiter + TruePeak
      vocal-processor.ts      # STFT vocal separator
    background/
      service-worker.ts       # Message router
    popup/
      popup.ts                # Popup control panel
      popup.html              # Popup markup
      popup.css               # Popup styles
  dist/                       # Built output (loadable by Chrome)
  assets/icons/               # Extension icons
```

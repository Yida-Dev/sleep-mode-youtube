# Sleep Mode for YouTube

A Chrome extension that transforms any YouTube video into sleep-friendly audio in real time.

## The Problem

Millions of people fall asleep listening to YouTube -- podcasts, audiobooks, ASMR, rain sounds. But YouTube audio is optimized for engagement, not sleep:

- Background music drowns out the speaker
- Volume jumps between videos or within a single video
- Sudden laughter, applause, coughing, or sound effects jolt you awake
- Speech is too fast for a drowsy brain
- High-pitched voices feel harsh at night

## What Sleep Mode Does

One click. No configuration. The extension processes YouTube audio in real time through a professional broadcast-grade signal chain:

```
Source -> Vocal Separator -> EQ -> Normalizer -> Compressor -> Limiter -> True Peak -> Output
```

Every stage is designed around one principle: **audio can only get quieter and smoother, never louder or harsher.**

## Features

| Feature | How It Works |
|---------|-------------|
| Volume normalization | EBU R128 LUFS measurement with 3-second window. Brings all content to a consistent loudness. |
| Transient protection | Fast RMS compressor (100ms window, 15ms attack) catches sudden laughs, coughs, and sound effects before they reach your ears. |
| Peak limiting | Lookahead limiter + true peak limiter with 4x oversampling. Nothing exceeds the safety ceiling. |
| Background music reduction | STFT-based mid/side vocal separator isolates speech from background music. |
| Speed & pitch adjustment | Native browser resampling (`preservesPitch=false`) slows speech and lowers pitch for a warmer, more soothing tone. |
| Warm EQ | High-frequency rolloff and low-pass filtering remove harshness. |

## Installation

### From Source

```bash
git clone https://github.com/Yida-Dev/sleep-mode-youtube.git
cd sleep-mode-youtube
npm install
npm run build
```

Then load into Chrome:

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder

### Quick Load (Pre-built)

The `dist/` folder is included in the repo. You can load it directly into Chrome without building.

## Usage

1. **Enable**: Click the extension icon on any YouTube video, then tap the power button
2. **Choose a preset**: Pick the mode that matches your content
3. **That's it**: Everything adjusts automatically

No sliders to tweak, no settings to configure. The presets are designed to work out of the box.

## Presets

| Preset | Best For | What It Does |
|--------|----------|-------------|
| **Sleep** | Podcasts, audiobooks, guided meditations | -26 LUFS target, 6% slower playback, warm EQ (high shelf -4dB), vocal separator ON, aggressive transient compression (6:1) |
| **ASMR** | Whisper content, tapping, scratching | -28 LUFS target (quietest), full frequency spectrum preserved, no speed change, aggressive compression (6:1) |
| **Podcast** | Talk shows, interviews, lectures | -24 LUFS target, vocal separator with +3dB voice boost, 6% slower, moderate compression (3:1) |
| **White Noise** | Rain, ocean, fan sounds, ambient | -26 LUFS target, EQ disabled (pure signal), no speed change, light compression (3:1) |

### Loudness Ranking (quietest to loudest)

ASMR (-28) < Sleep (-26) = White Noise (-26) < Podcast (-24)

## Technical Details

### Signal Chain

```
YouTube <video> element
    |
    MediaElementSourceNode
    |
    Vocal Separator (AudioWorklet: STFT mid/side, 2048-point FFT)
    |
    High-Pass Filter (BiquadFilterNode, 80Hz)
    |
    3-Band EQ (BiquadFilterNode x3: low shelf, peaking, high shelf)
    |
    Sleep Processor (AudioWorklet, 4-stage):
      1. Normalizer  -- BS.1770 K-weighted LUFS, 3s window, 1dB/s rate limit
      2. Compressor   -- Fast RMS (100ms), soft knee, per-preset ratio
      3. Limiter      -- Lookahead peak limiter, 5ms delay, 1ms attack
      4. True Peak    -- 4x linear interpolation, -2dBTP ceiling
    |
    Master Gain (GainNode)
    |
    AudioContext.destination
```

### Key Design Decisions

- **No DynamicsCompressorNode**: The Web Audio built-in compressor has automatic makeup gain that cannot be disabled, causing loudness increases. We use custom worklet implementations instead.
- **Normalizer measures raw input**: The LUFS measurement runs on the unprocessed signal, and gain is applied separately. This prevents feedback loops with downstream stages.
- **Conditional boost**: The normalizer only boosts signals quieter than -35 LUFS (genuinely silent content). Normal and loud content can only be attenuated.
- **Native pitch shifting**: Instead of DSP-based pitch algorithms (which produce artifacts in 128-sample AudioWorklet blocks), we use `video.playbackRate` with `preservesPitch=false` for artifact-free pitch reduction via the browser's native C++ resampler.

### Architecture

- **Manifest V3** Chrome Extension
- **Content Script**: Manages the Web Audio pipeline lifecycle, YouTube DOM observation
- **AudioWorklet**: All custom DSP runs in dedicated audio threads (2.67ms time budget per 128-sample block at 48kHz)
- **Popup**: Stateless control panel. All state lives in `chrome.storage.sync`
- **Service Worker**: Pure message router, no audio processing

## Build

```bash
npm run build    # Production build (esbuild IIFE bundles)
npx tsc --noEmit # Type check only
```

## License

MIT

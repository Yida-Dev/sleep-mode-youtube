# Sleep Mode for YouTube -- Product Design Document

## 1. Problem

### What job is the user hiring this product for?

> "I want to fall asleep listening to YouTube without being woken up by the audio."

Millions of people use YouTube as a sleep aid every night -- podcasts, audiobooks, guided meditations, ASMR, rain sounds, lo-fi music. They are not watching; they are listening with eyes closed, in bed, in the dark. Their brain is transitioning from alert to drowsy to asleep.

But YouTube audio is engineered for the opposite state: maximum engagement, maximum attention retention. This creates a fundamental mismatch between the content platform and the user's actual context.

### Struggle moments

Through user research (Reddit r/sleep, r/podcasts, r/asmr, YouTube comments, sleep app reviews, and forum discussions), we mapped the specific moments where users get disrupted:

| Moment | What happens | User reaction | Severity |
|--------|-------------|---------------|----------|
| The volume jump | A new video autoplays at a very different loudness than the previous one. Or an ad plays at 2x the volume. | Jolted half-awake, fumbles for phone to adjust volume | Critical |
| The sudden sound | A laugh track, applause break, cough, or sound effect fires at 10-15dB above the conversation level | Fully woken up, heart rate spikes, sleep cycle resets | Critical |
| The background music swell | Intro/outro music or background scoring gradually overpowers the speaker's voice | Can't follow the words anymore, gets frustrated, gives up | High |
| The fast talker | Speaker talks at 1.2-1.5x their natural pace (common in edited YouTube content) | Drowsy brain can't process words fast enough, anxiety instead of relaxation | Medium |
| The harsh voice | High-pitched voices or sibilant speech feels piercing in a quiet room at night | Discomfort, switches to different content | Medium |

These are not feature requests. They are involuntary physiological responses -- adrenaline, startle reflex, cortisol release. No amount of UI can fix an audio signal that spikes 15dB in 10 milliseconds.

### Key insight

All five struggle moments are **audio signal processing problems**. The solution must operate on the audio waveform itself, in real time, sample by sample. A volume slider, a sleep timer, or a "night mode" color theme are cosmetic -- they don't touch the waveform.

### Why now

Three converging factors make this the right time:

1. **AudioWorklet maturity** (2023-2024): Chrome's AudioWorklet API is now stable and performant. It provides dedicated audio processing threads with 2.67ms time budget per block. Two years ago, this API had cross-browser bugs and performance issues that made production DSP impractical.

2. **Manifest V3 stabilization** (2024): Chrome's extension platform transition from MV2 to MV3 is complete. Building on MV3 now means no migration risk. The `web_accessible_resources` feature in MV3 allows AudioWorklet scripts to load cleanly from extension context.

3. **No one has solved this**: Despite 2.7B monthly active YouTube users and sleep being the #1 reported use case for background audio, no product addresses the audio signal itself. Every existing "sleep" solution is a wrapper (timer, dimmer, playlist) that leaves the raw audio untouched.

## 2. Competitive landscape

### The real competitor is the status quo

Most users don't use any tool. They just "deal with it" -- lower the volume so loud parts don't wake them, which means quiet parts become inaudible. This is the primary behavior we're competing against.

| Current workaround | What users do | Why it fails |
|-------------------|---------------|-------------|
| Lower volume to minimum safe level | Set volume so the loudest moment won't wake them | Quiet parts become inaudible; they miss content |
| Set a sleep timer | YouTube/phone timer stops playback after N minutes | Doesn't help during the listening period; the bad audio still plays |
| Switch to "calmer" content | Avoid podcasts with ads/music, only play ambient | Dramatically limits content choice; the user shouldn't have to pre-screen |
| Use a white noise app instead | Abandon YouTube entirely for Calm/Headspace/rain apps | Loses access to their preferred content (specific podcasts, specific creators) |
| Manual equalizer app | Install a system EQ app and tweak per-video | Requires technical knowledge, doesn't handle dynamics, doesn't know about LUFS |

### Adjacent products

| Product | What it does | What it doesn't do |
|---------|-------------|-------------------|
| YouTube Premium | Removes ads, allows background play | Zero audio processing. Volume jumps, transients, and music remain |
| Sleep Timer apps | Stop playback after N minutes | Don't modify audio at all |
| Calm / Headspace | Curated sleep audio library | Only their own content; can't use your YouTube subscriptions |
| System equalizer (EQualizer+, Boom) | Frequency adjustment | No loudness normalization, no transient protection, no vocal separation. Static EQ can't respond to dynamic content |
| Browser volume extensions | Set per-tab volume | Volume is a single number; doesn't address dynamic range within content |

### Our asymmetric advantage

No existing product can intercept YouTube's audio stream at the element level and process it in real time with custom DSP. This requires three capabilities that don't coexist anywhere else:

1. **DOM access to `<video>` element** -- only possible in a Chrome content script
2. **Web Audio API with AudioWorklet** -- only available in modern browsers, not in native apps
3. **Domain-specific DSP knowledge** -- knowing what "sleep-friendly audio" means acoustically (target LUFS, compression ratios, frequency curves, attack times)

This combination is structurally hard to replicate by YouTube itself (they optimize for engagement, not sleep), by sleep apps (they don't have access to YouTube's audio), or by generic equalizer extensions (they lack the multi-stage dynamics processing).

## 3. Design tenets

Ordered by priority. When tenets conflict, higher-ranked ones win.

1. **Never disturb sleep.** Audio can only get quieter and smoother, never louder or harsher. If a processing stage could potentially increase loudness, it doesn't ship. This is a hard constraint, not a preference.

2. **Zero configuration required.** The user taps one button. Everything else is automatic. No sliders, no thresholds, no "advanced settings". Presets encode our domain knowledge so the user doesn't need any.

3. **Correct by default.** The default preset (Sleep) must work well for the most common use case (falling asleep to a podcast) without any adjustment. Storage defaults, initial state, and all parameters must match the default preset exactly.

4. **Transparent processing.** The audio should sound natural, not processed. No audible pumping, breathing, or artifacts. If you can hear the compressor working, the parameters are wrong.

5. **Minimal footprint.** Zero runtime dependencies. No React, no framework. Sub-50KB total bundle. AudioWorklet threads handle DSP; the main thread stays idle. The extension should be invisible in CPU/memory usage.

## 4. Product form decision

### Trade-off matrix

| Criterion | Weight | Chrome Extension | Desktop App (Tauri) | Mobile App | Web App |
|-----------|--------|-----------------|-------------------|-----------|---------|
| Direct YouTube audio access | Must-have | Direct `<video>` element | System audio capture (indirect) | Impossible on iOS/Android | Impossible (CORS) |
| Real-time DSP capability | Must-have | AudioWorklet (dedicated thread) | Native audio pipeline (WASAPI/CoreAudio) | Limited (background processing restrictions) | AudioWorklet (same as extension) |
| Install friction | High | One click (Chrome Web Store) | Download + install + permissions | App store + review cycle | Zero (but can't access YouTube audio) |
| Cross-platform | Medium | Chrome only (covers ~65% desktop browser share) | macOS + Windows (separate codebases) | iOS + Android (separate codebases) | All browsers |
| Development complexity | Medium | Single codebase, web tech | Rust + platform-specific audio drivers | Native per-platform | Same as extension minus distribution |
| Maintenance burden | Medium | One codebase | Two platform audio layers, OS update sensitivity | Two platforms, app store reviews | One codebase |

**Decision: Chrome Extension.**

The Chrome extension is the only form factor that provides direct YouTube audio access with zero install friction. The desktop app (Tauri) was our second choice and we built a working prototype -- it works, but the complexity of platform-specific audio capture (CoreAudio ScreenCaptureKit permissions on macOS, WASAPI loopback on Windows) adds 10x development surface area for the same end result.

### What we gave up

- **Non-Chrome browsers**: Firefox/Safari users can't use this. Firefox has limited AudioWorklet support. Safari's extension model is different. We accept this trade-off because Chrome has ~65% desktop browser market share and YouTube usage skews heavily toward Chrome.
- **Mobile**: YouTube mobile users can't use this. Mobile OSes don't allow extensions to modify app audio. If mobile becomes critical, a dedicated app with its own audio player (not modifying YouTube) would be the path.
- **Non-YouTube sources**: Spotify, Apple Podcasts, etc. are not covered. The extension only works on youtube.com and music.youtube.com. System-level audio capture (the desktop app path) would be needed for universal source support.

## 5. Solution architecture

### Signal chain

The processing pipeline is a **layered defense system**. Each layer operates at a different time scale, catching what the previous layer is too slow (or too fast) to handle:

```
YouTube <video> element
    |
    video.playbackRate = 0.94, preservesPitch = false
    |   (Native C++ resampler: slows speech, lowers pitch)
    |   (Solves: fast speech, harsh pitch)
    |
    MediaElementSourceNode
    |
    [1] Vocal Separator (AudioWorklet)
    |     STFT mid/side decomposition, 2048-point FFT, 50% overlap
    |     Frequency-band spectral masking: 80-300Hz crossfade in,
    |     300-3400Hz vocal band, 3400-8000Hz crossfade out
    |     Attenuates background music, preserves speech
    |     10ms crossfade on enable/disable transitions
    |     Solves: background music drowning out speaker
    |
    [2] High-Pass Filter (BiquadFilterNode, 80Hz, Q=0.707)
    |     Removes sub-bass rumble and DC offset
    |
    [3] 3-Band EQ (BiquadFilterNode x3)
    |     Low shelf (200Hz) + peaking (3kHz) + high shelf (6kHz)
    |     Per-preset frequency shaping
    |     Solves: harsh high frequencies
    |
    [4] Loudness Normalizer (AudioWorklet) -- time scale: 3 seconds
    |     BS.1770-4 K-weighted LUFS measurement
    |     3-second sliding window, 100ms update interval
    |     1 dB/s maximum gain change rate (prevents audible jumps)
    |     Conditional boost: only below -35 LUFS, max +3dB
    |     Gate at -60 LUFS (silence detection)
    |     Solves: volume inconsistency between and within videos
    |
    [5] Fast RMS Compressor (AudioWorklet) -- time scale: 100ms
    |     Sliding-window RMS measurement (100ms window)
    |     15ms attack, 400ms release
    |     Soft knee (6dB) with quadratic interpolation
    |     Per-preset ratio: 3:1 (gentle) to 6:1 (aggressive)
    |     Gain reduction only, never boost
    |     Solves: sudden laughter, applause, coughing, sound effects
    |
    [6] Lookahead Peak Limiter (AudioWorklet) -- time scale: 5ms
    |     5ms lookahead delay buffer
    |     1ms attack, 50ms release
    |     Hard ceiling at -3 dBFS with safety hard-clip
    |
    [7] True Peak Limiter (AudioWorklet) -- time scale: sub-sample
    |     4x linear interpolation oversampling
    |     Catches inter-sample peaks missed by sample-level limiter
    |     Safety ceiling at -2 dBTP
    |
    [8] Master Gain (GainNode)
    |     Per-preset volume offset (-3 to -6 dB)
    |
    AudioContext.destination
```

### Why 4 layers of gain control (not redundant)

| Layer | Time scale | What it catches | Example | Why the others can't |
|-------|-----------|-----------------|---------|---------------------|
| Normalizer | 3 seconds | Track-to-track loudness: podcast A is -16 LUFS, podcast B is -22 LUFS | Autoplay switches from loud video to quiet video | Compressor/limiter react to transients, not long-term average |
| Compressor | 100ms | Sudden loudness events within a track: a laugh, a cough, applause | Talk show host's joke gets a 12dB audience laugh | Normalizer is too slow (3s window, 1dB/s rate); limiter is peak-based, not loudness-based |
| Limiter | 5ms | Sample-level amplitude peaks exceeding -3dBFS | A hand clap produces a 0dBFS transient | No perceptual loudness awareness; can't measure LUFS |
| True Peak | Sub-sample | Inter-sample peaks from digital-to-analog reconstruction | Two consecutive samples at -1dBFS can reconstruct to +2dBFS between them | Sample-based limiter only sees discrete samples, not the continuous waveform |

### Key technical decisions

**Why no DynamicsCompressorNode**

The Web Audio API provides a built-in `DynamicsCompressorNode`. We deliberately do not use it. It has automatic makeup gain that cannot be disabled -- after compressing a loud sound, it boosts the output to compensate, which directly violates tenet #1 ("never louder"). Our custom worklet compressor applies gain reduction only.

**Why the normalizer measures raw input, not output**

The LUFS measurement runs on the K-weighted input signal. The gain adjustment is applied to the original (unweighted) signal. If we measured the output (post-gain), the normalizer would see its own gain changes and enter a feedback loop -- it turns something down, measures it as quieter, turns it back up, measures it as louder, ad infinitum.

**Why native pitch shifting instead of DSP algorithms**

We explored WSOLA (Waveform Similarity Overlap-Add) time stretching + resampling for independent speed/pitch control. The problem: AudioWorklet processes in 128-sample blocks (2.67ms at 48kHz). WSOLA requires analysis windows of ~2400 samples (50ms). The fundamental mismatch between the algorithm's granularity and the worklet's block size produced audible artifacts -- electrical noise, clicks, and tonal distortion.

The solution: `video.playbackRate = 0.94` with `video.preservesPitch = false`. The browser delegates to its native C++ audio resampler, which operates at a lower level than the Web Audio graph. Zero artifacts, zero CPU overhead. The coupling of speed and pitch is a feature for sleep -- 6% slower + slightly lower pitch = warmer, more soothing.

**Why soft knee compression**

Hard-knee compressors produce an audible "pumping" effect: the moment signal crosses the threshold, compression kicks in abruptly. Our soft knee (6dB) uses quadratic interpolation in the knee zone:

- Below threshold - 3dB: no compression (0 dB gain change)
- Threshold - 3dB to threshold + 3dB: gradual quadratic onset
- Above threshold + 3dB: full ratio compression

This makes compression inaudible -- the signal gets quieter without the listener perceiving a dynamics processor at work. Essential for tenet #4 ("transparent processing").

**Why conditional boost has a -35 LUFS gate**

The normalizer's default mode is attenuation-only (tenet #1). But genuinely quiet content (a whispered ASMR track at -40 LUFS) would be left inaudible. `boostBelowLufs = -35` allows up to +3dB boost, but only for content quieter than -35 LUFS. Normal content (-24 to -16 LUFS range) can only be attenuated. The downstream limiter and true peak limiter provide a hard ceiling as safety net.

## 6. Preset design

### Content categories and user behavioral clustering

Users don't describe what they listen to in audio engineering terms. They say "I listen to podcasts to fall asleep" or "I play rain sounds." We clustered by **listening behavior**, not content type:

| Behavioral cluster | Content examples | Key audio characteristic | What the user needs |
|-------------------|-----------------|------------------------|-------------------|
| Voice-centric sleep | Podcasts, audiobooks, guided meditations, lectures | Speech with varying background music/effects | Isolate voice, suppress music, slow down, warm tone |
| Texture-centric sleep | ASMR whispers, tapping, scratching, ear cleaning | Very quiet, high-frequency detail is the content itself | Preserve full spectrum, consistent quiet level, no filtering |
| Information-centric sleep | Talk shows, interviews, debates, news | Multiple speakers, varying dynamics, occasional loud reactions | Maximize speech clarity, compress dynamics, reduce mud |
| Ambient sleep | Rain, ocean, fan, fire crackling, lo-fi beats | Steady-state, no speech, no transients | Minimal processing, preserve spectral character, prevent drift |

### Preset parameters

| Preset | Target LUFS | Compressor | Speed | Vocal Separator | EQ | Master Gain |
|--------|------------|------------|-------|----------------|-----|-------------|
| **Sleep** | -26 | 6:1 ratio, -24dB threshold, 15ms attack | 0.94x | ON: music -6dB | Warm: high shelf -4dB at 6kHz | -6dB |
| **ASMR** | -28 | 6:1 ratio, -26dB threshold, 15ms attack | 1.0x | OFF | Flat (all bands 0dB) | -6dB |
| **Podcast** | -24 | 3:1 ratio, -20dB threshold, 20ms attack | 0.94x | ON: voice +3dB, music -6dB | Clarity: low shelf -3dB at 300Hz | -3dB |
| **White Noise** | -26 | 3:1 ratio, -22dB threshold, 20ms attack | 1.0x | OFF | Disabled | -3dB |

**Loudness gradient:** ASMR (-28) < Sleep/WhiteNoise (-26) < Podcast (-24)

**Per-preset rationale:**

- **Sleep** is the default and most aggressive. -26 LUFS is 10dB below YouTube's typical -16 LUFS average -- a 3x perceptual loudness reduction. 6:1 compression ratio means a 12dB sudden spike becomes a 2dB bump. Vocal separator is ON to suppress intro/outro music and background scoring that competes with the speaker. 0.94x speed makes speech 6% slower and slightly deeper, matching the rate at which a drowsy brain processes language.

- **ASMR** has the lowest target (-28 LUFS) because ASMR content is already quiet and the listener expects near-silence. The compressor is aggressive (6:1) to catch any loud triggers (some ASMR creators include sudden tapping sounds), but the threshold is lower (-26dB) to activate only on genuine spikes. EQ is flat because ASMR relies on high-frequency texture -- rolling off highs would destroy the content. No speed change because ASMR tempo is part of the experience.

- **Podcast** prioritizes speech intelligibility. -24 LUFS is the loudest preset but still 8dB below typical YouTube. Vocal separator actively boosts voice (+3dB) while reducing music (-6dB). Compression is gentler (3:1, 20ms attack) to preserve natural speech dynamics -- a 3:1 ratio still catches a laugh track but doesn't make the host sound robotic. Low shelf cut (-3dB at 300Hz) reduces "mud" that makes speech indistinct through pillow/earbuds.

- **White Noise** applies minimal processing. EQ is disabled to preserve the spectral character of rain, ocean, or fan sounds (equalizing white noise changes its color). Light compression (3:1) prevents gradual volume drift in long ambient recordings. No vocal separator because there are no vocals to separate.

## 7. User experience

### First 30 seconds (the "aha moment")

The product's aha moment is hearing the difference. The user must experience processed audio within 30 seconds of installing the extension:

```
Second 0:   User installs extension from Chrome Web Store
Second 3:   Extension icon appears in toolbar
Second 5:   User is already on a YouTube video (most likely scenario)
Second 8:   User clicks extension icon, popup opens
Second 10:  User sees power button and "Tap to activate" label
Second 12:  User taps power button
Second 12:  Audio processing activates instantly:
            - Volume normalizes to -26 LUFS
            - Compressor starts catching transients
            - Vocal separator reduces background music
            - Playback slows to 0.94x with lower pitch
            - Warm EQ rolls off highs
Second 15:  User hears the difference immediately
```

**Critical design choice:** We do NOT show an onboarding carousel, a tutorial, a "choose your preset" wizard, or a "learn about our features" page. The popup opens with a single power button. Tap it. Hear the difference. That's the onboarding.

### Why presets, not sliders

Users don't know what a "compression ratio" is. They don't know what "LUFS" means. They don't know what frequency a "high shelf filter" operates at. Exposing these controls would:

1. Force the user to make decisions they're not equipped to make
2. Create anxiety about whether their settings are "right"
3. Produce worse results than our pre-tuned presets (a user setting 20:1 compression would sound terrible)

The preset model encodes our domain expertise. The user's only decision is "what am I listening to?" -- and the four presets cover the major categories. Even this decision is optional, since the default (Sleep) works for the most common use case.

### State management

- All settings persist in `chrome.storage.sync` (syncs across Chrome instances)
- Default state matches the Sleep preset exactly: `enabled: false, presetId: "sleep", masterGainDb: -6.0, eqEnabled: true, vocalEnhance: true`
- Switching presets updates ALL parameters atomically -- no partial state possible
- YouTube SPA navigation is handled transparently: the pipeline stays connected when YouTube changes the video without a full page reload

## 8. Scope and non-goals

### What we shipped (v1)

- Real-time audio processing (8-stage signal chain)
- 4 content-aware presets (Sleep, ASMR, Podcast, White Noise)
- One-tap enable/disable
- Live LUFS + gain reduction metering
- youtube.com and music.youtube.com support
- Cross-session settings persistence

### What we deliberately cut

| Cut feature | Why we cut it | Reconsider when |
|------------|---------------|----------------|
| Per-parameter sliders (threshold, ratio, EQ bands) | Violates tenet #2 (zero configuration). Users can't tune DSP parameters better than we can. | User research shows power users need custom presets |
| Sleep timer | YouTube already has one. Duplicating it adds complexity for zero unique value. | If YouTube removes theirs |
| Fade-out before sleep | Requires predicting when the user falls asleep -- we can't. A fixed timer is a guess. | If we add biometric integration (heart rate from smartwatch) |
| Firefox / Safari support | Firefox AudioWorklet is less stable. Safari extension model is different. Market share doesn't justify the effort. | When Firefox AudioWorklet stabilizes or user demand is proven |
| Ad-aware processing | Detecting YouTube ads and applying different processing. | If we can reliably detect ad boundaries without YouTube API access |
| Custom preset creation | Users can't tune DSP parameters correctly without audio engineering knowledge. | If we design a guided "wizard" that translates user language to DSP parameters |
| Visualization (spectrum analyzer, waveform) | Adds CPU overhead, distracts from sleep use case, violates "minimal footprint" tenet. | If we build a separate "monitor" mode for debugging |

### V2 candidates (not committed)

- Multiple active preset profiles (switch by time of day)
- YouTube Music deep integration
- Per-channel (creator) preset memory
- Keyboard shortcuts for enable/disable
- Companion mobile app (own audio player, not modifying YouTube)

## 9. Success criteria

### Sean Ellis test framing

If we survey active users with "How would you feel if you could no longer use Sleep Mode for YouTube?":

- **Target: 40%+ answer "very disappointed"**
- If below 40%: the audio processing isn't making a perceptible enough difference, or the target audience is wrong
- If above 40%: we have product-market fit in this segment

### Quantitative signals

| Metric | What it measures | Target |
|--------|-----------------|--------|
| Daily active users (DAU) / Weekly active users (WAU) | Retention: do people come back? | DAU/WAU > 0.5 (used more than half the days in a week) |
| Average session duration with Sleep Mode ON | Engagement: how long do they actually use it? | > 30 minutes (long enough to fall asleep) |
| Preset distribution | Whether our 4 presets cover the actual use cases | No single preset > 80% usage (if so, the others are useless) |
| Extension uninstall rate (30-day) | Satisfaction: do they keep it? | < 20% uninstall within 30 days |
| Chrome Web Store rating | Public satisfaction signal | > 4.5 stars |

### Qualitative signals

- Users describe the extension as "I can't sleep without it now" (dependency = PMF)
- Users recommend it to others without being asked (organic word-of-mouth)
- Feature requests are about expansion ("can you support Spotify too?"), not about fixing the core experience

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| YouTube changes `<video>` element structure | Low (stable for years) | High (breaks audio capture) | YouTubeObserver uses MutationObserver with fallback selectors. Can adapt to DOM changes with an extension update. |
| Chrome deprecates or restricts `MediaElementAudioSourceNode` | Very low | Critical | No signals from Chrome team. This is a core Web Audio API. |
| AudioWorklet performance degrades on low-end hardware | Medium | Medium | All processing is O(n) per sample. 128 samples at 48kHz = 2.67ms budget. Our processing uses ~0.5ms measured on mid-range hardware. 5x headroom. |
| Users perceive audio quality degradation | Medium | High | Soft knee compression + slow normalizer rate (1dB/s) + transparent design tenet. If users notice processing, parameters need tuning. |
| YouTube Premium users expect this to "just work" | Low | Low | Extension works with or without Premium. Premium removes ads but doesn't change audio processing -- they're complementary. |
| Competitors copy the approach | Low (requires DSP expertise) | Medium | Our asymmetric advantage is the signal chain design, not a single feature. Replicating 4-layer gain control + vocal separator + per-preset tuning requires domain expertise that generic extension developers don't have. |

## 11. Architecture and build

### Extension architecture

```
manifest.json (MV3)
  |
  +-- Background Service Worker (ESM)
  |     Pure message router between popup and content script.
  |     No audio processing, no state.
  |
  +-- Content Script (IIFE)
  |     Runs in YouTube page context.
  |     Owns Web Audio pipeline lifecycle.
  |     YouTubeObserver: MutationObserver for SPA navigation.
  |     State machine: enabled/disabled, preset switching, bypass.
  |
  +-- AudioWorklet Processors (IIFE, dedicated audio threads)
  |     sleep-processor.ts: Normalizer + Compressor + Limiter + TruePeak
  |     vocal-processor.ts: FFT + spectral masking vocal separator
  |     Each runs in its own thread, 128-sample blocks, 48kHz.
  |
  +-- Popup (IIFE)
        Stateless control panel.
        All state from chrome.storage.sync.
        Live LUFS/gain-reduction metering from content script.
```

### Build system

- **esbuild**: Sub-second builds. Each entry point bundled separately (IIFE for content scripts and worklets, ESM for service worker).
- **TypeScript**: Strict mode. Shared types defined once in `src/shared/types.ts`, inlined by esbuild into each bundle.
- **No framework**: Vanilla TypeScript + HTML/CSS. Zero runtime dependencies. Total bundle size < 50KB.
- **Pre-built dist**: The `dist/` folder is committed so the extension can be loaded without a build step.

### File structure

```
sleep-mode-extension/
  manifest.json              # Chrome Extension manifest (V3)
  package.json               # Dev dependencies only (esbuild, typescript)
  build.config.ts            # esbuild multi-entry configuration
  tsconfig.json              # TypeScript strict mode config
  src/
    shared/
      types.ts               # All type definitions (pipeline, presets, metering, storage)
      constants.ts            # 4 preset configs with full parameter sets
      storage.ts              # chrome.storage.sync load/save/onChange
      messages.ts             # Message type definitions and type guards
    content/
      content-script.ts       # Pipeline lifecycle, state management, message handling
      audio-pipeline.ts       # Web Audio graph construction and control
      youtube-observer.ts     # MutationObserver for YouTube SPA navigation
    worklet/
      sleep-processor.ts      # 780 lines: K-weighting, normalizer, compressor, limiter, true peak
      vocal-processor.ts      # 395 lines: FFT, STFT, spectral masking, overlap-add
    background/
      service-worker.ts       # Message routing (popup <-> content script)
    popup/
      popup.ts                # Control panel logic
      popup.html              # Popup markup
      popup.css               # Popup styles
  dist/                       # Pre-built output (Chrome-loadable)
  assets/icons/               # Extension icons (16, 48, 128px)
```

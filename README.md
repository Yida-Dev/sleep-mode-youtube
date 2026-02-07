# Sleep Mode for YouTube

A Chrome extension that transforms any YouTube video into sleep-friendly audio in real time.

## The Problem

Millions of people fall asleep listening to YouTube -- podcasts, audiobooks, ASMR, rain sounds. But YouTube audio is optimized for engagement, not sleep:

- Background music drowns out the speaker
- Volume jumps between videos or within a single video
- Sudden laughter, applause, coughing, or sound effects jolt you awake
- Speech is too fast for a drowsy brain
- High-pitched voices feel harsh at night

## Research: These Are Real Problems

We systematically analyzed **100 real user pain point cases** collected from Reddit (r/sleep, r/podcasts, r/asmr), Hacker News, YouTube comments, sleep app reviews, and forum discussions. Each case was scored across 9 dimensions: severity, pain point category, technical solvability, solution match, sleep relevance, impact scope, content type, user emotion, and frequency.

The interactive visualization of this analysis is available at [`docs/research/用户痛点分析可视化.html`](docs/research/用户痛点分析可视化.html). Full dataset and methodology at [`docs/research/`](docs/research/).

### What the data shows

| Finding | Number |
|---------|--------|
| Volume problems (largest category) | **31%** of all cases |
| Audio quality problems (second largest) | **22%** of all cases |
| Cases our product perfectly or highly matches | **36%** (36 cases) |
| Cases we can solve to varying degrees | **53%** (53 cases) |
| Cases directly or highly related to sleep | **51%** (51 cases) |
| Cases that are common or universal problems | **79%** (79 cases) |
| P0 (highest severity, causes awakening) | **17%** (17 cases) |
| P0+P1 (critical + high severity) | **48%** (48 cases) |

### Pain points we solve, mapped to features

| User pain point | Cases | Severity | Our solution | Feature |
|----------------|-------|----------|-------------|---------|
| Ad volume blast / video-to-video volume jumps | 15 | P0-P1 | LUFS normalizer brings all content to consistent target loudness | Normalizer (-26 LUFS) |
| Volume fluctuations within a single video | 13 | P1 | Fast RMS compressor smooths loudness changes in real time | Compressor (6:1, 100ms) |
| Sudden loud sounds (laughter, applause, sound effects) | 6 | P0 | Lookahead limiter + true peak limiter catch transients in <5ms | Limiter (-3dBFS) + True Peak (-2dBTP) |
| Background music drowning out the speaker | 7 | P1 | STFT vocal separator reduces music while preserving voice | Vocal Enhance (music -6dB) |
| High-pitched / sibilant voices feel harsh | 4 | P2 | High-shelf EQ rolls off upper frequencies | Sleep EQ (6kHz, -4dB) |
| Speech too fast for a drowsy brain | 2 | P2 | Native playback rate reduction with pitch coupling | 0.94x speed |

### What real users say

> *"Quiet rainstorm video followed by aggressively loud cereal commercial, you're likely going to wake up suddenly"* -- Reddit user

> *"Sudden volume changes or unexpected sounds from videos I never meant to watch would jolt me awake in the middle of the night"* -- Hacker News user

> *"The backing track actually had lyrics, so I found myself trying to listen to them rather than what the presenter was saying"* -- Forum user

> *"Speakers dramatically vary their voice level for emphasis, causing overall volume to jump around from quiet to occasional shouts"* -- Podcast listener

Australian sleep meditation creator Jason Stephenson (3.2M subscribers) collected **10,000+ petition signatures** protesting YouTube ad volume disrupting sleep content.

### What we can't solve

Not every problem is an audio signal processing problem. **45% of cases** fall outside our scope:

| Problem type | Cases | Why we can't solve it |
|-------------|-------|----------------------|
| Platform features (autoplay, UI) | 16 | Requires YouTube to change |
| Ad content itself | 11 | Requires YouTube Premium or ad blockers |
| Content quality (TTS voices, style) | 6 | Content creation issue |
| Technical (Bluetooth, buffering) | 6 | System-level issue |

We are transparent about boundaries. Sleep Mode solves the audio signal problems -- the 53% that are within the domain of real-time DSP.

## What Sleep Mode Does

One click. The extension processes YouTube audio in real time through a broadcast-grade signal chain, making everything quieter, smoother, and more consistent. Every processing stage is designed around one principle: **audio can only get quieter and smoother, never louder or harsher.**

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

1. Navigate to any YouTube video
2. Click the Sleep Mode extension icon in the toolbar
3. Tap the moon button to activate
4. Choose the preset that matches your content
5. Done -- everything adjusts automatically

The popup shows real-time status while Sleep Mode is active: a green "PROCESSING" indicator confirms audio is being processed.

## Presets

Sleep Mode ships with four presets, each fine-tuned for a specific type of content. Select a preset and all audio parameters are set automatically -- no knobs to turn.

### Sleep

**Best for:** Podcasts, audiobooks, guided meditations, talk-heavy videos

This is the default and most aggressive preset. It is designed to create a warm, steady audio blanket that won't disturb you as you drift off.

What it does:

- **Slows playback by 6%** (0.94x speed). Speech becomes slightly slower and voices drop in pitch, creating a more relaxed, deeper tone. This uses the browser's native resampling -- no artifacts, just naturally warmer sound.
- **Normalizes volume to -26 LUFS.** This is noticeably quieter than YouTube's default (~-14 LUFS). Volume differences between speakers, segments, and videos are smoothed out automatically.
- **Aggressive transient compression** (6:1 ratio, 15ms attack). Sudden spikes -- a laugh, a cough, a sound effect, an ad transition -- are caught and reduced within milliseconds. This is the core "anti-jolt" feature.
- **Warm EQ.** A high-shelf filter at 6kHz rolls off the upper frequencies by 4dB, softening sibilance ("s" sounds), cymbal splashes, and other harsh high-frequency content. An 80Hz high-pass filter removes low rumble.
- **Vocal separator ON.** Background music is reduced by 6dB while the human voice passes through untouched, making speech clearer even at low volume.
- **Master output at -6dB** (50% volume). An extra safety net ensuring the final output is well below full scale.

When to choose Sleep: you are listening to someone talk, and you want to fall asleep to their voice without being startled by anything.

### ASMR

**Best for:** Whisper content, tapping, scratching, mouth sounds, ear-to-ear audio

ASMR content is already produced with sleep in mind, so this preset applies the lightest touch. The goal is to normalize volume without destroying the delicate textures that make ASMR work.

What it does:

- **No speed change** (1.0x). ASMR relies on precise timing and rhythm. Slowing it would break the trigger.
- **Normalizes volume to -28 LUFS.** The quietest preset -- 2dB below Sleep. Whisper content stays at whisper volume.
- **Aggressive transient compression** (6:1 ratio, -26dB threshold). Even in ASMR videos, some triggers can be unexpectedly loud (tapping, crinkles). The compressor keeps these in check.
- **Full-spectrum EQ.** No high-pass filter, no frequency cuts. ASMR relies on subtle sub-bass vibrations and high-frequency detail that would be lost with aggressive EQ. Everything passes through.
- **Vocal separator OFF.** ASMR has no "background music" to separate. The triggers themselves are the content.
- **Extra-low limiter threshold** (-6dB). Catches any remaining peaks more aggressively, because ASMR listeners are often in the most quiet, sensitive listening state.
- **Master output at -6dB.**

When to choose ASMR: you are listening to whisper or texture-based content and want consistent volume without altering the sound character.

### Podcast

**Best for:** Talk shows, interviews, lectures, news commentary, multi-speaker content

Podcast mode optimizes for speech clarity. It is the loudest preset -- designed for situations where you want to actually follow the conversation while still having volume protection.

What it does:

- **Slows playback by 6%** (0.94x speed). Like Sleep, this makes speech easier to follow when drowsy. The slight pitch drop adds warmth.
- **Normalizes volume to -24 LUFS.** Louder than Sleep and ASMR. You can hear the content clearly at low physical volume. Different speakers and segments are leveled automatically.
- **Gentle compression** (3:1 ratio, -20dB threshold, 20ms attack, soft 8dB knee). Less aggressive than Sleep -- preserves more of the natural dynamic range of conversation. Still catches sudden spikes, but lets normal emphasis through.
- **Voice-forward EQ.** A low-shelf cut at 300Hz (-3dB) reduces "muddy" low-mid frequencies that make speech less intelligible, especially on small speakers or earbuds. High frequencies are untouched to preserve vocal clarity.
- **Vocal separator ON with +3dB voice boost.** Background music is reduced by 6dB, AND the human voice is actively boosted by 3dB. This makes the speaker significantly more prominent in the mix -- ideal for podcasts with music beds, intros, or interview crosstalk.
- **Master output at -3dB.** Slightly louder output than Sleep/ASMR, matching the "still awake, still listening" use case.
- **Higher true peak ceiling** (-1dBTP vs -2dBTP). Allows slightly more headroom since podcast listeners are less sensitive to occasional near-peak moments.

When to choose Podcast: you want to follow the conversation but with consistent volume and protection from sudden noise. Good for "I'm in bed but not trying to fall asleep yet" moments.

### White Noise

**Best for:** Rain sounds, ocean waves, fan noise, ambient environments, nature recordings, lo-fi beats

White noise and ambient content is already smooth by nature. This preset normalizes volume with minimal processing to preserve the pure, unaltered character of the sound.

What it does:

- **No speed change** (1.0x). Ambient sounds should play at their natural tempo.
- **Normalizes volume to -26 LUFS.** Same quiet target as Sleep. Ensures consistent volume across different ambient videos.
- **Gentle compression** (3:1 ratio, -22dB threshold). Light touch -- ambient content rarely has transients, but some nature recordings have occasional bird calls, thunder, or waves that can spike. The compressor gently smooths these.
- **EQ disabled.** No frequency shaping at all. Rain should sound like rain, not like filtered rain. The audio passes through spectrally untouched.
- **Vocal separator OFF.** There is no voice to separate. The ambient sound is the content.
- **Low limiter threshold** (-6dB). Extra safety for occasional peaks.
- **Master output at -3dB.**

When to choose White Noise: you are playing ambient or environmental sounds and want steady volume without any coloring of the sound.

### Preset Comparison

| | Sleep | ASMR | Podcast | White Noise |
|---|---|---|---|---|
| Target loudness | -26 LUFS | -28 LUFS | -24 LUFS | -26 LUFS |
| Playback speed | 0.94x | 1.0x | 0.94x | 1.0x |
| Compression | 6:1 aggressive | 6:1 aggressive | 3:1 gentle | 3:1 gentle |
| EQ character | Warm (highs -4dB) | Flat (full spectrum) | Voice-forward (lows -3dB) | Disabled |
| Vocal separator | ON (music -6dB) | OFF | ON (voice +3dB, music -6dB) | OFF |
| Master output | -6dB | -6dB | -3dB | -3dB |

**Loudness ranking** (quietest to loudest): ASMR (-28) < Sleep (-26) = White Noise (-26) < Podcast (-24)

## Controls

### Sleep EQ

A toggle that enables or disables the preset's EQ profile. When ON, the frequency shaping described in each preset above is active. When OFF, no EQ is applied -- audio passes through with its original frequency balance.

Tip: If a preset sounds too muffled or too bright for your taste, try toggling Sleep EQ off. The normalizer and compressor still work regardless.

### Vocal Enhance

A toggle that enables or disables the vocal separator. When ON, background music is reduced and (depending on the preset) the human voice may be boosted. When OFF, all audio passes through equally.

Note: Vocal Enhance is most effective with content that has a clear voice + music separation (podcasts with background music, talk shows with intro music). It has no meaningful effect on solo voice recordings or ambient content.

## Meters

The bottom of the popup shows three real-time meters that update ~10 times per second:

### LUFS

The current measured loudness of the input signal in LUFS (Loudness Units Full Scale), using the EBU R128 / BS.1770 standard with K-weighting. This is the value the normalizer uses to decide how much to attenuate.

- Typical YouTube content reads between **-10 to -20 LUFS**
- The normalizer targets the preset's LUFS value (e.g., -26 for Sleep)
- If the reading matches the target, normalization is working correctly

### Gain Reduction

How much the compressor, limiter, and true peak limiter are collectively reducing the signal, in dB. This tells you how hard the dynamics processing is working.

- **0.0 dB**: No compression happening -- the audio is already below all thresholds
- **1-3 dB**: Normal operation -- gentle compression smoothing things out
- **3-6 dB**: Moderate compression -- the compressor is actively taming louder passages
- **6+ dB**: Heavy compression -- a loud transient was caught and significantly reduced

### Input Peak

The peak level of the raw audio entering the worklet processor, in dBFS (decibels relative to full scale). This is a diagnostic value.

- **-inf dB**: No audio signal is reaching the processor (check if the video is playing)
- **-30 to -10 dB**: Normal operating range for most content
- **Above -6 dB**: Very hot signal -- the compressor and limiter will be working hard

## Technical Details

### Signal Chain

```
YouTube <video> element
    |
    MediaElementSourceNode
    |
    Vocal Separator (AudioWorklet: STFT mid/side, 2048-point FFT)
    |
    High-Pass Filter (BiquadFilterNode)
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
- **Conditional boost**: The normalizer only boosts signals quieter than -35 LUFS (genuinely silent content). Normal and loud content can only be attenuated, never amplified.
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

import type {
  PresetConfig,
  NormalizerParams,
  CompressorParams,
  LimiterParams,
  TruePeakParams,
  EqParams,
  VocalWorkletParams,
} from "./types";

// -- Default normalizer params --

export const DEFAULT_NORMALIZER: NormalizerParams = {
  targetLufs: -16.0,
  windowMs: 3000.0,
  updateIntervalMs: 100.0,
  maxGainDb: 3.0,
  maxGainChangeDbPerS: 1.0,
  gateLufs: -60.0,
  boostBelowLufs: -35.0,
};

// -- Default compressor params (fast RMS compressor for transient protection) --

export const DEFAULT_COMPRESSOR: CompressorParams = {
  thresholdDb: -24.0,
  ratio: 6.0,
  attackMs: 15.0,
  releaseMs: 400.0,
  windowMs: 100.0,
  kneeDb: 6.0,
};

// -- Default limiter params --

export const DEFAULT_LIMITER: LimiterParams = {
  thresholdDb: -3.0,
  lookaheadMs: 5.0,
  attackMs: 1.0,
  releaseMs: 50.0,
};

// -- Default true peak limiter params --

export const DEFAULT_TRUE_PEAK: TruePeakParams = {
  ceilingDbTp: -2.0,
  lookaheadMs: 1.5,
  releaseMs: 50.0,
};

// -- Default EQ params (Sleep: warm tone with gentle high rolloff, cuts only) --

export const DEFAULT_EQ: EqParams = {
  highPassHz: 80,
  lowShelfHz: 200,
  lowShelfGainDb: 0,
  peakingHz: 3000,
  peakingGainDb: 0,
  peakingQ: 0.7,
  highShelfHz: 6000,
  highShelfGainDb: -4.0,
};

// -- ASMR EQ (preserve sub-harmonics, enhance texture) --

export const ASMR_EQ: EqParams = {
  highPassHz: 0,
  lowShelfHz: 150,
  lowShelfGainDb: 0,
  peakingHz: 4000,
  peakingGainDb: 0,
  peakingQ: 0.8,
  highShelfHz: 10000,
  highShelfGainDb: 0,
};

// -- Podcast EQ (vocal clarity, reduce mud) --

export const PODCAST_EQ: EqParams = {
  highPassHz: 80,
  lowShelfHz: 300,
  lowShelfGainDb: -3.0,
  peakingHz: 3000,
  peakingGainDb: 0,
  peakingQ: 0.8,
  highShelfHz: 7000,
  highShelfGainDb: 0,
};

// -- White Noise EQ (minimal, HPF only) --

export const WHITENOISE_EQ: EqParams = {
  highPassHz: 80,
  lowShelfHz: 150,
  lowShelfGainDb: 0,
  peakingHz: 3000,
  peakingGainDb: 0,
  peakingQ: 0.7,
  highShelfHz: 4000,
  highShelfGainDb: 0,
};

// -- Default vocal separator params --

export const DEFAULT_VOCAL: VocalWorkletParams = {
  separator: {
    enabled: false,
    vocalGainDb: 0.0,
    musicReductionDb: -12.0,
  },
};

// -- Preset definitions --

export const PRESETS: PresetConfig[] = [
  {
    id: "sleep",
    name: "Sleep",
    description: "Warm tone, gentle dynamics, optimized for falling asleep",
    playbackRate: 0.94,
    params: {
      worklet: {
        normalizer: { ...DEFAULT_NORMALIZER, targetLufs: -26.0 },
        compressor: { ...DEFAULT_COMPRESSOR },
        limiter: { ...DEFAULT_LIMITER },
        truePeak: { ...DEFAULT_TRUE_PEAK },
      },
      eq: { ...DEFAULT_EQ },
      eqEnabled: true,
      masterGainDb: -6.0,
      vocal: {
        separator: { enabled: true, vocalGainDb: 0.0, musicReductionDb: -6.0 },
      },
    },
  },
  {
    id: "asmr",
    name: "ASMR",
    description: "Preserve sub-harmonics, enhance whisper texture",
    playbackRate: 1.0,
    params: {
      worklet: {
        normalizer: { ...DEFAULT_NORMALIZER, targetLufs: -28.0 },
        compressor: { ...DEFAULT_COMPRESSOR, thresholdDb: -26.0 },
        limiter: { ...DEFAULT_LIMITER, thresholdDb: -6.0 },
        truePeak: { ...DEFAULT_TRUE_PEAK },
      },
      eq: { ...ASMR_EQ },
      eqEnabled: true,
      masterGainDb: -6.0,
      vocal: { ...DEFAULT_VOCAL },
    },
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "Vocal clarity, reduced mud, enhanced presence",
    playbackRate: 0.94,
    params: {
      worklet: {
        normalizer: { ...DEFAULT_NORMALIZER, targetLufs: -24.0 },
        compressor: {
          ...DEFAULT_COMPRESSOR,
          thresholdDb: -20.0,
          ratio: 3.0,
          attackMs: 20.0,
          releaseMs: 300.0,
          kneeDb: 8.0,
        },
        limiter: { ...DEFAULT_LIMITER },
        truePeak: { ...DEFAULT_TRUE_PEAK, ceilingDbTp: -1.0 },
      },
      eq: { ...PODCAST_EQ },
      eqEnabled: true,
      masterGainDb: -3.0,
      vocal: {
        separator: { enabled: true, vocalGainDb: 3.0, musicReductionDb: -6.0 },
      },
    },
  },
  {
    id: "whitenoise",
    name: "White Noise",
    description: "Lower target loudness, minimal processing",
    playbackRate: 1.0,
    params: {
      worklet: {
        normalizer: { ...DEFAULT_NORMALIZER, targetLufs: -26.0 },
        compressor: {
          ...DEFAULT_COMPRESSOR,
          thresholdDb: -22.0,
          ratio: 3.0,
          attackMs: 20.0,
          releaseMs: 300.0,
        },
        limiter: { ...DEFAULT_LIMITER, thresholdDb: -6.0 },
        truePeak: { ...DEFAULT_TRUE_PEAK },
      },
      eq: { ...WHITENOISE_EQ },
      eqEnabled: false,
      masterGainDb: -3.0,
      vocal: { ...DEFAULT_VOCAL },
    },
  },
];

// -- Helper to find a preset by ID --

export function getPresetById(id: string): PresetConfig | undefined {
  return PRESETS.find((p) => p.id === id);
}

// -- Misc constants --

export const DEFAULT_SAMPLE_RATE = 48000;
export const DEFAULT_PRESET_ID = "sleep";

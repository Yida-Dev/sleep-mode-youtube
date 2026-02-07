// -- AudioWorklet processor parameters --

export interface NormalizerParams {
  targetLufs: number;
  windowMs: number;
  updateIntervalMs: number;
  maxGainDb: number;
  maxGainChangeDbPerS: number;
  gateLufs: number;
  boostBelowLufs: number;
}

export interface LimiterParams {
  thresholdDb: number;
  lookaheadMs: number;
  attackMs: number;
  releaseMs: number;
}

export interface TruePeakParams {
  ceilingDbTp: number;
  lookaheadMs: number;
  releaseMs: number;
}

export interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  windowMs: number;
  kneeDb: number;
}

export interface WorkletParams {
  normalizer: NormalizerParams;
  compressor: CompressorParams;
  limiter: LimiterParams;
  truePeak: TruePeakParams;
}

// -- Vocal separator worklet parameters --

export interface SeparatorParams {
  enabled: boolean;
  vocalGainDb: number;
  musicReductionDb: number;
}

export interface VocalWorkletParams {
  separator: SeparatorParams;
}

// -- Native Web Audio node parameters --

export interface EqParams {
  highPassHz: number;
  lowShelfHz: number;
  lowShelfGainDb: number;
  peakingHz: number;
  peakingGainDb: number;
  peakingQ: number;
  highShelfHz: number;
  highShelfGainDb: number;
}

// -- Full pipeline parameters --

export interface PipelineParams {
  worklet: WorkletParams;
  eq: EqParams;
  eqEnabled: boolean;
  masterGainDb: number;
  vocal: VocalWorkletParams;
}

// -- Preset --

export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  playbackRate: number;
  params: PipelineParams;
}

// -- Metering --

export interface MeteringData {
  currentLufs: number;
  gainReductionDb: number;
  timestamp: number;
}

// -- Pipeline status --

export interface PipelineStatus {
  enabled: boolean;
  presetId: string;
  masterGainDb: number;
  pipelineReady: boolean;
  audioContextState: "suspended" | "running" | "closed";
  vocalEnhance: boolean;
}

// -- Storage schema --

export interface StorageSchema {
  enabled: boolean;
  presetId: string;
  masterGainDb: number;
  eqEnabled: boolean;
  vocalEnhance: boolean;
}

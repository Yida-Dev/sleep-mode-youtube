import type {
  PipelineParams,
  WorkletParams,
  EqParams,
  VocalWorkletParams,
  MeteringData,
} from "../shared/types";
import type { WorkletOutboundMessage } from "../shared/messages";
import { DEFAULT_SAMPLE_RATE } from "../shared/constants";

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export interface AudioPipeline {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  workletNode: AudioWorkletNode;
  vocalNode: AudioWorkletNode;
  hpf: BiquadFilterNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  gain: GainNode;
  destroy(): void;
  bypass(): void;
  engage(): void;
  setPreset(params: PipelineParams): void;
  setWorkletParams(params: WorkletParams): void;
  setEqParams(params: EqParams, enabled: boolean): void;
  setMasterGain(db: number): void;
  setVocalParams(params: VocalWorkletParams): void;
  onMetering(callback: (data: MeteringData) => void): void;
}

async function loadWorkletModule(
  ctx: AudioContext,
  filename: string
): Promise<void> {
  try {
    const url = chrome.runtime.getURL(`dist/worklet/${filename}`);
    await ctx.audioWorklet.addModule(url);
  } catch (primaryErr) {
    console.warn(
      `[Sleep Mode] Direct worklet load failed for ${filename}, trying blob fallback:`,
      primaryErr
    );
    try {
      const response = await fetch(
        chrome.runtime.getURL(`dist/worklet/${filename}`)
      );
      const code = await response.text();
      const blob = new Blob([code], { type: "text/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
    } catch (fallbackErr) {
      console.error(
        `[Sleep Mode] Failed to load worklet ${filename} (both methods failed):`,
        fallbackErr
      );
      throw fallbackErr;
    }
  }
}

// -- Pipeline builder --

export async function buildPipeline(
  video: HTMLVideoElement,
  params: PipelineParams
): Promise<AudioPipeline> {
  const ctx = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });

  // Load AudioWorklet processors
  await loadWorkletModule(ctx, "sleep-processor.js");
  await loadWorkletModule(ctx, "vocal-processor.js");

  // Source node (can only be called once per video element)
  const source = ctx.createMediaElementSource(video);

  // Vocal separator node
  const vocalNode = new AudioWorkletNode(ctx, "vocal-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      sampleRate: ctx.sampleRate,
      params: params.vocal,
    },
  });

  // Normalizer + Limiter + TruePeak
  const workletNode = new AudioWorkletNode(ctx, "sleep-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      sampleRate: ctx.sampleRate,
      params: params.worklet,
    },
  });

  // High-pass filter
  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";

  // EQ: 3 bands
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  applyEqParams(hpf, eqLow, eqMid, eqHigh, params.eq, params.eqEnabled);

  // Master gain
  const gain = ctx.createGain();
  gain.gain.value = dbToLinear(params.masterGainDb);

  // Signal chain:
  // Source -> Vocal -> HPF -> EQ -> Normalizer+Compressor+Limiter+TruePeak -> Gain -> Dest
  source.connect(vocalNode);
  vocalNode.connect(hpf);
  hpf.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(workletNode);
  workletNode.connect(gain);
  gain.connect(ctx.destination);

  let meteringCallback: ((data: MeteringData) => void) | null = null;
  let bypassed = false;
  let currentGainLin = dbToLinear(params.masterGainDb);

  workletNode.port.onmessage = (e: MessageEvent<WorkletOutboundMessage>) => {
    if (e.data.type === "METERING" && meteringCallback) {
      meteringCallback({
        currentLufs: e.data.lufs,
        gainReductionDb: e.data.gainReductionDb,
        inputPeakDb: e.data.inputPeakDb,
        timestamp: Date.now(),
      });
    }
  };

  const pipeline: AudioPipeline = {
    ctx,
    source,
    workletNode,
    vocalNode,
    hpf,
    eqLow,
    eqMid,
    eqHigh,
    gain,

    destroy() {
      source.disconnect();
      vocalNode.disconnect();
      hpf.disconnect();
      workletNode.disconnect();
      eqLow.disconnect();
      eqMid.disconnect();
      eqHigh.disconnect();
      gain.disconnect();
      ctx.close().catch(() => {});
    },

    bypass() {
      if (bypassed) return;
      bypassed = true;
      workletNode.port.postMessage({ type: "SET_BYPASS", bypassed: true });
      vocalNode.port.postMessage({ type: "SET_BYPASS", bypassed: true });
      source.disconnect();
      vocalNode.disconnect();
      hpf.disconnect();
      workletNode.disconnect();
      eqLow.disconnect();
      eqMid.disconnect();
      eqHigh.disconnect();
      gain.disconnect();
      source.connect(ctx.destination);
    },

    engage() {
      if (!bypassed) return;
      bypassed = false;
      source.disconnect();
      source.connect(vocalNode);
      vocalNode.connect(hpf);
      hpf.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(workletNode);
      workletNode.connect(gain);
      gain.connect(ctx.destination);
      workletNode.port.postMessage({ type: "SET_BYPASS", bypassed: false });
      vocalNode.port.postMessage({ type: "SET_BYPASS", bypassed: false });
      gain.gain.setValueAtTime(0.0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(currentGainLin, ctx.currentTime + 0.02);
    },

    setPreset(p: PipelineParams) {
      this.setWorkletParams(p.worklet);
      this.setEqParams(p.eq, p.eqEnabled);
      this.setMasterGain(p.masterGainDb);
      this.setVocalParams(p.vocal);
    },

    setWorkletParams(wp: WorkletParams) {
      workletNode.port.postMessage({ type: "SET_PARAMS", params: wp });
    },

    setEqParams(ep: EqParams, enabled: boolean) {
      applyEqParams(hpf, eqLow, eqMid, eqHigh, ep, enabled);
    },

    setMasterGain(db: number) {
      currentGainLin = dbToLinear(db);
      gain.gain.setTargetAtTime(currentGainLin, ctx.currentTime, 0.05);
    },

    setVocalParams(vp: VocalWorkletParams) {
      vocalNode.port.postMessage({ type: "SET_PARAMS", params: vp });
    },

    onMetering(callback: (data: MeteringData) => void) {
      meteringCallback = callback;
    },
  };

  return pipeline;
}

function applyEqParams(
  hpf: BiquadFilterNode,
  low: BiquadFilterNode,
  mid: BiquadFilterNode,
  high: BiquadFilterNode,
  params: EqParams,
  enabled: boolean
): void {
  hpf.frequency.value = params.highPassHz > 0 ? params.highPassHz : 1;
  hpf.Q.value = 0.707;

  low.frequency.value = params.lowShelfHz;
  low.gain.value = enabled ? params.lowShelfGainDb : 0;

  mid.frequency.value = params.peakingHz;
  mid.gain.value = enabled ? params.peakingGainDb : 0;
  mid.Q.value = params.peakingQ;

  high.frequency.value = params.highShelfHz;
  high.gain.value = enabled ? params.highShelfGainDb : 0;
}

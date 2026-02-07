// AudioWorkletProcessor for Sleep Mode
// This file is bundled as a standalone IIFE -- no external imports allowed.
// All types and constants are inlined.
export {}; // Make TSC treat as module (esbuild strips this in IIFE output)

// -- Inlined types --

interface NormalizerParams {
  targetLufs: number;
  windowMs: number;
  updateIntervalMs: number;
  maxGainDb: number;
  maxGainChangeDbPerS: number;
  gateLufs: number;
  boostBelowLufs: number;
}

interface LimiterParams {
  thresholdDb: number;
  lookaheadMs: number;
  attackMs: number;
  releaseMs: number;
}

interface TruePeakParams {
  ceilingDbTp: number;
  lookaheadMs: number;
  releaseMs: number;
}

interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  windowMs: number;
  kneeDb: number;
}

interface WorkletParams {
  normalizer: NormalizerParams;
  compressor: CompressorParams;
  limiter: LimiterParams;
  truePeak: TruePeakParams;
}

interface WorkletInboundMessage {
  type: "SET_PARAMS";
  params: WorkletParams;
}

// -- Utility functions --

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

function lerp(current: number, target: number, coeff: number): number {
  return current + (target - current) * coeff;
}

function timeToCoeff(timeMs: number, sampleRate: number): number {
  const timeS = Math.max(timeMs / 1000, 0.000001);
  const n = timeS * sampleRate;
  return 1.0 - Math.exp(Math.log(0.01) / n);
}

function msToFrames(ms: number, sampleRate: number): number {
  return Math.max(1, Math.round((ms / 1000) * sampleRate));
}

function moveTowards(
  current: number,
  target: number,
  maxDelta: number
): number {
  if (maxDelta <= 0) return current;
  if (target > current) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

// -- BS.1770 K-weighting IIR biquad --

class Iir2 {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  apply(x0: number): number {
    const y0 =
      this.b0 * x0 +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x0;
    this.y2 = this.y1;
    this.y1 = y0;
    return y0;
  }

  reset(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  // BS.1770 K-weighting Stage 1: High shelf (~+4dB above ~1.5kHz)
  static kWeightHighShelf(sampleRate: number): Iir2 {
    const gainDb = 3.9998439;
    const q = 0.70717525;
    const centerHz = 1681.9745;

    const k = Math.tan((Math.PI * centerHz) / sampleRate);
    const vh = Math.pow(10, gainDb / 20);
    const vb = Math.pow(vh, 0.49966678);
    const a0 = 1.0 + k / q + k * k;

    return new Iir2(
      (vh + (vb * k) / q + k * k) / a0,
      (2.0 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
      (2.0 * (k * k - 1.0)) / a0,
      (1.0 - k / q + k * k) / a0
    );
  }

  // BS.1770 K-weighting Stage 2: High pass (~40Hz)
  static kWeightHighPass(sampleRate: number): Iir2 {
    const q = 0.50032705;
    const centerHz = 38.13547;

    const k = Math.tan((Math.PI * centerHz) / sampleRate);
    const denom = 1.0 + k / q + k * k;

    return new Iir2(
      1.0,
      -2.0,
      1.0,
      (2.0 * (k * k - 1.0)) / denom,
      (1.0 - k / q + k * k) / denom
    );
  }
}

// -- K-weighting filter (two cascaded IIR stages) --

class KWeighting {
  private stage1: Iir2;
  private stage2: Iir2;

  constructor(sampleRate: number) {
    this.stage1 = Iir2.kWeightHighShelf(sampleRate);
    this.stage2 = Iir2.kWeightHighPass(sampleRate);
  }

  apply(x: number): number {
    return this.stage2.apply(this.stage1.apply(x));
  }

  reset(): void {
    this.stage1.reset();
    this.stage2.reset();
  }
}

// -- Loudness Normalizer --

class LoudnessNormalizer {
  private params: NormalizerParams;
  private sampleRate: number;
  private windowFrames: number;
  private updateIntervalFrames: number;

  private kL: KWeighting;
  private kR: KWeighting;

  private energyBuf: Float64Array;
  private energyIndex = 0;
  private energyFilled = 0;
  private energySum = 0;
  private framesSinceUpdate = 0;
  private framesSinceRecalc = 0;

  currentLufs: number;
  private gainDb = 0;
  gainLin = 1;

  constructor(sampleRate: number, params: NormalizerParams) {
    this.params = params;
    this.sampleRate = sampleRate;
    this.windowFrames = msToFrames(params.windowMs, sampleRate);
    this.updateIntervalFrames = msToFrames(
      params.updateIntervalMs,
      sampleRate
    );
    this.kL = new KWeighting(sampleRate);
    this.kR = new KWeighting(sampleRate);
    this.energyBuf = new Float64Array(this.windowFrames);
    this.currentLufs = params.targetLufs;
  }

  setParams(params: NormalizerParams): void {
    const windowFrames = msToFrames(params.windowMs, this.sampleRate);
    const updateIntervalFrames = msToFrames(
      params.updateIntervalMs,
      this.sampleRate
    );
    if (
      windowFrames !== this.windowFrames ||
      updateIntervalFrames !== this.updateIntervalFrames
    ) {
      this.windowFrames = windowFrames;
      this.updateIntervalFrames = updateIntervalFrames;
      this.energyBuf = new Float64Array(windowFrames);
      this.energyIndex = 0;
      this.energyFilled = 0;
      this.energySum = 0;
      this.framesSinceUpdate = 0;
      this.kL = new KWeighting(this.sampleRate);
      this.kR = new KWeighting(this.sampleRate);
    }
    this.params = params;
  }

  // Process a single stereo frame, returns [left, right] with gain applied
  processFrame(l: number, r: number): [number, number] {
    // 1) K-weighting + energy measurement
    const wl = this.kL.apply(l);
    const wr = this.kR.apply(r);
    // BS.1770: average power across channels (divide by channel count)
    const energy = (wl * wl + wr * wr) * 0.5;

    const old = this.energyBuf[this.energyIndex];
    this.energyBuf[this.energyIndex] = energy;
    this.energySum += energy - old;
    this.energyIndex++;
    if (this.energyIndex >= this.windowFrames) {
      this.energyIndex = 0;
    }
    if (this.energyFilled < this.windowFrames) {
      this.energyFilled++;
    }

    // Periodically recalculate energySum from scratch to prevent float drift
    this.framesSinceRecalc++;
    if (this.framesSinceRecalc >= this.windowFrames) {
      this.framesSinceRecalc = 0;
      let sum = 0;
      for (let j = 0; j < this.energyFilled; j++) {
        sum += this.energyBuf[j];
      }
      this.energySum = sum;
    }

    // 2) Update gain at interval
    this.framesSinceUpdate++;
    if (this.framesSinceUpdate >= this.updateIntervalFrames) {
      this.framesSinceUpdate = 0;
      this.updateGain();
    }

    // 3) Apply gain
    return [l * this.gainLin, r * this.gainLin];
  }

  private updateGain(): void {
    const denom = Math.max(1, this.energyFilled);
    const meanPower = Math.max(this.energySum / denom, 1e-12);
    this.currentLufs = -0.691 + 10.0 * Math.log10(meanPower);

    let desiredGainDb = this.params.targetLufs - this.currentLufs;

    // Gate: don't boost when below gate threshold
    if (
      this.currentLufs < this.params.gateLufs &&
      desiredGainDb > this.gainDb
    ) {
      desiredGainDb = this.gainDb;
    }

    // Conditional boost: only allow boost when content is genuinely quiet
    const maxBoostDb = Math.max(this.params.maxGainDb, 0);
    const effectiveMaxBoost =
      this.currentLufs < this.params.boostBelowLufs ? maxBoostDb : 0;
    desiredGainDb = Math.min(effectiveMaxBoost, desiredGainDb);

    // Rate limiting
    const dt = this.updateIntervalFrames / this.sampleRate;
    const maxDelta = Math.max(this.params.maxGainChangeDbPerS, 0) * dt;

    this.gainDb = moveTowards(this.gainDb, desiredGainDb, maxDelta);
    this.gainLin = dbToLinear(this.gainDb);
  }
}

// -- Fast RMS Compressor (transient loudness protection) --

class FastCompressor {
  private params: CompressorParams;
  private sampleRate: number;
  private windowFrames: number;

  private powerBuf: Float64Array;
  private powerIndex = 0;
  private powerFilled = 0;
  private powerSum = 0;
  private framesSinceRecalc = 0;

  private gainDb = 0;
  currentGain = 1;

  constructor(sampleRate: number, params: CompressorParams) {
    this.params = params;
    this.sampleRate = sampleRate;
    this.windowFrames = msToFrames(params.windowMs, sampleRate);
    this.powerBuf = new Float64Array(this.windowFrames);
  }

  setParams(params: CompressorParams): void {
    const windowFrames = msToFrames(params.windowMs, this.sampleRate);
    if (windowFrames !== this.windowFrames) {
      this.windowFrames = windowFrames;
      this.powerBuf = new Float64Array(windowFrames);
      this.powerIndex = 0;
      this.powerFilled = 0;
      this.powerSum = 0;
    }
    this.params = params;
  }

  processFrame(l: number, r: number): [number, number] {
    // 1. Update sliding-window RMS measurement
    const power = (l * l + r * r) * 0.5;
    const old = this.powerBuf[this.powerIndex];
    this.powerBuf[this.powerIndex] = power;
    this.powerSum += power - old;
    this.powerIndex++;
    if (this.powerIndex >= this.windowFrames) {
      this.powerIndex = 0;
    }
    if (this.powerFilled < this.windowFrames) {
      this.powerFilled++;
    }

    // Periodically recalculate to prevent float drift
    this.framesSinceRecalc++;
    if (this.framesSinceRecalc >= this.windowFrames) {
      this.framesSinceRecalc = 0;
      let sum = 0;
      for (let j = 0; j < this.powerFilled; j++) {
        sum += this.powerBuf[j];
      }
      this.powerSum = sum;
    }

    // 2. Compute RMS in dB
    const denom = Math.max(1, this.powerFilled);
    const meanPower = Math.max(this.powerSum / denom, 1e-12);
    const rmsDb = 10 * Math.log10(meanPower);

    // 3. Compute target gain reduction with soft knee
    const overDb = rmsDb - this.params.thresholdDb;
    const halfKnee = this.params.kneeDb * 0.5;
    const slope = 1 - 1 / this.params.ratio;

    let targetGainDb: number;
    if (overDb <= -halfKnee) {
      // Below knee: no compression
      targetGainDb = 0;
    } else if (overDb >= halfKnee) {
      // Above knee: full ratio compression
      targetGainDb = -(overDb * slope);
    } else {
      // In soft knee: quadratic interpolation
      const x = overDb + halfKnee;
      targetGainDb = -((x * x) / (2 * this.params.kneeDb)) * slope;
    }

    // 4. Smooth gain with attack/release
    const attackCoeff = timeToCoeff(this.params.attackMs, this.sampleRate);
    const releaseCoeff = timeToCoeff(this.params.releaseMs, this.sampleRate);

    if (targetGainDb < this.gainDb) {
      // Attack: gain decreasing (more compression)
      this.gainDb = lerp(this.gainDb, targetGainDb, attackCoeff);
    } else {
      // Release: gain increasing (less compression)
      this.gainDb = lerp(this.gainDb, targetGainDb, releaseCoeff);
    }

    this.currentGain = dbToLinear(this.gainDb);

    // 5. Apply gain (only attenuate, never boost)
    return [l * this.currentGain, r * this.currentGain];
  }

  gainReductionDb(): number {
    return isFinite(this.gainDb) ? -this.gainDb : 0;
  }
}

// -- Lookahead Limiter --

class LookaheadLimiter {
  private params: LimiterParams;
  private sampleRate: number;
  private lookaheadFrames: number;

  // Stereo delay buffer: [L0, R0, L1, R1, ...]
  private delayBuf: Float32Array;
  private delayIndex = 0;
  private peakEnvelope = 0;
  currentGain = 1;

  constructor(sampleRate: number, params: LimiterParams) {
    this.params = params;
    this.sampleRate = sampleRate;
    this.lookaheadFrames = Math.max(
      1,
      Math.round((params.lookaheadMs / 1000) * sampleRate)
    );
    this.delayBuf = new Float32Array(this.lookaheadFrames * 2);
  }

  setParams(params: LimiterParams): void {
    const newLookahead = Math.max(
      1,
      Math.round((params.lookaheadMs / 1000) * this.sampleRate)
    );
    if (newLookahead !== this.lookaheadFrames) {
      this.lookaheadFrames = newLookahead;
      this.delayBuf = new Float32Array(newLookahead * 2);
      this.delayIndex = 0;
      this.peakEnvelope = 0;
      this.currentGain = 1;
    }
    this.params = params;
  }

  // Process a single stereo frame, returns [left, right]
  processFrame(l: number, r: number): [number, number] {
    const thresholdLin = dbToLinear(this.params.thresholdDb);
    const attackCoeff = timeToCoeff(this.params.attackMs, this.sampleRate);
    const releaseCoeff = timeToCoeff(this.params.releaseMs, this.sampleRate);
    const envelopeDecay = Math.exp(
      -1.0 / (Math.max(this.params.releaseMs / 1000, 0.000001) * this.sampleRate)
    );

    // Peak envelope with hold + decay
    const framePeak = Math.max(Math.abs(l), Math.abs(r));
    this.peakEnvelope = Math.max(this.peakEnvelope * envelopeDecay, framePeak);

    // Target gain
    const targetGain =
      this.peakEnvelope > thresholdLin
        ? Math.min(thresholdLin / this.peakEnvelope, 1.0)
        : 1.0;

    // Gain smoothing
    if (targetGain < this.currentGain) {
      this.currentGain = lerp(this.currentGain, targetGain, attackCoeff);
    } else {
      this.currentGain = lerp(this.currentGain, targetGain, releaseCoeff);
    }

    // Read from delay buffer
    const di = this.delayIndex * 2;
    let outL = this.delayBuf[di] * this.currentGain;
    let outR = this.delayBuf[di + 1] * this.currentGain;

    // Hard clip safety net
    const outPeak = Math.max(Math.abs(outL), Math.abs(outR));
    if (outPeak > thresholdLin) {
      const hardGain = thresholdLin / outPeak;
      outL *= hardGain;
      outR *= hardGain;
    }

    // Write new sample into delay buffer
    this.delayBuf[di] = l;
    this.delayBuf[di + 1] = r;
    this.delayIndex++;
    if (this.delayIndex >= this.lookaheadFrames) {
      this.delayIndex = 0;
    }

    return [outL, outR];
  }

  gainReductionDb(): number {
    const gainDb = linearToDb(Math.max(this.currentGain, 1e-12));
    return isFinite(gainDb) ? -gainDb : 0;
  }
}

// -- True Peak Limiter (4x linear interpolation) --

// Uses 4x linear interpolation between adjacent samples to estimate inter-sample peaks.
const OVERSAMPLE_FACTOR = 4;

class TruePeakLimiter {
  private params: TruePeakParams;
  private sampleRate: number;
  private lookaheadFrames: number;

  // Delay buffer (stereo interleaved)
  private delayBuf: Float32Array;
  private delayIndex = 0;

  // History buffer for interpolation (per channel, last 4 samples)
  private histL: Float32Array;
  private histR: Float32Array;
  private histIndex = 0;

  // Gain state
  private peakEnvelope = 0;
  private currentGain = 1;
  private ceilingLin: number;

  constructor(sampleRate: number, params: TruePeakParams) {
    this.params = params;
    this.sampleRate = sampleRate;
    this.ceilingLin = dbToLinear(params.ceilingDbTp);
    this.lookaheadFrames = Math.max(
      1,
      Math.round((params.lookaheadMs / 1000) * sampleRate)
    );
    this.delayBuf = new Float32Array(this.lookaheadFrames * 2);
    this.histL = new Float32Array(4);
    this.histR = new Float32Array(4);
  }

  setParams(params: TruePeakParams): void {
    this.params = params;
    this.ceilingLin = dbToLinear(params.ceilingDbTp);
    const newLookahead = Math.max(
      1,
      Math.round((params.lookaheadMs / 1000) * this.sampleRate)
    );
    if (newLookahead !== this.lookaheadFrames) {
      this.lookaheadFrames = newLookahead;
      this.delayBuf = new Float32Array(newLookahead * 2);
      this.delayIndex = 0;
    }
  }

  // Estimate true peak using 4x oversampling with linear interpolation
  private estimateTruePeak(l: number, r: number): number {
    const hi = this.histIndex;
    this.histL[hi] = l;
    this.histR[hi] = r;
    this.histIndex = (hi + 1) & 3;

    let maxPeak = Math.max(Math.abs(l), Math.abs(r));

    // Interpolate between current and previous sample (3 intermediate points)
    const prevIdxL = (hi + 3) & 3; // previous sample index
    const prevL = this.histL[prevIdxL];
    const prevR = this.histR[prevIdxL];

    for (let p = 1; p < OVERSAMPLE_FACTOR; p++) {
      const t = p / OVERSAMPLE_FACTOR;
      // Linear interpolation between prev and current
      const interpL = prevL + (l - prevL) * t;
      const interpR = prevR + (r - prevR) * t;
      const peak = Math.max(Math.abs(interpL), Math.abs(interpR));
      if (peak > maxPeak) maxPeak = peak;
    }

    return maxPeak;
  }

  processFrame(l: number, r: number): [number, number] {
    const ceiling = this.ceilingLin;
    const releaseCoeff = timeToCoeff(this.params.releaseMs, this.sampleRate);

    // Detect true peak via oversampling
    const truePeak = this.estimateTruePeak(l, r);

    // Update envelope
    if (truePeak > this.peakEnvelope) {
      this.peakEnvelope = truePeak;
    } else {
      this.peakEnvelope = lerp(this.peakEnvelope, truePeak, releaseCoeff);
    }

    // Compute target gain
    const targetGain =
      this.peakEnvelope > ceiling
        ? Math.min(ceiling / this.peakEnvelope, 1.0)
        : 1.0;

    // Instant attack, smooth release
    if (targetGain < this.currentGain) {
      this.currentGain = targetGain;
    } else {
      this.currentGain = lerp(this.currentGain, targetGain, releaseCoeff);
    }

    // Read delayed sample
    const di = this.delayIndex * 2;
    let outL = this.delayBuf[di] * this.currentGain;
    let outR = this.delayBuf[di + 1] * this.currentGain;

    // Hard clip safety
    const outPeak = Math.max(Math.abs(outL), Math.abs(outR));
    if (outPeak > ceiling) {
      const clip = ceiling / outPeak;
      outL *= clip;
      outR *= clip;
    }

    // Write into delay
    this.delayBuf[di] = l;
    this.delayBuf[di + 1] = r;
    this.delayIndex++;
    if (this.delayIndex >= this.lookaheadFrames) {
      this.delayIndex = 0;
    }

    return [outL, outR];
  }

  gainReductionDb(): number {
    const gainDb = linearToDb(Math.max(this.currentGain, 1e-12));
    return isFinite(gainDb) ? -gainDb : 0;
  }
}

// -- SleepProcessor AudioWorkletProcessor --

class SleepProcessor extends AudioWorkletProcessor {
  private normalizer: LoudnessNormalizer;
  private compressor: FastCompressor;
  private limiter: LookaheadLimiter;
  private truePeak: TruePeakLimiter;
  private meteringCounter = 0;
  private meteringInterval: number;
  private bypassed = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();

    const opts = options?.processorOptions || {};
    const sr: number = opts.sampleRate || 48000;
    const params: WorkletParams = opts.params || {
      normalizer: {
        targetLufs: -16.0,
        windowMs: 3000.0,
        updateIntervalMs: 100.0,
        maxGainDb: 3.0,
        maxGainChangeDbPerS: 1.0,
        gateLufs: -60.0,
        boostBelowLufs: -35.0,
      },
      compressor: {
        thresholdDb: -24.0,
        ratio: 6.0,
        attackMs: 15.0,
        releaseMs: 400.0,
        windowMs: 100.0,
        kneeDb: 6.0,
      },
      limiter: {
        thresholdDb: -3.0,
        lookaheadMs: 5.0,
        attackMs: 1.0,
        releaseMs: 50.0,
      },
      truePeak: {
        ceilingDbTp: -1.0,
        lookaheadMs: 1.5,
        releaseMs: 50.0,
      },
    };

    this.normalizer = new LoudnessNormalizer(sr, params.normalizer);
    this.compressor = new FastCompressor(sr, params.compressor);
    this.limiter = new LookaheadLimiter(sr, params.limiter);
    this.truePeak = new TruePeakLimiter(sr, params.truePeak);

    // Send metering at ~10Hz: sampleRate / 128 (block size) / 10
    this.meteringInterval = Math.round(sr / 10);

    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "SET_PARAMS") {
        this.normalizer.setParams(data.params.normalizer);
        this.compressor.setParams(data.params.compressor);
        this.limiter.setParams(data.params.limiter);
        this.truePeak.setParams(data.params.truePeak);
      } else if (data.type === "SET_BYPASS") {
        this.bypassed = data.bypassed;
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][]
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    // When bypassed, passthrough without processing to save CPU
    if (this.bypassed) {
      for (let ch = 0; ch < output.length; ch++) {
        const src = input[ch] || input[0];
        output[ch].set(src);
      }
      return true;
    }

    const left = input[0];
    const right = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = left.length;

    for (let i = 0; i < frames; i++) {
      // 1. Normalizer: K-weighting + LUFS measurement + auto gain (slow, long-term)
      let [l, r] = this.normalizer.processFrame(left[i], right[i]);

      // 2. Compressor: fast RMS-based transient loudness protection
      [l, r] = this.compressor.processFrame(l, r);

      // 3. Limiter: lookahead delay + peak limiting
      [l, r] = this.limiter.processFrame(l, r);

      // 4. True Peak Limiter: 4x oversampling + true peak detection (must be last)
      [l, r] = this.truePeak.processFrame(l, r);

      outL[i] = l;
      if (outR !== outL) {
        outR[i] = r;
      }
    }

    // Send metering at ~10Hz
    this.meteringCounter += frames;
    if (this.meteringCounter >= this.meteringInterval) {
      this.meteringCounter = 0;
      this.port.postMessage({
        type: "METERING",
        lufs: this.normalizer.currentLufs,
        gainReductionDb:
          this.compressor.gainReductionDb() +
          this.limiter.gainReductionDb() +
          this.truePeak.gainReductionDb(),
      });
    }

    return true;
  }
}

registerProcessor("sleep-processor", SleepProcessor);

// AudioWorkletProcessor for Vocal Separation
// Bundled as standalone IIFE -- no external imports.
// Uses STFT + frequency-band spectral masking.
// Internal buffering handles 2048-sample FFT with 128-sample worklet blocks.
export {}; // Make TSC treat as module (esbuild strips this in IIFE output)

// -- Inlined types --

interface SeparatorParams {
  enabled: boolean;
  vocalGainDb: number;
  musicReductionDb: number;
}

interface VocalWorkletParams {
  separator: SeparatorParams;
}

interface VocalWorkletInboundMessage {
  type: "SET_PARAMS";
  params: VocalWorkletParams;
}

// -- FFT using flat Float32Arrays (zero allocation in hot path) --
// Complex data stored as interleaved [re0, im0, re1, im1, ...]
// This avoids creating Complex objects during processing.

function bitReverse(x: number, log2n: number): number {
  let result = 0;
  for (let i = 0; i < log2n; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

// In-place Radix-2 Cooley-Tukey FFT on interleaved [re, im] Float32Array.
// buf length must be 2*N where N is a power of 2.
function fftInPlace(buf: Float32Array, n: number, inverse: boolean): void {
  const log2n = Math.log2(n) | 0;

  // Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, log2n);
    if (i < j) {
      // Swap complex elements: buf[i] <-> buf[j]
      const i2 = i << 1;
      const j2 = j << 1;
      const tmpRe = buf[i2];
      const tmpIm = buf[i2 + 1];
      buf[i2] = buf[j2];
      buf[i2 + 1] = buf[j2 + 1];
      buf[j2] = tmpRe;
      buf[j2 + 1] = tmpIm;
    }
  }

  // Butterfly operations
  const angleSign = inverse ? 1.0 : -1.0;

  let size = 2;
  while (size <= n) {
    const half = size >> 1;
    const angleStep = angleSign * 2.0 * Math.PI / size;
    const wBaseRe = Math.cos(angleStep);
    const wBaseIm = Math.sin(angleStep);

    for (let k = 0; k < n; k += size) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let j = 0; j < half; j++) {
        const uIdx = (k + j) << 1;
        const tIdx = (k + j + half) << 1;

        const uRe = buf[uIdx];
        const uIm = buf[uIdx + 1];
        const tRe = wRe * buf[tIdx] - wIm * buf[tIdx + 1];
        const tIm = wRe * buf[tIdx + 1] + wIm * buf[tIdx];

        buf[uIdx] = uRe + tRe;
        buf[uIdx + 1] = uIm + tIm;
        buf[tIdx] = uRe - tRe;
        buf[tIdx + 1] = uIm - tIm;

        const newWRe = wRe * wBaseRe - wIm * wBaseIm;
        wIm = wRe * wBaseIm + wIm * wBaseRe;
        wRe = newWRe;
      }
    }
    size <<= 1;
  }

  // IFFT normalization
  if (inverse) {
    const invN = 1.0 / n;
    const len = n << 1;
    for (let i = 0; i < len; i++) {
      buf[i] *= invN;
    }
  }
}

// -- Vocal Separator --

const FFT_LEN = 2048;
const HOP_LEN = FFT_LEN >> 1; // 50% overlap

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

class VocalSeparator {
  private sampleRate: number;
  private params: SeparatorParams;
  private window: Float32Array; // Hann analysis window
  private binGains: Float32Array; // Per-bin gain

  // Input accumulation buffer (mono mid signal)
  private inputBuf: Float32Array;
  private inputCount = 0;

  // Output overlap-add buffer (ring)
  private outputBuf: Float32Array;
  private outputReadPos = 0;

  // FFT work buffer: interleaved [re, im] pairs, length = FFT_LEN * 2
  private fftBuf: Float32Array;

  // Side channel delay buffer (compensate STFT latency)
  private sideDelay: Float32Array;
  private sideDelayPos = 0;

  // Crossfade state
  private crossfadePos = 0;
  private crossfadeLen: number;
  private isFadingIn = false;
  private isFadingOut = false;

  constructor(sampleRate: number, params: SeparatorParams) {
    this.sampleRate = sampleRate;
    this.params = params;

    // Build Hann window
    this.window = new Float32Array(FFT_LEN);
    for (let i = 0; i < FFT_LEN; i++) {
      this.window[i] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * i / FFT_LEN));
    }

    const halfSpectrum = (FFT_LEN >> 1) + 1;
    this.binGains = new Float32Array(halfSpectrum);

    this.inputBuf = new Float32Array(FFT_LEN);

    // Output buffer: FFT_LEN + HOP_LEN to handle overlap
    this.outputBuf = new Float32Array(FFT_LEN + HOP_LEN);

    // Interleaved complex buffer: [re0, im0, re1, im1, ...]
    this.fftBuf = new Float32Array(FFT_LEN * 2);

    // Side delay: FFT_LEN samples
    this.sideDelay = new Float32Array(FFT_LEN);

    this.crossfadeLen = Math.floor(sampleRate * 0.01); // 10ms crossfade

    this.updateBinGains();
  }

  setParams(params: SeparatorParams): void {
    const wasEnabled = this.params.enabled;
    const gainChanged =
      Math.abs(this.params.vocalGainDb - params.vocalGainDb) > 1e-6 ||
      Math.abs(this.params.musicReductionDb - params.musicReductionDb) > 1e-6;

    this.params = params;

    if (gainChanged) {
      this.updateBinGains();
    }

    if (!wasEnabled && params.enabled) {
      this.isFadingIn = true;
      this.isFadingOut = false;
      this.crossfadePos = 0;
    } else if (wasEnabled && !params.enabled) {
      this.isFadingOut = true;
      this.isFadingIn = false;
      this.crossfadePos = 0;
    }
  }

  // Process a single stereo frame, modifying l/r in place
  processFrame(l: number, r: number): [number, number] {
    if (!this.params.enabled && !this.isFadingOut) {
      return [l, r];
    }

    // Mid/Side decomposition
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;

    // Delay side channel to compensate STFT latency
    const delayedSide = this.sideDelay[this.sideDelayPos];
    this.sideDelay[this.sideDelayPos] = side;
    this.sideDelayPos = (this.sideDelayPos + 1) % this.sideDelay.length;

    // Accumulate mid into input buffer
    this.inputBuf[this.inputCount] = mid;
    this.inputCount++;

    // When we have a full frame, process FFT
    if (this.inputCount >= FFT_LEN) {
      this.processFftFrame();
      // Slide: keep second half as overlap for next frame
      this.inputBuf.copyWithin(0, HOP_LEN, FFT_LEN);
      this.inputCount = HOP_LEN;
    }

    // Read processed mid from overlap-add buffer
    const processedMid = this.outputBuf[this.outputReadPos];
    this.outputBuf[this.outputReadPos] = 0;
    this.outputReadPos = (this.outputReadPos + 1) % this.outputBuf.length;

    // Mid/Side -> L/R
    const wetL = processedMid + delayedSide;
    const wetR = processedMid - delayedSide;

    // Crossfade handling
    let outL: number, outR: number;

    if (this.isFadingIn) {
      const t = this.crossfadePos / this.crossfadeLen;
      const fade = Math.min(t, 1.0);
      this.crossfadePos++;
      if (this.crossfadePos >= this.crossfadeLen) {
        this.isFadingIn = false;
      }
      outL = l + (wetL - l) * fade;
      outR = r + (wetR - r) * fade;
    } else if (this.isFadingOut) {
      const t = this.crossfadePos / this.crossfadeLen;
      const fade = Math.max(1.0 - t, 0.0);
      this.crossfadePos++;
      if (this.crossfadePos >= this.crossfadeLen) {
        this.isFadingOut = false;
      }
      outL = l + (wetL - l) * fade;
      outR = r + (wetR - r) * fade;
    } else {
      outL = wetL;
      outR = wetR;
    }

    return [outL, outR];
  }

  private processFftFrame(): void {
    // Analysis: window + load into interleaved complex buffer
    for (let i = 0; i < FFT_LEN; i++) {
      const i2 = i << 1;
      this.fftBuf[i2] = this.inputBuf[i] * this.window[i]; // re
      this.fftBuf[i2 + 1] = 0; // im
    }
    fftInPlace(this.fftBuf, FFT_LEN, false);

    // Apply bin gains (preserve phase)
    const half = (FFT_LEN >> 1) + 1;
    for (let k = 0; k < half; k++) {
      const g = this.binGains[k];
      const k2 = k << 1;
      this.fftBuf[k2] *= g;
      this.fftBuf[k2 + 1] *= g;
      // Mirror (conjugate symmetry)
      if (k > 0 && k < FFT_LEN >> 1) {
        const m2 = (FFT_LEN - k) << 1;
        this.fftBuf[m2] *= g;
        this.fftBuf[m2 + 1] *= g;
      }
    }

    // Synthesis: IFFT
    fftInPlace(this.fftBuf, FFT_LEN, true);

    // Overlap-add (only need real parts)
    const outBufLen = this.outputBuf.length;
    for (let i = 0; i < FFT_LEN; i++) {
      const pos = (this.outputReadPos + i) % outBufLen;
      this.outputBuf[pos] += this.fftBuf[i << 1]; // re part only
    }
  }

  private updateBinGains(): void {
    const half = (FFT_LEN >> 1) + 1;
    const vocalGain = dbToLinear(this.params.vocalGainDb);
    const musicGain = dbToLinear(this.params.musicReductionDb);

    // Frequency boundaries (Hz)
    const lowStart = 80;
    const lowEnd = 300;
    const highStart = 3400;
    const highEnd = 8000;

    const binFreq = this.sampleRate / FFT_LEN;

    for (let k = 0; k < half; k++) {
      const freq = k * binFreq;

      // Vocal mask: 0.0 = background, 1.0 = vocal
      let vocalMask: number;
      if (freq < lowStart) {
        vocalMask = 0;
      } else if (freq < lowEnd) {
        const t = (freq - lowStart) / (lowEnd - lowStart);
        vocalMask = 0.5 - 0.5 * Math.cos(Math.PI * t);
      } else if (freq <= highStart) {
        vocalMask = 1.0;
      } else if (freq < highEnd) {
        const t = (freq - highStart) / (highEnd - highStart);
        vocalMask = 0.5 + 0.5 * Math.cos(Math.PI * t);
      } else {
        vocalMask = 0;
      }

      this.binGains[k] = vocalMask * vocalGain + (1.0 - vocalMask) * musicGain;
    }
  }
}

// -- VocalProcessor AudioWorkletProcessor --

class VocalProcessor extends AudioWorkletProcessor {
  private separator: VocalSeparator;
  private bypassed = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();

    const opts = options?.processorOptions || {};
    const sr: number = opts.sampleRate || 48000;
    const params: VocalWorkletParams = opts.params || {
      separator: {
        enabled: false,
        vocalGainDb: 0.0,
        musicReductionDb: -12.0,
      },
    };

    this.separator = new VocalSeparator(sr, params.separator);

    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "SET_PARAMS") {
        this.separator.setParams(data.params.separator);
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

    // Pipeline bypass: passthrough to save CPU
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
      const [l, r] = this.separator.processFrame(left[i], right[i]);
      outL[i] = l;
      if (outR !== outL) {
        outR[i] = r;
      }
    }

    return true;
  }
}

registerProcessor("vocal-processor", VocalProcessor);

# DSP Modules Technical Reference

## Module Overview

| Module | 文件 | 运行位置 | 算法 |
|--------|------|---------|------|
| LoudnessNormalizer | sleep-processor.ts | AudioWorklet | BS.1770 K-weighting LUFS |
| LookaheadLimiter | sleep-processor.ts | AudioWorklet | Peak envelope + delay buffer |
| TruePeakLimiter | sleep-processor.ts | AudioWorklet | 4x oversampling + 峰值检测 |
| DynamicsCompressor | (原生节点) | Web Audio | DynamicsCompressorNode |
| EQ | (原生节点 x3) | Web Audio | BiquadFilterNode |
| TimeStretch | dsp-processor.ts | AudioWorklet | WSOLA |
| PitchShift | dsp-processor.ts | AudioWorklet | WSOLA + Catmull-Rom 重采样 |
| VocalSeparator | vocal-processor.ts | AudioWorklet | Radix-2 FFT + STFT 频谱掩码 |

---

## 1. LoudnessNormalizer (BS.1770 LUFS)

### 算法流程

```
输入采样 (L, R)
    |
    v
K-weighting IIR 滤波 (2级级联 biquad)
  Stage 1: High shelf (+4dB @1682Hz)
  Stage 2: High pass (HPF @38Hz)
    |
    v
计算瞬时能量: wl*wl + wr*wr
    |
    v
滑动窗口累积 (默认 3000ms, 144000帧 @48kHz)
    |
    v
计算 LUFS: -0.691 + 10*log10(meanPower)
    |
    v
计算目标增益: targetLufs - currentLufs (dB)
    |
    v
应用门限: 当 LUFS < gateLufs (-60) 时不增加增益
    |
    v
限幅: clamp to [-maxGainDb, +maxGainDb]
    |
    v
速率限制: maxGainChangeDbPerS (防止增益突变)
    |
    v
应用增益: sample * gainLin
```

### Key Parameters

- `targetLufs`: 目标响度 (默认 -16 LUFS)
- `windowMs`: 测量窗口 (默认 3000ms)
- `maxGainDb`: 最大增益幅度 (默认 12dB)
- `maxGainChangeDbPerS`: 增益变化速率限制 (默认 1 dB/s)
- `gateLufs`: 静音门限 (默认 -60 LUFS)

---

## 2. LookaheadLimiter

### 算法流程

```
输入采样
    |
    v
写入延迟缓冲区 (lookaheadMs, 默认 5ms)
    |
    v
峰值包络检测: peakEnvelope = max(envelope * decay, |sample|)
    |
    v
计算目标增益: threshold / peakEnvelope (当峰值超过 threshold)
    |
    v
增益平滑: attack (1ms) 快速下降 / release (50ms) 缓慢恢复
    |
    v
从延迟缓冲区读取 delayed sample
    |
    v
应用增益: delayedSample * smoothedGain
    |
    v
硬限幅安全网: 确保不超过 threshold
```

### 前瞻原理

延迟缓冲区使限制器能"预见"即将到来的峰值，在峰值到达输出前就开始降低增益。这比无前瞻的限制器能更干净地控制峰值。

---

## 3. TruePeakLimiter

### 算法

在采样点之间进行插值估算真实峰值。当前实现使用线性插值（4 点历史缓冲区），在相邻采样点之间生成 4 个插值点检测 inter-sample peak。

处理流程与 LookaheadLimiter 类似，但使用估算的真峰值代替采样峰值。

### 已知限制

当前使用线性插值而非 FIR polyphase 滤波器，对复杂波形的峰值估算可能偏低 1-3dB。`FIR_TAPS_4X` 常量已声明但未使用（待后续升级）。

---

## 4. WSOLA TimeStretch

### 算法: Waveform Similarity Overlap-Add

WSOLA 在不改变音高的情况下改变音频播放速度。

```
参数:
  windowLen = 50ms (2400帧 @48kHz)
  analysisHop = windowLen / 2 (50% overlap)
  tolerance = analysisHop / 2 (搜索范围)

流程:
  1. 从输入环形缓冲区读取 windowLen 大小的分析窗
  2. 在 tolerance 范围内搜索最佳对齐位置
     (使用互相关 cross-correlation, step=4 降采样加速)
  3. 应用 Hann 窗
  4. Overlap-Add 到输出环形缓冲区
  5. 输入推进 analysisHop * speed 帧
  6. 输出推进 analysisHop 帧

speed > 1.0: 快速播放（输入推进快于输出 -> 跳过内容）
speed < 1.0: 慢速播放（输入推进慢于输出 -> 重复内容）
speed = 1.0: 直接 passthrough（零处理开销）
```

### Speed 平滑

使用 20ms 时间常数的一阶低通滤波平滑 speed 变化，避免参数突变导致的音频伪影。

---

## 5. PitchShift

### 算法: WSOLA + Catmull-Rom 重采样

音高变换 = 时间拉伸 + 重采样。

```
要升高 N 个半音:
  1. speedFactor = 2^(N/12)
  2. WSOLA 以 speedFactor 拉伸（时长变短，音高不变）
  3. Catmull-Rom 重采样以 1/speedFactor 比率（恢复原始时长，音高改变）

例: +12 半音 (升一个八度)
  speedFactor = 2.0
  WSOLA 将时长压缩一半 -> 播放速度 2x
  重采样 ratio = 0.5 -> 每个输出采样取半个输入 -> 频率翻倍
```

### Catmull-Rom 插值

四点三次样条插值，比线性插值更平滑，但计算量适中：

```
f(t) = 0.5 * [(2*P1) + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t^2 + (-P0+3*P1-3*P2+P3)*t^3]
```

---

## 6. VocalSeparator

### 算法: STFT + Mid/Side + 频谱掩码

```
参数:
  FFT_LEN = 2048
  HOP_LEN = 1024 (50% overlap)
  Hann window

流程:
  1. 输入 L/R -> Mid (L+R)/2, Side (L-R)/2
  2. Mid 信号做 STFT:
     a. 加 Hann 窗
     b. 2048-point FFT (Radix-2 Cooley-Tukey)
     c. 对频率 bin 应用增益掩码:
        - 80Hz 以下: musicReductionDb (衰减音乐)
        - 80-300Hz: cosine 渐变过渡
        - 300-3400Hz: vocalGainDb (增强人声)
        - 3400-8000Hz: cosine 渐变过渡
        - 8000Hz 以上: musicReductionDb (衰减音乐)
     d. IFFT
     e. Overlap-Add 到输出缓冲区
  3. Side 信号延迟补偿 (匹配 STFT 延迟)
  4. 重建: L = processedMid + delayedSide, R = processedMid - delayedSide
  5. 开/关时 crossfade 过渡 (10ms)
```

### FFT 实现

手写 Radix-2 Cooley-Tukey FFT:
- Float32Array interleaved 存储: `[re0, im0, re1, im1, ...]`
- process() 中零内存分配
- 位反转重排 + 蝶形运算
- 逆变换通过共轭 + 正变换 + 除以 N

### 频率掩码设计

人声核心频段 300-3400Hz 设为 vocalGainDb（增强），其他频段设为 musicReductionDb（压制）。过渡区使用 cosine 平滑避免频率 bin 边界产生伪影。

---

## 7. Native Web Audio Nodes

### DynamicsCompressorNode

使用浏览器原生压缩器，参数通过 AudioParam 设置：
- threshold, ratio, knee, attack, release
- 自动 makeup gain

### BiquadFilterNode (EQ)

三段参数 EQ:
- Low shelf: 150Hz, -3dB (降低低频隆隆声)
- Peaking: 3kHz, -4dB, Q=0.7 (降低刺耳中高频)
- High shelf: 4kHz, -6dB (大幅降低高频 sibilance)

EQ bypass: 将所有 gain 值设为 0dB（flat response）。

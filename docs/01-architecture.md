# Sleep Mode Chrome Extension - Architecture

## Overview

Chrome Extension (Manifest V3)，拦截 YouTube 视频音频并施加实时 DSP 处理，优化为适合睡眠收听的音频。

核心能力：LUFS 响度归一化、动态压缩、前瞻限制、真峰值限制、三段 EQ、WSOLA 时间拉伸、音高变换、人声分离。

## Design Principles

- Content Script 拥有音频管道（Web Audio API 运行在页面上下文）
- AudioWorklet 处理自定义 DSP（实时音频线程，128 采样/块，2.67ms 时间预算）
- 原生 Web Audio 节点处理标准 DSP（Compressor、EQ、Gain）
- Popup 是无状态控制面板；所有状态存储在 chrome.storage.sync
- Background Service Worker 是纯消息路由器，不做任何音频处理

## Directory Structure

```
sleep-mode-extension/
  manifest.json                    # MV3 manifest
  build.config.ts                  # esbuild 构建脚本
  tsconfig.json
  src/
    background/
      service-worker.ts            # 消息路由、生命周期、Badge 更新
    content/
      content-script.ts            # YouTube DOM 交互、管道生命周期管理
      audio-pipeline.ts            # Web Audio 节点图构建
      youtube-observer.ts          # SPA 导航检测（MutationObserver）
    popup/
      popup.html / popup.css       # 控制面板 UI
      popup.ts                     # 控制面板逻辑
    worklet/
      sleep-processor.ts           # Normalizer + Limiter + TruePeakLimiter
      dsp-processor.ts             # WSOLA TimeStretch + PitchShift
      vocal-processor.ts           # FFT + STFT 人声分离
    shared/
      types.ts                     # 共享类型定义
      constants.ts                 # 预设参数、默认值
      messages.ts                  # 消息协议类型
      storage.ts                   # chrome.storage 读写封装
  assets/
    icons/                         # 扩展图标
  dist/                            # 构建产物（6个JS + HTML + CSS）
```

## Audio Pipeline

```
YouTube <video> element
       |
       | createMediaElementSource(video)
       v
  MediaElementAudioSourceNode
       |
       v
  [VocalProcessor]  AudioWorklet       -- STFT 人声分离 (Mid/Side + 频谱掩码)
       |
       v
  [SleepProcessor]  AudioWorklet       -- LUFS 归一化 + 前瞻限制器 + 真峰值限制
       |
       v
  DynamicsCompressorNode               -- 原生动态压缩
       |
       v
  BiquadFilterNode x3                  -- 原生三段 EQ (lowshelf/peaking/highshelf)
       |
       v
  [DspProcessor]    AudioWorklet       -- WSOLA 时间拉伸 + 音高变换
       |
       v
  GainNode                             -- 主音量
       |
       v
  AudioContext.destination             -- 扬声器/耳机
```

### Processing Order Rationale

1. VocalProcessor 最前：分离人声和背景音乐需要未处理的原始信号
2. SleepProcessor 第二：归一化需要测量原始（分离后）响度，限制器早期捕获突发峰值
3. DynamicsCompressor 第三：在归一化信号上进一步压缩动态范围
4. EQ 第四：在动态控制后塑造频率响应
5. DspProcessor 第五：时间拉伸/音高变换应用在已处理的信号上
6. GainNode 最后：用户主音量控制

## Communication Protocol

```
Popup                  Background SW           Content Script         AudioWorklet
  |                        |                        |                      |
  |-- SET_ENABLED ------->|                        |                      |
  |                        |-- relay ------------->|                      |
  |                        |                        |-- bypass/engage --->|
  |                        |                        |                      |
  |-- SET_PRESET -------->|                        |                      |
  |                        |-- relay ------------->|                      |
  |                        |                        |-- SET_PARAMS ------>|
  |                        |                        |                      |
  |                        |                        |<-- METERING --------|
  |                        |<-- METERING -----------|                      |
  |<-- METERING -----------|                        |                      |
  |                        |                        |                      |
  |-- GET_STATUS -------->|                        |                      |
  |                        |-- relay ------------->|                      |
  |                        |<-- STATUS -------------|                      |
  |<-- STATUS ------------|                        |                      |
```

### Message Types

Popup -> Content Script:
- `SET_ENABLED` / `SET_PRESET` / `SET_EQ_ENABLED`
- `SET_SPEED` / `SET_PITCH` / `SET_VOCAL_ENHANCE`
- `GET_STATUS`

Content Script -> Popup:
- `STATUS` (管道状态)
- `METERING` (LUFS + Gain Reduction, ~10Hz)

Content Script -> AudioWorklet:
- `SET_PARAMS` (每个 worklet 独立的参数消息)

### Transport

- Popup <-> Background: `chrome.runtime.sendMessage` / `onMessage`
- Background <-> Content Script: `chrome.tabs.sendMessage` / `onMessage`
- Content Script <-> AudioWorklet: `AudioWorkletNode.port.postMessage` / `onmessage`
- 补充同步: `chrome.storage.onChanged` 监听（Popup 写入 storage，Content Script 监听变化）

## Presets

| Preset | Normalizer | Compressor | Limiter | EQ | Vocal | 适用场景 |
|--------|-----------|------------|---------|-----|-------|---------|
| Sleep | -16 LUFS, 2.5:1 | -18dB/-3dB | -3dB | On | Off | 默认，中等压缩+睡眠EQ |
| ASMR | -18 LUFS, 1.5:1 | -18dB/-6dB | -6dB | On | Off | 轻柔处理，低语内容 |
| Podcast | -16 LUFS, 3.0:1 | -18dB/-3dB | -3dB | Off | On (+3dB) | 增强人声，压制背景 |
| White Noise | -20 LUFS, 1.5:1 | -18dB/-6dB | -6dB | Off | Off | 低目标响度，最少处理 |

## Storage Schema

```
chrome.storage.sync:
  enabled: boolean           -- 全局开关
  presetId: string           -- 当前预设 ID
  masterGainDb: number       -- 主音量 (dB)
  eqEnabled: boolean         -- EQ 开关（独立于预设）
  speed: number              -- 播放速度 (0.5 ~ 2.0)
  pitchSemitones: number     -- 音高偏移 (-12 ~ +12 半音)
  vocalEnhance: boolean      -- 人声增强开关
```

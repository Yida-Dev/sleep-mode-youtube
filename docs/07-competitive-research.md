# 竞品调研与技术方案分析

调研日期: 2026-02-07

## 一、核心发现摘要

### 1. 市场空白

现有扩展要么只做定时暂停（Sleep Timer），要么只做通用音频处理（EQ/压缩），**没有一款产品专门针对"睡眠场景的音频优化"**。ASMR Mode 最接近但已下架且功能单一。

### 2. 音频捕获方案：两条路线

| 维度 | createMediaElementSource | tabCapture + Offscreen |
|------|--------------------------|------------------------|
| 原理 | 内容脚本直接劫持 video 元素 | 捕获整个标签页音频流 |
| CORS 限制 | 严重（跨域媒体静音且不可逆） | 无 |
| 延迟 | 极低 (<10ms) | 略高 |
| MV3 兼容 | 直接在 content script 工作 | 需要 Offscreen Document |
| SPA 导航 | 需要处理视频元素变化 | 流持续有效，不受影响 |
| 用户交互 | 不需要 | 需要用户点击扩展图标 |

**关键发现**：大多数现有扩展使用 createMediaElementSource，但该方案存在 CORS 风险。YouTube 视频从 googlevideo.com CDN 加载，理论上属于跨域——但在 Chrome Extension 的 content script 中，由于扩展的高权限，这个问题通常不会表现出来。

**我们的选择**：我们当前使用 createMediaElementSource，在实际测试中 YouTube 上工作正常。如果未来遇到 CORS 问题，备选方案是 tabCapture + Offscreen Document。

### 3. DSP 实现：原生节点 vs AudioWorklet

**绝大多数现有扩展不使用 AudioWorklet**。它们直接串联 Web Audio API 内置节点：

```
BiquadFilterNode(x N) -> DynamicsCompressorNode -> GainNode -> destination
```

只有需要内置节点不提供的自定义算法时，才需要 AudioWorklet（如 LUFS 测量、自定义限制器、WSOLA）。

### 4. 时间拉伸的最佳方案

**Chromium 内置的 playbackRate 使用原生 WSOLA 实现，质量和性能远优于 JS/AudioWorklet 自行实现**。

Georgia Tech WAC2016 论文结论：浏览器中 JS 实现的时间拉伸算法数量少且多为实验性，Phase Vocoder 有明显性能问题，WSOLA 计算量较小但仍不如原生实现。

来源：
- [Georgia Tech WAC2016](https://repository.gatech.edu/handle/1853/54587)
- [Superpowered Web Audio](https://superpowered.com/js-wasm-overview)

---

## 二、现有扩展/项目清单 (15 个)

### 高相关性

| # | 名称 | 核心功能 | 技术方案 | 下载/评分 |
|---|------|---------|---------|----------|
| 1 | YouTube Sleep Timer | 定时暂停 YouTube | Chrome Alarms API + Scripting API | 开源 |
| 2 | YouTube Audio Compressor | 压缩动态范围 | createMediaElementSource + DynamicsCompressorNode | Chrome+Firefox |
| 3 | ASMR Mode | 广告期间替换为 ASMR 环境音 | 广告检测 + 音频替换 | 已下架 |
| 4 | YouTube Volume Normalizer | 标准化 YouTube 音量 | 读取 YouTube stats for nerds 的响度数据 + GainNode | 开源 |
| 5 | Decibel Limiter | 实时音量限制/听力保护 | 可配置分贝阈值 + 实时 dBFS 表 | 专业级 |

### 通用音频扩展

| # | 名称 | 核心功能 | 技术方案 | 下载/评分 |
|---|------|---------|---------|----------|
| 6 | Ears: Bass Boost | 11 段 EQ + 音量增强 + 频谱可视化 | BiquadFilterNode x11 + GainNode + AnalyserNode | 4.54/5 (已下架) |
| 7 | Equalizer Plus | 10 段 EQ + 压缩 + 音量 400% | Offscreen Document + BiquadFilter x10 + DynamicsCompressor | 10,000+ 用户，开源 |
| 8 | Audio Channel | EQ + 压缩 + 混响 + 变调 | ConvolverNode(脉冲响应) + 完整 DSP 链 | 功能最全但已废弃 |
| 9 | One-Click Audio Compressor | 一键压缩 | createMediaElementSource + DynamicsCompressorNode | 简洁 |
| 10 | Enhancer for YouTube | EQ + 音量增强(10x) + 去广告 | Web Audio API，闭源 | 200 万+ 用户 |
| 11 | Sound Tools | 实时音频效果 + MIDI 控制器 | AudioWorklet + MIDI API | 专业级，开源 |

### 开源参考项目

| # | 名称 | 核心功能 | 链接 |
|---|------|---------|------|
| 12 | YouMix | YouTube 音频滤波器 | github.com/ChrisZieba/youmix |
| 13 | Chrome-Audio-EQ | HTML5 EQ 控制 | github.com/ejci/Chrome-Audio-EQ |
| 14 | AudioKit | 轻量音量/人声/低音增强 | github.com/ChristianE00/AudioKit |
| 15 | Browser Compressor | 浏览器媒体压缩 | github.com/stella3d/browser-compressor |

---

## 三、竞品 App 的音频处理策略

### Overcast Voice Boost 2（最值得参考）

Overcast 是 Podcast 播放器领域音频处理的标杆：

- ITU BS.1770-4 标准的 LUFS 测量
- 标准化到 -14 LUFS（与 Siri/iOS 导航语音一致）
- 轻度压缩 + EQ + True-Peak Lookahead Limiter
- 纯 C 实现，iPhone SE 上仅 1% CPU 占用
- Smart Speed：动态缩短沉默，但故意保留部分间隙维持节奏

来源：[marco.org/2020/01/31/voiceboost2](https://marco.org/2020/01/31/voiceboost2)

### Calm / Headspace

- 主要依赖精心制作的内容，而非实时 DSP
- Headspace 与 Hans Zimmer 合作双耳节拍 + 电影音乐
- Sleep Radio：不间断环境声（雨声 + 柔和无人机音、电子乐 + 海洋声）
- 我们的差异化：对任意 YouTube 内容进行实时音频优化

### Spotify / Apple Music Sleep Timer

- Spotify 提供 5/10/15/30/45/60 分钟 + "播完当前曲目"
- 到时间后柔和淡出（关键：突然停止会惊醒用户）
- 跨设备支持

---

## 四、睡眠音频科学研究

### 频率与睡眠

| 发现 | 来源 |
|------|------|
| 432 Hz 音乐使 alpha 波显著增加，睡眠质量提升 +3.6 (p=0.02) | PMC/6924256 |
| 528 Hz 可降低皮质醇，提高催产素 | 多项研究 |
| Theta 双耳节拍 (4-8 Hz) 促进困倦，减少焦虑 | PMC/9909225 |
| ASMR 低唤起内容频率集中在 50-500 Hz | ScienceDirect |
| ASMR 耳语的亚谐波 (<100 Hz) 刺激前庭系统促进放松 | PMC/9598278 |
| 60-80 BPM 节奏与心率同步，是助眠音乐关键指标 | Frontiers/Neurology |

### 音调与放松

- 低音调被感知为更平静、更可信
- 人工降调 -1 到 -2 半音是安全范围（subtle，不易察觉）
- 超过 -3 半音会产生"机器人感"
- **必须使用带共振峰保持的 pitch-shift 算法**（我们当前的 WSOLA + resample 方案不保持共振峰）

来源：[bioRxiv/2019.12.28.889907](https://www.biorxiv.org/content/10.1101/2019.12.28.889907v2.full)

### 响度标准

| 场景 | 目标 LUFS |
|------|----------|
| YouTube 原始内容 | -14 LUFS |
| 播客标准 (Apple) | -16 LUFS |
| 广播标准 (EBU R128) | -23 LUFS |
| 睡眠聆听推荐 | -20 到 -24 LUFS |

---

## 五、EQ 预设最佳实践

### Sleep EQ

| 频段 | 频率 | 增益 | 说明 |
|------|------|------|------|
| High-Pass | 80 Hz | 切除 | 去除低频隆隆声 |
| 低频 | 80-250 Hz | +2 到 +3 dB | 增加温暖感 |
| 中低频 | 250-500 Hz | -2 到 -3 dB | 减少浑浊 |
| 中频 | 500-2k Hz | 0 dB | 人声核心区 |
| 中高频 | 2-4 kHz | +1 到 +2 dB | 人声清晰度 |
| 高频 | 4-8 kHz | -2 到 -3 dB | 减少刺耳/齿音 |
| 超高频 | >8 kHz | -3 到 -6 dB | 使声音更柔和 |

### ASMR EQ

| 频段 | 频率 | 增益 | 说明 |
|------|------|------|------|
| 超低频 | <60 Hz | 0 dB | 保留亚谐波（不切！） |
| 低频 | 60-250 Hz | +3 到 +4 dB | 增强深层耳语 |
| 中高频 | 2-6 kHz | +2 到 +3 dB | 增强刷擦清脆感 |
| 高频 | >8 kHz | 0 dB | 保留 ASMR 细节 |

### Podcast 人声 EQ

| 频段 | 频率 | 增益 | 说明 |
|------|------|------|------|
| High-Pass | 80-100 Hz | 切除 | 无有用人声信息 |
| 中低频 | 200-600 Hz | -2 到 -4 dB | 减少浑浊 |
| 中高频 | 2-4 kHz | +2 到 +4 dB | 人声存在感 |
| 高频 | 6-8 kHz | +1 到 +2 dB | 空气感 |

来源：
- [audiblearray.com/asmr-equalizer-settings](https://audiblearray.com/asmr-equalizer-settings/)
- [podigy.co/podcasters-eq](https://www.podigy.co/podcasters-eq)

---

## 六、压缩与限制参数

### 压缩器推荐

| 参数 | Sleep | ASMR | Podcast | Music |
|------|-------|------|---------|-------|
| Ratio | 3:1 | 2:1 | 4:1 | 2:1 |
| Threshold | -20 dBFS | -18 dBFS | -24 dBFS | -18 dBFS |
| Attack | 20 ms | 30 ms | 15 ms | 30 ms |
| Release | 120 ms | 150 ms | 100 ms | 150 ms |
| Knee | 6 dB (Soft) | 6 dB | 6 dB | 6 dB |

### True Peak Limiter

| 参数 | 推荐值 |
|------|--------|
| Ceiling | -1.0 dBTP（睡眠场景可更保守 -2.0 dBTP） |
| Lookahead | 1-5 ms |
| Release | 50-100 ms |

### 三层防护架构

```
第一层: AGC (自动增益控制)   -- 慢速响应 1-3s，处理持续音量偏移
第二层: Compressor (压缩器) -- 中速响应 15-30ms，处理语音动态
第三层: Limiter (限制器)    -- 瞬时响应 + Lookahead，捕捉突发峰值
```

---

## 七、UX 设计参考

### 渐入渐出时长

| App | Fade-Out | 用户评价 |
|-----|----------|---------|
| 某些 App | 5 秒 | 太短，容易惊醒 |
| AntennaPod | 10 秒 | 用户反馈太快 |
| Audiobookshelf | 30 秒 | 较好 |
| Spotify | ~30 秒 | 较好 |

推荐：默认 60 秒，可选 30/60/120/300 秒，使用对数曲线。

### 用户感知阈值 (JND)

| 维度 | JND | 启示 |
|------|-----|------|
| 响度 | 1 dB | EQ 调整 <1 dB 用户感知不到 |
| 频率 | 0.5% | 1000Hz 处为 5Hz |
| 信噪比 | 3 dB | 处理效果需超过 3dB 才有感知 |
| EQ 变化 | 1-2 dB | 当前 EQ 设置需要达到 2-4 dB 才能被明显感知 |

---

## 八、用户反馈中的常见问题

| 问题 | 频率 | 说明 |
|------|------|------|
| YouTube 更新后扩展失效 | 较常见 | YouTube 前端变化导致无法找到 video 元素 |
| 音频延迟 | 较常见 | 启用处理后 0.1-0.2s 延迟 |
| 编解码器兼容 | 偶发 | 特定 avc1+mp4a.40.2 组合导致静音 |
| 帧率下降 | 偶发 | 音频处理导致视频掉帧（约 4-5 帧/10分钟） |
| 扩展被下架 | 较常见 | Google 封禁或项目废弃 |
| 音质劣化 | 偶发 | 更新后声音发薄/颤抖/变调 |

---

## 九、对我们产品的关键启示

### 当前 DSP 问题的根因分析

基于调研结果，对比我们当前代码，以下问题的原因已明确：

**1. Speed 无效**
- 根因：我们在 AudioWorklet 中自行实现 WSOLA 时间拉伸，但浏览器的音频渲染线程时间预算只有 ~2.7ms@48kHz（128 帧），WSOLA 的计算量在这个预算内可能来不及，导致输出全是零或原始数据
- 业界方案：**直接用 HTMLMediaElement.playbackRate**，Chromium 内置了高质量 WSOLA，质量和性能远超 JS 实现
- 来源：Georgia Tech WAC2016 论文明确指出 JS 实现的时间拉伸在浏览器中"数量少且多为实验性"

**2. Pitch 负数静音**
- 根因：负半音对应 pitchFactor < 1.0，WSOLA 拉伸器速度 < 1.0 意味着输出帧数多于输入帧数，resample buffer 填充不够快导致 underrun（读取位置超过可用数据）
- 业界方案：使用 Phase Vocoder 做变调（如 phaze 库），或直接用 playbackRate 调速后用 resampler 修正音调

**3. Speed + Pitch 电流音**
- 根因：两个 WSOLA 实例（stretcher + pitcher 内部的 stretcher）同时运行，共享有限的音频线程预算，导致 buffer underrun/overflow 和交互伪影
- 业界方案：Speed 用 playbackRate（原生），Pitch 用单独的 AudioWorklet 或 Phase Vocoder

**4. EQ 不明显**
- 根因：当前 Sleep EQ 高频衰减 -6 dB (highShelfGainDb)，但 JND 研究表明用户需要 2-4 dB 的变化才能明显感知。然而我们的 -6 dB 应该足够——更可能的原因是 EQ 节点串联在压缩器和限制器之后，响度归一化会补偿掉 EQ 造成的能量变化
- 建议：EQ 应放在响度测量和归一化之前，这样 EQ 的音色变化不会被归一化"撤销"

**5. 开启 Sleep Mode 响度变大**
- 根因：normalizer 目标是 -16 LUFS，但 YouTube 已经将视频归一化到 -14 LUFS。如果原始视频比 -16 LUFS 安静，normalizer 会提升增益。加上压缩器减小动态范围，感知响度会进一步上升
- 建议：睡眠模式目标 LUFS 应设为 -20 到 -24（比正常聆听低 4-8 LU）

### 推荐的修复方向

| 问题 | 方案 | 难度 |
|------|------|------|
| Speed | 改用 video.playbackRate（Chromium 原生 WSOLA） | 低 |
| Pitch | 简化为微调（-2 到 +2 半音），优化 resample buffer 管理 | 中 |
| Speed+Pitch | Speed 用 playbackRate，Pitch 用 AudioWorklet，两者解耦 | 中 |
| EQ 不明显 | 调整 DSP 链路顺序：EQ 放在归一化之前 | 低 |
| 响度变大 | Sleep 预设 targetLufs 从 -16 改为 -22 | 低 |

### 未来功能优先级

| 功能 | 优先级 | 理由 |
|------|--------|------|
| Sleep Timer + Fade Out | P0 | 所有竞品都有，用户期望的基本功能 |
| 响度归一化优化 | P0 | 核心价值，参数需要调对 |
| EQ 预设优化 | P1 | 参考科学研究调整参数 |
| 定时渐慢 (gradual slowdown) | P2 | 创新功能，逐渐降低播放速度 |
| 环境音混合层 | P3 | 可选叠加白噪/棕噪 |

---

## 十、参考来源汇总

### 学术研究
- [Effect of music of specific frequency upon sleep architecture (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6924256/)
- [ASMR amplifies low frequency oscillations (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0010945222000119)
- [Sound Quality Factors Inducing ASMR (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9598278/)
- [Meta-narrative review: music therapy and sleep (Frontiers)](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2024.1433592/full)
- [Georgia Tech WAC2016 - Time stretching in browser](https://repository.gatech.edu/handle/1853/54587)

### 技术文档
- [Chrome tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome Offscreen Documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Audio Worklet](https://developer.chrome.com/blog/audio-worklet)
- [Chrome Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)
- [MDN Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Web Audio Performance Notes](https://padenot.github.io/web-audio-perf/)

### 竞品分析
- [Overcast Voice Boost 2](https://marco.org/2020/01/31/voiceboost2)
- [YouTube Volume Normalizer](https://github.com/Kelvin-Ng/youtube-volume-normalizer)
- [Equalizer Plus (开源)](https://github.com/NikoSardas/Equalizer-Plus)
- [phaze - AudioWorklet Pitch Shifting](https://github.com/olvb/phaze)
- [Superpowered Web Audio WASM SDK](https://superpowered.com/js-wasm-overview)

### UX/音频科学
- [Podcast Loudness Standard](https://async.com/blog/podcast-loudness-standard/)
- [EBU R128](https://en.wikipedia.org/wiki/EBU_R_128)
- [Dark Mode UI Best Practices](https://blog.logrocket.com/ux-design/dark-mode-ui-design-best-practices-and-examples/)
- [Just Noticeable Difference](https://en.wikipedia.org/wiki/Just-noticeable_difference)

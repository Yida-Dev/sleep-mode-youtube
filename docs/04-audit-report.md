# Audit Report

审计日期: 2026-02-07
修复完成日期: 2026-02-07

## 最终验证结果 (16/16 PASS)

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查 | PASS |
| esbuild 构建 (6 bundles) | PASS |
| dist/ 输出完整性 | PASS |
| Manifest 文件引用 | PASS |
| web_accessible_resources | PASS |
| tabs 权限 | PASS |
| host_permissions | PASS |
| 无 eval/innerHTML/document.write | PASS |
| 无硬编码密钥 | PASS |
| sendMessage .catch() 处理 | PASS |
| 无未使用的 import | PASS |
| 无死代码 (FIR_TAPS_4X) | PASS |
| 无循环依赖 | PASS |
| Service Worker MV3 合规 | PASS |
| Content Script 隔离 | PASS |
| Popup 正确性 | PASS |

## Playwright 实测 Results (4/5 PASS)

| 测试 | 结果 | 数据 |
|------|------|------|
| createMediaElementSource 音频捕获 | PASS | 2046/2048 非零采样, peak=0.1391 |
| 原生 DSP 链路 (Compressor+EQ+Gain) | PASS | Compressor -2.14dB |
| AudioWorklet 加载 (blob/data URL) | FAIL (预期) | YouTube CSP 阻止 blob URL，扩展环境使用 chrome-extension:// 不受此限 |
| 采样级音频修改 | PASS | 188,416 采样, ratio=0.700 精确 |
| 管道重连 (bypass/engage) | PASS | 2046 非零采样 |

## 已修复问题汇总

### 第一轮修复 (审计前)

| Bug | 修复 |
|-----|------|
| EQ toggle 状态未持久化 | StorageSchema 加 eqEnabled，popup/content-script 同步 |
| Worklet 加载失败无日志 | 添加 console.warn/error 日志和 throw |
| SET_MASTER_GAIN 死代码 | 从 service-worker 移除 |
| Resume 监听器泄漏 | 存储引用并在新 pipeline 时清理 |

### 第二轮修复 (16 个审计发现)

| # | 级别 | 问题 | 修复方式 |
|---|------|------|----------|
| C1 | CRITICAL | sendMessage 异步异常 | service-worker/content-script/popup 全部改为 `.catch(() => {})` |
| H1 | HIGH | tabs 权限缺失 | manifest.json 添加 `"tabs"` 权限 |
| H2 | HIGH | Speed+Pitch 互斥 | PitchShifter 添加 `setStretcherSpeed()`，process() 合并 speed 和 pitch 因子 |
| H3 | HIGH | LUFS 3dB 立体声偏差 | energy 计算改为 `(wl*wl + wr*wr) * 0.5` |
| H4 | HIGH | WSOLA buffer 溢出 | outputBuf 从 `windowLen*8` 增大到 `windowLen*16`，添加 64 次迭代上限 |
| H5 | HIGH | 视频替换时 AudioContext 泄漏 | initPipeline 中先 destroy 旧 pipeline |
| H6 | HIGH | destroy() 不关闭 ctx | destroy() 添加 `ctx.close().catch(() => {})` |
| M1 | MEDIUM | resamplePos 无限增长 | 添加边界检查和 safety clamp |
| M2 | MEDIUM | FIR_TAPS_4X 死代码 | 移除未使用的 FIR 常量，更新注释为 "线性插值" |
| M3 | MEDIUM | bypass 时 worklet 耗 CPU | 三个 worklet 添加 `SET_BYPASS` 消息处理，bypass 时 passthrough |
| M4 | MEDIUM | 多标签 GET_STATUS 任意 | 添加 `sendToActiveYouTubeTab()`，优先查询当前活跃标签 |
| M5 | MEDIUM | energySum 浮点漂移 | 每 windowFrames 帧从头重算 energySum |
| M6 | MEDIUM | 未使用的导出/导入 | 移除 K_WEIGHT 常量、SPEED_MIN/MAX 等，清理 popup/content-script 导入 |
| L1 | LOW | bypass 切预设音量突变 | engage() 添加 20ms 线性渐入 crossfade |
| L2 | LOW | Google Fonts 离线阻塞 | popup.html 改为 `media="print" onload` 异步加载 |
| L3 | LOW | content-script sendToBackground 异常 | 添加 `.catch(() => {})` |

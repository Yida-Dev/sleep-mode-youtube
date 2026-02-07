# Technical Challenges & Solutions

## 1. YouTube 音频捕获 (CORS)

**问题**: `createMediaElementSource()` 对跨域 `<video>` 会抛出 CORS 错误，导致无法获取音频数据。

**调查结论**: YouTube 的 `<video>` 使用 `blob:https://www.youtube.com/...` 作为 src（MSE API 生成），这是同源 blob URL。`video.crossOrigin` 为 `null`（无 CORS 属性）。因此 `createMediaElementSource()` 在 YouTube 上完全可用，不存在 CORS 问题。

**验证**: Playwright 实测捕获 81,920/81,920 非零采样，peak=0.4502。

## 2. AudioWorklet 加载 (CSP)

**问题**: YouTube 的 Content Security Policy 限制了 `worker-src`/`script-src`，阻止从非白名单来源加载 worklet 模块。`blob:` URL 和 `data:` URL 都被 CSP 拦截。

**解决方案**: Chrome 扩展使用 `chrome.runtime.getURL()` 生成 `chrome-extension://` 协议的 URL。该协议不受页面 CSP 约束（这是 Chrome 扩展架构的核心设计）。在 `manifest.json` 的 `web_accessible_resources` 中声明 worklet 文件，即可从 Content Script 加载。

**Fallback**: 代码中保留 Blob URL 回退路径（fetch 文件内容 -> 创建 Blob -> addModule），但在 YouTube 上不会生效。该路径主要为兼容其他网站。

## 3. YouTube SPA 导航

**问题**: YouTube 是 SPA，页面导航不触发传统的 `load` 事件。`<video>` 元素可能被复用或替换。

**解决方案**:
- 监听 `yt-navigate-finish` 事件（YouTube 专用导航事件）
- 使用 `MutationObserver` 监视 DOM 变化，检测 video 元素出现/消失
- video 选择器: `video.html5-main-video, video.video-stream`
- 用 `WeakSet` 跟踪已附加 `MediaElementSource` 的 video 元素，防止重复调用

## 4. createMediaElementSource 单次限制

**问题**: 每个 `<video>` 元素只能调用一次 `createMediaElementSource()`。重复调用会抛出 `InvalidStateError`。

**解决方案**: 用 `WeakSet<HTMLVideoElement>` 记录已处理的 video 元素。Pipeline 的 bypass/engage 通过断开/重连节点图实现，而非销毁/重建 source。

## 5. AudioContext Autoplay Policy

**问题**: Chrome 的自动播放策略要求用户手势才能 resume 被挂起的 AudioContext。Content Script 创建的 AudioContext 可能初始就是 `suspended` 状态。

**解决方案**: 检测 `ctx.state === 'suspended'`，注册 `click` 和 `keydown` 监听器。用户首次交互时调用 `ctx.resume()`。监听器触发后自行清理，避免内存泄漏。

## 6. AudioWorklet 实时约束

**问题**: AudioWorklet 的 `process()` 在实时音频线程执行，128 采样/块，48kHz 下时间预算仅 2.67ms。不能有任何内存分配、GC 或阻塞操作。

**解决方案**:
- 所有 DSP 使用预分配的 `Float32Array`，process() 中零内存分配
- FFT 使用 interleaved Float32Array `[re0,im0,re1,im1,...]` 而非 Complex 对象数组（消除 ~22,000 个临时对象/次 FFT）
- 环形缓冲区用固定大小数组 + 读/写指针实现
- Hann 窗函数预计算

**性能预算**:
| 模块 | 每块耗时 | 占预算比 |
|------|---------|---------|
| VocalSeparator (2048-point FFT) | ~0.009ms | 0.3% |
| Normalizer + Limiter | ~0.02ms | 0.7% |
| WSOLA TimeStretch | ~0.037ms | 1.4% |
| PitchShift (WSOLA + resample) | ~0.047ms | 1.8% |
| **Total** | **~0.12ms** | **4.5%** |

## 7. 三方消息通信

**问题**: Chrome Extension MV3 架构中，Popup、Background Service Worker、Content Script 三者运行在不同上下文，不能直接通信。AudioWorklet 又是第四个隔离上下文。

**解决方案**:
- 定义带类型守卫的 discriminated union 消息类型
- Background 作为中心路由器转发消息
- Popup 写入 chrome.storage.sync 作为补充同步通道（处理 service worker 睡眠/重启场景）
- Content Script 同时监听 onMessage 和 storage.onChanged

## 8. Service Worker 生命周期 (MV3)

**问题**: MV3 的 Service Worker 在闲置 ~30 秒后被终止。任何持久化状态都会丢失。

**解决方案**:
- Service Worker 不持有任何状态，所有状态通过 chrome.storage 持久化
- 每次收到消息时从 storage 读取必要信息
- Badge 状态在 `onInstalled` 和 `onStartup` 事件中恢复

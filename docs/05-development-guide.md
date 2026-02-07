# Development Guide

## 环境要求

- Node.js >= 18
- npm
- Chrome 浏览器 (Manifest V3 需要 Chrome 88+)

## 安装依赖

```bash
cd sleep-mode-extension
npm install
```

## 构建

```bash
# 一次性构建（minified，无 sourcemap）
npm run build

# 开发模式（watch，inline sourcemap）
npm run dev

# 类型检查
npm run typecheck

# 清理构建产物
npm run clean
```

### 构建产物

构建脚本 (`build.config.ts`) 使用 esbuild 生成 6 个 bundle:

| 入口文件 | 输出 | 格式 | 说明 |
|----------|------|------|------|
| background/service-worker.ts | dist/background/service-worker.js | ESM | MV3 Service Worker |
| content/content-script.ts | dist/content/content-script.js | IIFE | Content Script 不支持 ESM |
| worklet/sleep-processor.ts | dist/worklet/sleep-processor.js | IIFE | AudioWorklet 不支持 ESM |
| worklet/dsp-processor.ts | dist/worklet/dsp-processor.js | IIFE | AudioWorklet 不支持 ESM |
| worklet/vocal-processor.ts | dist/worklet/vocal-processor.js | IIFE | AudioWorklet 不支持 ESM |
| popup/popup.ts | dist/popup/popup.js | IIFE | Popup 页面脚本 |

构建同时复制 `popup.html` 和 `popup.css` 到 dist/popup/，并生成占位图标到 assets/icons/。

## 加载扩展到 Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角 **Developer mode**
3. 点击 **Load unpacked**
4. 选择 `sleep-mode-extension/` 根目录（不是 dist/）
5. 扩展图标出现在工具栏

修改代码后:
1. 运行 `npm run build`（或保持 `npm run dev` 运行中）
2. 在 `chrome://extensions/` 点击扩展卡片上的刷新按钮
3. 如果修改了 Content Script，需要刷新 YouTube 页面

## 调试

### Content Script

1. 打开 YouTube 页面
2. DevTools (F12) > Console
3. 日志带 `[Sleep Mode]` 前缀

### AudioWorklet

1. DevTools > Sources
2. 左侧面板可看到 AudioWorklet 线程
3. 可在 worklet 代码中设置断点

### Background Service Worker

1. `chrome://extensions/` > 扩展卡片 > "Service Worker" 链接
2. 打开独立的 DevTools 窗口

### Popup

1. 右键扩展图标 > "Inspect Popup"
2. 打开 Popup 专用的 DevTools

## 项目结构

```
sleep-mode-extension/
  manifest.json                     # MV3 manifest
  package.json
  tsconfig.json
  build.config.ts                   # esbuild 构建脚本
  assets/icons/                     # 扩展图标
  docs/                             # 项目文档
  src/
    background/
      service-worker.ts             # 消息路由、Badge、生命周期
    content/
      content-script.ts             # 入口：YouTube DOM 交互、管道生命周期
      audio-pipeline.ts             # Web Audio 节点图构建与控制
      youtube-observer.ts           # SPA 导航检测 (MutationObserver)
    popup/
      popup.html                    # 控制面板 HTML
      popup.css                     # 控制面板样式
      popup.ts                      # 控制面板逻辑
    worklet/
      sleep-processor.ts            # LUFS 归一化 + 前瞻限制 + 真峰值限制
      dsp-processor.ts              # WSOLA 时间拉伸 + 音高变换
      vocal-processor.ts            # FFT + STFT 人声分离
    shared/
      types.ts                      # 共享类型定义
      constants.ts                  # 预设参数、默认值
      messages.ts                   # 消息协议类型
      storage.ts                    # chrome.storage 读写封装
  dist/                             # 构建产物（git ignore）
```

## 测试

### Playwright 自动化测试

使用 Playwright 在真实 YouTube 页面上测试:

1. `createMediaElementSource` 音频捕获 — 验证可从 YouTube video 元素获取非零音频采样
2. 原生 DSP 链路 — 验证 Compressor + EQ + Gain 节点正常工作
3. AudioWorklet 加载 — 验证 `chrome-extension://` URL 可绕过 CSP
4. 采样级音频修改 — 验证 DSP 实际修改了音频数据
5. 管道重连 — 验证 bypass/engage 切换后音频恢复

### 手动测试 Checklist

- [ ] 打开 YouTube 视频，点击扩展图标开启
- [ ] Popup 显示 LUFS 和 Gain Reduction 实时数据
- [ ] 切换 4 个预设，音频效果有明显差异
- [ ] 调节音量滑块，音量平滑变化
- [ ] 开关 EQ，频率响应变化可感知
- [ ] 调节播放速度（0.5x ~ 2.0x），播放速度变化音调不变
- [ ] 调节音调（-12 ~ +12 半音），音调变化速度不变
- [ ] 开关人声增强，人声/背景音乐比例变化
- [ ] YouTube SPA 导航（点击其他视频），音频处理持续工作
- [ ] 关闭 Popup 再打开，状态正确恢复
- [ ] 多标签页打开 YouTube，独立工作

## 已知限制

详见 [04-audit-report.md](./04-audit-report.md) 中的 Known Issues 部分。

关键待修复项:
- service-worker sendMessage 异步异常需加 `.catch()`
- manifest 缺少 `tabs` 权限
- Speed + Pitch 同时使用时 speed 被丢弃
- 视频元素替换时 AudioContext 泄漏

## 发布

1. 确认 `npm run typecheck` 零错误
2. 运行 `npm run build` 生成 production 产物
3. 替换 `assets/icons/` 中的占位图标为正式设计图标
4. 在 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) 上传整个项目目录的 zip 包
5. 填写商店描述、截图等信息
6. 提交审核

# 端到端测试流程

## 准备

1. `npm run build`
2. Chrome 打开 `chrome://extensions/` > Developer mode > Load unpacked > 选择项目根目录
3. 使用以下测试视频：

### 测试用例 URL

| URL | 类型 | 推荐预设 | 验证重点 |
|-----|------|---------|---------|
| https://www.youtube.com/watch?v=6_PI1l5NKL8 | 常规视频（前 2 分钟） | Sleep / Podcast | LUFS 标准化、压缩器、EQ |
| https://www.youtube.com/watch?v=7ARBJQn6QkM | 常规视频（前 2 分钟） | Sleep / Podcast | 人声增强、音量平滑 |
| https://youtube.com/shorts/l7dIb1-Aymk | Shorts 竖屏短视频 | Sleep | Shorts 页面兼容性、视频元素识别 |
| https://youtube.com/shorts/Th12tPRHX5s | Shorts 竖屏短视频 | ASMR / Noise | Shorts 页面兼容性、预设切换 |

## 测试清单

### 1. 基础开关

- [ ] 点击扩展图标，弹出 Popup
- [ ] 点击月亮按钮开启 Sleep Mode
- [ ] Badge 显示 "ON"
- [ ] 状态指示灯变绿 "Processing"
- [ ] 再次点击关闭，Badge 消失，状态回 "Standby"

### 2. 预设切换

- [ ] 依次点击 Sleep / ASMR / Podcast / Noise 四个预设卡片
- [ ] 每次切换音质有可感知差异
- [ ] 切换到 Podcast 时 EQ 自动关闭
- [ ] 切换回 Sleep 时 EQ 自动开启

### 3. 实时数据

- [ ] 开启后 LUFS 显示实时数值（约 -16 附近）
- [ ] Gain Reduction 显示非零值（说明限制器在工作）
- [ ] 关闭后 LUFS 和 GR 显示 "--"

### 4. Speed 滑块

- [ ] 拖到 0.5x，播放明显变慢，音调不变
- [ ] 拖到 2.0x，播放明显变快，音调不变
- [ ] 拖回 1.0x，恢复正常

### 5. Pitch 滑块

- [ ] 拖到 +12，声音升高一个八度
- [ ] 拖到 -12，声音降低一个八度
- [ ] 拖回 0，恢复正常

### 6. Speed + Pitch 同时

- [ ] Speed 设 0.8x，Pitch 设 +3
- [ ] 播放变慢且音调升高，两者同时生效

### 7. 人声增强

- [ ] 开启 Vocal Enhance
- [ ] 人声变清晰，背景音乐变弱
- [ ] 关闭后恢复

### 8. EQ 开关

- [ ] 关闭 Sleep EQ，高频变亮
- [ ] 开启后高频变柔和

### 9. SPA 导航

- [ ] 保持 Sleep Mode 开启
- [ ] 点击 YouTube 侧边栏推荐视频跳转
- [ ] 音频处理持续工作（不中断、不报错）
- [ ] Popup 显示的状态正确

### 10. 状态持久化

- [ ] 开启 Sleep Mode，切到 ASMR 预设
- [ ] 关闭 Popup，重新打开
- [ ] 预设仍是 ASMR，状态仍是开启
- [ ] 关闭标签页，打开新 YouTube 视频
- [ ] Popup 记住上次的设置

## 异常场景

- [ ] 非 YouTube 页面点击扩展：Popup 正常显示但数据为 "--"
- [ ] 同时打开 2 个 YouTube 标签：各自独立工作
- [ ] 视频暂停时开关 Sleep Mode：无报错
- [ ] 快速连续切换预设 10 次：无崩溃

### 11. YouTube Shorts 兼容性

- [ ] 打开 https://youtube.com/shorts/l7dIb1-Aymk
- [ ] 开启 Sleep Mode，Popup 显示 "Processing"
- [ ] LUFS 和 Gain Reduction 显示实时数值
- [ ] 切换预设（Sleep -> ASMR -> Podcast），音质有可感知差异
- [ ] 上下滑动切换不同 Shorts，音频处理持续工作
- [ ] 从 Shorts 页面点击常规视频链接，管线不中断

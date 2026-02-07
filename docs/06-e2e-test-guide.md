# 端到端测试流程

## 准备

1. `npm run build`
2. Chrome 打开 `chrome://extensions/` > Developer mode > Load unpacked > 选择项目根目录
3. 打开任意 YouTube 视频页面

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

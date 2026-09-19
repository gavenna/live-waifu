# Computer Use 集成方案 — war-vote 直播互动系统

> 本文档从调研结论提炼为可执行方案，供开发会话直接使用。

## 一、目标

在 war-vote 现有链路（弹幕→投票→地图生成→启动游戏）基础上，补齐最后两步：

```
弹幕采集 ✅ → 投票 ✅ → 地图生成 ✅ → 打开游戏 ✅
→ 【游戏内选模式/选地图/开始】❌ → 【直播伴侣切场景】❌
```

## 二、核心原则：一次探索，永久免费

| 层级 | 何时用 | 花费 |
|------|--------|------|
| 脚本硬编码（百分比坐标） | 菜单位置固定后，日常执行 | 免费 |
| UIA 元素索引 | 直播伴侣等标准控件 | 免费 |
| AI 视觉识别 | 仅首次探索 + 异常回退 | 花 token |

**不要在日常流程中调 AI 识别。首次用 AI 摸清布局，之后全部固化成脚本。**

## 三、两个任务

### 任务 1：Rusted Warfare 游戏内自动操作

**难点：** Java AWT 游戏，UI 是自己画的像素，Windows UIA 无障碍树识别不了。
**方案：** 纯视觉探索 → 固化百分比坐标脚本。

#### 3.1 首次探索流程（花 token，只做一次）

```
前置：游戏以窗口模式启动（固定分辨率，如 1024×768）

Step 1: 打开游戏，停在主菜单
  → capture（纯视觉截图）
  → AI 识别：Skirmish / Single Player 按钮的相对坐标 (x%, y%)

Step 2: 点击 Skirmish，等待进入
  → capture
  → AI 识别：地图列表位置、目标地图坐标

Step 3: 选择地图
  → capture
  → AI 识别：Start / Play 按钮坐标

Step 4: 点击 Start
  → capture
  → AI 识别：确认游戏画面已开始（看到地图、单位等）

每一步记录：截图路径 + 操作 + 坐标（百分比）
```

#### 3.2 固化成脚本（免费）

探索完成后，将坐标写入配置文件：

```javascript
// war-vote/server/gameSteps.js
// 所有坐标都是相对窗口的百分比 (0.0 ~ 1.0)

module.exports = {
  // 游戏窗口要求
  window: {
    width: 1024,
    height: 768,
    mode: 'windowed'  // 必须窗口模式，不能全屏
  },

  // 操作步骤（按顺序执行）
  steps: [
    // --- 主菜单 ---
    { action: 'click', x: 0.45, y: 0.60, label: 'Skirmish', wait: 2000 },

    // --- 地图选择 ---
    { action: 'click', x: 0.30, y: 0.40, label: '目标地图', wait: 1000 },

    // --- 开始游戏 ---
    { action: 'click', x: 0.85, y: 0.90, label: 'Start Game', wait: 3000 },

    // --- 验证 ---
    { action: 'verify', label: '确认游戏画面正常' }  // 仅此步可能需要AI
  ],

  // 坐标容差（百分比），点击时 ±tolerance 范围随机偏移，模拟人类
  tolerance: 0.02
}
```

> **注意：** 以上坐标是示例，首次探索后替换为真实值。

#### 3.3 执行引擎（免费，不调 AI）

```javascript
// war-vote/server/gameAutomation.js
const { execSync } = require('child_process')

async function executeGameSteps(steps, windowInfo) {
  for (const step of steps) {
    if (step.action === 'click') {
      // 百分比 → 实际像素
      const x = Math.round(windowInfo.x + windowInfo.width * step.x)
      const y = Math.round(windowInfo.y + windowInfo.height * step.y)

      // 容差内随机偏移
      const dx = (Math.random() - 0.5) * 2 * (step.tolerance || 0.02) * windowInfo.width
      const dy = (Math.random() - 0.5) * 2 * (step.tolerance || 0.02) * windowInfo.height

      // 通过 Hermes computer_use 或直接用 robotjs/nutjs 点击
      await clickAt(x + dx, y + dy)

      if (step.wait) await sleep(step.wait)
    }

    if (step.action === 'verify') {
      // 只有验证步骤才考虑用 AI，或者用更简单的像素采样
      const ok = await verifyGameRunning()
      if (!ok) throw new Error('游戏未正常启动，需要人工介入或回退 AI 识别')
    }
  }
}
```

#### 3.4 点击方式选择

| 方案 | 依赖 | 是否需要前台 | 推荐度 |
|------|------|-------------|--------|
| Hermes computer_use | cua-driver | 短暂前台（foreground） | ⭐⭐⭐ 先用这个跑通 |
| robotjs / nutjs | npm 包 | 是 | ⭐⭐ 后续可替换 |
| PowerShell SendInput | 系统自带 | 是 | ⭐ 兜底 |

**建议：先用 Hermes computer_use 跑通流程，后续替换成轻量方案（robotjs/nutjs）脱离 Hermes 依赖。**

#### 3.5 窗口管理

```javascript
// 启动游戏时强制窗口模式 + 固定大小
const gameProcess = spawn('java', [
  '-Dsun.java2d.d3d=false',    // 禁用 Direct3D，避免 Intel 驱动崩溃
  '-jar', 'Rusted Warfare.exe',
  '-w', '1024',                 // 窗口宽度
  '-h', '768',                  // 窗口高度
  '--windowed'                  // 窗口模式
])

// 记录窗口位置（后续点击坐标需要）
// 可用 PowerShell Get-WindowRect 或 Win32 API
```

### 任务 2：抖音直播伴侣切场景

**简单：** Electron 应用，UIA 树完整，元素索引直接命中。

#### 3.6 操作流程（全程免费）

```javascript
// 用 Hermes computer_use 的 UIA 模式，不花 token

async function switchLiveScene(sceneName) {
  // 1. 获取直播伴侣的 UIA 元素树
  const capture = await computerUse({
    action: 'capture',
    mode: 'som',           // 截图 + 元素编号
    app: '抖音直播伴侣'
  })

  // 2. 在元素列表中找到目标场景按钮
  const targetElement = capture.elements.find(
    el => el.label.includes(sceneName)  // 如 "游戏画面"
  )

  // 3. 点击（后台模式，不抢焦点）
  await computerUse({
    action: 'click',
    element: targetElement.index
  })
}
```

> **首次需要确认场景名称：** 先跑一次 `capture(app="抖音直播伴侣")` 看看元素列表里场景叫什么名字，之后硬编码。

## 四、集成到 war-vote

### 4.1 触发时机

```
war-vote 倒计时结束
  → 生成地图文件
  → 启动游戏（已有逻辑）
  → 【新增】执行 gameSteps.js 自动化操作
  → 【新增】验证游戏画面正常
  → 【新增】调用 switchLiveScene('游戏画面')
```

### 4.2 建议的代码位置

```
war-vote/server/
├── index.js              ← 现有主服务
├── voteEngine.js         ← 现有投票引擎
├── gameSteps.js          ← 【新增】游戏操控坐标配置
├── gameAutomation.js     ← 【新增】游戏自动化执行引擎
├── liveSceneSwitch.js    ← 【新增】直播伴侣切场景
└── config.js             ← 现有配置
```

### 4.3 集成点（在 index.js 中）

```javascript
// 投票结束后的现有逻辑中，加入：
const { executeGameSteps } = require('./gameAutomation')
const { switchLiveScene } = require('./liveSceneSwitch')

// ... 现有：生成地图、启动游戏 ...

// 新增：等待游戏窗口出现
await waitForGameWindow(5000)

// 新增：自动操作游戏
await executeGameSteps(gameSteps.steps, gameSteps.window)

// 新增：确认游戏画面后切场景
await switchLiveScene('游戏画面')
```

## 五、技术风险

| 风险 | 等级 | 应对 |
|------|------|------|
| 游戏 UIA 不可用 | ✅ 已确认 | 用纯视觉+坐标方案 |
| 游戏菜单布局随版本变化 | 🟡 中 | 坐标配置外置，修改不需要改代码 |
| 游戏启动慢，截图时还没加载完 | 🟡 中 | 每步操作后加 wait + 重试机制 |
| 直播伴侣 UIA 元素名变化 | 🟢 低 | Electron 应用，控件名稳定 |
| Intel GPU 崩溃 | 🔴 已知 | `-Dsun.java2d.d3d=false` 禁用硬件加速 |
| 坐标偏移导致点错 | 🟡 中 | 每步操作后 capture 验证，异常时回退 AI |

## 六、实施步骤

| 步骤 | 内容 | 预计耗时 |
|------|------|----------|
| **Step 1** | 用 Hermes computer_use 手动操控游戏主菜单，摸清布局 | 30 分钟 |
| **Step 2** | 把坐标写入 gameSteps.js | 10 分钟 |
| **Step 3** | 写 gameAutomation.js 执行引擎 | 1 小时 |
| **Step 4** | 首次 capture 直播伴侣，确认场景元素名 | 10 分钟 |
| **Step 5** | 写 liveSceneSwitch.js | 30 分钟 |
| **Step 6** | 集成到 war-vote 的 index.js | 30 分钟 |
| **Step 7** | 端到端测试一轮 | 30 分钟 |

## 七、首次探索 Checklist

在另一个会话中执行（用 Hermes computer_use）：

```
□ 1. 以窗口模式启动 Rusted Warfare (1024×768)
□ 2. capture 主菜单 → 记录 Skirmish 坐标
□ 3. 点击 Skirmish → capture → 记录地图选择坐标
□ 4. 选择地图 → capture → 记录 Start 按钮坐标
□ 5. 点击 Start → capture → 确认游戏画面
□ 6. 把所有坐标更新到 gameSteps.js
□ 7. capture 直播伴侣 → 记录场景列表元素索引
□ 8. 写入 liveSceneSwitch.js
```

---

*文档生成时间：2026-09-13*
*来源：Hermes 会话 20260913_201423_7d8db7（Computer Use 调研）*
*目标：Hermes 会话 20260913_184801_577104（war-vote 功能调通）*

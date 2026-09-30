# waifu-agent

> 桌面 Live2D 角色 + AI Agent 后端 — 给 Agent 一张脸，一个有表情、有声音的桌面伙伴。

waifu-agent 是一个基于 **Tauri 2** 的桌面应用，用 Live2D 动漫角色为 AI Agent 提供可视化形象。
不是会聊天的桌宠 — 是让 Agent 拥有表情、语音和存在感的体验层。

## 核心理念

- **不是会聊天的桌宠** — 是给 Agent 一张脸
- **角色即品牌** — 每个角色有自己的个性、语气、表情和语音
- **状态可视化** — agent 思考/说话/空闲一目了然
- **跨平台桌面** — Windows / Linux，透明无框悬浮窗

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Tauri 2 (Rust + WebView) |
| 前端 | React 18 + TypeScript + Vite 5 |
| 角色渲染 | Pixi.js 7 + pixi-live2d-display (Cubism 4) |
| AI 后端 | Hermes Agent (深度模式) + OpenAI 兼容 API (快速模式) |
| 通信 | WebSocket (端口 9191) |
| 语音 | edge-tts (微软神经网络 TTS) + ffplay 播放 |

## 快速开始

### 前置依赖

- **Node.js** ≥ 18 (推荐 scoop: `scoop install nodejs-lts`)
- **Rust** (推荐 scoop: `scoop install rustup-msvc`)
- **Python 3** (推荐 scoop: `scoop install python`)
- **ffmpeg** (推荐 scoop: `scoop install ffmpeg`)
- **Python 包:** `pip install edge-tts websockets`

### 安装与运行

```bash
# 1. 克隆项目
git clone <repo-url> waifu-agent
cd waifu-agent

# 2. 安装 Node 依赖
npm install

# 3. 配置 LLM (快速模式)
cp llm_config.example.json llm_config.json
# 编辑 llm_config.json，填入 API 地址和密钥

# 4. 启动开发模式
npx tauri dev
# 或直接用 node_modules 路径:
./node_modules/.bin/tauri dev
```

### 构建生产版本

```bash
npm run tauri build
# 输出在 src-tauri/target/release/
```

## 项目结构

```
waifu-agent/
├── src/                        # React 前端
│   ├── main.tsx                # 入口
│   ├── App.tsx                 # Live2D 渲染 + 窗口管理
│   ├── persona.config.ts       # 角色预设 (7 套)
│   └── components/
│       ├── ChatUI.tsx          # 聊天面板 (快速/深度模式)
│       ├── TtsPlayer.tsx       # TTS 音频播放
│       ├── StatusIndicator.tsx  # Agent 状态指示器
│       └── DiagPanel.tsx       # 口型诊断面板
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口
│   │   ├── lib.rs              # Tauri 命令 (TTS/音频/聊天/记忆)
│   │   └── llm_client.rs       # OpenAI 兼容聊天适配器
│   └── tauri.conf.json         # 窗口/打包配置
├── hermes-plugin/              # Hermes Agent TTS 插件
│   ├── plugin.yaml
│   └── __init__.py             # WS 服务器 + TTS 生成
├── hermes-hook/                # Hermes Gateway 钩子
│   ├── HOOK.yaml
│   └── handler.py              # agent 状态推送 + TTS
├── scripts/
│   └── waifu-memory-distill.py # 记忆提炼脚本
├── public/
│   ├── cubism/                 # Live2D Cubism 4 SDK
│   └── live2d-models/          # Live2D 模型文件
│       ├── haru_greeter/       # Haru Greeter 模型
│       └── mao/                # Mao 模型 (当前默认)
├── llm_config.json             # LLM API 配置 (不入 git)
├── SOUL.md                     # 角色灵魂/系统提示
└── docs/                       # 文档
```

## 双模式聊天

### 快速模式 (Quick Chat)
- 直接调用 OpenAI 兼容 API (DeepSeek 等)
- 配置在 `llm_config.json`
- 适合日常对话、角色扮演
- TTS 通过 `quick_speak` 命令 (edge-tts)

### 深度模式 (Deep / Hermes)
- 通过 Hermes Agent CLI 调用
- 支持工具调用、长推理、多步任务
- 状态通过 WebSocket 实时推送到前端
- 需要安装 Hermes Agent

## 角色切换

编辑 `src/persona.config.ts`，修改 `ACTIVE_PERSONA`:

```ts
const ACTIVE_PERSONA = "mao";  // 可选: default | jarvis | yuanqi | sage | healer | lipsyncTest | mao
```

每个预设包含: Live2D 模型路径、角色缩放/位置、呼吸动画、口型同步、状态指示器样式、聊天面板外观。

## 配置说明

### llm_config.json (快速模式)
```json
{
  "api_url": "https://api.deepseek.com/v1/chat/completions",
  "api_key": "your-api-key",
  "model": "deepseek-v4-flash",
  "timeout_secs": 30
}
```

### SOUL.md
角色的系统提示，定义个性、语气、与主人的关系。快速模式会自动加载。

### 环境变量 (可选)
| 变量 | 说明 |
|------|------|
| `WAIFU_PYTHON` | Python 解释器路径 (默认: `python`) |
| `WAIFU_HERMES_PYTHON` | Hermes 专用 Python 路径 |

## 数据存储

所有数据存在 `~/.waifu-agent/` (Linux) 或 `%USERPROFILE%/.waifu-agent/` (Windows):

```
.waifu-agent/
├── conversations/      # 每日对话日志 (JSONL)
│   └── 2026-05-23.jsonl
├── memory/
│   └── thoughts.jsonl  # AI 蒸馏的角色记忆
└── window_pos.json     # 窗口位置持久化
```

## 许可证

MIT

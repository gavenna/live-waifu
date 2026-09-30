# CLAUDE.md — waifu-agent

> 桌面 Live2D 角色 + AI Agent 前端。Tauri 2 (Rust + React + PIXI.js + Cubism 4)。
> **一句话定位**: 不是会聊天的桌宠，是给 Agent 一张有表情有声音的脸。

## 命令

```bash
npm install                              # 首次装依赖
npm run tauri:dev                        # 开发调试 (dev 模式)
./node_modules/.bin/tsc --noEmit         # TS 类型检查
cd src-tauri && cargo check              # Rust 编译检查
```

构建模式由 `VITE_WAIFU_MODE` 环境变量 + `vite.config.ts` 注入。调试默认 `dev`，打包默认 `user`。详见 `package.json` scripts 和 `src/config/buildMode.ts`。

## 架构

三窗口系统: MainWindow (`main`) + SettingsWindow (`?view=settings`) + ChatWindow (`?view=chat`)。窗口间通过 Tauri events 通信，独立 `WebviewWindow`，不搞 overlay。

数据流: `用户输入 → LLM (SOUL+USER+MEMORY+history) → 响应 → TTS + 口型 + 贴图 + memory`

双 AI 模式: `builtin` (直连 DeepSeek API) / `relay` (WebSocket 9191 接外部 Agent)

设置: `app_data_dir()/settings.json` + 项目根 `llm_config.json`，启动时合并。

许可: 激活码模式 → Vercel API → 机器码绑定 → JWT → `license.dat` 本地缓存 30 天。

## 🚨 核心规则（Claude 最容易搞错的）

### 路径
- 静态资产 → `include_str!` / bundle.resources
- 运行时数据 → `app.path().app_data_dir()`（唯一合法根目录）
- ❌ 永远不用 `CARGO_MANIFEST_DIR`（打包后指向开发机）和 `home_dir()/.waifu-agent`

### React
- 无框窗口: 所有交互元素必须拦截 `onMouseDown` + `onMouseUp`，否则被拖拽吞掉
- async 用 generation counter，不用 boolean flag（StrictMode 双挂载会死锁）
- PIXI Canvas 用 `useWindowSize()` + 等比缩放，不写死 px
- UI 尺寸从 `persona.config.ts` 读，不硬编码
- `save_settings` 传完整对象，禁止 partial write
- useEffect listener 依赖用 ref，不用 useState

### Rust
- 新增 Tauri command: lib.rs 实现 → `invoke_handler![]` 注册 → 必要时更新 `capabilities/default.json`
- 错误不能 `unwrap_or_default()` / `match Err(_) => {}`
- 不要 `cargo clean`（target/ 约 28GB）
- 改功能前 `grep -rn` 全链路

### 通用
- 不能 `.catch(() => {})` 静默吞错误
- emit 方只发事件，listener 统一处理持久化
- 禁止贴膏药：修根因，不加 prompt 护栏掩盖症状
- 新增文本语法标记 → grep 所有清洗管线（Rust+TS 双端同步）
- **管道调试铁律**：涉及文本处理（TTS/LLM/贴图/清洗）的改动，先在首尾加 `log_debug` 看清数据再改逻辑。不让用户当测试机。
- `log(tag, ...)` 的 tag 必须在 `logConfig.ts` 的 `LOG_SWITCH` 里
- 重要信息必须沉淀到 `docs/`

### 日志文件位置

```
{app_data_dir}/waifu-agent.log      # 当前会话（主）
%TEMP%/waifu-agent.log              # 备份（内容相同）
{app_data_dir}/waifu-agent.prev.log # 上次会话
```

`app_data_dir` = `C:\Users\gaven\AppData\Roaming\com.waifu-agent.app\`

**用户复现 bug → 通知 Claude → Claude 自己读日志。不让用户贴日志。**

日志链路：`log(tag, msg)` → `console.log` → `main.tsx` patch → `invoke("frontend_log")` → Rust `log_debug()` → 双写上述两个文件。

### 关键文件
| 文件 | 改它时注意 |
|------|-----------|
| `src/App.tsx` | 最大文件，PIXI+settings+LLM+resize 全在这 |
| `src-tauri/src/lib.rs` | 所有 commands 注册点 |
| `src/types/settings.ts` | 新增字段同步更新 `getDefaultSettings()` 和 `mergeWithDefaults()` |
| `SOUL.md` | 角色系统提示，被 `llm_client.rs` 注入 |

## 工作方式

| 任务 | 怎么处理 |
|------|---------|
| 小改动（单文件、<50 行） | 直接做 |
| 复杂改动（跨文件、需参考规范） | + 相关 skill（/backend /frontend） |
| 隔离排查（追日志、全链路） | 调 `flow-debugger` agent |
| 标准流程（部署、审查） | 用 skill（/deploy /review /prompt /cubism） |
| Claude Code 功能 | 调 `claude-code-guide` |

### Agent（1 个）
| Agent | 用途 |
|-------|------|
| `flow-debugger` | 日志诊断（只查不修） |

### Skill（7 个）
| 命令 | 触发 |
|------|------|
| `/deploy` | "发布"/"构建" |
| `/review` | "审一下"/"体验" |
| `/verify` | "验证"/"检查改动" |
| `/prompt` | "调 prompt"/"对话质量" |
| `/cubism` | "角色"/"动画"/"表情" |
| `/backend` | 改 Rust 文件 |
| `/frontend` | 改 React 组件 |

## 环境

Windows 11 · scoop 包管理 · bash (Git Bash) · `python` 非 `python3` · `./node_modules/.bin/` 执行 Node 工具

## Hook 防护体系

Harness 四层 Hook 把关，把核心规则从"靠人记"变成"机器拦"。

| 层级 | Hook | 检查什么 | 失败后果 |
|------|------|---------|---------|
| PreToolUse | `check-catch-silence.py` | `.catch(() => {})` 静默吞错 | **阻断** exit 2 |
| PostToolUse | `validate-settings.py` | `settings.json` 关键字段被默认值覆盖 | 警告 exit 1 |
| PostToolUse | `check-tts-pipeline.py` | 新增 `[tag]` 语法时 TTS 管线同步 | 警告 exit 1 |
| Stop | `verify.sh` | git diff 检测 → 按文件类型跑 tsc/cargo check | **阻断** exit 2 |
| Stop | `waifu-speak.py` | 对话类回复 → edge-tts → waifu 朗读 | 静默容错 |

`verify.sh`（settings.json，进 git）负责编译验证；其余四个（settings.local.json，不进 git）负责代码质量 + 设置保护 + 朗读。

## 会话收尾

调 `/wrapup` skill — 代码 / 文档 / 未修复 bug / pycache 四步扫描。

## 偏好

- 全 inline styles，暗色半透明风，无 CSS 框架
- 不写 JSDoc，代码自解释
- 收尾时直接 commit（用户已验证过），不需要确认
- 手动肉眼验证，无自动化测试

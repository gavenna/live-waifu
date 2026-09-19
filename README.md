# live-waifu

虚拟主播直播互动套件 — 三个独立项目的整合工作区。组件之间通过 WebSocket 网络协议协作，各自保留独立 Git 仓库、独立构建与发布节奏。

> 📌 **接手继续开发/探索？先读 [`HANDOVER.md`](HANDOVER.md)**（2026-09-19 交接：运行现场、今天改了什么、怎么生效/回滚、已知缺陷与待办、红线与陷阱、验证门禁）。

## 目录结构

```
live-waifu/
├── start-all.ps1          # 统一启动器（菜单 / 参数 / 一键全启 / 停止）
├── waifu-agent/           # 桌面 Live2D 角色 + AI Agent（Tauri 2 / Rust + React + PIXI）
├── war-danmaku/           # 弹幕阵营对抗游戏（Node.js + Web Canvas）
└── danmaku-relay/         # B站/抖音弹幕中继（Node.js，可打包独立 exe）
```

## 系统架构

```
B站 / 抖音直播间
      ↓ 弹幕·礼物·进房
danmaku-relay
  :8766  WS 广播统一消息 ──────────────┐
  :8767  HTTP 控制面板（启停适配器）   │
      ↑ 跨进程调用 :8767 API           │
war-danmaku                           │
  relayClient 消费弹幕 → 游戏引擎      │
  :8765  WS+HTTP 游戏通信              │
  :3000  纯游戏画面（OBS 浏览器源）    │
  :8760  游戏工具箱                    │
      │ 游戏事件话术（TTS/情绪/动作）  │
      ↓ WS :9191                       │
waifu-agent                            │
  relay 模式接收 agent:* 消息 ─────────┘
  → 表情 + 动作 + TTS 口型的 Live2D 桌宠
  :1420 Vite 开发服务器（仅开发时）
```

> ⚠️ 上图为**历史（war-danmaku 时代）**示意。当前实际直播链路是：`danmaku-relay/battle` 直接驱动
> **真实 Rusted Warfare**（`war-danmaku` 已不在链路里）；waifu-agent 作为桌宠，由中继经 **:9191**
> 驱动播报游戏事件 / 观众对话。详见 [`docs/项目工作流.md`](docs/项目工作流.md) §10 与 [`HANDOVER.md`](HANDOVER.md)。

## 快速开始

```powershell
cd D:\Projects\live-waifu
.\start-all.ps1          # 菜单选择启动组件
.\start-all.ps1 -All     # 一键：中继 → 游戏 → 桌宠
.\start-all.ps1 -Stop    # 关闭全部并释放端口
```

直播标准启动顺序：**danmaku-relay（先在 :8767 面板开启直播平台适配器）→ war-danmaku → waifu-agent（relay 模式）**

### 单独开发（与整合前完全一致）

```powershell
# waifu-agent
cd waifu-agent; npm install; npm run tauri:dev

# war-danmaku
cd war-danmaku; npm run server      # 游戏服务端 :8765/:8760
npm run frontend                    # 画面 :3000

# danmaku-relay
cd danmaku-relay; node index.js --auto-start
```

## 端口表

| 端口 | 组件 | 协议 | 用途 |
|---|---|---|---|
| 8766 | danmaku-relay | WS | 弹幕统一消息广播（war-danmaku 订阅） |
| 8767 | danmaku-relay | HTTP | 控制面板 / 适配器启停 API |
| 1088 | douyinLive.exe | WS | 抖音弹幕代理（relay 拉起） |
| 8765 | war-danmaku | WS+HTTP | 游戏通信 |
| 3000 | war-danmaku | HTTP | 游戏画面（OBS 源） |
| 8760 | war-danmaku | HTTP | 游戏工具箱 |
| 9191 | waifu-agent | WS | Agent 中继（游戏话术 → 桌宠） |
| 1420 | waifu-agent | HTTP | Vite dev（仅开发） |

## 运行时数据

| 数据 | 位置 |
|---|---|
| 游戏 SQLite / 密钥 | `war-danmaku/data/`、`war-danmaku/server/secrets.json` |
| 中继密钥 / 日志 | `danmaku-relay/server/secrets.json`、`danmaku-relay/logs/` |
| 桌宠设置与日志 | `%AppData%/com.waifu-agent.app/`（系统目录，与项目位置无关） |

## 整合说明（相对原独立项目做了什么）

1. **复制而非移动**：`D:\Projects\` 下原 `waifu-agent`、`war-danmaku`、`danmaku-relay` 三个目录原样保留，可随时回滚。确认无误后可自行删除。
2. **代码零改动**：三个项目的运行只依赖 `__dirname` 相对路径和 localhost 网络端口，目录整体搬迁不影响运行。
3. **重建了两个 NTFS Junction**（Tauri 打包资源需要，原 junction 是绝对路径）：
   - `waifu-agent/src-tauri/scripts` → `waifu-agent/scripts`
   - `waifu-agent/src-tauri/waifu-memory` → `waifu-agent/waifu-memory`
4. **路径文本更新**：各项目 CLAUDE.md / docs / `.claude/settings.local.json` 中的 `D:\Projects\<项目>` 旧绝对路径已更新到新位置；`statusline.log` 等历史日志保留原样。
5. **Git**：三个仓库各自的历史、远程、未提交改动完整保留，父目录不建 Git 仓库。
6. **注意**：Rust 编译指纹含绝对路径，首次在新位置执行 `npm run tauri:dev` 时 cargo 可能触发增量重编，属正常现象。

## 各自文档

- [waifu-agent/CLAUDE.md](waifu-agent/CLAUDE.md)
- [war-danmaku/CLAUDE.md](war-danmaku/CLAUDE.md)
- [danmaku-relay/CLAUDE.md](danmaku-relay/CLAUDE.md)
- [danmaku-relay/docs/协议.md](danmaku-relay/docs/协议.md) — 弹幕统一消息契约

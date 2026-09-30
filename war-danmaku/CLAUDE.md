# CLAUDE.md — war-danmaku

> 弹幕互动阵营对抗游戏。中世纪战争题材 · 抖音平台 · Node.js + Web Canvas。
> **一句话定位**: 观众发弹幕选阵营、刷礼物出兵，双方对战推城堡。主播解说煽动，营收来自礼物分成。

## 命令

```bash
.\start.ps1             # 一键启动全部（游戏服务器 8765 + 前端 3000 + B站中继 + 抖音适配器）
npm run server          # 单独启动游戏服务器 (WebSocket :8765)
npm run frontend        # 单独启动前端 (OBS 浏览器源 http://localhost:3000)
npm run restart         # 杀旧服务器 + 重启（解决端口占用）
npm run check           # JS 语法检查
npm run test:anim       # 一键动画测试（启动 server + 自动出兵）
npm run dev             # 同 server
```

底层命令：
```bash
python server/stitch-sprites.py         # 拼接精灵图水平条（依赖 Pillow）
node .claude/skills/artist/scripts/gen-anim-frames.js  # AI 动画帧生成（实验，未采用）
```

开发时浏览器打开 `http://localhost:3000`，用右侧控制面板或 `npm run test:anim` 测试。

> `gen-anim-frames.js` 和 `stitch-sprites.py` 是 AI 图生图路线的实验产物。经调研 `agnes-image-2.0-flash` 无法保持角色一致性，当前采用纯程序化动画（`sprites.js`），这两个脚本仅供将来参考。

## 架构

Node.js 游戏服务器 + 纯 HTML5 Canvas 前端。弹幕数据由独立项目 **danmaku-relay** 通过 `:8766` WS 协议提供。

数据流:

```
danmaku-relay (独立 exe)
  B站弹幕 → bilibili.js → relay.broadcast
  抖音弹幕 → douyinLive.exe :1088 → douyin.js → relay.broadcast
                         ↓
                  WS Server :8766
                         ↓
              server/relayClient.js ─→ Game Engine
                                            ↓
                                   WebSocket :8765 → 前端 Canvas
                                            ↓
                                   积分/排行（SQLite 持久化）
```

- **Server**: Node.js + `ws` 库。监听 `:8765` (游戏 HTTP+WS)、`:3000` (前端)、`:8760` (工具箱)
- **Frontend**: 单个 `index.html` + Canvas JS。OBS 浏览器源直接填 URL
- **Danmaku**: 由 danmaku-relay 独立工具提供 — 参阅 `../danmaku-relay/docs/协议.md`
- **Database**: SQLite，重启不丢失

## 🚨 核心规则

### JS/Node
- 不写 `.catch(() => {})` 静默吞错，至少 `console.error`
- async/await 不用 bare `Promise`，always await
- WebSocket 断连必须自动重连（exponential backoff）
- `process.exit()` 只在 `index.js` 入口用
- 日志用 `const logger = require('./logger')`，不用 `console.log`
  - 开发模式终端彩色输出 (`chcp 65001` 切 UTF-8 防乱码)
  - 生产模式 `$env:NODE_ENV="production"` → `server/logs/combined.log` + `error.log`
  - 级别控制: `$env:LOG_LEVEL="debug"`

### Canvas 渲染
- Canvas 尺寸从配置读，不写死 px。OBS 常见分辨率 1920×1080 / 1280×720
- 所有动画用 `requestAnimationFrame`，不用 `setInterval`
- 兵种精灵图预加载，不边渲染边加载
- 弹幕滚动层和战斗层分两个 Canvas 叠加，避免重绘互相影响
- **UI 位置全部从 `window.UI_POS` 读取**，不在渲染函数中硬编码坐标。新增 UI 元素时同步在 POS 中声明位置字段
- **改 POS 值后必须 grep 确认所有相关 draw 函数都读了 POS**（常见错误：改了 POS 但渲染函数仍用旧硬编码值）

### 游戏逻辑
- 数值全部放 `server/config.js`，不在业务代码里写死
- 改兵种属性 → 改 config → 重启 server。不热更新（先保证稳定性）
- 动态平衡机制（人数平衡、劣势保护、碾压加速）必须有，否则碾压局没人消费
- 每局结束后日志输出关键数据（双方人数、礼物总额、MVP、时长），便于调优

### 通用规则
- 改功能前先 grep 全链路调用点
- emit 方只发事件，listener 统一处理持久化
- 禁止贴膏药：修根因不堵出口
- 管道调试铁律：涉及数据流（弹幕→游戏→渲染）的改动，先在首尾加 console.log 看清数据再改逻辑

## 关键文件

| 文件 | 改它时注意 |
|------|-----------|
| `server/config.js` | 兵种属性、数值参数、平衡系数。改了要重启 server |
| `server/gameEngine.js` | 游戏状态机（WAITING→COUNTDOWN→PLAYING→ROUND_END）。所有游戏共用 |
| `server/battle.js` | 战斗逻辑（出兵、交战计算、战线推进）。性能敏感，避免每帧遍历全量兵种 |
| `server/wsServer.js` | WebSocket 服务。两个端口: 8765(前端) + 8766(弹幕中继) |
| `server/ranking.js` | 积分/段位/排行榜。SQLite 持久化 |
| `server/logger.js` | Pino 日志。开发=pino-pretty→终端，生产=JSON→server/logs/ |
| `D:\Projects\danmaku-relay\danmaku\douyin.js` | 抖音适配器（独立项目 danmaku-relay）。连 douyinLive :1088，翻译弹幕/礼物/点赞/关注/进房 |
| `D:\Projects\danmaku-relay\danmaku\bilibili.js` | B站适配器（独立项目 danmaku-relay）。直连 B站 WebSocket → relay :8766 broadcast |
| `server/relayClient.js` | 弹幕中继客户端。连 danmaku-relay :8766 消费弹幕，断线自动重连 |
| `frontend/renderer.js` | Canvas 渲染主循环。帧率目标 30fps（直播 30fps 足够，省 CPU） |
| `frontend/sprites.js` | 兵种精灵绘制。几何图形时期（Phase 1）vs 精灵图时期（Phase 3）实现不同 |
| `frontend/audio.js` | 音效引擎。文件播放模式：往 `frontend/assets/audio/` 丢 MP3 即可。IIFE 包裹 |

## 工作方式

| 任务 | 怎么处理 |
|------|---------|
| 小改动（单文件、<50 行） | 直接做 |
| 复杂改动（跨文件、游戏逻辑） | 调 Plan agent 出方案再动手 |
| 数值调优（兵种平衡、时长） | 改 config.js → 重启 → 模拟弹幕测试 |
| 隔离排查 | 调 `flow-debugger` agent |
| 标准流程 | 用 skill（/verify /review /wrapup） |

### Agent（1 个）
| Agent | 用途 |
|-------|------|
| `flow-debugger` | 日志诊断（只查不修）。查弹幕流转、战斗计算、WS 通信 |

### Skill（4 个）
| 命令 | 触发 |
|------|------|
| `/verify` | "验证"/"检查改动" |
| `/review` | "审一下"/"体验" |
| `/game` | "调数值"/"兵种平衡"/"弹幕协议" |
| `/wrapup` | "收尾"/"结束"/"收工" |

## 环境

Windows 11 · scoop 包管理 · bash (Git Bash) · `python` 非 `python3` · `node` v18+

## Hook 防护体系

四层 Hook 把关，继承自 waifu-agent 工程体系。

| 层级 | Hook | 检查什么 | 失败后果 |
|------|------|---------|---------|
| PreToolUse | `check-catch-silence.py` | `.catch(() => {})` 静默吞错 | **阻断** exit 2 |
| PostToolUse | `check-game-pipeline.py` | 新增兵种/弹幕指令时渲染管线同步（待实现） | 警告 exit 1 |
| Stop | `verify.sh` | git diff 检测 → `node --check` 语法检查 | 警告 exit 1 |

`verify.sh` 进 git，其余两个 `settings.local.json` 配置不进 git。

## 会话收尾

调 `/wrapup` skill — 代码 / 文档 / 未修复 bug / pycache 四步扫描 / 根据会话上下文精华完成自进化。

## 偏好

- 全 inline styles，暗色半透明风，无 CSS 框架
- 不写 JSDoc，代码自解释
- 收尾时直接 commit（用户已验证过），不需要确认
- 手动肉眼验证，无自动化测试

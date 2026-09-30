# PROGRESS.md — 项目时间线

> 追加式。每次 `/wrapup` 在末尾加一条。
> 永不覆盖。只增不改。

---

## 2026-07-18
- 抖音弹幕接入：douyin.js（可遇AI协议适配器）+ douyin-test.js（测试工具）
- 日志系统重构：自研 logger → Pino（8 文件迁移 + B站 Python relay 升级）
- 前端：renderer.js 加 like/follow/share 事件渲染
- 配置：DOUYIN_GIFT_MAP + DOUYIN_ADAPTER + DANMAKU_COMMANDS 加"赞"
- 文档：可遇AI 官方协议文档 + 弹幕对接文档
- wrapup 进化：5 项落地（强制输出约束 + /resume + HANDOVER.md + PROGRESS.md + 模板更新）
- 踩坑登记：G10 (Windows GBK 乱码) + G11 (正则迁移断裂)
- Memory：新增 `diagnose-data-flow-first`

## 2026-07-18（续）
- AP2→AP3 战斗表现层全覆盖：城堡箭塔防御、士兵攻城反馈、受击闪白、城堡损毁四阶段+震屏、战线拉扯增强（辉光+火星+战鼓）、战场环境音（风声+战鼓）
- AP3→AP4 游戏深度层全覆盖：连杀播报6档（3-25杀）、翻盘时刻、盲盒系统（warChest 99钻随机稀有兵种）、战场随机事件（援军/火雨/国王亲征）、指挥官系统（伤害最高者金色光环+1.3×）、城堡防御自动升级（三档）
- 画面文字感谢文化（礼物→"感谢XXX的「礼物名」！召唤了兵种"）+ displayText 机制
- 弹幕指令友好翻译（加红→加入了炎龙帝国，杀→号召民兵出击）+ 非指令聊天不上屏
- OBS分辨率双档适配（设计分辨率1920×1080 + Canvas ctx.scale）
- 音效库路径记忆：D:\tmp\游戏动画音效全集\游戏动画音效全集
- 5个新音效槽位 + 环境音层（ambientGain）
- Memory：sound-library-path.md

## 2026-07-19
- 城堡伤害修复：战线改纯视觉指示器，士兵必须攻到城下才掉血（删除 getCastleDamage()，soldier_attack_castle 带真实伤害）
- 城堡受击闪烁效果（B11: 双层辉光，300ms 衰减）
- 免费兵种克制链：新增矛兵/弓兵/突袭兵，4 兵种闭环（民兵→突袭→弓→矛→民兵）
- 弹幕指令：枪/射/袭/冲，各出 2 个对应兵种
- AI 精灵图生成：spearman.png/bowman.png/raider.png（agnes-image-2.1-flash + rembg）
- 日志双写：取消 NODE_ENV 分档，始终终端+文件
- 代码清理：删除 speed_boost 系统
- Art Bible 更新：v1.2 新增 3 兵种设计规范
- 文档更新：游戏设计.md §3.1/§3.3 同步

## 2026-07-20
- 可遇AI → douyinLive 迁移：编译 Go 代理 (`tools/douyinLive.exe`)，重写 `douyin.js` 连接层 + 格式映射
- douyinLive 调试：确定房间号 `642238215421`、解决 4003034 鉴权（需 HttpOnly sessionid cookie）
- Cookie 配置流程简化：两个字段 `roomId` + `cookie` 直填 `secrets.json`，废弃 Playwright 自动化方案
- 项目清理：删除 @dycast/core、playwright、better-sqlite3 未使用依赖；gitignore 加 tools/ vendor/
- 踩坑：document.cookie 拿不到 HttpOnly sessionid → 必须从 Network 标签复制完整 Cookie 头

## 2026-07-20~21

### 打包分发
- better-sqlite3 → sql.js (WASM)：消除原生 C++ 模块，17 玩家/167 局无损迁移
- 日志简化：pino → 自研 logger（`server/logger.js`），无 worker thread，SEA 兼容
- SEA 单文件 exe：`build.js` 一键构建，sql.js WASM base64 内嵌，游戏 exe ~89MB
- 工具箱桌面应用：Node.js HTTP + 浏览器 UI，三 Tab（控制台/设置/工具），实时日志流
- douyin.js 集成进 game exe：游戏启动时自动检测 secrets.json 并拉起抖音适配器
- Inno Setup 安装包：`dist/war-danmaku-setup-v1.0.exe` (95 MB)
- 项目专属 `/wrapup` skill（`.claude/skills/wrapup/SKILL.md`）

### Tauri v2 工具箱（进行中）
- Rust 后端已写：8 个 Tauri 命令（进程管理/文件读写/系统操作）
- 前端 HTML/CSS/JS 准备就绪，待 `@tauri-apps/api` invoke 适配
- 未编译测试（`cargo build` 待跑）

### 踩坑
- `better-sqlite3` 误删 → 上次清理依赖时当作"未使用"删了，实际 `server/db.js` 还在用，server 启动即崩且日志还没写
- SEA 路径适配：`__dirname` 在 SEA 模式 = exe 目录而非 `server/`，3 个文件需要 `baseDir` 逻辑
- douyin.js SEA 路径 fix 第一次用 `endsWith('danmaku')` 误判（项目名也以此结尾），改为 `endsWith('server/danmaku')`
- Chrome `--app` 模式 → 前端 JS 不执行，原因不明，改为普通浏览器打开
- build.js 中间产物残留（`dist/war-danmaku.exe`、`dist/bundle.js` 等），加了末尾清理

## 2026-07-21

### 单 exe 架构合并
- `server/index.js` 合入工具箱全部功能：:3000 OBS画面 + :8760 管理面板
- 删独立 toolbox exe，`build.js` 只构建一个 exe + 静态文件
- 控制面板三个独立按钮：启动游戏 / 启动抖音 / 启动B站
- "全部停止"全停干净：引擎 reset + 适配器 shutdown + 杀 douyinLive 进程

### B站 relay Node.js 重写
- `server/danmaku/bilibili.js` — 直连 B站 WebSocket 协议，消除 Python 依赖
- 重连限制：最多 5 次，递增间隔

### 日志系统强化
- `logger.onLog` 回调 → 所有模块日志自动进面板环缓冲
- 面板加日志来源过滤：全部/抖音/B站/游戏
- 日志区可选中复制（之前全局 `user-select:none` 阻止）

### 适配器启停控制
- `douyin.js` / `bilibili.js` 去 `process.exit()`，导出 start/stop/isRunning
- `stop()` 设 `shutdown=true` 彻底阻止重连
- GameEngine 新增 `reset()` 方法

### Tauri v2 工具箱
- Rust 后端 + 前端已写，`npx tauri build --debug` 编译通过
- 当前环境缺 WebView2 运行时，保留代码备用

### 踩坑
- WS 每 5 秒断连循环：`app.js` 三个 `setTimeout(connectWS)` 互相冲突 → 单一定时器修复
- `cargo build --release` 不打包前端 → Tauri 需用 `npx tauri build`
- B站重连无限制刷屏 → 加 5 次上限 + 递增间隔
- "全部停止"没停游戏引擎 → 补 `engine.stop()` + `reset()`
- `/api/start-douyin` 只 spawn douyinLive 没启适配器 → 补 `douyin.start()`
- `pollStatus` 用适配器状态判 UI → 游戏跑着但适配器没开就切 offline → 改用 `s.game`

## 2026-07-21（续）

### 废弃文件清理
- 删 `toolbox/server.js`（逻辑已迁入 `server/index.js`）
- 删 `server/danmaku/bilibili-relay.py`（已被 `bilibili.js` 替代）
- `start.ps1` / `start.sh` 同步更新，B站改为走 `bilibili.js`
- 删 `toolbox/src-tauri/` 全部 Tauri v2 代码（Rust 后端 + 构建产物）
- 删 `@tauri-apps/cli` dev 依赖
- `toolbox/app.js` 清理 `isTauri` / `tauriCall()` 死代码
- `.gitignore` 清理 Tauri 条目

### 文档更新
- 新增 `docs/构建指南.md`：SEA 构建流程、产物结构、运行方式
- `docs/README.md` 更新：架构图、关键文件表、启动命令
- `docs/项目进展.md` 清理过时待办项，更新已知问题列表
- `CLAUDE.md` 更新：架构图 + bilibili.js 替换 Python relay 引用

### 决策
- 放弃 Tauri v2 工具箱：SEA 单 exe + 浏览器面板已验证可用，Tauri 多一层 Rust + WebView2 纯属增负

## 2026-07-23

### 虚拟主播集成 — waifu-agent × war-danmaku

**war-danmaku 侧** (~1000行新增)：
- 新增 `server/announcer/` 完整模块（6 个文件）：Announcer 主类 + 模板引擎 + 优先级调度器 + TTS 生成器 + LLM 引擎 + WS 客户端
- 数据流：GameEngine pendingEvents → Announcer → 模板/LLM 话术 → edge-tts Python 子进程 → base64 MP3 → waifu-agent :9191
- waifu-agent 零改动（relay 模式已原生支持 agent:emotion/motion/tts:audio）
- 20 种游戏事件 → 中文话术模板（含 emotion/motion 标注）
- P1-P10 优先级调度 + 批次窗口 + 防抖 + 音频时长同步
- 工具箱新增 "🎤 话术" 面板（引擎状态/日志级别/播报节奏 实时可调）

**waifu-agent 侧** (2 处改动)：
- `App.tsx`：WS 监听去 agentMode 限定（始终连 9191）
- `useTts.ts`：`playBuffer` 加 `activeSourceRef`，新音频 stop 旧音频防重叠

**修复的 8 个 bug**：
1. TTS 时长估算虚高（`audioSize/2000` → `audioSize/6`）
2. castle_hit 刷屏 → 累积阈值播报
3. observer `pendingEvents>0` 条件 → 状态切换不可见
4. phase eventType 全部冲突 → 拆为 6 个独立类型
5. `_init()` `await preGenerate` 阻塞 → WS 先连，预生成 fire-and-forget
6. 调度器硬编码 500ms → 等 `_speak` 返回 durationMs
7. 回合切换不清队列 → 自动 reset
8. waifu-agent builtin 模式不监听 9191 → 始终启用 WS

**遗留**：
- LLM 话术代码完整但缺 API Key（`LLM_ENABLED=false`）
- waifu-agent 口型音频不同步（vowel 按 ~220ms/字生成，edge-tts 实际 ~500ms/字）
- 真实直播弹幕/礼物链路未经观众验证

## 2026-07-25 ~ 08-05 — 话术引擎调试闭环
- **设计变更**：WAITING 与 COUNTDOWN 合并。循环变为 `ROUND_END → COUNTDOWN(30s) → PLAYING → ROUND_END`；WAITING 仅首局候场（round=0）
- COUNTDOWN 30s（DEV 模式 5s→30s）：`countdown_recruit` 招募话术（进入时+15s后）+ 最后5s读秒
- **修复 8 个话术 bug**：
  1. observer 通知被包在 PLAYING/ROUND_END 条件内 → WAITING/COUNTDOWN 全程静默 → 通知块移到条件外
  2. `_gameStarted` 先于 `_maybePhaseTrigger` 置 true → game_start 永不触发 → 调整顺序
  3. cheap/medium 礼物只 push `danmaku_text` → Announcer 无反应 → 补 `spawn_preview`
  4. cheap/medium `spawn_preview` 缺 `text` → 前端 renderer.js:250 显示 undefined → 结构对齐 premium（text+giftName）
  5. bilibili/douyin 关注奖励缺 `giftName` → 话术念 undefined → 全部补上
  6. ⚔🔥 emoji 被 TTS 朗读 → `cleanForTts()` 清洗（画面保留原文）
  7. 模板插值 `val !== undefined` 不防 null → `val != null` + `{xxx}` 残留兜底清除
  8. Announcer giftName 缺失时 troopName 兜底
- **新增文档**：`docs/话术引擎参考.md`（完整话术清单+调度规则）、`docs/话术验收清单.md`（按时间线验收表）
- **新增资产**：`docs/assets/召唤指南.svg`（直播间挂图：阵营/免费指令/礼物→兵种表）
- flow-debugger 参与排查：定位 cheap/medium `spawn_preview` 缺 text 字段（renderer.js 显示 undefined 根因）

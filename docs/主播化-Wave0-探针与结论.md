# waifu-agent 主播化 · Wave 0 探针与结论

> 计划：`.rivet/plans/waifu-agent-主播化重设计-个人陪伴-直播间主播.md`
> 本文件承载 Wave 0 的三条地基探针结论。**0.2 / 0.3 已离线完成；0.1 需本机实机**（探针前请先读第 5 节的"红线"）。

---

## 探针 0.1（需本机实机）— OBS 能否捕获 waifu 的 Tauri 透明窗口？

**为什么先验它**：这决定 Wave 3「主播输出面」走哪条路线，工作量差一个量级。**不验就动手 = 在错误前提上盖楼。**

**步骤**

1. 起 waifu（`start-all.ps1 -Waifu`，或 `cd waifu-agent && npm run tauri:dev`）。
2. 打开 OBS → 来源 → `+` → **窗口捕获（Window Capture）** → 属性里选：
   - 捕获方式优先 **Windows 10 (1903 及更高版本)**（WGC，对透明/无框窗口兼容最好）；
   - 若失败，退回 **BitBlt** 再试。
   - 窗口选 `waifu-agent`（或 `Mao` / 角色名，视窗口标题而定；waifu 主窗口无框、`skipTaskbar` 可能为真 —— 见下）。
3. 观察：OBS 预览里**是否出现角色**，以及**背景是透明还是黑/白/花屏**。
4. 若窗口列表里找不到 waifu：检查 `waifu-agent/src-tauri/tauri.conf.json` 主窗口的 `skipTaskbar` / `decorations` / `transparent` 设置 —— `skipTaskbar:true` 的窗口在部分捕获方式下不可选。

**记录表（填了再往下走）**

| 项 | 结果 |
|---|---|
| OBS 能列出 waifu 窗口？ | ☐ 是 / ☐ 否 |
| 捕获方式 | ☐ Windows 10 (WGC) / ☐ BitBlt / ☐ 其他 |
| 预览里出现角色？ | ☐ 是 / ☐ 否 |
| 背景表现 | ☐ 透明 / ☐ 黑 / ☐ 白 / ☐ 花屏 |
| 结论 | ☐ **路线 A**（window capture 可行）/ ☐ **路线 B**（改走 browser source） |

**分支**

- **路线 A（window capture 可行）**：Wave 3.1 只需给 OBS 场景配置 + waifu 窗口参数（置顶 / 无框 / 尺寸）。
- **路线 B（不可行）**：改走 OBS **浏览器源** —— 复用 `waifu-agent/src/App.tsx` 的 PIXI + Live2D 渲染层，抽一个直播态渲染入口，由中继 `danmaku-relay/toolbox/` 同源托管（对齐 `danmaku-relay/toolbox/leaderboard.html` 的既有模式）。

---

## 探针 0.2（已离线完成）— 播报通道能承载"主动 + 优先级"吗？

**结论：原来不能，现已补上。**

- 现状取证（改造前）：`danmaku-relay/battle/waifuBridge.js` 的 `send()/speak()` 只有 `QUEUE_MAX=20` 的**离线缓冲**（`agent:start/end` 入队），**无 priority / interrupt**。
- 落地（Wave 1.3，commit `35d4657`）：`speak(text, { priority })` 支持抢占 —— **仅带 `priority` 的调用参与**（上一条带 priority 的若仍在"预估播放窗口"内、本条不高于它则丢弃）；**不带 priority 的调用不受影响**（保护 `announce*` / `maybeChat` 旧行为）。
- 证据：`danmaku-relay/tools/verify_director.js` 的 **F 段**（假 :9191 断言抢占/放行/旁路），`npm run verify:director` 28/28 PASS。
- 已知近似：中继拿不到 waifu 的"播放完成"回执，窗口按字数**估算**（`estimateSpeakMs`，中文 ~180ms/字，封顶 20s）。精确回执需协议扩展（未做，列为后续）。

---

## 探针 0.3（已离线完成）— 主播大脑要的战况数据，中继能聚合吗？

**结论：大部分可直接取，少数需新增。**

**可直接取**（`danmaku-relay/battle/index.js` 已持有 / 可调用）

| 数据 | 来源 |
|---|---|
| 轮次 / 状态 | `round.state`、`round.round`（`battle/roundManager.js`） |
| 本轮生兵数 | `round.snapshot().spawns`（红/蓝） |
| 阵营余额 | `economy.getTeam(viewerTeamOf(team))` |
| 本轮榜单 | `leaderboardSnapshot()`（观众维 + 阵营维） |
| 上轮荣誉 | `lastChampions` / `championTitleOf(pid)`、`audience.titlesOf(pid)`（Wave 2 新增） |
| 观众归属 | `playerTeams` / `playerTeamOf(pid)` |
| 观众档案 | `audience.get/snapshot`（Wave 2 新增） |

**需新增**（后续波次）

| 数据 | 归属 |
|---|---|
| 画面读数（经济/战况 OCR） | Wave 5（复用 `capture_game_frame.py` 或 `_archive/ccresearch-game/shot.py`） |
| `CLIMAX`（高光判定：战况密度/关键事件） | Wave 1 后续（Director 状态机需要，v1 用"静默时长"近似，未做密度） |

---

## 红线（探针 0.1 必读）

- **不要干扰用户桌面**（`AGENTS.md` 硬闸门）：开窗口 / 占端口 / 启停服务前先确认；后台抓帧一律用 **PrintWindow，不切窗口**。
- 杀进程必须**按 PID 且先验身份**，永不触碰 `explorer` / `winlogon` / `dwm` / `csrss` / `sihost` / `hermes-*`。
- 探针只读、可随时关掉 OBS，不影响直播链路。

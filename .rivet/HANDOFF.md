# HANDOFF — live-waifu / 弹幕对战直播

> 快照时间：**2026-09-27 深夜**。写给**零上下文**的接手者（人或 agent）。**自包含**，不引用任何对话。
> **项目根**：`D:\Projects\live-waifu`；**游戏目录**（下文 `<GAME>`）：`D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`
>
> **更早的交接（都在磁盘上，务必也看，其知识未被本文件取代）**：
> - `.rivet\HANDOFF.prev-20260927-mapswitch.md`（24657 B）— **本轮之前**的快照。内容是「换直播地图 → `live_map_001.tmx` + 地图契约 + 召唤白名单 + 推手 + 外置排行榜 + 兵种四分类」那条线，**含 20 条坑**，本文件不复述。**帧数/性能那条 P0 卡点记在里面，本轮没动。**
> - `.rivet\HANDOFF.prev-20260927-unit-table.md`（18667 B）、`.rivet\HANDOFF.prev-20260927-1200.md`（15765 B）、`.rivet\HANDOFF.prev-20260926.md`（29189 B，含承自更早的 **34 条坑**）
> - `HANDOVER.md`（项目根）— 2026-09-19 快照。注入 jar 台账、`econ_live.txt`/`end_live.txt` 契约、杀进程红线，最全的一份。
>
> **子仓库各自独立 git**：`danmaku-relay`（branch **`main`**）、`waifu-agent`、`war-danmaku`、`war-vote`；顶层 `master` **只**纳管顶层文档与启动脚本。
> ⚠️ **`.rivet\` 全目录不受版本管理**（在 `.git\info\exclude` 里）——本文件本身也会随工作区丢失，重要结论要往仓库里搬。

---

## 任务目标

在 **Rusted Warfare** 里跑「抖音/B站弹幕驱动的红蓝对战」直播：观众发弹幕在游戏内实时造兵、扣真实余额、红蓝 AI 对战、自动结算、自动下一局。**本轮聚焦「观众经济 + 荣誉 + 直播画面呈现」这条线。**

**用户原话级目标（按时间顺序）**：

1. 就一张手绘的「游戏机制思考」图（`D:\MyWiki\WiKI\兵种\09-27-01-游戏机制的思考与复盘.png`）设计机制：余额充足→派兵；余额不足→点赞/关注/送礼充值；结束→获胜阵营+贡献榜前3。
2. 「**给观众开独立钱包这个可行**，荣誉要有，实质性的奖励也要有，但是**不要破坏游戏平衡**，主要还是起到一个**装逼**的效果就行」。
3. 「点赞一直会播报，要改，我建议**一局同一个观众点赞只播报一次**」。
4. 「游戏结算后的**皇冠应该在头像正上方**一点，而不是右边，一缩小两个就会重叠」→ 后追加「实在分不清就把这个也当成一个参数放到**控制面板**里」。
5. 「排行榜**只跟上一局有关**这个设计不太好吧…**再开一个榜**，用来统计刷分最多的」→ 明确选 **C：按时间窗**（同一人 N 分钟内重复关注只算一次）。
6. 「我留给这两个榜单以及**显示余额的画面，大概只有 200×400 大小**的空间」→「画质本来就不太行，还搞得**灰蒙蒙的，模糊得很**，**基于背景是黑色**重新设计」。
7. 「**重复关注也闭嘴**，不然有人故意刷语音」。
8. 「关键是你得**主动把页面都弹出来**，都加到**一键启动脚本**里」。
9. 「开局两边的余额也太少了吧，这个也**加到配置面板**里去」。

**非目标（本轮明确不做）**：不重打注入 jar；不动抖音/B站适配器链路（除加标记字段）；不删旧图/旧配置；不重做上一轮的换图/推手/地图契约逻辑；**没碰性能/帧数那条 P0**。

---

## 已完成

> ⚠️ 行号**已漂移**——下面一律给**符号名 + 文件**，定位请用 `grep -n "<符号名>" <文件>`，不要信写死的行号。

### A. 观众独立钱包（分账）— 本轮的基石

**语义**：观众的钱与 AI 主队隔离。观众召唤扣 **观众宿主队**（红=`RED_VIEWER_TEAM`=3 / 蓝=`BLUE_VIEWER_TEAM`=4），互动充值进同两个队；AI 主队（`RED_TEAM`=1/`BLUE_TEAM`=2）不受观众账目扰动。观众兵本来就落 3/4（`spawnBatch`），所以现在**钱和兵落在同一支队**。

| 改动 | 文件 / 符号 |
|---|---|
| 阵营主队→观众宿主队 映射 | `danmaku-relay/battle/teams.js` → `viewerTeamOf()` |
| 分账开关（枚举） | `battle/battleConfig.js` → `LIMITS.walletMode`（`'viewer'` 默认 / `'shared'` 旧行为）+ `walletMode()` |
| 召唤扣款/读余额改 viewer 队 | `battle/liveSpawner.js` → `spawnUnit()` 内的 `econTeam`（`parsed.viewerTeam`，缺则 `viewerTeamOf(parsed.team)`） |
| 互动充值改 viewer 队 | `battle/index.js` → `handleCredits()` 的 `walletTeam` |
| 榜单阵营余额读观众池 | `battle/index.js` → `leaderboardSnapshot()` 的 `balTeam()` |
| 回归 | `tools/verify_viewer_wallet.js`（**新增**）；同步改了 `tools/verify_economy.js`、`verify_viewer_team.js`、`verify_interaction_credits.js`（它们原本锁死"扣 AI 主队"） |

**实机已验**（中继重启后起局，读 `<GAME>\econ_live.txt`）：`team 3 = 100000`、`team 4 = 100000`；关注一次 → `team 3` 4000→54000；`红2秃鹰` → `[SPAWN] … 花费 36000 → 余额 18000`；同时 `team 1/2` 只随自身收入走、不受影响。

### B. 观众钱包开局余额（用户第 9 点）

- `battle/battleConfig.js` → `LIMITS.viewerStartingCredits`（min 0 / max 1000000 / **def 100000**；`0 = 不改`，引擎默认只有 4000，买不起白名单兵）。
- `battle/gameController.js` → 起局段（`loadMap` 之后、`startAutoBattle()` 之前）把该值设到 `RED_VIEWER_TEAM`/`BLUE_VIEWER_TEAM`，日志 `[BATTLE] 观众钱包初始余额已设为 N`。
- 面板：`danmaku-relay/toolbox/battle.html` → 输入框 `#cfgViewerCredits`（loadConfig/saveCfg 都已接）。
- **实机已验**：重启后起局，`econ_live.txt` 的 `team 3/4` 均为 100000。

### C. 互动质量

| 项 | 实现 |
|---|---|
| **点赞量化** | `battleConfig` 新增 `likePerExtra`(def 10) / `likeCap`(def 5000)；`battle/index.js:handleCredits()` → `cfg.likeCredits + (连赞数-1)×likePerExtra`，封顶 `likeCap`；`danmaku/douyin.js:_like()` 把 `count` 透传进 credits 事件 |
| **点赞播报去重** | `battle/index.js` → `likeChatAllowed(pid)` / `resetLikeChat()`（每观众**每轮**一次；`RW_LIKE_CHAT_ONCE=0` 关）；每轮 `fighting` 清零。**只抑制播报，加钱照旧**。理由：实机日志证明连赞每 1s 触发一次桌宠 TTS |
| **关注时间窗** | `battleConfig` 新增 `followWindowMin`(min 0/max 1440/**def 60**)；`battle/index.js` → `followWindowMs()` / `followAllowed(pid)` / `followOnCooldown(pid)`；`_followRewarded` 是 **`Map<pid, 时间戳>`**。窗口内重复**不发奖**，超过窗口算新的一次（"取关再关注"能再拿）；`0`=只算第一次；`RW_FOLLOW_WINDOW_MS` 覆盖；`RW_FOLLOW_ONCE=0` 全关 |
| **重复关注「闭嘴」** | `douyin.js:_follow()` 给播报弹幕打 `source:'follow'`；`battle/index.js:handleDanmaku()` 非指令分支在 `maybeChat` 前：`if (msg.source==='follow' && followOnceEnabled() && followOnCooldown(pid)) return null` |

> ⚠️ `followOnCooldown` 是**只读探询、不记账**，`followAllowed` 才记账——这个拆分是**必须的**：播报（danmaku）先到、发奖（credits）后到，若探询也记账，后到的发奖会被误判成重复而**永远发不出去**。

### D. 结算露出 + 荣誉（「装逼」）

- **结算播报前三**：`battle/index.js` → `buildTopText(top3)`（纯函数）；`round.on('ended')` 里 `announce(buildTopText(top3), 'top')`，同一份 `top3` 也传给 `waifuAnnouncer.announceRoundEnd({..., top3})`（`battle/waifuAnnouncer.js:roundEndText()` 已支持）。
- **称号**：`battle/index.js` → `setChampions(top3)` / `championTitleOf(pid)` / `repLabelText(pid,name)` → 代表单位头顶名字带 `【冠军】/【亚军】/【季军】` 前缀（**纯文字前缀**，不给 `addLabel` 加参数——该 API 定长参数，多传一个参数会崩游戏）。上一轮结束后记下、下一轮重建代表单位时生效，再下一轮自动覆盖。
- **皇冠徽章**：`championBadgePath()` → `danmaku-relay/toolbox/badge_champion.png`（本会话用 node 手写 PNG 生成，20×18 RGBA）；贴**头像正上方居中**。
- **皇冠位置参数**：`battleConfig` → `LIMITS.crownOffset`（min 0/max 300/**def 30**，单位=**屏幕像素**间距）；`battle/index.js:spawnRepUnit()` 里 `crownWorldGap = (crownOffset + REP_BADGE_H) / zoom`（除以 zoom ⇒ 任何缩放下观感一致）。面板输入框 `#cfgCrown`「皇冠上移」。
- **代表单位在缩放下不糊/不重叠**（用户抱怨"一缩小就叠一起"）：
  - 名字标签**缩放闸门**：`RW_REP_LABEL_MIN_ZOOM`（默认 1.0）——`cameraTarget().zoom < 该值` 时**不贴名字**（全景缩放下多标签必糊）。
  - 网格间距**随缩放大**：`battle/index.js:spawnRepUnit()` 里 `gscale = zoom<1 ? 1/zoom : 1`，`gdx = REP_GRID_DX*gscale`（世界间距 = 54/zoom ⇒ 屏幕间距恒定 54px > 头像 26px）。
  - **朝开局视野中心铺**：`dir = (anchorX < cameraTarget().x) ? +1 : -1`——红锚点偏右就向左铺、蓝偏左就向右铺，否则整排往画面外延伸。
- 回归：`tools/verify_champion_award.js`（**新增**，含 C 段黑底清晰度护栏、D6/D7 皇冠位置、E1–E4 间距/方向）。

### E. 榜单：双榜（用户第 5 点）

- `battle/leaderboard.js` **重写为双榜**：
  - **本轮榜** `viewers`：原行为，每轮 `reset()` 清零，供本轮战报 / 冠军判定。
  - **累计榜** `season`：跨轮累计、**落盘**（`RW_SEASON_FILE`，默认 `danmaku-relay/data/leaderboard-season.json`，原子写 + 2s 防抖）、多一项 **`wins` 夺冠次数**。排序 **`wins ↓ → spawns ↓ → spent ↓`**。
  - 新增 `recordWin(pid)` / `seasonSnapshot()` / `resetSeason()` / `loadSeason()` / `saveSeasonNow()` / `SEASON_FILE`。
- `battle/index.js`：`round.on('ended')` 里对 `top3` 各调一次 `leaderboard.recordWin(...)`；`init()` 里 `leaderboard.loadSeason()`（**跨中继重启保留**）。
- `snapshot()` 现在同时返回 `viewers` 与 `season`。
- 中继 `index.js`：新增 `POST /api/leaderboard/reset-season`（开新赛季）。
- 回归：`tools/verify_leaderboard.js` 增 C1–C9 + B7–B9（**落盘已隔离到临时文件**）。

### F. 榜单页按 200×400 黑底重做（用户第 6 点）

`danmaku-relay/toolbox/leaderboard.html`（**整页重写**）：

- `html,body` 固定 **200(宽)×400(高)**（`--w`/`--h` CSS 变量；URL `?w=&h=` 可覆盖），`overflow:hidden`。
- **纯黑底 `background:#000`**；**删除**一切 `rgba()` 半透明面板、`linear-gradient`、`text-shadow`（这三样在低码率视频上就是"灰蒙蒙/糊"的来源）。
- 布局：余额两行（红/蓝）→ 本轮榜（**前 5**）→ 累计榜（**前 11**）；字号 11–12px、行高 15px；金额缩写 `12345→12.3k`。
- 荣誉：前三名**实心色条 + 名字换色**（金 `#ffd400`/银 `#d8d8d8`/铜 `#d08040`）。
- 回归护栏：`tools/verify_champion_award.js` 的 **C8–C11** 断言"必须有 `background:#000`、不得有 `linear-gradient(` / `text-shadow:` / `rgba(0,0,0,…)`"——谁把模糊加回来会直接测试红。

### G. 阵营级配额

`battle/summon-whitelist.json` → `summon.teamCapPerRound`（**300**，`RW_TEAM_CAP_PER_ROUND` 覆盖）；`battle/liveSpawner.js` → `teamCapPerRound()` / `resetTeamSpawnCount()`，`spawnUnit()` **在扣款前**拦超额（回执 `economy.capped`）；`battle/index.js` 每轮 `fighting` 清零。

### H. 一键启动自动弹页（用户第 8 点）

- 顶层 `start-all.ps1` → `Start-Relay` 里 `Start-Process` 依次打开 `http://localhost:8767/battle.html`、`/leaderboard.html`、`/`（控制面板）。
- 子仓库 `danmaku-relay/start-all.bat` 同样三页（保持 **ASCII**，cmd 读 UTF-8 中文会乱）。

### I. 离线回归不再污染真实直播日志

- `danmaku-relay/logger.js`：**入口脚本位于 `tools/` 下 ⇒ 视为离线回归、默认不落盘**；`RW_LOG_SILENT=1` 强制静默 / `=0` 强制落盘。生产入口 `index.js` 不受影响。
- 回归：`tools/verify_log_silent.js`（**新增**）用**子进程**功能验证四条规则。
- **实测**：跑一次 `verify_champion_award` 后，`logs/combined.log` 行数 45376 → **45376（未增长）**。

### J. 文档

- `docs/直播指令手册.md`：§2 **整节换成当前召唤白名单**（14 项，含别名/单价/单条上限/免费标注/`giftOnly`）；§1/§5/§6 的失效示例词改掉；新增 **§4·B 点赞/关注**（含关注时间窗、平台不发取关事件这条限制）。
- `docs/兵种与收益一览.md`：**生成物**，改了生成器 `tools/gen_unit_table.js` 三处 stale（加"本文是全量单位库、**不是**可召唤范围"横幅；修正"怎么召唤"表；标注"档位"列已被 `summon-whitelist.json` 取代），再 `node tools/gen_unit_table.js > ../docs/兵种与收益一览.md`（**该生成器把结果写 stdout，必须重定向**）。
- `docs/游戏机制与运作流程.md`：§7 补双榜、关注时间窗、点赞播报频率、观众钱包开局余额。

### 提交清单

**danmaku-relay（branch `main`）**，按时间顺序：

| hash | 内容 |
|---|---|
| `808ec55` | 观众独立钱包分账（viewerTeamOf / walletMode / 扣款与充值改 viewer 队） |
| `1e10104` | 关注去重 + 点赞按连赞数量化 |
| `2a70475` | 结算播报贡献榜前三（`buildTopText` + 桌宠） |
| `fdec76a` | 前三荣誉（称号前缀 + 冠军徽章 + OBS 榜单高亮） |
| `76382b4` | 阵营级观众兵配额（`teamCapPerRound` 300） |
| `3ac9953` | 观众钱包开局余额 `viewerStartingCredits`（默认 10 万） |
| `4869e55` | 点赞播报一局一人一次 + 皇冠改贴头像正上方 |
| `7763696` | 代表单位网格间距随缩放放大（全景不重叠） |
| `bda20e2` | 代表单位朝开局视野中心铺（不往画面外延伸） |
| `22db4f0` | 皇冠上移做成面板参数 `crownOffset` |
| `7052a2d` | 累计榜（跨轮+落盘+夺冠次数）+ `/api/leaderboard/reset-season` |
| `06eb9d3` | 榜单页重做为 200×400 紧凑卡片 |
| `c4ba492` | 榜单页按黑底重设计（纯黑/实心高对比/去半透明与阴影） |
| `61f6cb6` | 关注去重改时间窗（默认 60 分，可配） |
| `ec0e35c` | 窗口内重复关注不再播报（闭嘴） |
| `5f9c153` | 离线回归不污染 live 日志（`tools/` 入口默认静默） |
| `a0ac2b1` | `start-all.bat` 自动弹 battle+leaderboard 面板 |
| `5f060c9` | 兵种一览生成器同步当前召唤规则 + `simulate` 默认词改有效 |

**顶层仓库（branch `master`）**：`6758cea`（手册白名单 + 兵种一览再生）、`ad49ec5`（启动脚本弹榜单页）、`0a57b6c`（观众钱包开局余额文档）、`b3695fb`（双榜/时间窗文档）。

### 验证证据（真跑过的）

- **离线**：`cd danmaku-relay && npm run verify` → **exit 0 / 0 FAIL**（本轮多次复跑；套件数已涨到 30+，**耗时约 70–110s，bash 120s 硬超时偶尔会截断，给 timeout 300000**）。
- 新增回归与其终态：`verify_viewer_wallet` **24/0**、`verify_follow_dedup` **17/0**、`verify_round_end_top` **7/0**、`verify_champion_award` **33/0**、`verify_like_chat_once` **10/0**、`verify_log_silent` **4/0**、`verify_battle_config` **44/0**、`verify_leaderboard` **全过**。
- **实机**（重启中继 → 起局）：`econ_live.txt` 的 `team 3/4 = 100000`；关注 → `team 3` +50000；再关注（窗口内）→ **无 `[CREDITS]` 且无桌宠播报**；`红2秃鹰` 扣 `team 3` 36000；结算 `[播报][top] 【战报】功勋榜 1.…` + `[WAIFU][end] 本轮功勋前三:…`；代表单位日志坐标实测间隔 135 世界px（旧值 54）且全部落在开局视野框内。
- **用户口头验收**：「皇冠的位置我调好了」「这次显示 OK 了」——即 200×400 榜单页与皇冠位置由**用户肉眼确认过**。

---

## 当前卡点

### 1. 🟠 累计榜的排序口径是**我拍的**，未被用户确认

`leaderboard.js:seasonSnapshot()` 用 `wins ↓ → spawns ↓ → spent ↓`。用户原话是「统计**刷分最多**的，或者之类的」——"夺冠次数优先"是我替他选的。要改成"累计花费优先"只需改那一行 sort。**未知用户偏好。**

### 2. 🟠 4 个白名单兵种**免费**（单价表缺项）

`百夫长(Ek_beamGunshipA_5)`、`防空T3(c_antiAirTurretT3)`、`闪电炮塔(c_turret_t2_lightning)`、`顶级炮塔(c_turret_t3_gun)` 在 `unit-prices.json`/`mod-units.json` 里都没有价 ⇒ `economy.priceOf()` 返回 null ⇒ `spawnUnit()` 走 `no-price-entry` 分支**不扣钱**（只受每轮 300 兵上限约束）。**是否补价待用户决定。**

### 3. 🟠 礼物的兵种表**仍是旧白名单外的**

`battle/giftTiers.js` 的 `GIFT_TIERS` 是 `megaTank / mammothTank / laserTank / heavyTank`——**这四个都不在 `summon-whitelist.json` 里**（礼物路径不走白名单，所以能出，但和"能召唤什么"的设定不一致；旧交接里的「执行者=礼物触发」也仍未接线）。

### 4. 🟡 我**没能亲眼验证**的两处渲染

- **皇冠/称号在游戏内的实际观感**：截图多次失败（撞上 Briefing 弹窗 / 镜头被新一局重置 / 游戏停在 Corroding 开场 Logo）。只验了**坐标正确**（`verify_champion_award` D6/D7/E1–E4）与用户口头确认。
- **200×400 榜单页的实际排版**：本会话**没有浏览器工具**，只验了"CSS 里无致糊因子 + 尺寸/行数封顶 + 服务端吐出的确是这一版"。字体渲染/长昵称会不会挤，**未知**。

### 5. 🟡 关注"窗口内闭嘴"只验到判据与接线

`followOnCooldown` 的行为 + `handleDanmaku` 确实调它并 `return null` 有回归（D1–D6、F13/F14），但**没在真实取关/关注下听过一次语音**。

### 6. 🔴 **上一轮的性能/帧数 P0 完全没动**

见 `.rivet/HANDOFF.prev-20260927-mapswitch.md` 的「当前卡点 1」：java 单核 93–100%、FPS 198→141→160（不单调）、已排除进程泄漏/单位累积/镜头/画质三项，怀疑 RW 主循环 CPU-bound + Intel Iris Xe。**用户不接受"地图太大"这个解释。**

### 7. 🟡 服务当前状态

本轮末尾**中继在跑**（`node index.js`，占 `:8766`/`:8767`，并由它拉起游戏占 `:9999`）。要停：先 `curl -X POST http://localhost:8767/api/stop`，再按 **PID** `taskkill /PID <pid> /F`（**别用 `/IM java.exe`**）。判据：`netstat -ano | grep -E ":(8766|8767|9999)\b"`。

---

## 下一步

**P0（先做）**

1. **确认服务状态并按需重启**：`netstat -ano | grep -E ":(8766|8767|9999)\b"`。要起：`powershell -NoProfile -ExecutionPolicy Bypass -File D:\Projects\live-waifu\start-all.ps1 -Relay`（会自己弹三个面板页）。**注意**：它会先 `Test-Port 8767`，已在跑就跳过——想加载新代码必须先停再起。
2. **把本文件里「A–J」对应的行为在真实直播里各看一遍**（尤其是卡点 4 的两处渲染），并让用户确认**累计榜排序口径**（卡点 1）。

**P1**

3. **接「执行者 = 礼物触发」**：`battle/giftTiers.js` 加一档高价值礼物 → `Ek星舰`，并让 `handleGift`（`battle/index.js`）识别；建议同时把 `GIFT_TIERS` 的旧四兵种换成 `summon-whitelist.json` 里的（卡点 3）。
4. **补 4 个免费兵种的价**（卡点 2）：往 `battle/unit-prices.json`（或改 `mod-units.json` 生成链）补 `Ek_beamGunshipA_5` / `c_antiAirTurretT3` / `c_turret_t2_lightning` / `c_turret_t3_gun`。
5. **回头处理性能 P0**（卡点 6）。

**P2**

6. **`.rivet\skills\switch-map\` 与 `.rivet\scratch\` 里的脚本搬进仓库**（上一份交接的 P0-1；`.rivet` 不受版本管理 ⇒ 修了会丢）。
7. **`docs\兵种分类模板.md`** 里还写着"填完接进 `battle\mod-unit-pool.json`"——那文件已被 `summon-whitelist.json` 取代，属 stale。

---

## 坑

> 上一份交接的 20 条坑**仍然有效**（`.rivet\HANDOFF.prev-20260927-mapswitch.md`「坑」章），这里只记**本轮新增**的。

1. **回归脚本 `require('../battle')` 会打日志**。本轮之前它们直接追加进真实的 `logs\combined.log` ⇒ 排障时真行假行混在一起（曾经拿测试造的 `[REP] gp1/gd3` 假记录当故障证据）。**已修**（`logger.js` 按入口位置判定），但**新增测试时不要绕过它**：`tools/` 下的入口默认静默，`RW_LOG_SILENT=0` 才会落盘。
2. **`followOnCooldown`（探询）和 `followAllowed`（记账）必须分开**。原因：关注播报（danmaku）与发奖（credits）是**两条**消息、播报**先到**；若探询也记账，后到的发奖会被判成"重复"而**永远发不出去**。改这块时先想清楚顺序。
3. **`addLabel` / `addAvatar` 是定长参数**，多传一个参数 = 游戏进程 `onGameCrash` **当场死**。所以"称号"走**文字前缀**、徽章走**额外一次 `addAvatar`**，绝不给现有 API 加参数。
4. **代表单位的名字是"屏幕固定像素"、位置是"世界坐标"**。任何"名字/头像不随缩放"的需求都要按 `÷zoom` 折算世界间距，否则全景下必叠（本轮踩过：间距 54 世界px × zoom 0.399 ≈ 21.5 屏幕px < 头像 26px）。
5. **给面板加配置项要同时改三处**：`battleConfig.LIMITS`（含 `clamp` 分支——枚举型字段要用 `L.enum`，见 `walletMode`）、`toolbox/battle.html` 的 HTML + `loadConfig()` + `saveCfg()`。漏一处 = 面板显示不出来或存不下去。
6. **`npm run verify` 的套件数会涨，耗时 ~70–110s**。bash 工具 120s 硬超时 ⇒ **给 `timeout: 300000`**，否则会误判成"卡住"而去乱查。
7. **`node tools/gen_unit_table.js` 把结果写 stdout**，不重定向就什么都不写盘；正确姿势 `node tools/gen_unit_table.js > ../docs/兵种与收益一览.md`。
8. **改 `battle/*.js` 必须重启中继才生效**；判"新代码生效"的硬锚点是**中继进程启动时间晚于提交时间**，不是症状（本轮据此发现用户手动起的中继是旧代码，`/api/battle/config` 里没有 `viewerStartingCredits`）。
9. **起局会重拉游戏进程**：重启中继后它是冷启动，可能停在 **Briefing 弹窗**或 **Corroding 开场 Logo**——此时截图什么都看不到，别把它当成"渲染坏了"。
10. **抓帧截图脚本本会话用 PowerShell + `PrintWindow`（`user32.PrintWindow` + `System.Drawing`）**，写到 `.rivet\scratch\*.ps1` 用。机器上**没有 PIL**（`python -c "import PIL"` 失败），所以历史交接里的 `_archive/ccresearch-game/shot.py` 跑不了。
11. **`.rivet\HANDOFF.md` 覆盖前必须先 `read_file` 一次**（工具会拒绝覆盖本会话没读过的既有文件），并且**按惯例先把旧版 `cp` 成 `HANDOFF.prev-<日期>-<主题>.md`**——本轮就是 `HANDOFF.prev-20260927-mapswitch.md`（24657 B）。
12. **`curl` 直发中文会丢编码**（`红3战车` → `��3ս��` 被判"未识别"）。用 JSON 的 `\uXXXX` 转义绕过；且**先怀疑自己的转义**（历史踩过 `\u51f0\u51f0` 是"凰凰"不是"凤凰"）。
13. **`danmaku-relay` 是独立 git 仓库**：顶层 `git add danmaku-relay/...` **无效**；子仓库改动一律 `git -C danmaku-relay add/commit`。本轮全部改动都分别落在两个仓库，**别只提交一边**。
14. **榜单页的 CSS 纪律**：不许加回 `rgba()` 半透明面板 / `linear-gradient` / `text-shadow`——背景是黑的，这三样只会显灰、且经视频压缩后发糊。有回归护栏（`verify_champion_award` C8–C11）钉着。

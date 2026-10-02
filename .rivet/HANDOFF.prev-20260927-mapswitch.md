# HANDOFF — live-waifu / 弹幕对战直播链路

> 快照时间：**2026-09-27 傍晚**。写给**零上下文**的接手者（人或 agent）。**自包含**，不引用任何外部对话。
> **项目根**：`D:\Projects\live-waifu`；**游戏目录**（下文 `<GAME>`）：`D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`
>
> **更早的交接材料（都在磁盘上，务必也看，其知识没有被本文件取代）**：
> - `.rivet\HANDOFF.prev-20260927-unit-table.md`（18667 B）— **本轮之前的那个 2026-09-27 快照**，内容是「mod 单位接入可召唤 / 生成 `docs\兵种与收益一览.md` / 探针 mod 加靶子单位」那条线。**本文件覆盖它，但它是被归档而非删除**。
> - `.rivet\HANDOFF.prev-20260927-1200.md`（15765 B）— 2026-09-26 那轮。
> - `.rivet\HANDOFF.prev-20260926.md`（29189 B）— 「观众墙/换阵营名字修复」+ 承自更早的 **34 条坑**。
> - `HANDOVER.md`（项目根）— 2026-09-19 快照。注入 jar 台账、运行期通道契约（`econ_live.txt`/`end_live.txt` 格式）、桌面与杀进程红线，最全的一份。
>
> **子仓库各自独立 git**：`danmaku-relay`（branch `main`）、`waifu-agent`、`war-danmaku`、`war-vote`；顶层 `master` 只纳管顶层文档。
> ⚠️ **`.rivet\` 全目录不受版本管理**（在 `.git\info\exclude` 里）——本文件、以及本项目对 `.rivet\skills\switch-map\` 的修改，都会随工作区丢失。

---

## 任务目标

在 **Rusted Warfare** 里跑「抖音弹幕驱动的红蓝对战」直播：观众发弹幕在游戏内实时造兵、扣该队真实余额、红蓝 AI 对战、自动结算、自动下一局。

**本轮（2026-09-27 下午~傍晚）用户原话级目标**，按时间顺序：

1. 「`D:\game\...\mods\maps\LIVE_FOR_MAP_001_2P.tmx` 这是我刚在沙盒模式做好的地图布局。**准备切换到这个地图**上来，按照新的模式进行后续的开展。」
2. 地图仍红蓝两阵营由 AI 托管；**召唤的兵要和之前一样能巡逻、避免被本队 AI 拦截**。
3. **召唤兵种按 land / sea / air / building 四分类**，出一份模板文档，主播填范围。
4. **排行榜与游戏解耦**——游戏里的排行榜已用于显示余额，想放到游戏外，直播时直接取来显示。
5. **观众的图像与名字显示照旧**，因换图要改摆放位置；主播已在地图里两阵营各放一个 `viewer_king` 当基准。
6. **之前的地图相关设计不要删**；**最好做成规范**，以后换图共用一套逻辑。

**后续追加（同样已落地或已记录）**：

7. 只列出的兵种可召唤（用户给了具体名单）。
8. **推手**继续：30s 一次、两边从 land+air 随机挑兵种、每次一共 20 兵；`air` 里的**执行者不参与推手**（只作礼物触发的清图兵种）。
9. 「两边你确定都是同一个召唤策略吗？怎么我感觉蓝方明显强于红方」→ 「**热闹但别一边倒**」。
10. 「基地的位置互相调远一些」→ 反复收敛为「**移动 Command 就行了，其他的不用动**」。
11. 「怎么游戏运行着也越来越卡了？帧数一直掉调到几十了」→ 「**关画质重启看下吧**」。
12. 「推手多久推一次，召唤的机制设计我需要重新评估一下（召唤方式、数量兵种、冷却）」→ 用户回复「**按你推荐的来**」。

**非目标（本轮明确不做）**：不改抖音/B站适配器链路；不删旧图/旧配置（`new_dire*.tmx`、`live_dire.tmx` 保留）；不重做注入 jar（沿用既有 `Debug.spawnRep/addAvatar/addLabel/addWall/spawnPatrol` 等 API）；**「执行者=礼物触发」只标了 `giftOnly`，礼物路径尚未接线**（见「当前卡点」）。

---

## 已完成

### A. 换图流水线（本轮核心，已规范化）

**心智模型（三层，产物名与源图名解耦）**：

```
源图（主播摆阵）                     产物（适配后）                 引擎实读
<GAME>/mods/maps/                   <GAME>/mods/maps/             <GAME>/assets/maps/skirmish/
 LIVE_FOR_MAP_001_2P.tmx      →     live_map_001.tmx        →     live_map_001.tmx
 (team0=蓝 / team1=红)               (team2=蓝 / team1=红)         (中继每轮开局前从产物复制过去)
```

**四步流水线（换图就这四步，别手搓）**：

```bash
GAME="D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15"
# 1) 适配（队伍/Triggers）
RW_NEWDIRE_SRC="$GAME/mods/maps/<新源图>.tmx" RW_NEWDIRE_DST="$GAME/mods/maps/live_map_XXX.tmx" \
  python danmaku-relay/tools/map_adapt_newdire.py apply
# 2) 基地外挪（可选；默认只移 commandCenter）
python danmaku-relay/tools/map_move_bases.py "$GAME/mods/maps/live_map_XXX.tmx" --dist 500
# 3) 生成地图契约（会写 battle/map-config.json，含中继加载的文件名）
node danmaku-relay/tools/gen_map_contract.js --src "$GAME/mods/maps/live_map_XXX.tmx" --map-name live_map_XXX.tmx
# 4) 独立双通道复核
python .rivet/skills/switch-map/scripts/verify_adapted_map.py "$GAME/mods/maps/<新源图>.tmx" "$GAME/mods/maps/live_map_XXX.tmx"
python danmaku-relay/tools/verify_units_et.py "$GAME/mods/maps/live_map_XXX.tmx"
```

**新源图实测结构**（`LIVE_FOR_MAP_001_2P.tmx`，220KB）：
- 230×180 瓦片（20px/瓦片 → 世界 4600×3600）；图层只有 `Ground` + `Items`，**无 `set` 层**（可省）。
- `Triggers` 是**空自闭合** `<objectgroup name="Triggers"/>`（L6937）——踩坑点，见「坑」1。
- `UnitObjects`（L6939）：team0=75 / team1=73。
- **指挥中心**：蓝(team0) @ (1315,1735)、红(team1) @ (3255,1835)；**viewer_king**：蓝 @ (740,1540)、红 @ (3860,1640)。
- Ground md5 = `bf3892c5…`（与旧图不同 ⇒ 坐标必须重取）。
- **含真实水域**（浅水 28598 格 / 41400，按**瓦片 `water` 属性**判定，不是按 tileset 名）。
- 引用 EK mod 单位（`EkBrickwall1Y` / `EkBunkerInterceptor` / `EkLargeArtillary` / `c_turret_t3_gun` 等；`a2bd88c8437b8561.rwmod` = EK_Definitive，已 enabled）。

**产物 `live_map_001.tmx` 现状**：CC 已各沿两 CC 连线外移 500px ⇒ 红 **(3754,1861)**、蓝 **(816,1709)**，间距 **1943 → 2943px**。**只移了 2 个 `commandCenter`**，其余 146/148 个对象逐点未动。
> 原产物备份在 `<GAME>/mods/maps/live_map_001.tmx.bak-prebases-20260927`。

### B. 地图契约（「换图共用一套逻辑」的关键）

`danmaku-relay/battle/map-config.json`（由 `tools/gen_map_contract.js` 从产物 TMX 生成）集中所有地图几何量，中继改读它：

```json
{ "map":"live_map_001.tmx",
  "commandCenters":{"red":{"x":3754,"y":1861},"blue":{"x":816,"y":1709}},
  "patrolTargets":{"red":<蓝CC>,"blue":<红CC>},
  "viewerAnchors":{"red":{"x":3860,"y":1640},"blue":{"x":740,"y":1540}},
  "camera":{"x":2285,"y":1785,"zoom":0.399},
  "hasWater":true, "waterTiles":28598, "spawnPad":45, "teams":{...} }
```

消费方（缺 `map-config.json` 时各自**回退写死值**，保证旧图可切回）：
- `battle/mapConfig.js`（**新增**，加载器）
- `battle/liveSpawner.js`：`COMMAND_CENTER` / `SPAWN_AREAS` / `CC_SPAWN_PAD` / `PATROL_TARGETS`（`patrolTargets` = **对面 CC**，自动推导，消除了历史上"出生点新图/巡逻目标旧图"的错位）
- `battle/index.js`：`MAP_FILE_DEFAULT` ← `map`；`spawnRepUnit` 网格锚点 ← `viewerAnchors`（即地图里的 `viewer_king`，即第 5 点的"基准"）
- `battle/gameController.js`：`CAM_DEFAULTS` ← `camera`（`RW_CAM_X/Y/ZOOM` 仍优先）

> `camera.zoom` 是**自动推导**的（推远景以框住两基地），基地挪远后从 0.605 变成 0.399。

### C. 观众召唤白名单 + 机制重估

新建 `danmaku-relay/battle/summon-whitelist.json`（**唯一的召唤范围真相源**；存在即生效，删掉=回到旧 `UNIT_MAP`+`mod-unit-pool` 行为；env `RW_SUMMON_WHITELIST=0` 可临时关，供离线解析机制测试用）。

**四分类（用户逐项确认过的）**：
- **land**：`EkWardenMechX`狂暴者 / `EkSamuraiMech_mk2`浪人 / `EkTitanMech`泰坦 / `EkWardenMech_mk2`典狱长
- **sea**：**空**（用户名单里没有）
- **air**：`EkBuzzard`秃鹰 / `Ek_beamGunshipA_5`**百夫长** / `Ek星舰`执行者（**`giftOnly:true`**，不进弹幕/推手）/ `Ek_mutli_laser_ship`凤凰
- **building**：`c_antiAirTurretT3`防空T3 / `EkInfBunker`轻型地堡 / `EkBunkerInterceptor`空防地堡 / `EkLargeArtillary`大型碉堡 / `c_turret_t2_lightning`闪电炮塔 / `c_turret_t3_gun`顶级炮塔

**机制参数**（`summon` 段，按用户「按你推荐的来」落地）：

| 项 | 值 | 说明 |
|---|---|---|
| `basicUnit` | `EkBuzzard` | **零门槛入口**：光发「红」/「蓝」（可带「方」）→ 出 1 个它 |
| `cooldownMs` | **3000** | 同一观众两条指令最小间隔（原 500ms） |
| `tierCaps` | ≤2万→10 / 2万-8万→5 / **>8万→2** | 单条弹幕数量上限按**单价分档**（原一刀切 10） |

`liveSpawner.js` 相应改动：新增 `basicUnit()` / `tierCapOf()` / `spawnCooldownMs()`（均在 `parseDanmaku` 之前）；`parseDanmaku` 加了「bare 阵营字」分支（`basic:true`）与分档夹取；`spawnUnit` 的冷却改用 `spawnCooldownMs()`。
> ⚠️ 零门槛出的基础兵**仍然走经济扣费**（秃鹰单价 18000），**不是免费**。

### D. 推手（收局推手）

`battle/summon-whitelist.json` 的 `pusher` 段：

| 项 | 现值 | 历史 |
|---|---|---|
| `intervalMs` | 30000（30s） | — |
| `perSide` | **3** | 原 10（= 两边合计 20/cycle，用户早先的要求） |
| `typesPerSide` | 3 | 两边**共用同一批**挑中的兵种（公平对拼） |
| `pool` | `["land","air"]` | 排除项 `exclude:["Ek星舰"]` |
| `maxPerSide` | **400** | 原 80（再原 300）——旧值导致"4 分钟打满就全线停手" |

行为：每 30s，两边各自从 `pool` 随机挑 3 种（同批），各补 3 兵（兵种从挑中的里随机），落本队指挥中心、`spawnPatrol` 巡逻向敌方 CC。
**新增 `[PUSH]` 日志**（此前完全没有）：`[PUSH] 各 +3 → 红 X ×3 | 蓝 X ×3（累计 红3/蓝3，上限 400）`。

### E. AI 难度收窄（「热闹但别一边倒」）

`battle/difficulty.js`：`WEAK_LEVELS` 从 `[-2,-1,0]` → **`[1,2]`**、`STRONG_LEVELS` 从 `[1,2,3]` → **`[3]`**（原单轮最多差 5 档，实测出现过 红=0/蓝=3 明显一边倒）。仍每轮随机决定红/蓝谁拿强。`RW_AI_DIFF_PAIR=0` 可关。
难度是写进 `assets/` 副本的 `team_N_info.lockAiDifficulty`（运行时无 per-team setter）——验证看 `lastrun.log` 的 `Locking lockAiDifficulty:N by map request to: V`。

### F. 排行榜外置（用户第 4 点）

- 中继新增 `GET /api/leaderboard`（`danmaku-relay/index.js`，紧挨 `/api/battle/state`）。
- 数据源 `battle/leaderboard.js`（**新增**，内存累计：观众维 spawns/spent/likes/follows）+ `battle/index.js` 的 `leaderboardSnapshot()`（阵营维 = 轮次生兵数 + 引擎余额）。
- 埋点：`handleDanmaku`（召唤）、`handleGift`（礼物）、`handleCredits`（点赞/关注）；每轮开局 `leaderboard.reset()`。
- **OBS overlay**：`danmaku-relay/toolbox/leaderboard.html`（轮询该接口渲染，与游戏完全解耦，由 `:8767` 同源托管）。
- **游戏内原生排行榜（显示余额的那个）保留不动**。

### G. 兵种四分类文档

- `danmaku-relay/tools/gen_unit_categories.js`（生成器）+ `battle/unit-categories.json`（产物：land165/sea29/air87/building150，覆盖 431 单位不重不漏；实验级 30 为横跨清单）+ `tools/verify_unit_categories.js`。
- `docs/兵种分类模板.md`（**顶层仓库**，留空表供主播填）。

> ⚠️ 注意区分：`battle/unit-categories.json`（**全量 431 单位**的落桶结果，供挑代表）≠ `battle/summon-whitelist.json`（**实际放行**的 17 个）。前者是菜单，后者是白名单。

### H. 画质降负载（用户第 11 点）

`<GAME>/preferences.ini` 三项关掉（**备份 `<GAME>/preferences.ini.bak-gfx-20260927`**）：`renderExtraShadows` / `renderExtraLayers` / `softFogFading` → `false`。改完**必须重启游戏**才生效。

### 提交清单

**danmaku-relay（branch `main`）**：

| hash | 内容 |
|---|---|
| `ef7ef3f` | 修 `map_adapt_newdire.py` 空 Triggers 崩溃 + 新增 `tools/gen_map_contract.js` |
| `d67d9db` | 适配新图 → `live_map_001.tmx` + `battle/map-config.json` + 水域判据修正 |
| `666f361` | 中继改读地图契约（CC/巡逻/镜头/观众基准）+ `verify:mapcontract` |
| `e4d32cb` | 兵种四分类生成器 + `unit-categories.json` + 校验 |
| `7ae6488` | 外置排行榜（`/api/leaderboard` + overlay + 校验） |
| `6ea43a8` | AI 难度收窄 + 推手两边同兵种 |
| `62e90e7` | 召唤白名单（四分类）+ 推手 v3 |
| `5c8f99f` | 用户可见文案示例词改用白名单词（`红3战车`→`红3狂暴者`） |
| `b95fabe` | 新增 `tools/map_move_bases.py` + 应用 dist=500 |
| `022ef9e` | `map_move_bases` 改为按类型移基地（防御原地） |
| `94247b7` | `map_move_bases` 默认**只移 commandCenter** |
| `8f87a31` | 推手 `maxPerSide` 300→80 |
| `38f2cb6` | 召唤机制重估（零门槛 + 分档 + 冷却3s + 推手低强度 + `[PUSH]` 日志） |
| `3d391b9` | `[PUSH]` 日志分隔符 |

**顶层仓库（branch `master`）**：`2c6a495` docs(units): 新增 `docs/兵种分类模板.md`。

### 验证证据（本会话真跑过的）

**离线**：
- `python danmaku-relay/tools/map_adapt_newdire.py selftest` → S1–S8 全 OK
- `node danmaku-relay/tools/gen_map_contract.js --selftest` → C0–C8 全 OK
- `node danmaku-relay/tools/verify_map_contract.js` → 9/9 PASS
- `node danmaku-relay/tools/verify_unit_categories.js` → 6/6 PASS（四桶并集 == 431、无重无漏）
- `node danmaku-relay/tools/verify_leaderboard.js` → A1–B6 全 PASS
- `python danmaku-relay/tools/map_move_bases.py --selftest` → S1–S7 全 OK
- `python .rivet/skills/switch-map/scripts/verify_adapted_map.py <源> <产物>` → 9 条全 OK、exit 0（对**新图**）
- `python danmaku-relay/tools/verify_units_et.py <产物>` → XML 通道 PASS
- **`cd danmaku-relay && npm run verify` → exit 0**（22 文件语法检查 + 19 项 `verify:*`）
- 新断言 `E7`(零门槛「红」→基础兵 x1) / `E8a-c`(分档 2/5/10) / `E9`(冷却 3000) 均 PASS

**实机**（起中继 → 开局）：
- `lastrun.log`：`Mapfile: assets/maps/skirmish/live_map_001.tmx`、`Could not find (custom) unit` 计数 **0**、`spectator` 计数 **0**；`end_live.txt` `defeat 0`（无秒判负）
- 弹幕落点：红 `EkWardenMechX x2 @(3734,1882)` / 蓝 `Ek_mutli_laser_ship x2 @(859,1736)` ⇒ 均在新 CC ±45 内
- **光发「红」→ `[SPAWN] 红方 EkBuzzard x1 (base) @(3746,1886)` 花费 18000**（零门槛生效）
- **「红3狂暴者」→ `EkWardenMechX x2`**（分档封顶生效）
- 同一观众 3 秒内再发 → 无新生兵（冷却生效）
- `[PUSH] 各 +3 → 红 Ek_mutli_laser_ship ×3 | 蓝 Ek_mutli_laser_ship ×3（累计 红3/蓝3，上限 400）`
- `GET /api/leaderboard` 返回正确；`toolbox/leaderboard.html` 在浏览器渲染正确（阵营条 + 观众榜）
- 截图确认：新图渲染正常（草地/沙地/海域）、两基地分列最左/最右、防御线留在中场、**无 Defeat 面板**

---

## 当前卡点

### 1. 🔴 游戏帧数：**未定位，证据互相矛盾**（最高优先）

用户报「运行着越来越卡、帧数掉到几十」。实测（全部来自本会话）：

- java 进程 **CPU 单核 93–100%**，内存 ~315–360MB；**只有 1 个 java + 1 个中继**（无残留进程）。
- **新局刚开局（elapsed 47s、几乎没兵）CPU 就 92.9%** ⇒ **不是单位累积**。
- 现场把 `zoom` 从 0.399 调到 0.605，CPU **96.3%**（基本不变）⇒ **不是镜头**。
- 关掉画质三项后重启，CPU **99.3%**（基本不变）⇒ **画质项也不是主因**。
- 抓帧读屏幕 FPS（`preferences.ini` 里 `showFps:true`）：**开局 198 → 5.4 分钟 141（正抓在混战瞬间）→ 7.5 分钟 160**。**先降后升、不单调** ⇒ 我的判断是"随当下交火强度波动"，但**没能复现用户说的"几十 fps"**。
- 旁证：`lastrun.log` 高频 `Loading in lazy loaded bitmap` / `Recreating image data from texture`（30 分钟内 400 次，涉及 262 张贴图 / 115 个单位目录）——**贴图缓存抖动**。

**已排除**：进程泄漏、单位累积、镜头 zoom、画质三项。
**怀疑**：RW 主循环本就是**单线程 CPU-bound**（每 tick 模拟**全部**单位，不看是否在屏幕内）；这台机器是 **Intel Iris Xe 集显 + i5-1135G7**（旧 HANDOVER 记的 C3：Intel 驱动 native 帧崩溃）。
**用户明确不接受**「地图太大」这个解释（原话：「地图不算大，如果这都大那之后都不用玩了」）。

### 2. 「执行者」礼物触发**未接线**

用户要求 air 的 `Ek星舰`（执行者，清图兵）「后面只能由礼物触发」。现在只在白名单里标了 `giftOnly:true`（**不进弹幕召唤、不进推手**），**礼物路径没有任何代码读它**。`battle/giftTiers.js` 的 `GIFT_TIERS` 仍是旧的 `megaTank/mammothTank/laserTank/heavyTank`（**这四个都不在召唤白名单里**）。

### 3. 观众指令量 = 0 的**效果**未验证

历史上长期 0 条指令（2026-09-23 全天 0）。本会话把门槛改成「光发红/蓝就出基础兵」，**机制已验证生效，但"指令量是否真的涨"需要真实直播数据**。

### 4. sea 分类为空，但地图有真实水域

地图有 28598 格浅水，海军本可用；用户四分类里 sea 没填。

### 5. `roundMaxMs` = 30 分钟未复核

`danmaku-relay\data\battle-config.json` 的 `roundMaxMs: 1800000`（该文件 **gitignored**，不进仓库）。实测某轮跑到 12 分钟仍在继续。

### 6. `.rivet` 下的修复会丢

`.rivet\skills\switch-map\scripts\verify_adapted_map.py` 本会话**修过**（同一个 `_TRIGGERS_RE` 缺陷，见「坑」2），但 `.rivet` 不受版本管理 ⇒ **下次工作时修复就没了**。

---

## 下一步

**P0 — 先做这两个**

1. **把 `.rivet\skills\switch-map\` 整份搬进仓库**（如 `danmaku-relay/tools/switch-map/`），并把 `.rivet\scratch\grab_shot.py`（PrintWindow 抓帧脚本）也一起搬。搬完删 `.rivet` 下那份，避免两份漂移。**这是消除"每次重踩同一个正则坑"的根本手段**。
2. **确认当前服务状态**：中继由 `node index.js --auto-start` 启动（占 `:8766` / `:8767`，并拉起游戏占 `:9999`）。要停：先 `curl -X POST http://localhost:8767/api/stop`，再按 **PID** `taskkill /PID <pid> /F`。判据：`netstat -ano | grep -E ":(8766|8767|9999)\b"`。

**P1**

3. **拍板帧数问题**（见卡点 1）。二选一：
   - a) 让用户**盯一局**报"开局多久掉、掉到多少、是混战时掉还是平时也掉"（我复现不出「几十」）；
   - b) 若怀疑是**换图导致**（旧图 110×110 → 新图 230×180），把 `battle/map-config.json` 的 `map` 临时改成 `new_dire_nomoo.tmx`（旧产物仍在 `<GAME>/mods/maps/`）跑一局对比 FPS。
4. **接「执行者 = 礼物触发」**：在 `battle/giftTiers.js` 加一档「高价值礼物 → `Ek星舰`」，并让 `handleGift`（`battle/index.js`）识别；建议同时把 `GIFT_TIERS` 的旧兵种换成白名单里的（现在那四个都不在召唤集）。

**P2**

5. **看真实直播数据**判断零门槛入口的效果：`danmaku-relay\logs\combined.log` 里 `[SPAWN]` / `[DANMAKU] 未识别` / `[CREDIT]` 曲线（注意坑 14：该日志会被 `npm run verify` 写入假事件污染）。
6. **填 sea 分类**（要海军的话）。
7. **复核 `roundMaxMs`**：跑一局看 30 分钟是否触发超时结算。

**P3**

8. 若用户觉得画面变差，`preferences.ini.bak-gfx-20260927` 一键还原画质三项。

---

## 坑

1. **`map_adapt_newdire.py` 的 `_TRIGGERS_RE` 对「空自闭合 Triggers」会崩**。源图若是 `<objectgroup name="Triggers"/>`，旧正则 `[^>]*>.*?</objectgroup>` 会把 `/>` 当闭合、一路吞到 **UnitObjects 的 `</objectgroup>`** ⇒ `transform()` 抛 `AttributeError`（实测复现过）。**已修**（改为 `(?:/>|>.*?</objectgroup>)`），并有 selftest S7/S8 钉住——**改这个正则后必须跑 `selftest`**。
2. **`.rivet\skills\switch-map\scripts\verify_adapted_map.py` 有同一个旧正则缺陷**（对空 Triggers 会假红报 `FAIL 1) 除 Triggers/UnitObjects 外逐字节相同`）。本会话已用**扫描式非正则**剥离修好，但 `.rivet` 不受版本管理 ⇒ **会丢**。换图复核若见该 FAIL，先怀疑脚本，别怀疑产物。
3. **换图后必须重跑 `map_move_bases` + `gen_map_contract`**。`map_adapt` 从源图重算 ⇒ 基地回到源图位置、`map-config.json` 坐标过期 ⇒ 兵生成到错误位置、巡逻目标错。
4. **`map_move_bases` 的移动集是「类型」不是「半径」**。默认 `BASE_TYPES = {'commandCenter'}`。早前版本用半径 650px，把整个防御圈都带走了（红 38 / 蓝 45 个对象），用户当场发现「怎么全都移动了」；再往前一版按类型移了 CC+经济建筑（红17/蓝22），用户仍说多。**最终定案：只移 commandCenter**。
5. **推手此前完全没有日志**（现在有 `[PUSH]`）。任何"推手到底推了多少兵"的问题只能靠这行日志或抓帧数，**没有读单位总数的 API**。
6. **帧数不能只看 CPU%**。这台机器上 RW 主循环**常态就是单核 100%**（开局、没兵时也一样）。判断卡不卡要看**游戏左上角的 FPS**（`preferences.ini` 的 `showFps:true`），而 RW 的 `renderVsync:false` ⇒ **帧数不锁**，198/141 都是正常值，不是"卡"。
7. **`preferences.ini` 只在游戏启动时读**。改完必须**完全重启游戏**。
8. **中继改 `battle/*.js` 必须重启中继**（只在启动时 `require`）。判"新代码生效"的硬锚点是**进程启动时间**，不是症状。
9. **`danmaku-relay` 是独立 git 仓库**。顶层仓库 `git add danmaku-relay/...` 无效；子仓库改动一律 `git -C danmaku-relay add/commit`。
10. **杀进程必须按 PID，且先验身份**。`taskkill /IM java.exe` 会杀掉机器上**所有** JVM；历史上还误杀过 `explorer.exe` 导致桌面消失。用 `taskkill /PID <pid> /F`。
11. **PowerShell 里 `$pid` 是只读自动变量**，`foreach ($pid in 1,2) {...}` 会**静默不执行**（本会话踩过，以为杀掉了其实没杀）。改用具名变量。
12. **bash 工具有 120s 硬超时**，`sleep 245` 会被截断；长等待要分两段（各 ~110s）。
13. **向中继发中文弹幕必须 `\uXXXX` 转义**。本会话踩过：`\u51f0\u51f0` 是「凰凰」不是「凤凰」（`\u51e4\u51f0`），结果被判「未识别」——**先怀疑自己的转义，再怀疑代码**。
14. **`npm run verify` 会往真日志 `logs/combined.log` 写假事件**（`没听懂`/`4蜘蛛`/模拟轮次）。拿这些行当故障证据会得出完全错误的结论。
15. **游戏 JVM 跨轮复用**。任何"每轮一次"的 JVM 级静态量会被多轮共用（旧交接记过 `EndBridge.firstSeenMs` 栽在这）。
16. **`<GAME>/assets/maps/skirmish/` 那份地图每轮被中继覆盖**——手改它是白改，源永远是 `mods/maps/`。
17. **`battle/mapPool.js` 的日志（"经典战场/森林遭遇"）是遗留代码**，与实际加载无关。要确认真实地图只看 `lastrun.log` 的 `Mapfile:` 行。
18. **`data/battle-config.json` 是 gitignored**，改动不进仓库；中继启动时 `index.js` 会调 `battleConfig.loadDefaults()` 读它。
19. **排查卡顿前先分清"当下交火"还是"随时间"**。本会话两个假设（单位累积、镜头拉远）都被实测推翻，浪费了往返——**先取时间序列数据（多点抓帧），再下结论**。
20. **`write_file` 拒绝覆盖本会话没读过的 `.rivet\HANDOFF.md`**（本会话踩到）。覆盖前必须先 `read_file` 一次；惯例是先把旧版 `cp` 成 `HANDOFF.prev-<日期>-<主题>.md` 再覆盖（本文件就是这么做的）。

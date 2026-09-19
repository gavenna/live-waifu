# BRIEF：让 FFA 的多支 AI 各自拿到基地并参战（Rusted Warfare 1.15）

> 交给 Claude Code 的交接文档。§3 是**已实测确立的事实**，§4 是**已经失败、不要重试**的路线。
> 先读 `D:\app\Hermes Agent CN Desktop\data\hermes-home\profiles\live\skills\software-development\live-waifu-ops\SKILL.md`（99KB，含全部历史结论与反编译证据），再动手。

## 0. 一句话背景

直播间弹幕生兵对战。《铁锈战争》引擎能开 **8 个玩家（1 真人 + 7 支 AI，见 §3.1 配方）**，但**只有 team 0/1 能从地图上拿到基地单位**，team 2~7 开局一个单位都没有（`isTeamWipedOut=true`），AI 直接放弃（`firstRun: no command center found`）。
**目标：找出"地图单位只对前两支队生效"的真正原因，或换机制给 team≥2 生存单位。**

## 1. 目录与关键文件（绝对路径，照抄）

| 用途 | 路径 |
|---|---|
| 游戏根目录（下称 `GAME`） | `D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15` |
| 地图**真源**（改这个） | `GAME\mods\maps\live_battle.tmx` |
| 引擎实际加载的副本（每轮由中继复制） | `GAME\assets\assets\maps\skirmish\live_battle.tmx` |
| 引擎日志（**唯一**日志出口，UTF-8） | `GAME\lastrun.log` |
| 沙盒选项界面 | `GAME\assets\gui\sandboxOptions.rml` |
| 引擎缓存目录 | `GAME\cache\*.cachedata` |
| 反编译树 A（librocket + rts\game + rts\appFramework） | `D:\Projects\live-waifu\war-vote\tools\decompiled\main_out\com\corrodinggames\` |
| 反编译树 B（**只有** rts\gameFramework 包，534 类） | `D:\Projects\live-waifu\war-vote\tools\_gfdec\gf_src\com\corrodinggames\rts\gameFramework\` |
| CFR 反编译器 | `D:\Projects\live-waifu\war-vote\tools\cfr.jar` |
| 中继（**发 Debug 命令的唯一通道**） | `D:\Projects\live-waifu\danmaku-relay`（`node index.js --auto-start`，端口 8766/8767） |
| 我方探针/研究脚本（已归档） | `D:\Projects\live-waifu\_archive\ccresearch-game\` |

### 树 A 里真正相关的文件

- `rts\game\b\g.java:82-179` ★**单位瓦片 → 单位**。`:85` 取瓦片属性（取不到就当地形，**无日志**）；`:107` 读 unit 名；`:109-113` `n.k(team)` 为 null → log `skipping unit without player:...at:X,Y team:N` 并丢弃；`:148-151` unit 名查不到会 `throw f("Could not find unit:...")`（**会在日志里看得见**）；`:154` 创建单位；`:168` 置 `bP`（"这是指挥中心"标志）；`:171` `n.c(am)` 入世界；`:175` 静默 return。
- `rts\game\b\e.java:349 / :395` 图层遍历，调用 `g.a(b, this, tileset, gid - tileset.l, x, y, ...)`。
- `rts\game\b\b.java:568` `_moved` 机制；`:890-897` 逐 `<layer>` 解析。
- `rts\game\a\a.java:947-957` ★AI 的 `firstRun`：**一辈子只跑一次**，`this.e(this)` 找本队指挥中心，找不到就永远不设攻击目标。
- `rts\game\n.java:1422-1438` `n.k(int)` 队伍查找（越界/负数才 null）。
- `rts\appFramework\i.java:82-136` ★玩家/AI 创建（在地图加载**之前**；`bl3=false` ⇒ 奇/偶队号都用、且不写 `n12.r = 1`）。
- `rts\appFramework\c.java:46-72` `getNumberOfPlayersInMap`（`[pN]` 正则）。
- `librocket\scripts\Root.java:205` `setValueById(id, value)`；`:635-645` `loadConfigCommon` 读 `numberOfAIs`/`aiTeams`；`:1101` `setValueDynamic`。
- `librocket\scripts\Debug.java` 全部 67 个 public debug API（`createUnit` / `getPlayerName` / `isTeamWipedOut` / `isTeamDefeated` / `setGameSetting` / `moveAllUnitsOnTeam` / `lookAt` …）。

### 树 B 里相关的文件

- `rts\gameFramework\SettingsEngine.java:217` `setValueDynamic(String key, String value)`（键名 == RML 元素 id）。
- `rts\gameFramework\n\c.java:110-124` + `n\e$7.java` **触发器动作 unitAdd**（读 property **`spawnUnits`**）。
- `rts\gameFramework\n\d.java:115-133`。
- `rts\gameFramework\n\bp.java` **单位自定义属性解析器（尚未反编译出来）** —— 走 `spawnUnits` 路线的拦路虎。

## 2. 目标（按价值排序）

1. ★ **找出 `g.java` 单位瓦片生成对 team≥2 的真实过滤点**（或证明过滤发生在别处）。当前最强证据指向"这些格子**根本没被当成单位瓦片处理**"，见 §3.3。
2. 备选：用触发器 `unitAdd` / `spawnUnits` 语法，在 `firstRun` 之前生成基地。
3. 备选：任何能在 `firstRun` 之前给 team 2..7 塞进指挥中心的机制。

## 3. 已确立的事实（都实测过，别重做）

### 3.1 多阵营 + 多 AI 已经能开出来（配方，实测通过）

游戏自己的沙盒选项里就有这两个控件（`GAME\assets\gui\sandboxOptions.rml:225,240`）：
```html
<select id="numberOfAIs">  0 1 2 3 [4] 5 6 7          ← AI 数量 0~7
<select id="aiTeams">     [vs all] 1 ally 2 ally 3 ally  Free for all
```
`Root.java:635-645` 读取；`aiTeams==5`(Free for all) ⇒ `bl4=false` ⇒ `i.java:117-133` 里 `bl5=true`（奇偶队号都用）+ 跳过 `n12.r=1`（每支 AI 保持"自己的队号"当同盟组）⇒ **7 支 AI 各自一个阵营、互相敌对**。用 Debug Socket 一行一条：
```
script root.open('sandboxOptions.rml', 'maps/skirmish/live_battle.tmx')
script root.setValueById('aiTeams', '5')          # 5 = Free for all
script root.setValueById('numberOfAIs', '7')      # 1..7
script root.loadConfigAndStartNewSandbox('maps/skirmish/live_battle.tmx')
```
**实测（2026-09-17 00:27）**：`numberOfPlayersPlusAI() = 8`；`getPlayerName(1..7) = "AI - Medium"`；日志 `Allies: 0/0`；`isTeamWipedOut(1)=false`、`2..7=true`；team 8/9 无玩家。
⚠️ `setValueById` 有副作用：它似乎会**触发沙盒重启**（日志里 "Starting sandbox from map" 紧跟最后一次 setValueById）。设置会写入 `preferences.ini`（持久化）。
⚠️ 必须先 `root.open('sandboxOptions.rml', ...)`，否则 `loadConfigCommon` 会 NPE（日志里是 `null`）。
⚠️ 队友字母映射：**A=3 C=2 E=4 F=5 G=6 H=7 I=8 J=9**（0 = 真人 "Player"）。

### 3.2 已有的"能跑通"的对战基线（别弄坏它）

中继 `battle\teams.js` + `battle\gameController.js` 里：`RED_TEAM=1`（AI，有基地 → 会主动进攻）、`BLUE_TEAM=0`（人类槽位但有基地）；**同盟组必须不同**（`{1:1, 0:0}`；历史上写成 `{1:0,...}` 导致红方成了蓝方同盟 ⇒ 永远零击杀，已修）；双方弹幕兵出生点收紧到相距 <50px。
实测结果：红方 AI 在 **4 分 06 秒**打爆蓝方主基地，结算面板 `Units Killed 6 / Units Lost 6`（双方各击毁 6 个单位）。

### 3.3 team≥2 拿不到地图单位：实测证据

- 往 `live_battle.tmx` 的 Units 瓦片层铺了 **team2~7 的指挥中心+builder**（gid 89 / 107 / 143 / 156 / 158 / 160，且已核对 `units.tsx` **两份副本**的 tile id 完全一致，排除"用错 tileset"）：开局日志 `ai_debug(2..7): firstRun: no command center found` 一条不少，`isTeamWipedOut(2..7)=true`。
- **team9 探针**（gid 180 = `units.tsx` tile 178 = `{team:9, unit:commandCenter}`；team 9 **永远不是玩家**）：分别放在 `(34,36) (34,20) (30,23) (20,24) (10,25) (25,26) (5,29) (15,32) (25,36)` —— **一条 `skipping unit without player` 都没有**。按 `g.java:111`，只要该格子被当成单位瓦片处理、且队伍查不到，就**必然**打这行 ⇒ **这些格子根本没进入"单位瓦片"处理流程**（不是"队伍查找失败"）。
- 引擎自报 `there are 8 units on this map and 0 trees`：在 **12 格版和 23 格版地图上都是 8**，与瓦片数无关（含义未解释，暂时别当判据）。
- "玩家创建晚于地图解析"这个猜想被日志排除：`Allies: 0/0`（玩家创建完）在 `00:27:28.416`，`MapLayer create: Units` 在 `.490`，`ai_debug` 在 `.729` ⇒ 解析地图时玩家**已经**存在。
- 现有绿皮地图（能用的那份）：Units 层 12 个非空格 = 第 18~21 行：team0 `tank(2,3) gid4 / landFactory(3,18) gid17 / builder(5,18) gid3 / CC(3,20) gid8 / builder(5,20) gid3 / heavyTank(16,21) gid6`；team1 `builder(34,18) gid48 / landFactory(36,18) gid62 / heavyTank(23,19) gid51 / builder(34,20) gid48 / CC(36,20) gid53`。（`gid = 2 + tileId`，`units.tsx firstgid=2`；**team1 的 CC 只来自 (36,20) gid53 = tile51**。）

### 3.4 ★★ 引擎的两个"文件系统"怪癖（最容易踩，不要再花时间验证）

**(a) 换新文件名一律加载不了。**
把地图复制成 `mt1.tmx`（与 `live_battle.tmx` **字节相同**）→ `Could not find map: assets/assets/maps/skirmish/mt1.tmx`；**杀掉游戏进程、重启后依然找不到**；用游戏自带的 `[p2]example_skirmish_(2p).tmx` 对照，同样失败。⇒ 引擎只认"它启动时就登记过的路径"。存在 `GAME\cache\*.cachedata`（`.meta` 里是 `时间戳:list`）与日志里的 `StateEngine: get(<地图路径>)=...bf@...` 解析缓存。
**(b) 同一游戏进程内重复起沙盒时，地图内容改动可能不生效**（复用已解析的地图）。
⇒ **改地图后必须重启游戏进程**；**别指望新文件名**。
⇒ 这也解释了为什么"`[pN]` 文件名前缀声明队伍数"的方案失败：**不是方括号的问题，是引擎不认识这个新名字**（虽然 `Max teams on map` 能被解析成 4）。

### 3.5 Debug 通道与 API 现状

- 引擎**只允许一个 Debug Socket 连接**（9999 已被中继占用）⇒ 不能直连，一律用中继的调试通道：
  `POST http://localhost:8767/api/battle/exec`  body `{"cmd":"<命令>","waitMs":600}` → 返回 `{ok, replies}`。
- 命令前缀：`script <js>`（RML/Root 脚本，如 `script root.clickElement(root.getElementById('ok'))`）、`function <js>`（引擎对象方法，返回值进 `replies`，如 `function debug.isTeamWipedOut(2)`）、裸命令。
- ⚠️ **开局瞬间 Debug Socket 会被重置** ⇒ 命令必须"重连+重试"（中继 `gameController.sendScript` 已实现 15 次 × 2 秒）。
- 实测可用：`getPlayerName(t)`、`isTeamWipedOut(t)`、`isTeamDefeated(t)`、`createUnit(type,x,y,team,centerCamera)`、`numberOfHumanPlayers()`、`numberOfPlayersPlusAI()`、`setGameSetting(k,v)`、`moveAllUnitsOnTeam(t,x,y)`、`lookAt(x,y)`、`resumeNonMenu()`。
- **不存在**：任何"查某队单位数 / 击杀数"的 API（`Debug.java` 67 个 public 方法里没有）；也没有"下攻击命令"的 API；
  `moveAllUnitsOnTeam` 是**纯移动**（`e.a(x,y)`，从不设攻击移动标志 `e.h`）⇒ 实测 300 秒零击杀。
- `roundManager.killCount` **恒为 0**（没人 +1），**绝对不能当验证判据**（历史上被它误导两轮）。
- `isTeamWipedOut` 是**整队级别的锁存**标志（一旦 true，后来补兵也不恢复）。

## 4. 已验证的失败路线（**不要重试**）

1. `[pN]` 文件名前缀声明队伍数 → 见 §3.4a（解析成功但加载不了）。
2. 往 `UnitObjects` objectgroup 写 `unit`/`team` 属性 → 引擎不读（已回退，别再加）。
3. 改 Units 瓦片层给 team≥2 铺建筑 → 见 §3.3（连"skipping unit"日志都不打）。
4. `debug.createUnit` 抢在 `firstRun` 前塞基地：时序 `Starting sandbox` → `firstRun` 只有 **180~365ms**；实测命令到达时已过 `firstRun`（team2..7 依旧报无指挥中心）；若早于起始命令，则会被地图加载清掉。
5. `moveAllUnitsOnTeam` 制造交火（只移动不攻击）。
6. "手动补建 AI 玩家" —— 不用，引擎白送 7 支（§3.1）。
7. 静态分析"引擎里没有按队伍过滤地图单位" —— cc 上一轮这么结论，但**与实测矛盾**（team≥2 确实拿不到）；别照抄这个结论。

## 5. 方法论 / 现成工具（照用，别自己造）

- **判据日志关键字**（`GAME\lastrun.log`）：
  `ai_debug(N):firstRun: no command center found`（该队没基地）、`Not showing defeated message: <p> had no starting units (Team: X)`（该队开局无单位）、`skipping unit without player`、`Starting sandbox from map:`、`Max teams on map ... = N`、`Allies: x/y`、`MapLayer create: <layer>`、`there are N units on this map`、`Could not find map`、`Mapfile: ...`、`Error loading map:`。
- ⚠️ **引擎大量静默失败** ⇒ 永远要找"结果指标"（`isTeamWipedOut` / `ai_debug` 有无 / 结算面板），不要等报错。
- 探针脚本（`D:\Projects\live-waifu\_archive\ccresearch-game\`）：
  `relay-lab.js`（raw/探针）、`ffa-round.js`（FFA 起局并回读各队）、`ffa-bases.js`（抢跑 createUnit）、`probe_rows.py` / `probe_team9.py`（瓦片探针）、`patch_multiteams.py`（铺/还原基地瓦片）、`dump_tmx.py` / `layers.py` / `cmp_units_tsx.py`（TMX/TSX 解析）、`shot.py`（PrintWindow 后台截图，不抢焦点）、`unitview.py` / `hotprobe.py`（画面像素判据）、`start-round.js`（起局带重试）。
- 运行：`cd D:\Projects\live-waifu\danmaku-relay && node index.js --auto-start`；开局 `POST /api/battle/start`（偶发 20 秒超时"游戏启动失败: unknown"→ 重试即可）；状态 `GET /api/battle/state`；生兵 `POST /api/battle/simulate-danmaku {"content":"红坦克"}`。
- 验证"打起来了"：结算面板 OCR（`Game Time` / `Units Killed` / `Units Lost`），或截图交给人看。**别用画面亮点像素猜交火**（我栽过：游戏早就打完停在结算面板，我测的是暂停画面）。

## 6. 红线（必须遵守）

- **绝不干扰用户桌面**：历史上无人值守跑"实启实停"杀掉了 `explorer.exe`，用户桌面/任务栏/开始菜单全没了。
- 任何 `taskkill`/`Stop-Process` **必须先校验进程身份**（PID 会复用、窗口标题谁都能设）；永不触碰 explorer/winlogon/dwm/csrss/sihost/hermes-*。
- 不要在用户正在用的机器上无人值守跑"开窗口 / 占端口 / 编译 / 启停服务"的操作；需要时先问。
- **不要破坏 §3.2 的对战基线**：改 `live_battle.tmx` 前先备份（`mods\maps\` 下已有多个 `.bak-*`），team 0/1 的 12 个格子是能跑通的配置。

## 7. 交付要求

- 结论要有证据：日志原文行（带时间戳）+ 回读值 + 截图路径。
- 判成败只看 `is_error` + exit code + **回读产物**（任务报告的 `subtype` 会谎报成功）。
- 别一次问太多问题：`cc` 的 `-MaxTurns` **默认只有 12**，必须显式调大，例如
  `cc -Brief .\BRIEF-multifaction.md -MaxTurns 45 -TimeoutSec 1500`。

## 8. 建议的第一步（成本最低、信息量最大）

**一次实验同时验证两件事：把 `(36,20)` 的 team1 指挥中心瓦片值 `53` 换成 `107`（team3 的指挥中心），保留其余 12 格不变。**

- 若 `ai_debug(1): firstRun: no command center found` **出现** ⇒ 说明该格子**确实被解析**（team1 丢了它唯一的 CC）。
- 若 `ai_debug(3)` **消失** ⇒ 说明 **team≥2 完全可以从瓦片拿基地** ⇒ 那么之前失败的原因就在别处（很可能是 §3.4b 的地图缓存！→ 立刻改成"重启游戏进程 + 不改文件名"重测）。
- 若两者都没变 ⇒ 再次确认"引擎读的不是我们写的那份数据"，下一步去查引擎的资源解析路径（`b.java` 的 `Mapfile:` 那几行日志显示 `assets/maps/skirmish/mt1_moved` 这种 `_moved` 回退机制，值得深挖）。

（脚本就绪：`python patch_multiteams.py restore` 可回到绿皮 12 格版；改单元格可直接复用 `probe_rows.py` 的写法。）

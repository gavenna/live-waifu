# 任务：只调研（读代码），回答"为什么引擎不给第 3 支队伍生成地图单位"

项目根：`D:\Projects\live-waifu`。**只读代码，不要跑 shell、不要启动游戏、不要改任何文件（只写 RESULT.md）。**
两棵反编译树：
- `war-vote\tools\decompiled\main_out\`（原 jar 大部分）
- `war-vote\tools\_gfdec\gf_src\`（`com.corrodinggames.rts.gameFramework` 包，534 个类）

## 已经实机确证的事实（直接采信，别复现）

1. 地图 `mods\maps\live_battle.tmx` 的 `Units` 瓦片层里有：team0 指挥中心(gid 8)、team1 指挥中心(gid 53)、**以及我们手工加的 team3 指挥中心 (gid 107 = units.tsx tile 105，properties 实读为 `{team:3, unit:commandCenter}`)**。
   两份 TMX（`mods\maps\` 与 `assets\assets\maps\skirmish\`）**字节完全相同**，游戏日志确认加载的就是它。
2. 开局后实测（`function debug.isTeamWipedOut(t)` / `debug.getPlayerName(t)`）：
   - team 0 = "Player"（人类）wiped=false ← 地图单位**生成了**
   - team 1 = "AI - Medium"  wiped=false ← 地图单位**生成了**
   - team 2 = `<NULL>`
   - **team 3/5/7 = "AI - Medium"，wiped=真正 true** ← **一个单位都没有**（日志 `Not showing defeated message: AI - Medium had no starting units` 恰好 3 条，对应 3/5/7；team 1 没有这条）
3. **两条完全独立的生成路径都被静默跳过**：
   - 瓦片层路径 `game\b\g.java:82-179`（按 tileset 瓦片 properties 取 `unit`/`team`）
   - objectgroup 路径 `game\b\a.java:111-190`（`<object>` 自带 `unit`/`team` properties；引擎自己保存地图时用的就是这格式，见 `game\b\b.java:635-677`）
   两条路各自的"跳过"分支**都会打日志**（`g.java:111 "skipping unit without player"` / `a.java:137 "Unit object without team"`），
   而 `lastrun.log` 里**这两条日志一条都没有** ⇒ 跳过发生在"逐瓦片/逐 object 判断"**之前**。
4. 关于队伍数：日志
   ```
   Starting sandbox from map: maps/skirmish/live_battle.tmx
   Max teams on map: maps/skirmish/live_battle.tmx = -1
   ```
   地图名**没有 `[pN]` 前缀** ⇒ `appFramework\c.java:46-72 getNumberOfPlayersInMap` 解析失败返回 -1。
   改成 `[p4]live_battle.tmx` 后：`Max teams on map = 4`（解析成功），**但引擎找不到这个文件**：
   `Could not find map: assets/assets/maps/skirmish/[p4]live_battle.tmx`（文件确实存在，用游戏自带的 `[p2]example_skirmish_(2p).tmx` 对照也一样失败）。

## 要回答的问题（每条都要 file:line 证据）

### Q1 ★★★ 引擎在哪里限制"给哪些队生成地图单位"？
- 已知 `appFramework\i.java:95-100`：`n8 = n.c - 1; n9 = appFramework.c.a(mapName); if (n9 > 0 && n9-1 < n8) n8 = n9-1;`，
  之后用 `n8` 创建 AI 玩家（`:104-133`）。**AI 玩家创建在 map 加载之前**（`:136 l2.a(false, s.b)` 是加载），
  所以 team 3 的玩家对象在解析地图时**已存在**。
- 那么**地图单位**的生成是在哪里被限制的？请找出：遍历 Units 层/objectgroup 生成单位的调用链
  （`game\b\g.java` 的 static `a(b, e, j, int, short, short, boolean)` 的**调用者**是谁？`game\b\a.java` 的 object 解析由谁驱动？），
  以及那里是否有 `team < K` / `n9` / `n8` / `n.c` / map 对象的某个字段 的上限判断。
- 关键问题：`n9 == -1`（无 `[pN]`）时，单位生成用的是哪个默认值（看起来是 2）？在哪里写死/兜底的？把那段代码贴出来。

### Q2 ★★ 为什么"basename 以 `[` 开头的松散文件"加载不了？有没有办法绕？
- 调用链：`game\b\b.java:568 b(String)` → `:588 d(String)` → `:580 c(String)` → `gameFramework.e.a.e(String)`（补 `assets/` 前缀）→ `:186 e.a.k(String)` → `gameFramework.e.b.j(String)`。
- 在 `gf_src\...\gameFramework\e\*.java` 里找**路径清洗 `e(String)`** 与 **解析器 `b.j(String)`** 的实现，
  判定 `[` `]` 是不是被当成 **mod 标签 / 通配符 / 正则字符类** 处理（例如 RW 的 `[modname]path` 语法）。
- 有没有绕过：把地图放进 mod 包（`.rwmod` / `mods\<name>\`）、换个 root、或利用 `b.java:568-578` 的 **`_moved` 机制**
  （`<name>_moved` 文件的内容被当成真正的路径）。注意 `getNumberOfPlayersInMap` 只吃 **basename**，所以有没有可能
  "路径能加载" 而 "basename 带 `[pN]`" 两者同时满足（例如通过 `_moved` 指到无方括号的真实文件）？请从代码给出判定。

### Q3 ★ 触发器 `unitAdd` 能不能给 team 3 生成指挥中心？语法是什么？什么时候触发？
- `gameFramework\n\c.java:110-124`：type=`unitAdd` 的动作读 property **`spawnUnits`**，交给
  `com.corrodinggames.rts.game.units.custom.bp.a(String,String,String)` 解析（`bp` 是 **`units.custom` 包**的类，
  它**不在**两棵树里：`main_out\...\units\custom` 只有 35 个文件）。
  请从其它线索推断 `spawnUnits` 的书写语法（错误信息文案、保存端、`bo` 异常、`unitAdd` 相关常量）。
- 判定 `gameFramework\n\d.java:115-133` 的触发时机 vs `game\a\a.java:947` 的 **一次性 firstRun**：
  `bd` 一旦置 false 就再也不初始化 AI 决策 ⇒ 触发器必须在 firstRun 之前生成指挥中心才有效。代码上判断得到吗？

### Q4 还有没有别的"增加队伍数"的杠杆？（各给结论：有/没有 + 证据）
- `debug.setGameSetting(String,String)`（`librocket\scripts\Debug.java:527`）在引擎侧有哪些 key？
- `map_info` 的属性全集（`game\b\b.java:1001-1018` 只读到 `type`/`fog`，确认没有队伍数字段？）
- `team_info` 的属性全集（`gameFramework\n\f.java:319-361`：`team/credits/basicAI/lockAiDifficulty/disabledAI/allyGroup/ai`）——`ai` 是干什么的？`disabledAI`？
- 有没有"给某队补起始单位"的其它入口（`Debug.java` 的 `createUnit/createManyUnits/setNetworkStartingUnits`）？

## 节奏与交付
- **每查到一条立刻追加写 `RESULT.md`**（第一件事就是建文件写计划），最后给"最可行的方案排序 + 需实机验证的点"。
- Grep 优先，最多读 10 个文件。不确定的写「未确认」，**不要编造**。
- 交付：`.hermes-cc\<task-id>\RESULT.md`

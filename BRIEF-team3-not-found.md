# 任务：**只调研，不改代码** —— 为什么地图里的 team3 指挥中心瓦片没被引擎识别

项目根目录：`D:\Projects\live-waifu`

## 🔴 节奏要求
**每查到一条结论立刻追加写入 `RESULT.md`**（第一个动作就是建文件写计划）。轮次可能被截断，攒着写＝什么都留不下。

## 已经完全确认的事实（**直接采信，不要复现**）

1. **地图里有合法的 team3 指挥中心瓦片**：`mods\maps\live_battle.tmx` 的 `Units` 层
   `(36,36) = gid 107`。`units.tsx` 实读：`tile id=105` → `{team:3, unit:commandCenter}`，
   且 `gid = 2 + tileId`（对照现有 `(3,20) gid=8 → tile 6 → team0`、
   `(36,20) gid=53 → tile 51 → team1`，全部吻合）。**⇒ gid 107 是对的，别怀疑这一点。**
2. **地图确实被游戏加载了**：两份 TMX（`mods\maps\` 与 `assets\assets\maps\skirmish\`）
   都是 2312 字节、**字节完全相同**；游戏日志 `Starting sandbox from map: maps/skirmish/live_battle.tmx`。
3. **`team_3_info` 触发器也在**：`{team:3, credits:99999, allyGroup:2}`，`nextobjectid` 已 4→5。
4. **但游戏日志仍然报**（沙盒开局时）：
   ```
   ai_debug(3):firstRun: no command center found
   Not showing defeated message: AI - Medium had no starting units (Team: A)
   ai_debug(5):firstRun: no command center found
   Not showing defeated message: AI - Medium had no starting units (Team: B)
   ai_debug(7):firstRun: no command center found
   ```
5. **AI 需要指挥中心的确切机制**（上一轮已确认，`game\a\a.java:947-956` + `:900-910`）：
   ```java
   if (this.bd) { object2 = this.e(this);
     if (object2 == null) this.d("firstRun: no command center found");
     if (object2 != null) { ...才设 bh/bi/bj/bk 四个 AI 决策开关... } }
   public am e(n n2) { for (am am2 : am.bE) { if (am2.bX != n2 || !(am2 instanceof d.e) && !am2.bP) continue; return am2; } return null; }
   ```
6. `debug.getPlayerName(t)` 探测结果（同一次运行）：team 0=`Player`、team 1/3/5/7=`AI - Medium`、2/4/6/8/9=`<NULL>`。

## 要回答的问题

### Q-A ★★ 引擎在哪里把 TMX 的 `Units` 瓦片层解码成"真正生成出来的单位？"
- 已知地图解析在 `gameFramework\n\f.java`（`team_info` 属性解析在 `:319-361`）。
  找**读取 `<layer name="Units">` / 把 gid 变成单位实例**的那段代码。
- 给出：**它给哪些 team 生成单位？** 有没有过滤条件？
  （例如：只给 `team_info` 里声明过的队伍？只给出生点附近？只给前两队？瓦片的 `team` 属性怎么被读？）
- 关键：**为什么 (36,36) 的 team3 指挥中心没有被生成，或者生成了但 `am2.bX != 3` / 不是 `d.e`？**

### Q-B ★ 有没有更可靠的"给 team 3 一个指挥中心"的办法？
逐个评估（附 文件:行号）：
- **触发器动作 `unitAdd`**（`gameFramework\n\e$7` → `n\d.java:115-133`，需要单位列表 `a2.v` + team）——
  能不能直接用触发器**给 team 3 生成一个 commandCenter**？属性名怎么写？单位列表怎么指定？
- **`set_team`**（`f.java:389-398`，按类型生效）——把某个已有单位改成 team 3？
- **`rotate` / `attack_point` / `basicAI` / `allyGroup`** 里有没有别的相关开关？
- `mapGen.js` 生成器侧：它给 team 0/1 铺建筑用的是 `buildingCells(team)`，
  如果直接让生成器多铺一个 team3 的 `commandCenter`，**结果和这次手工塞瓦片会一样吗？**（判断这条路值不值得走）

### Q-C 顺带确认
- `d.e` 到底是哪个类（CommandCenter？还是"带指挥功能的建筑"基类）？`am2.bP` 是什么标志？
- `Not showing defeated message: ... had no starting units` 这句是在哪里打的？（搜该字符串的拼接处）
  它的判定条件是"该队伍没有任何单位"吗？如果是，是否意味着**单位层的 team3 单位一个都没生成**？

## 硬约束
- 🔴 **不要请求 shell / Bash，不要运行任何进程或游戏。** 只做代码读写。实机验证由 Hermes 执行。
- 🔴 **不要修改任何代码文件**（连地图也不要动），只写 `RESULT.md`。
- 两棵反编译树可用：`war-vote\tools\decompiled\main_out\`（原 jar 大部分）
  和 `war-vote\tools\_gfdec\gf_src\`（**`com.corrodinggames.rts.gameFramework` 包，534 个类**，
  地面/单位/地图解析很可能在这里）。
- **Grep 优先，最多读 8 个文件**，每步最多 3 次 grep。别通读。
- **不要编造运行结果**，不确定的写「未确认」。

## 交付
`RESULT.md`（**边查边写**）到 `.hermes-cc\<当前 task-id>\RESULT.md`：
Q-A / Q-B / Q-C 结论（每条附 文件:行号）+ 建议的实现方案（按可行性排序）+ 需实机验证的点。

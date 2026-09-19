# 任务：**只做调研，不改代码** —— 怎么让 AI 队变成"真实玩家"（有基地、会打）+ 击杀怎么统计

项目根目录：`D:\Projects\live-waifu`（代码在 `danmaku-relay\battle\`）

## 🔴 节奏要求
**每查到一条结论立刻追加写入 `RESULT.md`**（第一个动作就是建文件写计划）。
轮次可能被截断，攒着写＝一个字都留不下。

## 实机事实（2026-09-16 深夜真实日志，**直接采信，不用复现**）

**1. AI 玩家确实存在**（用 `debug.getPlayerName(t)` 探测拿到的真实返回值）：
```
team 0 = "Player"            ← 人类本地玩家
team 1 = "AI - Medium"   team 3 = "AI - Medium"   team 5/7 = "AI - Medium"
team 2/4/6/8/9 = <NULL>
```

**2. 但它们全是"废的"** —— 游戏日志：
```
ai_debug(4):firstRun: no command center found
Not showing defeated message: Player - 5 had no starting units (Team: E)
ai_debug(5):firstRun: no command center found
Not showing defeated message: Player - 6 had no starting units (Team: F)
```
⇒ **AI 玩家没有指挥中心 ⇒ AI 逻辑空转，不会打**；而且"没有起始单位的玩家"**在界面上不显示**
⇒ 用户看到"只有两个玩家"就是这个原因。

**3. 引擎自带 MissionEngine 会驱动队伍移动**：
```
MissionEngine:triggerLog:firstActivation: move at:50 for teamId:2 to targetId:4 (#units:8)
MissionEngine:triggerLog:firstActivation: move at:50 for teamId:0 to targetId:2 (#units:2)
MissionEngine:triggerLog:firstActivation: move at:50 for teamId:1 to targetId:8 (#units:4)
MissionEngine:triggerLog:firstActivation: move at:1062 for teamId:1 to targetId:6 (#units:5)
```

**4. `roundManager.js` 的 `killCount` 从来没有被 +1**（整个文件只有 `startRound`/`recordSpawn`/`endRound`/`snapshot`，
**没有 `recordKill`**）⇒ `/api/battle/state` 的 `kills` **恒为 0**。

## 要回答的问题

### Q-A ★ 本项目的**地图是怎么生成的**？"每方 20 兵"从哪来？
- 找到地图生成代码（`battle\` 下，可能与 `mapPool`/`formation`/`square`/`line` 这些词有关），
  读清：它写出的 TMX 里**到底有没有单位对象、有没有每个队的指挥中心/基地**？
- 现有生成的地图只有 `team_0_info` / `team_1_info` 两个触发器（`team` + `credits`），
  **没有 team 2/3**。那么"每方 20 兵"是谁放的？（中继代码？还是 TMX 里的 unit object？）
- 给出**文件:行号**依据。

### Q-B ★★ 怎么让 AI 队（team 3，或 team 1/3 两个）成为**真实参战玩家**？
目标是：① 界面上能显示；② AI 会真正驱动单位进攻。
线索（请验证并补充）：
- `ai_debug(N):firstRun: no command center found` ⇒ AI 需要一个**指挥中心**类单位。
- 引擎解析 TMX 的 Triggers：`MissionEngine` 读到了 `move ... for teamId:N to targetId:M`。
  搜 `MissionEngine` / `triggerLog` / `firstActivation` 的实现，看：
  - 触发器支持**哪些动作类型**（move / spawn / attack / …）？关键字/属性名是什么？
  - `move` 的 `targetId` 指向什么（TMX 里的 object id？）
  - 有没有能让某队单位**主动进攻**的触发器动作？
- 反编译树位置：`war-vote\tools\decompiled\main_out\`（原 jar 的大部分），
  **另外 `war-vote\tools\_gfdec\gf_src\` 是 `com.corrodinggames.rts.gameFramework` 包（534 个类，新解出来的）** ——
  `MissionEngine`/单位基类很可能在这两个树里的某一个。
- 也查：`createUnit` 造出来的兵为什么不被 AI 用？AI 是否要求"该玩家有 command center 实例"才启动？

### Q-C 击杀数怎么才能统计出来？
`killCount` 恒为 0。请给出**可行的检测途径**（按可靠性排序，各附依据）：
- `Debug.isTeamWipedOut(int)` / `isTeamDefeated(int)` / `isTeamInVictory(int)`（`Debug.java:226/235/244`）
- 游戏日志里出现过 `network:cannot send sendSystemMessage:Player - 4 has been wiped out (Team: A), we are not a server`
  ⇒ **能不能 tail 游戏日志（`<游戏目录>\lastrun.log`）解析这类行**？给出该行的产生条件与稳定格式。
- 有没有别的 API 能查单位数量/损失？

## 硬约束
- 🔴 **不要请求 shell / Bash，不要运行任何进程或游戏。** 只做代码读写。实机验证由 Hermes 执行。
- 🔴 **不要修改任何代码文件**，只写 `RESULT.md`。
- 反编译树很大：**Grep 优先，最多读 8 个文件**，每步最多 3 次 grep。别通读。
- **不要编造运行结果**，不确定的写「未确认」。

## 交付
`RESULT.md` 写到 **`.hermes-cc\<当前 task-id>\RESULT.md`**（随查随写）：Q-A / Q-B / Q-C 结论（每条附 文件:行号）
+ 建议的实现方案 + 需实机验证的点。

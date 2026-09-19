# 任务：实现「双方自动开战」—— 用 Debug Socket 的脚本 API 驱动

项目根目录：`D:\Projects\live-waifu`
**主要改 `danmaku-relay\battle\gameController.js`**（必要时可动 `battle\` 下其他模块）。

## 背景（调研已完成，**不要再翻反编译树**）

直播玩法：观众发弹幕 → `liveSpawner.js` 经游戏内置 **Debug Socket（:9999）** 调 `debug.createUnit` 实时生兵。

**问题**：红方(team 0)是**人类玩家**、蓝方(team 1)是 AI。蓝方会自己动，**红方只有人类操作才动**
⇒ 弹幕生出来的红方单位站着不动。目标：**双方自动互相攻击，主播零操作**。

**已确认的反编译结论**（完整证据在 `.hermes-cc\t-20260916-223717\RESULT.md`）：

- 人类槽位**无法**改造成 AI：`n.w`（是否 AI）在构造时由 `this instanceof game.a.a` 定死，**没有 setter**
  （`rts\game\n.java:1047`；`appFramework\i.java:102-103`）→ **此路不通，不要再试**
- ★ **出路**：`com\corrodinggames\librocket\scripts\Debug.java` 是暴露给 LibRocket 脚本
  （`root.` 命名空间）的 API 集合：

| 行号 | 签名 | 用途 |
|---|---|---|
| 325 | `moveAllUnitsOnTeam(int teamId, float x, float y)` | **把某队全部单位移向坐标** |
| 287 | `setTeamAllyGroup(int teamId, int group)` | **改同盟组 → 让双方敌对** |
| 226/235/244 | `isTeamWipedOut / isTeamDefeated / isTeamInVictory(int)` | 胜负判定 |
| 371/376 | `numberOfHumanPlayers()` / `numberOfPlayersPlusAI()` | 玩家数 |

这些可以通过 Debug Socket 的 `script` 前缀调用，形如：
```
script root.setTeamAllyGroup(0, 0)
script root.moveAllUnitsOnTeam(0, 700, 700)
```

## 要实现的

在 `gameController.js` 的**开局流程里、游戏加载完成之后**：

1. **让两队敌对**：用 `root.setTeamAllyGroup(...)` 把 team 0 与 team 1 设为互相敌对。
   ⚠️ 关键是找对 group 取值（相同 group 才是同盟）。**先 grep 反编译树里 `setTeamAllyGroup`
   的实现**（`Debug.java:287`），看它接受的 group 取值与语义，再决定调用参数。
   若无法确定，就用"给两队设不同 group"（如 `(0,0)` 与 `(1,1)`），并在 RESULT.md 里标明**未确认**。

2. **周期性驱赶单位互相进攻**：每 3~5 秒调一次 `moveAllUnitsOnTeam`，把红方单位移向蓝方、
   蓝方单位移向红方。
   ⚠️ **坐标必须基于真实地图尺寸**：地图是 `40x40` 格、`tilewidth=tileheight=20`
   ⇒ 世界坐标约 **800x800**（不是 1080+，那是 TMX 里 object 的像素位置，超出地图）。
   请先确认坐标可用范围，把坐标写成**具名常量**并注明依据。

3. **定时器必须可靠清理**：游戏结束 / 重开 / 进程退出时都要停掉，不能泄漏 interval。
   参考现有 `roundManager` 的状态机（IDLE→FIGHTING→ENDED）选择合适的启停时机。

4. 加一个**开关**（常量或配置项），默认开启；**任何失败都不能影响现有弹幕生兵功能**（要 catch 住）。

## 硬约束

- 🔴 **不要请求 shell / Bash，不要运行任何进程或游戏。** 只做代码读写。实机验证由 Hermes 执行。
- **不要动**：`liveSpawner` 的弹幕解析与词表、轮次状态机语义、地图池、控制面板。
- JS 文件**不要写 BOM**（Node 读文件遇 BOM 会出错）。
- **先 `Read` `gameController.js`**，看它**现在怎么发 Debug Socket 命令的**（大概率是通过
  `require('./liveSpawner').sendCommand(cmd)` 复用同一个连接），**务必复用现有发送函数与连接**，
  **不要新建 TCP 连接** —— 本项目踩过：Debug Socket 可能只支持单连接（见技能里的记录）。
- **不要编造任何运行结果**。你没有执行权限 —— 只写你**读到**的事实和你**改了什么**，不确定的写「未确认」。

## 交付

1. 就地修改 `danmaku-relay\battle\gameController.js`
2. 写 `RESULT.md` 到 **`.hermes-cc\<当前 task-id>\RESULT.md`**
   🔴 **边写边改，不要攒到最后**（上一个任务因轮次耗尽而零产出；改成随查随写后，同样的截断也留下了完整成果）：
   - 先建文件写下计划
   - 每得到一条结论 / 每改一处代码，**立刻追加**
   - 最后补：改前/改后对照、每处改动的依据、**必须实机验证的点**

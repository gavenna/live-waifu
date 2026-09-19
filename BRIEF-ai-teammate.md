# 任务：用「两个 AI 玩家」当双方 —— 实现 + 验证埋点

项目根目录：`D:\Projects\live-waifu`
改 **2 个文件**：`danmaku-relay\battle\gameController.js`、`danmaku-relay\battle\liveSpawner.js`

## 为什么这么做（用户提出的思路，已被代码证实可行）

用户的洞察：**"人类槽位不能变 AI，那就别用人类队 —— 用 AI 玩家当双方"**。正确。

反编译已确认的事实（**直接用，不要重查反编译树**）：

1. `appFramework\i.java:104-131`：引擎开局时会**创建真正的 AI 玩家**：
   - 盟友 AI：`n10 = new a(n6); n10.r = 0;`
   - 敌人 AI：`n12 = new a(i2); n12.v = "AI"; n12.r = 1;`
   （`a` = AI 玩家类，`n` = 玩家基类）
2. 默认 `aiTeams=1`（`sandboxOptions.rml` 的 selected）⇒ `allyCount = aiTeams - 1 = 0`；
   默认 `numberOfAIs=4` ⇒ 敌人 AI 数 = `numberOfAIs - allyCount = 4`
3. 敌人 AI 的槽位：`i.java:122` `bl5 = i2 % 2 == 1 || n5 == 1` ⇒ **优先奇数槽位**
   ⇒ 4 个敌人 AI 落在 **slot 1, 3, 5, 7**
4. `rts\game\n.java:1096-1111`：`c(n)` 敌对判定 `this.r != n.r`；`d(n)` 同盟判定 `this.r == n.r`
   ⇒ **r 相同 = 同盟，r 不同 = 敌对**
5. `librocket\scripts\Debug.java:287` `setTeamAllyGroup(int teamId, int group)` → **直接写 `n.r = group`**，无校验
6. `Debug.java:253` `getPlayerName(int teamId)` → 可用来**探测**某槽位是谁（人类叫 `"Player"`，AI 叫 `"AI"`）

⇒ **结论**：把 `team 1` 和 `team 3` 设为不同同盟组，它们就是**互相敌对的两个 AI 玩家**。
弹幕红兵生给 team 1、蓝兵生给 team 3 ⇒ 双方都由 AI 驱动 ⇒ **自动开战、主播零操作**。
人类队（team 0）一个兵都不生 ⇒ 之前"人类兵站着不动"的问题**从根上消失**。

## 要做的改动

### A. `gameController.js`（现有 autoBattle 段落，约 128-252 行）

1. **改同盟组**：把原来的
   `setTeamAllyGroup(0, 0)` + `setTeamAllyGroup(1, 1)`
   改成 **`setTeamAllyGroup(1, 1)` + `setTeamAllyGroup(3, 2)`**
   （team 1 → 组 1；team 3 → 组 2；1 != 2 ⇒ 互相敌对）
2. **删掉 `moveAllUnitsOnTeam` 的定时器**（`driveUnits` / `setInterval`）。
   理由：AI 玩家自己会移动和攻击，**不需要我们驱赶**。
   已实测：`moveAllUnitsOnTeam` 下的是**纯移动命令**（`e.a(x,y)`，从不设攻击移动标志 `e.h`），
   300 秒零击杀。留着它只会把 AI 单位硬拖到固定坐标、干扰 AI 决策。
   ⇒ 保留 `startAutoBattle` / `stopAutoBattle` / `isAutoBattleRunning` 这些函数名与开关
   （`index.js` 有引用，别改坏接口），但内部只做"设同盟组"，不再有定时器。
3. **加运行时探测（重要，用来实机验证）**：开局后发一组
   `debug.getPlayerName(t)`（t = 0..9），把结果**写进中继日志**（用项目现有的 logger，
   前缀建议 `[BATTLE][probe]`），形如：
   ```
   [BATTLE][probe] team 0 = "Player"    <- 人类
   [BATTLE][probe] team 1 = "AI"        <- 我们要用的
   [BATTLE][probe] team 3 = "AI"        <- 我们要用的
   [BATTLE][probe] team 5 = "AI"
   [BATTLE][probe] team 7 = "AI"
   [BATTLE][probe] team 2 = null/空
   ```
   注意：**你现在无法确定 `getPlayerName` 的返回值怎么取回来**（Debug Socket 的
   `function` 前缀支持返回值，但 `liveSpawner.sendCommand` 是否解析回包需要你自己看代码）。
   **如果拿不到返回值，就退而求其次**：只发命令、不做判断，并把"探测不可用"写进 RESULT.md
   的未确认项。**不要为了取返回值去新建第二条 TCP 连接**（本项目踩过：Debug Socket 可能只支持单连接）。
4. **加一个常量**，把"红方用哪个 team / 蓝方用哪个 team"集中定义并导出，例如：
   ```js
   const RED_TEAM  = 1
   const BLUE_TEAM = 3
   ```
   并在 `module.exports` 里导出，供 liveSpawner 引用（**单一真相来源**，别在两处各写一份）。

### B. `liveSpawner.js`

1. `liveSpawner.js:112` 现在是
   ```js
   const team = (match[1].toLowerCase() === '红' || match[1].toLowerCase() === 'red') ? 0 : 1
   ```
   改成引用 `gameController` 导出的 `RED_TEAM` / `BLUE_TEAM`（注意**循环依赖**：
   `gameController` 已经 `require('./liveSpawner')`。若出现循环依赖问题，
   就把这两个常量放到一个**新的小模块**（如 `battle/teams.js`）里，两边都 require 它 —— 这是更干净的做法，推荐直接这么做）。
2. `SPAWN_AREAS`（`liveSpawner.js:130-133`）现在是按 team 0/1 索引的，要改成按 **RED_TEAM / BLUE_TEAM** 索引，
   否则生成坐标会 fallback 到 `SPAWN_AREAS[0]` 两边重叠。
3. `teamName`（`liveSpawner.js:126`）的 `team === 0 ? '红方' : '蓝方'` 也要跟着改。

## 硬约束

- 🔴 **不要请求 shell / Bash，不要运行任何进程或游戏。** 只做代码读写。实机验证由 Hermes 执行。
- 🔴 **不要动**：弹幕解析词表（`UNIT_MAP` 等）、轮次状态机语义（`roundManager`）、地图池、控制面板 `toolbox/`。
- **不要修改反编译树**，也不要重新反编译。
- JS 文件**用 Edit 就地改**，**不要重写整个文件**（避免引入 BOM）。
- 改完**必须自己跑 `node --check <文件>` 是做不到的**（你没有 shell）——
  所以请**逐行仔细检查括号与逗号**，并在 RESULT.md 里写明"未做语法校验，需 Hermes 执行"。
- **不要编造运行结果**，不确定的写「未确认」。

## 交付

1. 就地改好上述文件（必要时新建 `battle/teams.js`）
2. `RESULT.md` 写到 **`.hermes-cc\<当前 task-id>\RESULT.md`**，**边改边写**：
   - 先建文件写计划
   - 每改一处立刻追加（改前/改后）
   - 最后补：**必须实机验证的点**、未确认项

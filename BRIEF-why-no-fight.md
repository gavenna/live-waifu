# 任务：**只做调研，不改任何代码** —— 为什么 0 击杀 + 能不能做成"真·全 AI 对局"

项目根目录：`D:\Projects\live-waifu`

## 🔴 硬性节奏要求（最重要）

**每查到一个结论，立刻追加写入 `RESULT.md`。不要攒到最后。**
第一个动作就是创建 `RESULT.md` 并写下计划；之后每次得到结论立刻 `Edit` 追加。
（上一个任务因轮次耗尽零产出，改成随查随写后，同样的截断也留下了完整成果。）

## 实机事实（已发生，不用你复现）

上一版实现（`gameController.js` 的 autoBattle）**实机跑了一整轮 300 秒，结果失败**：

```
/api/battle/state → {"state":"ENDED","spawns":{"red":1,"blue":1},
                     "kills":{"red":0,"blue":0},"elapsed":301478}
```

- 游戏日志显示命令**执行成功、无报错**，每 4 秒一次：
  ```
  ScriptEngine:HandleEvent:debug.setTeamAllyGroup(0, 0)
  ScriptEngine:HandleEvent:debug.setTeamAllyGroup(1, 1)
  ScriptEngine:HandleEvent:debug.moveAllUnitsOnTeam(0, 480.0, 200.0)
  ScriptEngine:HandleEvent:debug.moveAllUnitsOnTeam(1, 160.0, 200.0)
  ```
- 红方 1 车 @(151,210)、蓝方 1 车 @(454,168)，**300 秒零击杀**，双方都没打死对方。
- 参考基线（改动前同配置）：300 秒后 `红方1兵 蓝方1兵`，同样零交火。

用户实机观察（原话）：
> *"好像不行啊，必须要有一个主视角的玩家一样，那不行啊"*
> *"这个召唤好像是跟经济不挂钩的，好像只显示一个经济的显示"*

---

## 必须回答的三个问题

### Q-A（最关键）为什么 0 击杀？

读 `war-vote\tools\decompiled\main_out\com\corrodinggames\librocket\scripts\Debug.java:325-341`
的 `moveAllUnitsOnTeam`：

```java
public boolean moveAllUnitsOnTeam(int n2, float f2, float f3) {
    n n3 = n.k(n2);
    if (n3 == null) { logWarn("Could not find team:" + n2); return false; }
    l l2 = l.B();
    e e2 = l2.cf.b(n3);
    for (am am2 : am.bF()) {
        if (!(am2 instanceof y)) continue;
        if (((y)am2).bX != n3) continue;
        e2.a((y)am2);
    }
    e2.a(f2, f3);      // ← 这是"移动"还是"攻击移动"？
    return true;
}
```

要查清（**给文件:行号依据**）：
1. `e.a(float, float)` 下的是**纯移动**命令还是**攻击移动（attack-move）**？
   —— 若只是纯移动，单位走到点就停、**不会主动追敌**，这就解释了 0 击杀。
2. 单位是否有**自动索敌**：RW 里玩家单位在武器射程内会不会自动开火？
   搜 `target`/`attack`/`getClosestEnemy`/`autoTarget`/`weapon` 之类。
3. **红方(team 0)是人类玩家的队**，`l2.cf.b(n3)` 取到的"选择对象"对**人类队**和**AI 队**是否行为不同？
   人类队的选择是不是要求"玩家当前选中"才有意义？
4. 单位**到底有没有移动**？有没有别的 API 能查单位坐标（我好实机确认）。

### Q-B ★ `Debug.java` 的**完整** public 方法清单（找"下达攻击命令"的 API）

上一版只挑了 12 个方法看，**没枚举全**。请把
`Debug.java` 里**所有 public 方法**列成表（行号 + 签名 + 一句话作用），
**重点标出**任何跟"攻击 / 攻击移动 / 指定目标 / 寻路 / 命令单位"相关的。
这决定能否用脚本让红方单位主动寻敌击杀（次优方案，可接受"人类在场但零操作"）。

### Q-C ★★ 能不能做成**真·全 AI 对局**（没有主视角玩家）

已确认的死路（不用再查）：
- 沙箱路径的人类槽位是 **`new e(0)` 无条件创建**（`appFramework\i.java:102-103`）
- `n.w`（是否 AI）在构造时由 `this instanceof game.a.a` 定死，**没有 setter**（`rts\game\n.java:1047`）

请查清**这条路**：
- `librocket\scripts\Multiplayer.java` 的 `addAI()`（发 `-addai`）与 `playerConfig_apply()`（`spawnPoint` 下拉框值 `-2` ⇒ `r = -3` 观察者）。
- **battleroom 路径能否离线/本地单机跑起来？** 需要起本地服务器吗？有没有脚本 API 能
  **程序化地构造 battleroom 并开局**（而不是手点 UI）？搜 `battleroom.rml` 的元素 id 与相关脚本方法。
- **游戏日志里这两行很重要**：
  ```
  getNumberOfPlayersInMap: fail to match:live_battle.tmx
  Max teams on map: maps/skirmish/live_battle.tmx = -1
  ```
  ⇒ 引擎**没能识别地图里的队伍声明**（`Max teams = -1`）。
  查 `getNumberOfPlayersInMap` 的匹配逻辑：**它期望的地图 team 声明格式到底是什么？**
  （现有地图写的是 `team_0_info` / `team_1_info` + `type="team_info"`，显然不匹配。）
  修好地图声明后，`i.java` 的 `int n9 = c.a(mapPath); if (n9 > 0 && n9-1 < n8) n8 = n9-1;`
  会不会让引擎**把两个队都建成 AI**？**这是最有希望的正路，请重点查。**

## 硬约束

- 🔴 **不要请求 shell / Bash，不要运行任何进程或游戏。** 只做代码读写。实机验证由 Hermes 执行。
- 🔴 **不要修改任何代码文件**，只写 `RESULT.md`。
- 反编译树很大：**Grep 优先，最多读 8 个文件**，每步最多 3 次 grep。
- **不要编造运行结果**。不确定的明确写「未确认」。

## 交付

`RESULT.md` 写到 **`.hermes-cc\<当前 task-id>\RESULT.md`**（随查随写），包含：
1. Q-A / Q-B / Q-C 的结论，**每条附 文件:行号**
2. **下一步实现方案建议**（按可行性排序），只写方案不写代码
3. 需要实机验证的点

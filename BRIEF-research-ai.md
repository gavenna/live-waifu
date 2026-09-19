# 任务：**只做调研，不要改任何代码**

## 唯一要回答的问题

在 Rusted Warfare 1.15 里，**怎样让"人类玩家那一队"也由 AI 控制**（或者让人类干脆不参战），
从而使开局后双方单位自动互相攻击、主播零操作？

## 🔴 硬性节奏要求（比结论本身更重要）

**每查到一个结论，立刻追加写入 `RESULT.md`。绝对不要攒到最后一起写。**

上一个任务是 41 轮零产出的 —— 因为它把所有发现攒在最后，结果轮次被截断，一个字都没留下。
你这次必须做到：**任何时刻被截断，RESULT.md 里都已经有东西。**

具体做法：
1. **第一个动作**：先把 `RESULT.md` 创建出来，写进"我要查什么 + 已掌握的信息"。
2. 之后每得到一条结论（哪怕只是一半），**立刻 `Edit` 追加进去**，再继续下一步。
3. 不要写"待补充"，写实际查到的内容。

## 探索纪律（防止烧光轮次）

反编译树 `war-vote\tools\decompiled\main_out\` **非常庞大**。**不要通读它。**

- 只用 **Grep** 精确定位，整个任务**最多打开 6 个文件**（Read）。
- 每步最多 3 次 grep 就该有产出。卡住就写"未确认"并换方向。
- 不要读 `Root.java`（2170 行）之类的整文件，用 grep 定位行号后只读那一段。

**推荐起手式**（按顺序，每条都是 grep，不是通读）：
1. grep `"credits"` → 找到解析地图 `team_info` 属性的代码 → 看同一段还读哪些键
   （重点找 `spectator` / `ai` / `player` / `aiDifficulty` 这类键名）
2. grep `spectator` → 找到队伍类里那个 `boolean b()`（isSpectator）的定义 → 反查**谁把它设成 true**
3. grep `isSpectator|spectatorTeam|setSpectator` → 看有没有脚本 API / 地图属性可以设置它
4. grep `"numberOfAIs"|"aiTeams"|addAI` → 看 battleroom 路线能不能开出"没有人类"的对局

## 已知证据（直接用，**不要重新查**）

- 地图 `assets\assets\maps\skirmish\live_battle.tmx` 的 Triggers 里：
  `map_info(type=mission, fog=map, winCondition=mainBuilings)`、
  `team_0_info(team=0, credits=99999)`、`team_1_info(team=1, credits=99999)`
  —— **只有 team + credits，没有任何 AI/人类/观察者属性**

- `com\corrodinggames\librocket\scripts\Root.java:627-646` `loadConfigCommon(String, boolean)`：
  从**当前活动 RML 文档**读 `aiDifficulty` / `numberOfAIs` / `aiTeams` 三个元素；
  `aiTeams==5` 时令 `n4=0, bl4=false`；然后调 `i.a(mapPath, isSkirmish, numberOfAIs, n4, bl4, false)`

- `com\corrodinggames\rts\appFramework\i.java:82`
  `a(String mapPath, boolean isSkirmish, int numberOfAIs, int allyCount, boolean teamsBased, boolean isSandbox)`
  内部 `l2.bs = new e(0); l2.bs.v = "Player";` —— **人类槽位总是被创建**；
  `teamsBased==false`（即 aiTeams==5）只是不设 `r=1`（敌人标记）。
  ⇒ **`aiTeams=5` 不能去掉人类，此路不通。**

- `com\corrodinggames\rts\game\b\a.java:140` 与 `com\corrodinggames\rts\game\b\g.java:114`：
  ```java
  if (n2.b()) {  // n2 是队伍对象；b()==true 表示该队伍是观察者
      l.log("map", "Unit team is marked as spectator:" + ... + " (skipping unit)");
  ```
  ⇒ **引擎支持"观察者队伍"，但还不知道它是怎么被设置的 —— 这就是你要查的核心。**

- 游戏 GUI 定义 `assets\gui\sandboxOptions.rml`：
  `aiDifficulty`(-2..3) / `numberOfAIs`(0..7) / `aiTeams`(1=vs all, 2..4=N ally vs all, 5=Free for all)

- 现有开局代码：`danmaku-relay\battle\gameController.js`（先 `root.open('sandboxOptions.rml', map)`，
  再 `loadConfigAndStartNewSandbox(map)`）

## 交付

**只写 `RESULT.md`（UTF-8 无 BOM），不要修改任何代码文件。** 内容：

1. **结论**：怎么让人类那队也变 AI（或让人类不参战）。按可靠性排序，每条附 **文件:行号**。
2. **实现方案**：具体要改哪个文件、加什么命令／什么地图属性（**只写方案，不要真改**）。
3. **未确认项**：必须实机验证的点，逐条列出。

如果你查到"这个游戏根本做不到"，**如实说**，并给出次优方案：
例如有没有脚本 API 能给单位下达移动/攻击命令（`debug.` 系列或 `script` 命令里），
让 Hermes 侧定时驱动红方单位去攻击 —— 目标仍是"主播零操作、双方自动开战"。

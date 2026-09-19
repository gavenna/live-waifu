# 任务：让 Rusted Warfare 开局后「双方都是 AI」，单位一上来就自动互相开战

项目根目录：`D:\Projects\live-waifu`

## 背景

直播玩法：观众发弹幕 → `danmaku-relay/battle/liveSpawner.js` 通过游戏内置 **Debug Socket（:9999）**
调用 `debug.createUnit(type, x, y, team)` 在游戏里实时生成单位。

开局流程在 **`danmaku-relay/battle/gameController.js`**（启动游戏 → 打开 sandboxOptions → 加载地图 → 开战）。

**用户报告的问题**：游戏加载后是「一个我自己 + 一个 AI」—— 红方(team 0)是**人类玩家**、蓝方(team 1)是 AI。
结果蓝方 AI 会自己动，**红方只有人类操作才会动** → 弹幕生出来的红方单位站着不动、不会自己开战。
主播不可能一边直播一边手动指挥。

**用户要求**：**两边都变成 AI**，单位一出现就自动互相打，主播零操作。

## 已经查到的证据（**不要重复做，直接用**）

### 1. 地图文件
`D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\assets\assets\maps\skirmish\live_battle.tmx`

（注意是 **双 `assets`** 路径 —— 游戏 `loadConfigAndStartNewSandbox` 会自动补一层 `assets/` 前缀。
副本也在 `mods\maps\live_battle.tmx` 和 `assets\maps\skirmish\live_battle.tmx`）

Triggers objectgroup 内容：
```xml
<object id="1" name="map_info">
  <property name="fog" value="map"/>
  <property name="introText" value="红方 2 兵 vs 蓝方 1 兵 ..."/>
  <property name="type" value="mission"/>
  <property name="winCondition" value="mainBuilings"/>
<object id="2" name="team_0_info" type="team_info">   team=0  credits=99999
<object id="3" name="team_1_info" type="team_info">   team=1  credits=99999
```
**只有 `team` + `credits`，没有任何"谁是 AI / 谁是观察者"的属性。**

### 2. 反编译源码（**就在本项目里**，可自由 grep）
`war-vote\tools\decompiled\main_out\`

**`com\corrodinggames\librocket\scripts\Root.java` 第 627-646 行** `loadConfigCommon(String, boolean)`：
```java
Element element = elementDocument.getElementById("aiDifficulty");
l2.bQ.aiDifficulty = element.getValueAsInt(0);
l2.bQ.save();
...
int n2 = elementDocument.getElementById("numberOfAIs").getValueAsInt(4);
boolean bl4 = true;
int n3 = elementDocument.getElementById("aiTeams").getValueAsInt(1);
int n4 = n3 - 1;
if (n3 == 5) { n4 = 0; bl4 = false; }
i.a(string3, bl3, n2, n4, bl4, bl2);
```
两个要点：
- 它从**当前活动的 RML 文档**里取这三个元素 —— 取不到就 NPE。
  这就是为什么必须先 `root.open('sandboxOptions.rml', mapPath)` 再调 `loadConfigAndStartNewSandbox`。
- `_startAdvancedMode()`（第 565 行）走的是 **battleroom 路线**（`battleroom.rml`）；
  `Multiplayer.java` 第 654 行 `addAI()` 会发聊天命令 `-addai`。

**`com\corrodinggames\rts\appFramework\i.java` 第 82 行**：
```java
public static void a(String mapPath, boolean isSkirmish, int numberOfAIs,
                     int allyCount, boolean teamsBased, boolean isSandbox) {
  if (isSkirmish || isSandbox) {
     ...
     l2.bs = new e(0);  l2.bs.v = "Player";     // ← 人类槽位**总会**被创建
     // 先按 allyCount 建 r=0 的盟友 AI，再建 (numberOfAIs - allyCount) 个 r=1 的敌人 AI
     // teamsBased == false（aiTeams==5 FFA）时不设 r=1
  }
}
```
⇒ **`aiTeams=5`（Free for all）只是"没有盟友、各自为战"，不会去掉人类槽位。** 这条路走不通。

**`com\corrodinggames\rts\game\b\a.java` 第 140 行**（地图加载 Units 层时）：
```java
if (n2.b()) {   // n2 是队伍对象；b() == true 表示该队伍是观察者
    com.corrodinggames.rts.gameFramework.l.b("map", "Unit team is marked as spectator:" + string2 + " (skipping unit)");
    return;
}
```
`com\corrodinggames\rts\game\b\g.java` 第 114 行有同样逻辑。
⇒ **引擎支持把某个队伍标记为 spectator（观察者）** —— 这是目前最有希望的线索。

### 3. 游戏 GUI 定义（决定能设哪些值）
`D:\game\...\assets\gui\sandboxOptions.rml`，三个元素：
```html
<select id="aiDifficulty">  -2,-1,0(默认),1,2,3
<select id="numberOfAIs">   0..7（默认 4）
<select id="aiTeams">       1=vs all(默认) 2=1 ally vs all 3=2 ally vs all 4=3 ally vs all 5=Free for all
```
按钮：`onclick="loadConfigAndStartNewSandbox(mode)"`（Start）、`loadConfigAndStartNewSandboxInAdvanced(mode)`（Advanced）

## 你要做的事

### A. 先给出结论（按可靠性排序，每条都要 **文件:行号** 依据）
**怎样让"人类那一方也由 AI 控制"？** 必须查清：

1. 队伍对象的 `b()`（isSpectator）是**哪个属性**设的？在地图 `team_info` 或脚本 API 里怎么设？
   建议入手点：搜索解析队伍属性的代码（`credits` 是怎么读的？`spectator` / `ai` / `player` 这类键名在哪解析？），
   以及 `com\corrodinggames\rts\game\` 下队伍类（可能有 `n`/`am`/`a` 之类的混淆名）。
2. 有没有办法让**本地人类玩家**不参战（例如把本地玩家分到 spectator 队伍、或把本地队伍交给 AI）？
3. battleroom 路线（`Root._startAdvancedMode` + `Multiplayer.addAI()` + `-addai`）能不能开出"没有人类"的对局？
4. `com\corrodinggames\librocket\scripts\Debug.java` 暴露了哪些脚本 API 与本问题相关
   （例如有没有设置队伍 AI / 队伍类型的方法）。
5. 地图 `team_info` 属性**全清单**：引擎支持哪些键？（找 `credits` 的解析处，看同一段代码还读哪些键）

### B. 然后实现
改 **`danmaku-relay/battle/gameController.js`** —— 通过 Debug Socket 的 `script ...` 命令，
在开局前把需要的设置设好（例如给 sandboxOptions 的元素设值、或改地图属性、或调用某个脚本 API），
使**两边都成为 AI**。

改动要**小而集中**，并写清"靠哪一行生效、为什么它有效"。

如果结论是"这个游戏做不到两边全 AI"，**如实说**，并给出**次优方案**：
例如用脚本周期性给红方单位下达攻击命令（`debug.` 系列 API 或 `script` 命令里有没有
移动/攻击指令？）—— 目标仍然是"主播零操作，双方自动开战"。

## 硬约束

- 🔴 **不要请求 shell / Bash 权限，也不要尝试运行游戏或任何进程。**
  你只做**代码读写**；所有实机验证由 Hermes 执行。这是红线。
- **不要删任何现有功能**：弹幕生兵、轮次状态机、地图池、控制面板都不能动。
- 改 `.js` 时**不要引入 BOM**（Node 读文件遇 BOM 会出错）。
- **不要编造任何"运行结果"。** 你没有执行权限 —— 只写你从源码里**读到**的事实，以及你**改了什么**。
  不确定的明确写「未确认」。

## 交付

1. 就地修改 `danmaku-relay/battle/gameController.js`
2. 写 `RESULT.md`（UTF-8 **无 BOM**）：
   - A 部分结论，每条附 **文件:行号**
   - 你改了什么（改前 / 改后对照）
   - 为什么这样能让两边都是 AI
   - **你未能确认、必须实机验证的点**（逐条列出，别含糊）

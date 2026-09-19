# 任务：给 team 3 铺指挥中心 + 声明式敌对 —— 让第 3 个玩家真正出现

## 目标（一句话）
在游戏实际加载的 TMX 里，为 **team 3** 铺一个指挥中心 + 写 `team_3_info` 触发器，
使它成为**真实参战玩家**：界面上显示、AI 真的会打。

## 已确认的事实（**直接用，不要重查反编译树**）

1. **AI 为什么需要指挥中心**（`game\a\a.java:947-956` + `:900-910`）：
   首帧 `this.e(this)` 找本队指挥中心（`am2.bX == team && am2 instanceof d.e`），
   返回 null 就打 `"firstRun: no command center found"` 并**跳过设置 bh/bi/bj/bk 四个 AI 决策开关**
   ⇒ AI 逻辑空转。**给指挥中心＝让 AI 真参战。**
2. **素材现成**：`D:\game\...\Rusted Warfare1.15\mods\maps\units.tsx` 里有各队指挥中心瓦片：
   team0=`tile id 6`、team1=`id 51`、**team2=`id 87`、team3=`id 105`、team4=`id 141`**。
   编码规则（`war-vote\server\mapGen.js:38-42` `gidOf`）：**gid = 2 + tileId** ⇒ team3 指挥中心 **gid = 107**。
   ⚠️ **你必须自己核对**：读 TMX 的 `<tileset>` 声明确认 `units.tsx` 的 `firstgid`，
   以及读 `units.tsx` 确认 team3 commandCenter 的 tile id —— **不要照抄我的 107，要以实读为准**。
3. **`team_info` 原生支持 `allyGroup`**（`gameFramework\n\f.java:354-357`）：
   `if (property "allyGroup") team.r = parseInt(value)` —— 直接写敌对字段。
   `team_info` 支持的全部属性（`f.java:319-361`）：`team` / `credits` / `basicAI` /
   `lockAiDifficulty` / `disabledAI` / **`allyGroup`** / `ai`。
4. **要把 team 3 设为敌对**：给它一个**与 team 0/1 不同的** `allyGroup` 值。
   （现有实机里 team 0 组 0、team 1 组 1；建议 team 3 用 `2`。）
   ⚠️ 注意 `f.java:310-315`：skirmish 下引擎会**先把 team 3 的 `r` 强设成 0**，
   而 `team_info` 循环（`:319`）在它**之后**执行 ⇒ TMX 里的 `allyGroup` 会**覆盖**掉。**以实机验证为准。**

## 要改的文件（就一个）

**`D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\mods\maps\live_battle.tmx`**

（中继每轮会把它**复制**到 `assets\assets\maps\skirmish\live_battle.tmx` 再由游戏加载；
所以要改的是 `mods\maps\` 这一份源文件。见 `danmaku-relay\battle\index.js:52-61`。）

🔴 **动它之前先备份**到同目录 `live_battle.tmx.bak-<时间戳>`（游戏正在用的正式资源，必须可回滚）。

### 改动内容

1. **加一个 team 3 的指挥中心**：在 TMX 的 **`<layer name="Units">`** 瓦片层里，
   放一个 **team3 commandCenter 的 gid** 到某个**空着的、team 3 的出生侧**格子上。
   - 参考 team 1（蓝方）指挥中心的现有格子坐标 —— 建议**镜像/平移**到地图的另一侧，别和现有单位重叠。
   - 现有两队的建筑坐标可参考 `war-vote\server\config.js:82-87`
     （`{x:3,y:20,commandCenter}`、`{x:3,y:18,landFactory}`、两个 builder），以及 `mapGen.js:46-48` 的 `mirrorX`。
   - 确保放的是 **Units 层的 gid**（不是 Build 层之类），且该格子原本为空（gid=0）。
2. **加 `team_3_info` 触发器**：在 Triggers objectgroup 里照 `team_1_info` 的样子加一个，
   `nextobjectid` 记得 +1，属性：
   ```xml
   <property name="team" value="3"/>
   <property name="credits" value="99999"/>
   <property name="allyGroup" value="2"/>
   ```
3. （可选，加一句说明即可）如果要让 team 3 有起始部队，Units 层里再放几个 team3 的兵种瓦片。

### 硬性要求

- **必须保持 TMX 结构合法**：`<map>` 头、`<tileset>` 原样不动；只加瓦片数字、只加一个 object；
  XML 缩进风格与现有一致；**不要**改变现有任何 gid 或坐标。
- **Units 层是 CSV 文本**（每行一串逗号分隔的 gid）—— 改的时候**逐格对齐**，行数/列数必须不变
  （`width="40" height="40"`），否则地图直接读不了。**这是本任务最容易出错的地方，请格外小心。**
- 改完**自己核对**：Units 层每行的数字个数都等于 40、共 40 行；你新增的那个 gid 只出现一次。
- **不要求 shell、不要运行任何进程或游戏**。只做文件读写。实机验证由 Hermes 执行。

## 交付

1. 备份 + 改好的 `live_battle.tmx`
2. `RESULT.md` 写到 **`.hermes-cc\<当前 task-id>\RESULT.md`**（**边改边写**）：
   - 你实读到的 `firstgid` / team3 指挥中心 tile id / 你最终用的 gid（附文件:行号）
   - 你放在哪个格子、为什么选那里
   - 改动前/后的 XML 片段对照
   - **必须实机验证的点** + 未确认项

# HANDOFF — live-waifu / 弹幕对战直播链路

> 快照：2026-09-24 深夜。写给**零上下文**的新会话（agent 或人）。
> 项目根 `D:\Projects\live-waifu`；游戏目录下文简称 `<GAME>` = `D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`。
> ⚠️ **`<GAME>` 即将被删除**（用户要换游戏版本）。见「当前卡点 #1」。
> **中继 `danmaku-relay\` 是独立 git 仓库**（branch `main`），根仓库把它当未跟踪目录。
> **换地图先读 skill `switch-map`**（`.rivet\skills\switch-map\SKILL.md`）。
> **现场状态**：中继与游戏均已停（8766/8767/9999 无监听、无 java 进程）。项目根有个 `node.exe`（PID 9424）**不是本项目起的**，别碰。

---

## 任务目标

抖音主播的「弹幕 → 游戏内真实经济」Rusted Warfare 对战直播：观众发「红3战车」这样的弹幕，中继在游戏里实时造兵、扣该队真实余额、红蓝对战、自动结算、自动下一局。

**本会话用户的原话级目标**（时间顺序）：

1. 「`D:\Downloads\37188a5fa28f2fb3.rwmod` 下了一个 mod，怎么导入？」
2. 「按照之前项目的方式要去 sandbox editor 的，但是现在 mod 好像只能去开那种多人房间才能使用，岂不是说直播互动的这个游戏没法加入 mod 了？」
3. 「游戏卡死退不出了，进程都搜不到，但是就是退不出去」
4. 「New New Dire Straight (2p) [by uber] …22 九月…，把这个地图改一下，主要是阵型把 Mod 的一些兵种换进去，同时还要更新玩法文档」
5. 「炮塔可以建一下，按照你认为炮塔应该在的位置就行，其他的没问题」
6. 「今天又播了一天，复盘一下」
7. 「这个项目的代码都放在哪里的，特别是游戏相关的，还有之前反编译的」
8. 「把游戏目录重要的内容都备份打包存到项目路径来，原游戏目录我准备删了」

**非目标（明确排除）**：
- 不改抖音适配器链路。
- 不把「无阵营指令」当合法：`4蜘蛛` 仍不生成部队，「无红/蓝前缀 = 不生成」的语义保留。
- 不做「随便说话就发兵」这类降门槛改动。
- C3（Intel 驱动崩溃）用户此前明确「先留着先不管」，本会话未修。

---

## 已完成（本会话）

### A. `.rwmod` 导入机制查清并装好

`<GAME>\mods\units\Moo's Defence Agency v3.1.rwmod`（572140 B，sha256 `8c4bfa86…bd07d7`）。**注意：该文件已于 2026-09-24 被移出，见卡点 #1。**

机制（证据 `<GAME>\cache\mods-info.cachedata\` 里 100+ 条路径形状 `/SD/mods/units/<名字>.rwmod/mod-info.txt`）：
- `.rwmod` 就是 zip，**直接丢进 `mods\units\`，不用解压**；引擎把 `.rwmod` 当目录读它内部的 `mod-info.txt`。
- 启用状态存 `preferences.ini` 的 `modSettings`，**新放的 mod 默认 disabled**，要在游戏 Mods 菜单手动勾。

### B. 「mod 只能多人用」是误解（已纠正）

证据（游戏自己的文案与源码）：
- `assets\translations\Strings.properties:223`：`menus.mods.headerInfoAndroid=Enabled mods for singleplayer and hosted games.`
- `assets\gui\mods.rml:460` 附近：`Use the reload button in sandbox to load in your unit changes`
- 反编译 `war-vote\tools\_gfdec\out\com\corrodinggames\rts\game\b\a.java` —— mod 加载在 `ModEngine` 初始化阶段（游戏启动时），**与游戏模式无关**。
- 实测 `lastrun.log`：单机对局里 `enableAll: Moo's Defence Agency v3.1(unitCount: 40)`，且 `Could not find custom unit` 计数为 **0**。

用户以为「只在多人可用」的来源：多人开房界面（`multiplayerLobby_hostgame.rml`）里有 `Use active mods` / `Use (and require) modded units` 两个勾选框——那是**多人同步校验**开关，不是「启用 mod」开关。启用 mod 的唯一入口是主菜单的 **Mods** 按钮（`mainMenu.rml:435`，`menus.front.mods`）。

### C. 游戏「卡死退不出」= Intel 驱动崩溃（C3）

- 用户报「进程都搜不到但退不出去」。实测：进程在，只是**名字是 `javaw.exe`**（手动启动）或 **`java.exe`**（中继拉起），任务管理器按「Rusted Warfare」搜不到；窗口标题才是 `Rusted Warfare`。
- 崩溃证据：`<GAME>\hs_err_pid3960.log`（2026-09-22 23:37）——`ExceptionCode=0xc0000005`，崩溃帧全在 **`igxelpicd32.dll`**（Intel 集显 OpenGL 驱动），线程状态 `_thread_in_native`。
- **表现是"假死"**：主渲染线程卡在 GPU 驱动里 → 游戏循环停摆、退不出去；但窗口消息泵还活着 → Windows 报 `Responding=True`；实测 5 秒烧满 5 秒 CPU。
- 同源证据：崩溃偏移 `igxelpicd32.dll+0x2d254` 在 09-15 / 09-19(×2) / 09-21 / 09-22 反复出现，**最早可追到 09-13**，与任何 mod 无关。
- 环境：Intel i5-1135G7 + Iris Xe，驱动 `32.0.101.7088`（2026-06-17）。**无独显可切**。
- **2026-09-23 全天直播 12.8 小时只崩 1 次，且发生在开播前** —— C3 当前不是高频问题。

### D. 直播图改造：阵型换 Moo 兵种 + 补 18 个炮塔

**改动文件**：`<GAME>\mods\maps\New New Dire Straight (2p) [by uber] - 21 九月 2026 - 22 九月 2026.tmx`（源图）
产物 `<GAME>\mods\maps\new_dire.tmx` 由 `map_adapt_newdire.py apply` 重新生成。

**证据链（全部实测）**：
- 反编译 `war-vote\tools\_gfdec\out\com\corrodinggames\rts\game\b\a.java:104-170` —— 引擎造兵读的是对象的 **properties**，不是 `gid` 也不是 `name`：
  ```
  string2 = getProperty("unit");        // 走内置单位表 ar.a()
  string4 = getProperty("customUnit");  // 走自定义(mod)单位注册表 custom.l.n()
  if (string4 != null) { ...customUnit 优先... }
  ```
- 源图阵型原本 **167 个起手单位**（team0=蓝 88 / team1=红 79），格式：
  ```xml
  <object gid="515" name="commandCenter (t:1)" ...>
    <properties><property name="unit" value="commandCenter"/>
                <property name="team" value="1"/></properties>
  </object>
  ```
- 改造后 **185 个对象**（50 个仍是基础单位 + **135 个 Moo 单位**），红 88 / 蓝 97；其中炮塔 18 个（红蓝各 9）。
- 逐条对账：源 ↔ 产物（队号换算回同一口径）**63 组 (单位,队伍) 组合零差异**。
- 三项独立复核全绿：`map_adapt_newdire.py apply` → `RESULT: PASS`；skill 自带 `verify_adapted_map.py` → 9 条全 OK / `exit=0`；新写的 `verify_units_et.py`（XML 通道）→ PASS。
- **实机验证（2026-09-23 08:38 起中继）**：`Mapfile: assets/maps/skirmish/new_dire.tmx`、`Could not find (custom) unit` 计数 **0**、`end_live.txt` 无秒判负、日志出现 `Loading .../Moo's Defence Agency v3.1.rwmod/units/Sea Units/Cruiser/cruiser.png team:1`（红方 `cruiserShip` 真的被创建并渲染）。
- 更强的证据：**2026-09-23 全天 26 轮直播全程用的就是改造后的图**，`Could not find (custom) unit` 计数始终为 0。

**改了什么**（映射表在脚本顶部 `MAP`，可改一行重跑）：
- 地面 11 种（`heavyTank`→`lynxTank`、`plasmaTank`→`saberTank`、`c_mammothTank`→`achillesTank`、`c_experimentalTank`→`wyvernTank` …，按官方价位由轻到重对齐）
- 水面 5 种（`battleShip`→`destroyerShip`、`heavyBattleship`→`cruiserShip`、`experiementalCarrier`→`mooClassBattleship` …）
- 空中 3 种（`bomber`→`grandSlamBomber`、`missileAirship`→`harbingerGunship`、`experimentalGunship`→`typeUGunship`）
- **没换的**：工厂 / 经济 / 指挥中心 / 核与反核 / **潜艇**（`heavySub`、`attackSubmarine`——Moo 海军 7 个单位全是水面舰，没有潜艇类）/ `experimentalHoverTank`（`assets\units` 下查不到它的独立定义与价档）。
- 炮塔 18 个由 `map_add_mod_towers.py` 自动选位，规则：LAND-CLEAN（点及 5×5 邻域无纯水图块）、与已有单位间距 ≥48px、以「朝敌方指挥中心」为主轴分内/中/外三圈。每方 9 个：`mgTurret`×3、`rocket_turret`×2、`mgTurretT2`/`turretArtyLight`/`turretArtyHeavy`/`shredderAATurret` 各 ×1（**AA 只 1 个/方**是刻意的，沿用既有决策：观众会花钱召唤飞机，AA 铺满会让飞机瞬间蒸发）。

**新增工具**（`danmaku-relay\tools\`）：
- `map_swap_mod_units.py` —— 阵型基础单位 → mod 单位。`check/dryrun/apply/revert/verify` 五模式，`apply` 自动备份。映射表在顶部 `MAP`。
- `map_add_mod_towers.py` —— 补炮塔。`plan/apply/verify/revert`。层数与兵种在顶部 `LAYERS`。
- `verify_units_et.py` —— 用 `xml.etree`（**不是正则**）复核 UnitObjects 全量，补 `verify_adapted_map.py` 的盲区（见「坑」#5）。

**提交**：`danmaku-relay` = `e3e30b9`（三个工具）；根仓库 = `d79cf3e`（新文档 `docs\直播图 new_dire 玩法说明.md`）。

**回退点**（都在 `<GAME>\mods\maps\`）：
- `…tmx.bak-modswap-20260923-082412`（58786 B，替换前，纯 CRLF 原版）
- `…tmx.bak-towers-20260923-082615`（替换后、炮塔前）
- `new_dire.tmx.bak-before-modtowers-20260923-082438`（旧产物）

### E. 2026-09-23 直播复盘（26 轮）

数据源 `danmaku-relay\logs\combined.log` 的 09-23 切片（2513 行，08:38→21:31）。

- **26 轮**：红胜 11 / 蓝胜 10 / 打平 5。平均单局 **1275 秒（21.3 分）**，中位 1231 秒。
- **5 轮卡满 60 分钟超时**（第 2/9/12/19/20 轮），吃掉 18000 秒 = **全天对局时长的 40%**。
- 「一强一弱 AI 难度」**没有打出一边倒**（11:10）——交接文档里挂着的待验证项，这天的数据回答了它。
- **观众参与只剩点赞**：召唤指令 **0**、送礼 **0**、关注 **0**、点赞 101 次（清心 76 / 筱米 16 / 赵云轲 7 / 其他 2 人各 1）。118 条弹幕全是普通聊天（"赞"、"[捂脸]"、"欧买噶"、"关播了哦"）。对比 09-22 基线「红蓝指令去重发送者 2 人」，这天是 0。
- 稳定性：全程仅 2 条 WARN（`douyinLive 断连` 1 次、`游戏链路探测失联 1/2` 1 次——后者是 21:31 关播后游戏被关的正常现象）。**直播期间零崩溃**。

### F. `roundMaxMs` 从 60 分钟改为 30 分钟

文件：`danmaku-relay\data\battle-config.json`（**被 `.gitignore:15:data/` 忽略，不进仓库**）。

依据（用 09-23 的 26 轮实测逐档算过）：

| 上限 | 会切掉的非超时局 | 僵局止损 |
|---|---|---|
| 20 分 | **12 个**（21 局切一半） | 省 200 分 |
| **30 分** | 2 个 `[2452, 3133]` | **省 150 分** |
| 40 分 | 2 个 `[2452, 3133]` | 省 100 分 |
| 45 分 | 1 个 `[3133]` | 省 75 分 |
| 60 分 | 0 个 | 0 |

**30 与 40 切掉的是同样两局，所以 30 严格更优**。顺带修正了旧交接文档建议的 `120000~300000`（2–5 分钟）——那个值会把 21 局砍掉 12 局。

验证：`node tools/verify_battle_config.js` → **30 PASS / 0 FAIL, exit=0**。中继停着，**下次启动时读盘生效**（`index.js:22` 会调 `battleConfig.loadDefaults()`）。

### G. 游戏目录已备份到项目内

**`D:\Projects\live-waifu\_archive\game-backup-20260924\`** —— 465 个文件 / 115 MB：

| 目录 | 内容 |
|---|---|
| `mods\` | `maps\`（258 文件：历次摆阵源图 + 产物 + 备份）+ `units\`（3 个 .rwmod） |
| `jar\` | `game-lib.jar` + 15 个 `game-lib.jar.bak-*`（五重注入产物与各阶段回滚点） |
| `runtime\` | `lastrun.log`、`econ_live.txt`、`end_live.txt`、`crashes.txt`、**19 个 `hs_err_pid*.log`** |
| `config\` | `preferences.ini`（含 mod 启用状态）、`autostart.script`、`cache\` |
| `saves\` | 4 个存档，含 `autosave.rwsave.tmp2`（2026-09-24 21:20） |
| `replays\` | 4 个录像，含 **2 份 `[sandbox]Dire Straight … .replay`**（主播沙盒摆阵录像） |

备份内附 `README.md`（清单 + 换版本后的 5 步恢复流程 + 硬编码路径改造点）。

**对账证据**：`mods` 258 vs 258 文件（0 缺 / 0 多 / 0 字节不符）、`jar` 16 vs 16、`hs_err` 19 vs 19；5 个关键文件 sha256 逐一比对一致（`game-lib.jar` / `preferences.ini` / `autostart.script` / `new_dire.tmx` / 摆阵源图）。
**原目录未被写**：全程只用 `cp -r`（以原目录为源）+ 只读命令；原目录最新 mtime 21:47:33 早于备份创建时刻 21:50:08。

### H. 代码位置（回答用户问题）

**全部在项目里，游戏目录里没有项目源码。**

```
D:\Projects\live-waifu\               ← 项目根（git 仓库）
├── danmaku-relay\                    ← 直播中继（独立 git 仓库，branch main）
│   ├── battle\                       ← 对局控制：gameController / liveSpawner / teams / battleConfig / difficulty / giftTiers
│   ├── danmaku\                      ← 弹幕适配器（抖音 / B站）
│   ├── tools\                        ← 地图与单位工具
│   ├── toolbox\battle.html           ← 控制面板
│   └── data\battle-config.json       ← 运行时配置（gitignored）
├── war-vote\tools\                   ← ★ 反编译源码
│   ├── decompiled\main_out\com\corrodinggames\rts\…
│   ├── _gfdec\out\com\corrodinggames\rts\…
│   └── _gfdec\gf_src\com\corrodinggames\rts\gameFramework\…
├── _reports\                         ← 调研报告 + 注入补丁源码（各 *_research\_inject\src\*.java）
├── _archive\                         ← 归档研究脚本（ccresearch-game\：analyze_map.py / terrain_at.py）+ 本会话的游戏备份
├── waifu-agent\ · war-danmaku\       ← 桌宠 agent / 弹幕前端
├── docs\                             ← 文档
├── .rivet\                           ← skills / plans / knowledge（**不受版本管理**）
└── AGENTS.md · HANDOVER.md · BRIEF-*.md · relay-window.bat
```

游戏目录里**属于项目**的东西（已在 G 项备份，删目录前必须留）：`game-lib.jar`、15 个 `.bak-*`、`mods\`、`preferences.ini`、`autostart.script`、`lastrun.log`/三个 `*.txt`/`crashes.txt`、19 个 `hs_err`、`cache\`、`saves\`、`replays\`。`assets\`/`libs\`/`jvm*`/DLL/`*.exe` 是新版本自带的，不必救。

---

## 当前卡点

### 1. 🔴 直播图目前是坏的 —— 它依赖的 mod 已被移出（最高优先）

**事实**：`<GAME>\mods\units\` 现在只有三个 2026-09-24 21:29–21:37 放进来的 mod：
- `45bf7cf23313dc35.rwmod`（67.5 MB，"Major Experimentals / 更多实验单位"）
- `a2bd88c8437b8561.rwmod`（5.4 MB，"EK_Definitive_Edition_2025h6"）
- `tmpzqo3w6go.rwmod`（658 KB，"Large Earth 4000x2000"，地图 mod）

**`Moo's Defence Agency v3.1.rwmod` 已经不在了**，`preferences.ini` 的 `modSettings` 里也没有任何 Moo 条目（只剩 `8561.rwmod... enabled`、`dc35`/`mega_builders` disabled）。

**后果**：`<GAME>\mods\maps\new_dire.tmx` 里引用了 **25 种 Moo 单位**（`achillesTank buffaloTank cometTank cruiserShip destroyerShip dinghyShip dreadnoughtShip dusterTank grandSlamBomber harbingerGunship lynxTank mgTurret mgTurretT2 monarch mooClassBattleship paladinTank rocket_turret saberTank shredderAATurret turretArtyHeavy turretArtyLight typeUGunship wyvernTank wyvernTankDeployed zephyrTank`），而引擎对 `customUnit` 找不到会抛 `Could not find custom unit of:` → **地图加载失败，开播起不来**。

**未验证**：没有实机跑过（中继停着）。但这个结论直接来自 `game\b\a.java` 的 `throw new f(...)`，且 09-23 全天该计数为 0 正是因为 Moo 当时还在。

**两条出路**（用户尚未选）：把 Moo 放回 `mods\units\`（Steam 创意工坊可重下）；或者把这 25 种单位换成现有 mod 的单位（用 `map_swap_mod_units.py` 改 `MAP` 后重跑整条链）。

### 2. `<GAME>` 即将被删除，换版本的影响面

用户明确说「原游戏目录我准备删了」，并要换其他版本。已排除的障碍：无进程占用该目录、无端口监听。

**未做的事**：新版本还没下、没解压、路径常量**还没改**。
项目里 **117 处**引用了 `tiexiuzhanzheng_zhengshi_v1.15_anfensi.com`，其中**活代码**在：
- `danmaku-relay\battle\gameController.js:19`
- `danmaku-relay\battle\economy.js:25`
- `danmaku-relay\tools\gen_unit_table.js:25`、`verify_unit_prices.js:23`
- `_reports\*\_inject\*.ps1`
其余 47 处在 `.md` 文档里。

**`game-lib.jar` 的注入补丁与游戏版本绑定** —— 换版本后大概率不能直接套用，需按新 jar 用 `_reports\*\_inject\` 的构建脚本重新构建。这是换版本里**工作量最大**的一块。

### 3. `roundMaxMs` 改动待实机确认

已改成 1800000（30 分钟），静态验证通过（30 PASS / 0 FAIL）。**但没有在真实对局里跑过一轮**——需要至少观察一轮 timeout 是否在 30 分钟触发。

### 4. 观众指令为 0（2026-09-23）

全天 0 条召唤指令。**未查因**：不知道是「没人知道怎么玩」「玩法门槛太高」还是「那天就是人少」。桌宠欢迎语（`[WAIFU][welcome]`）已经在讲规则了。要判断得看多日曲线，单日样本不足。

### 5. C3 未修（用户此前搁置）

方向（都未验证）：① 回退/更新 Intel 驱动；② 试 `fallback64.bat`（走 `jvm64\` 的 OpenJDK 13 64 位，加载的是 `igxelpicd64.dll`——**是另一个 DLL 文件**，有机会绕开 32 位缺陷点）。**旁证**：目录里 6 个 OpenJDK-64 的 `hs_err` 带着这套游戏的 classpath 崩在 OpenGL 驱动帧里，说明**64 位路径能跑起这个游戏**；但那些崩溃的 CPU 签名是 AMD（`family 23` + `sse4a`/`3dnowpref`），**来自打包者的机器而非本机**，所以「64 位能否绕开 Intel 缺陷点」仍未验证。

---

## 下一步

按优先级，每条可立即执行。

1. **🔴 先修直播图**（卡点 #1）。二选一：
   - 把 `Moo's Defence Agency v3.1.rwmod` 下载回来放进 `<GAME>\mods\units\`，重启游戏在 Mods 菜单勾启用；或
   - 改 `danmaku-relay\tools\map_swap_mod_units.py` 顶部 `MAP` 与 `map_add_mod_towers.py` 顶部 `LAYERS`，把不可用的单位换成现有 mod 的单位，然后按序重跑：
     ```
     python tools/map_swap_mod_units.py apply
     python tools/map_add_mod_towers.py apply
     python tools/map_adapt_newdire.py apply
     python tools/verify_units_et.py "<产物路径>"
     ```
     （若图已被 Moo 化，第一步要先 `revert` 回原始源图再改 `MAP`，否则 `MAP` 的键对不上。）
2. **换版本前先确认卡点 #1 已解决** —— 否则备份里的 `new_dire.tmx` 是张跑不起来的图，搬过去也没用。
3. **换版本后改路径常量**（卡点 #2 列出的活代码点），并**重打 jar 注入**。
4. **实机验证 `roundMaxMs` 30 分钟**（卡点 #3）：起中继观察一轮 timeout 是否在 1800 秒触发。
5. **观众指令为 0 的归因**（卡点 #4）：至少再看 2–3 天的 `[DANMAKU]`/`[CREDIT]` 曲线，或直接问用户。
6. **给 `_archive\game-backup-20260924\` 打一个 zip** —— `_archive\` 在 git 里是未跟踪状态，将来一句 `git clean -fdx` 就会把它清掉。（本会话末尾向用户提过这个选项，用户未回。）
7. **（承自上一份交接，仍未做）跑几局统计一强一弱是否真打出差别**：09-23 那天是 11:10（几乎五五开），要看多日累计。锚点：`<GAME>\lastrun.log` 的 `Locking lockAiDifficulty` 两行 + 中继日志的 `第 N 轮结束 (engine-end) — … | 红方胜/蓝方胜`。不对称就调 `battle/difficulty.js` 的 `WEAK_LEVELS`/`STRONG_LEVELS`。
8. **（承自上一份交接，仍未做）决定 `switch-map` skill 是否搬到 `.agents\skills\`** 以获得版本管理；搬完删 `.rivet` 下那份，避免两份漂移。
9. **（承自上一份交接，仍未做）实机复验收紧后的 `looksLikeCommand`**（离线 25/0 已过）：起中继后发 `{"content":"主播开车了"}` 期望**不出现** `[播报][hint]`；再发 `{"content":"4\u8718\u86db"}` 期望出现一条。
10. **（承自上一份交接，仍未做）`.rivet\` 会随工作区丢**（见「坑」#21）—— 要把结论留痕，写进 `docs\` 或代码注释。

---

## 坑

### 本会话新增

1. **游戏进程名随启动方式变化**：手动双击是 `javaw.exe`，**中继拉起的是 `java.exe`**。`tasklist //FI "IMAGENAME eq javaw.exe"` 会返回空 → 误判「游戏已退出」。**可靠判据是 `netstat` 找 `:9999` 的 owner PID**，再用 `Get-CimInstance Win32_Process` 看 CommandLine 确认。
2. **`battle/battleConfig.js` 的 `effective()` 不会自动读盘**。模块 `require` 时 `defaults` 只是 `LIMITS` 里的内置默认值（`numberOfAIs:7 / aiDifficulty:0 / roundMaxMs:0`），**必须先显式调 `battleConfig.loadDefaults()`**（`index.js:22` 会调）。验证配置时漏掉这一步会看到一组「文件明明改了却对不上」的假值。
3. **`glob.glob()` 遇到文件名里的方括号会静默返回空** —— 本项目地图名是 `… [by uber] …`，`glob` 把 `[by uber]` 当字符类。用 `os.listdir` + `startswith` 代替。（本会话测试 revert 时踩到，差点误判成脚本 bug。）
4. **地图文件名含中文**，在 Git Bash 里把路径作为参数传给 python 会被转码搞坏（`FileNotFoundError` 且路径显示为乱码）。做法：让 python 自己用 `os.listdir`/`glob` 去找，或用 ASCII 临时副本。
5. **`verify_adapted_map.py` 看不见 mod 单位**。它用正则只认 `<property name="unit" …/>`，而 mod 兵种走 `customUnit` → 产物 185 个对象它只报 50 条、`{1:25,2:25}`，却给 **PASS**（有损的通过）。改用 `danmaku-relay\tools\verify_units_et.py`（XML 通道）读全。
6. **`.tmx` 换行是 CRLF**。python 读写要带 `newline=""`，否则默认的通用换行会把整份文件转成 LF（实测 58786→57995 字节）。功能上引擎不在乎，但这是**未声明的改动**，交付前要修掉。
7. **正则里写中文会被 shell 转码**。heredoc 传 `—`／`第`／`轮` 等字符进 python 正则会匹配失败。用 `\u` 转义（如 `\u79d2` = 秒），或把脚本写成文件再跑。
8. **python 里别用 Git Bash 风格的路径**。`/d/Projects/...` 会 `FileNotFoundError`，要用 `D:/Projects/...`。
9. **`assets\assets\maps\skirmish\new_dire.tmx` 存在** —— 中继拷贝产物时多了一层 `assets\`。不影响运行，但排查路径时别被它绕进去。

### 承自上一份交接，仍然有效

10. **`danmaku-relay` 是独立嵌套 git 仓库**（`git -C danmaku-relay rev-parse --show-toplevel` = `D:/Projects/live-waifu/danmaku-relay`，branch `main`）；根仓库把它当未跟踪目录，在根仓库 `git add danmaku-relay/...` **无效**。后果：以为提交了其实没提交。
11. **同一游戏 JVM 跨轮复用**。任何「每轮一次」的 JVM 级静态量都会被多轮共用——`EndBridge.firstSeenMs` 就是这样栽的。新增注入若用静态状态，必须确认它按轮复位。
12. **`npm run verify` 会往真日志 `danmaku-relay\logs\combined.log` 写固定假事件**（`模拟开局失败`、`第 9/10 轮结束`、`游戏链路失联`）。拿这些时段当故障证据会得出完全错误的结论。`logger.js` 支持 `RW_LOG_FILE` 覆盖路径可隔离。
13. **改了中继 `.js` 不重启 = 跑旧代码**（只在启动时 `require`）。判「新代码生效」的硬锚点是**进程启动时间**，不是症状。地图换图不用重启（每轮自动拷贝）。
14. **覆盖 `game-lib.jar` 必须先停游戏**（`apply.ps1` 会自检游戏 java 进程并拒绝），它会做时间戳备份 + 部署后字节校验。不停游戏直接拷 → jar 被锁、写坏。
15. **`build.ps1` 的输入是「已部署 jar」**，而当前 jar 在 end 注入之上还叠了 cam/fog/probe，直接跑会撞 EndPatcher 的幂等守卫（`input already patched`）。**要只换 EndBridge 得用 `replace_end.ps1`。**
16. **Git Bash 控制台是 GBK**：python `print` 中文会 `UnicodeEncodeError`。做法：`export PYTHONIOENCODING=utf-8`，或把输出写进 UTF-8 文件再用 `read_file` 读。
17. **向中继发中文弹幕必须用 `\uXXXX` 转义**：`curl -d '{"content":"红3战车"}'` 的中文会被命令行编码搞坏，`parseDanmaku` 返回 `null`、`spawns` 停在 0。
18. **`announce()` 直接调 `spawner.sendCommand`，不走 `dispatch`**（`battle/index.js:84`）。用 `setSendCommandForTest` 打桩抓不到画面提示命令，测试会假阴性。
19. **`looksLikeCommand` 与 `matchUnitByContains` 的判据别合回去** —— 后者为解析容错保留单字键（`车`/`飞`），合回去会让「主播开车了」被判成指令。
20. **`team_orchestrate` 的 Markdown 解析器认不出 `### 任务 N.M` 这类中文标题**，且它的波间门禁按 `*.test.*` 找测试文件，而本项目约定是 `tools/verify_*.js` → 会被误判「零测试文件」而硬拦。遇到时报失败先自己复现再下结论。
21. **`<GAME>\lastrun.log` 会被下一次游戏启动覆盖**。要留证必须在崩溃当时抓，或依赖 `hs_err_pid*.log`（不会被覆盖）。
22. **游戏窗口常被浏览器遮挡**；截图用 `PrintWindow(hwnd, hdc, 2)`（`PW_RENDERFULLCONTENT`）可抓被遮挡窗口，不必置前台。
23. **UI / 渲染类改动别只信日志**：`announce` 返回 `sent=true` 只证明命令写进了 socket，不证明画面渲染出来——要靠截图肉眼确认。
24. **直播地图的 Triggers 必须含 `team_0_info`（`allyGroup=1` + `disabledAI=1`）**，否则引擎判负逻辑（`gameFramework\n\f.java:918-967`）查到「本地队 team0 的同盟组里没有指挥中心」就**一进游戏弹 Defeat**（实测 `Game Time 00:00`）；中继运行时的 `setTeamAllyGroup(0,1)` 要起局后约 10s 才发，来不及。
25. **`<GAME>\assets\maps\skirmish\` 那份地图每轮会被覆盖** —— 手改它是白改，源永远是 `mods\maps\`。
26. **`battle/mapPool.js` 的日志会骗人**：`第 N 轮准备中 — 经典战场 (wedge)` 只是显示名。**要确认真实地图只看 `lastrun.log` 的 `Mapfile:` 行。**
27. **中继吃 `RW_ROUND_MAX_MS` / `RW_PUSH_LEVEL` / `RW_ECON_ENABLED` 等环境变量**；但单局时长面板化后**面板值 > 环境变量**（`roundMaxMs` 非 0 时 env 完全不起作用）。
28. **停服务必须先校验进程身份**：按端口找 owner → `Get-CimInstance Win32_Process` 看 `CommandLine` → 确认是 relay 再杀；**永不碰 `explorer` / `winlogon` / `dwm`**。顺序是**先杀中继再杀游戏**（否则中继的看门狗会把游戏重新拉起）。停中继前先 `curl -X POST http://localhost:8767/api/stop` 停适配器。
29. **改代码后要跑 `npm run verify`（exit 0 才算过）**，新加的 `verify_*.js` 要**显式**加进 `package.json` 的 `verify` 链——它是固定清单，不会自动发现新脚本。
30. **`.rivet\` 全目录不受版本管理**（在 `.git\info\exclude` 里）：plans / skills / knowledge 都会随工作区丢。**要留痕的结论得写进 `docs\` 或代码注释。**（本文档本身就在 `.rivet\` 下，同样不受版本管理。）
31. **`plan close` 会追加 `Status: EXECUTED` 但不清旧的 `APPROVED`** —— 两行并存会让后续会话误判「计划仍在执行」。close 后手工 grep 一下 `^> \*\*Status:`。
32. **写断言时别拿整份文档判「不含某串」**：换图收敛测试里断言「产物不含 `team="0"`」，但 Triggers 的 `team_0_info` 本身就带它——断言永远不成立。只查 UnitObjects 段。
33. **弹幕兵种别名不认识就是无声空操作**：`红2轰炸机` / `蓝5等离子坦克` 会被标 `未识别（不生兵）`（`UNIT_MAP` 里没有这两个词）。别名表与播报中文名同源，要用 `unitDisplayName` 反查。
34. **地图一旦引用 mod 单位，那个 mod 就成了硬依赖** —— 禁用/改名/删掉会让地图加载直接抛异常（卡点 #1 就是这么发生的）。把 mod 单位写进地图前先想清楚这个代价。

---

## 附：本会话新增/改动的文件

**提交过的**：
- `danmaku-relay\tools\map_swap_mod_units.py`、`map_add_mod_towers.py`、`verify_units_et.py` → `danmaku-relay` 提交 `e3e30b9`
- `docs\直播图 new_dire 玩法说明.md` → 根仓库提交 `d79cf3e`

**未提交但已落盘**：
- `danmaku-relay\data\battle-config.json`（`roundMaxMs: 1800000`；gitignored）
- `_archive\game-backup-20260924\`（465 文件 / 115 MB + `README.md`；`_archive\` 未跟踪）
- `<GAME>\mods\maps\` 下的源图与产物、三份 `.bak-*`

**本会话跑过的日志落点**：`danmaku-relay\logs\combined.log`（注意「坑」#12 的假事件污染）。

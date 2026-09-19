# live-waifu 交接文档

> ⚠️ **本文档写于 2026-09-19 17:20，之后又发生了两轮开发。动手前请先读 `.rivet/HANDOFF.md`**
> （那里有后续会话的交接，包含巡逻接线、观众阵营归属、点赞/关注加余额等本轮新增能力）。
>
> **本文档中已知过期的条目**（照它行动会走错）：
> - §3.2「中继代码未生效」→ 中继早已重启多次，改动已生效。
> - §7#1「中继未重启」→ 已完成。
> - §7#2「收局推手缺失」→ **现已等价有解**：巡逻（`av.j`）接线已落地，
>   召唤的兵会自动朝敌方基地推进（见 `.rivet/HANDOFF.md` §1-§4）。
> - §7#9「`live-waifu-ops` 的 SKILL.md 已超 10 万字符」→ 仍待处理。
> - jar 版本台账（§4.3）已延长，最新见 `.rivet/HANDOFF.md` §5。

> 写于 **2026-09-19 17:20**（承接当日会话）。写给「接手继续开发/探索的 Agent 或人」。
> 本文档自包含：现状、今天改了什么、怎么生效、怎么回滚、哪里还会踩坑、哪些事没做完。
> 动手前**必须先读两个 skill**（`live-waifu-ops`、`jvm-bytecode-patching`）—— 本文档只做索引与交接，不重复它们的细节。

---

## 0. TL;DR（先看这 6 行）

1. **项目能跑，全链路在线**：中继 + 抖音适配器 + Live2D 桌宠 + 游戏（注入版 jar）都在运行，直播互动可用。
2. **今天最大的成果**：把引擎的「判胜」信号接出来了 —— 游戏 jar 已注入 `endinject.EndBridge`，每 6 帧写 `<GAME>\end_live.txt`（`victory`=Victory 面板 / `defeat`=Defeat 面板 / `first_seen` 时刻）。**这是唯一能同步「指挥中心被拆」结局的通道**（引擎 `isTeamDefeated` 读的是"整队清零"，与规则不同源）。
3. **但中继还没重启 ⇒ 中继侧的接线代码（`startEngineEndWatch`）尚未生效**。现在跑的中继是 15:50 起的进程、旧代码。要激活只需重启中继（约 5 s 断抖音）。
4. **游戏本体已是注入版**（`game-lib.jar` sha256 `C0F85AEC46F4CFD5`，2,642,783 B）；**原始版和三版备份都在**，回滚一条命令（见 §4.3）。
5. **今天还修了 3 个实机缺陷**：兵种别名 3 组"无声空操作"、8 个兵种"免单召唤"、`startGame()` 谎报 PID（每轮白起一个死掉的 JVM）。均已改代码 + 备份。
6. **待拍板未做的**：收局推手（每 18 s 推两队打对方基地）、轮次上限可配、核弹/T2 塔定价（见 §7）。

---

## 1. 项目是什么 / 架构

抖音直播自动化套件：观众发弹幕 → 中继解析 → 通过游戏 Debug Socket 在 Rusted Warfare 里实时生兵 → 观众操控红蓝对战。

```
抖音直播间 642238215421
   │ 弹幕/礼物
   ▼
douyinLive.exe (:1088, ws)  ← 由中继 spawn
   │
   ▼
danmaku-relay (:8766 WS 广播 / :8767 控制面板)
   ├── battle/ 模块（内置，无需单独启动）
   │     liveSpawner.js   弹幕解析 → Debug Socket 生兵（含经济扣款）
   │     roundManager.js  轮次状态机 IDLE→FIGHTING→ENDED
   │     gameController.js 游戏生命周期 + 胜负轮询 + 失联看门狗
   │     economy.js       读 econ_live.txt 实时余额，扣款走 debug.addTeamCredits
   │     index.js         轮次事件 / 播报 / 看门狗 / HTTP API
   └── waifu-agent (:1420) Live2D 桌宠 + TTS（Tauri dev）
          │
          ▼
Rusted Warfare 1.15（注入版 game-lib.jar, Debug Socket :9999）
```

**关键路径**

| 项 | 路径 |
|---|---|
| 项目根 | `D:\Projects\live-waifu` |
| 中继（独立 git 仓库） | `D:\Projects\live-waifu\danmaku-relay` |
| 一键启动（交互菜单，每个组件独立窗口） | `D:\Projects\live-waifu\start-all.ps1`（`-All/-Relay/-Waifu/-Companion/-Stop/-Status/-DryRun`） |
| 中继窗口脚本（设 `RW_ECON_ENABLED=1` 后 `node index.js --auto-start`） | `D:\Projects\live-waifu\relay-window.bat` |
| 桌宠窗口脚本 | `D:\Projects\live-waifu\waifu-window.bat` |
| 游戏安装目录（下文简称 `<GAME>`） | `D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15` |
| 中继日志 | `danmaku-relay\logs\combined.log`（**UTF-8，PS 5.1 必须显式 `-Encoding UTF8` 读**） |
| 引擎自己的日志 | `<GAME>\lastrun.log`（每次启游戏被覆盖） |
| 运行期通道 | `<GAME>\econ_live.txt`、`<GAME>\end_live.txt`（见 §6） |
| 今日报告 | `_reports\live-observation-20260919.md`、`_reports\unit-alias-audit-20260919.md` |
| 注入工作区 | `_reports\end-research\_inject\`（end 读数）、`_reports\econ-research\_inject\`（经济+HUD） |

---

## 2. 当前运行现场（快照：2026-09-19 17:15，**时间敏感**）

| 组件 | 进程 / 端口 | 备注 |
|---|---|---|
| danmaku-relay | `node` **pid 7464**（15:50:45 起，父 cmd 16608，标题 `[DANMAKU-RELAY] running - do not close`）→ `:8766` `:8767` | ⚠️ **跑的是旧代码**，今天的中继改动未生效 |
| waifu-agent | `waifu-agent.exe` pid 16428 + vite `node` 5056（`:1420`） | 正常 |
| 抖音适配器 | pid 4456 → `:1088` | 由中继 `spawnDouyin()` 拉起 |
| 游戏 | `java` **pid 19100**（17:08:12 起，535 MB）→ `:9999` | **注入版 jar 首次加载**，无 `onGameCrash`、无 `hs_err` |
| 轮次状态 | `/api/battle/state` → `IDLE`, round 5, `outcome.winner="red"`（17:09:35 以 `defeat:blue` 结束，69 秒） | 第 5 轮是**今天唯一真的打出胜负的一轮**（靠旧的"团灭"判据，比引擎判胜晚 27 s） |
| 另有两个 node 进程（1548 / 18872） | `tianshu-tui ... browser install` + `playwright ... install chromium` | **是接手的 Agent 工具链在装浏览器**，与直播链路无关，别误判为泄漏 |

**查真相的三条命令**（日志会说谎时用它们）：

```powershell
# 谁真的占着调试口（= 真正的游戏进程）
Get-NetTCPConnection -LocalPort 9999 -State Listen | Select OwningProcess
# 这个实例是什么时候起来的（lastrun.log 首行 = 文件日志开始时间）
(Get-Content '<GAME>\lastrun.log' -TotalCount 1 -Encoding UTF8)
# 引擎认得的 jar 能力（30 秒判版本，别靠 hash 记忆）
python -c "import zipfile;z=zipfile.ZipFile(r'<GAME>\game-lib.jar');print('econPrepY', 'econPrepY' in z.read('com/corrodinggames/rts/gameFramework/f/g.class').decode('latin-1'));print('EndBridge','endinject/EndBridge.class' in z.namelist())"
```

---

## 3. 今天改了什么（2026-09-19）

### 3.1 游戏本体：注入「引擎判胜读数」（已部署、已实机验收）

| 项 | 内容 |
|---|---|
| 注入点 | 往**已有**的 `econinject.EconBridge.tick(Object,Object)` 首行插 `try { endinject.EndBridge.tick(l.B()); } catch (Throwable) {}`（EconBridge 已被 `f/g.b(F)V` 每帧调用 ⇒ 不用再碰 `f/g.class`） |
| 读的字段 | `com.corrodinggames.rts.gameFramework.l` 的 public 布尔 `dq`(Victory) / `dt`(Defeat) / `dr`(短局抑制)。面板取字处 `f/f.java:182-185`，判据 `f/f.java:67-70`，置位者 `f/g.java:3415 G()` / `:3427 H()` |
| 产物 | `<GAME>\end_live.txt`（每 6 帧原子写，见 §6） |
| 极性 | `victory` = 本地玩家视角胜（本地 team 0 已并入红方同盟组）⇒ **红方胜**；`defeat` ⇒ **蓝方胜** |
| 构建/部署 | `_reports\end-research\_inject\{src\EndPatcher.java, build.ps1, apply.ps1, decomp_check.py}` |
| 部署结果 | `<GAME>\game-lib.jar` = 2,642,783 B，sha256 `C0F85AEC46F4CFD5`（17:07:42） |
| 验收 | 静态 8/0（skill 探针）→ CFR 反编译人眼确认读 `dq/dt/dr` → 起宿主无崩溃、econ 未受影响 → **端到端**：空投 10 辆 megaTank 到蓝方基地旁，~28 s 后 `end_live.txt` 翻 `victory 1` |
| 完整案例 | skill `jvm-bytecode-patching` → `references/rusted-warfare-end-readout.md` |

### 3.2 中继代码（**已改文件，未生效**：需重启中继）

| 文件 | 改动 | 备份 |
|---|---|---|
| `battle/gameController.js` | 新增 `readEngineEnd()` / `startEngineEndWatch(sinceMs,cb)` / `stopEngineEndWatch()` / `endFilePath()`；`startGame()` 增加「调试口已连 ⇒ 复用现有实例、不 spawn」分支（旧代码每轮白起一个注定死掉的 JVM，并谎报 PID）；`killGame()` 保持身份校验不杀错进程 | `gameController.js.bak-stalegame-20260919-162323` |
| `battle/index.js` | `fighting` 事件启动 end 轮询、`ended` 停止；播报新增 `engine-end` 原因；日志区分「复用实例」/真实 PID | `index.js.bak-stalegame-20260919-162323` |
| `battle/liveSpawner.js` | 修 3 组**无声空操作**别名：`蜘蛛→experimentalSpider`、`甲虫→bugMelee`、`航母→experiementalCarrier`（原 `spiderBot`/`bug`/`carrier` 本安装**不存在**，引擎日志实锤 `Could not find type:spiderBot`） | `liveSpawner.js.bak-aliasfix-20260919-162323` |
| `battle/unit-prices.json` | 补 8 个有权威出处的单价（含原"免单洞" `experimentalGunship=140000`、`experimentalSpider=70000`、`modularSpider=90000`、`experiementalCarrier=30000`、`bugMelee/bugRanged/bugWasp/bugFly`）——**`null` 或缺失 = 免费召唤，不是拒绝** | `unit-prices.json.bak-prices-20260919-162323` |

### 3.3 工具与知识资产（今天新增）

| 资产 | 位置 | 用途 |
|---|---|---|
| 别名全量审计 | skill `live-waifu-ops` → `scripts/verify_unit_aliases.py`（rc=0 才算过） | 对照引擎自己的三份名单（translations + 单位 ini + 引擎实测拒绝的类型）审 `UNIT_MAP` 与单价 |
| 后台抓帧 + OCR | skill `live-waifu-ops` → `scripts/capture_game_frame.py` | PrintWindow（**不移动窗口**）+ RapidOCR，如实打印 `minimized=`，最小化时不会假装有内容 |
| 端到端报告 | `_reports\live-observation-20260919.md` | 今天 15:50–17:15 的完整观察、证据、结论、待办 |
| 注入案例 #1（经济+HUD） | skill `jvm-bytecode-patching` → `references/rusted-warfare-econ-injection.md` | 读+写+显示三条链路、工具链实测、纯 JRE 无 JDK 的做法 |
| 注入案例 #2（判胜读数） | skill `jvm-bytecode-patching` → `references/rusted-warfare-end-readout.md` | 今天的注入全过程 + hash 链 + 四层验收 |

---

## 4. 怎么让改动生效 / 怎么回滚

### 4.1 重启中继（激活 3.2 的全部改动）

```powershell
# 停：先确认 8767 的 owner 就是中继，再杀（身份判断按端口，不按名字）
$c = Get-NetTCPConnection -LocalPort 8767 -State Listen
$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess)
Write-Output "pid=$($p.ProcessId) name=$($p.Name) cmd=$($p.CommandLine)"   # 先看清再决定
Stop-Process -Id $p.ProcessId -Force
Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue   # 必须空
# 起（会自动拉起 douyinLive）
powershell -ExecutionPolicy Bypass -File D:\Projects\live-waifu\start-all.ps1 -Relay
```
- 重启**会丢自启游戏的进程句柄**，但游戏往往还在跑 ⇒ 新中继会**连上现有实例**（这正是今天加的那条复用分支）。
- 重启后确认：`danmaku-relay\logs\combined.log` 出现 `[BATTLE][win] 开始轮询引擎判胜文件（每 2000ms，文件 <GAME>\end_live.txt）`。
- 验收一轮：起一轮 → 让一方基地被打掉（或按 `references/engine-unit-commands.md` §3 灌兵+推基地）→ 中继应立刻播报「红/蓝方获胜！」而不再等超时。

### 4.2 重启游戏（只在换 jar 后需要）

正常路径：**让中继起**（`POST http://127.0.0.1:8767/api/battle/start`，或面板点「开始新一轮」）。
它用 `<GAME>\jvm\bin\java.exe ... -cp game-lib.jar;libs/* com.corrodinggames.rts.java.Main -debug 9999:autostart -log lastrun.log` 起。

### 4.3 回滚游戏 jar（先停游戏！）

```powershell
# 停游戏（中继提供身份校验过的路径）
Invoke-RestMethod -Uri 'http://127.0.0.1:8767/api/battle/kill-game' -Method Post
# 回滚到「econ 注入版」（无 end 读数）
Copy-Item "<GAME>\game-lib.jar.bak-end-20260919-170807" "<GAME>\game-lib.jar" -Force
# 回滚到「原始未改版」（连经济注入也没有）
Copy-Item "<GAME>\game-lib.jar.bak-econ-20260919-113027" "<GAME>\game-lib.jar" -Force
```

**版本 hash 链**：

| 阶段 | 大小 | sha256 前缀 | 备注 |
|---|---|---|---|
| 原始未改 | 2,639,503 | `8A550A37E2D8A543…` | 备份 `game-lib.jar.bak-econ-20260919-113027` |
| + 经济/HUD 注入 | 2,641,418 | `B095112E1045D712…` | 备份 `game-lib.jar.bak-end-20260919-170807` |
| **+ 判胜读数（当前）** | 2,642,783 | `C0F85AEC46F4CFD5…` | 无对应备份（它就是当前版本） |

> ⚠️ jar 被运行中的 JVM 锁住 ⇒ 换 jar 前必须先停游戏；`apply.ps1` 已内建这条守卫（游戏在跑就 rc=4 拒绝）。

---

## 5. 改 jar 的标准流程（今天验证过，照抄即可）

1. 读 skill `jvm-bytecode-patching`（铁律：注入体整体 `try/catch(Throwable)` 包死；先备份+身份校验；分步验证；别用高级语法）。
2. 反编译定位：CFR 在 `war-vote\tools\cfr.jar`。源码树：`war-vote\tools\decompiled\main_out\...`（`librocket\scripts\Debug.java` 等）与 `war-vote\tools\_gfdec\gf_src\...`（`gameFramework` 主体）。**反编译目录不吃目录输入，先打成小 jar**。
3. 写 patcher：模板见 `_reports\end-research\_inject\src\EndPatcher.java`（javassist 源码字符串造类/方法 + `insertBefore` + **输入守卫**防重复注入）。
4. 构建：`powershell -File _reports\end-research\_inject\build.ps1`（3 s：清 stale classes → ECJ 编译 → 跑 patcher → skill 的 `verify-class-injection.py`）。
   - 工具链（已下载）：`_reports\econ-research\_tools\{javassist.jar, ecj-3.21.0.jar}`。**本机无 JDK**；用游戏自带 Java 8 JRE + **ECJ 3.21.0**（3.33 要 Java 11，会 `UnsupportedClassVersionError`）。
5. 反编译人眼复核：`_reports\end-research\_inject\decomp_check.py`（抽出改后的 class → CFR → 打印全文）。**别只看"insertAfter ok"**。
6. 部署：`powershell -File _reports\end-research\_inject\apply.ps1`（父代理执行；打印路径 → 校验没有 `cmdline 含 corrodinggames` 的 java → 时间戳备份 → 拷贝 → **hash 复核** → 打印回滚命令）。
7. 实机：起游戏 → 读落盘文件 → 断言数值 → （需要时）截图/OCR。
8. 验收四层（缺一层就是自欺）：**静态**（常量池）→ **加载**（空方法先起一次）→ **反编译人眼** → **实机**。

---

## 6. 运行期通道契约（读方按这个写，别猜）

### `<GAME>\econ_live.txt`（经济注入，每 6 帧原子写）

```
# econ_live <millis> <frame>
team <id> <balance> <incomePerSec>     # 8 队，team 0 = 本地槽位(99999)，3..7 = 不参战 AI(4000,0)
```
读方：`battle/economy.js`（`RW_ECON_FILE` 可覆盖路径；`RW_ECON_ENABLED=1` 才扣款）。

### `<GAME>\end_live.txt`（判胜读数，每 6 帧原子写）

```
# end_live <millis> <frame>
victory 0|1      # l.dq：Victory 面板（本地视角胜）
defeat  0|1      # l.dt：Defeat 面板
hidden  0|1      # l.dr：短局抑制（面板没画出来，但判胜仍成立）
first_seen <millis> <victory|defeat|none>    # 首次看到判胜的时刻
```
读方：`gameController.readEngineEnd()` / `startEngineEndWatch()`（`RW_END_FILE` / `RW_END_POLL_MS` 可覆盖）。

⚠️ **两个必须遵守的读方纪律**：
1. 文件**跨轮次复用** ⇒ 只认"读到 `victory=1` 就是赢"会把上一轮的胜利算到这一轮。**用 `first_seen > 本轮开始时刻` 去重**。
2. 标志在轮内**一旦为真就一直是真**（直到下次 `loadConfig` 重建）⇒ "状态"不能当"事件"，只能靠时刻 + 停表。

---

## 7. 已知缺陷 / 待办（按优先级）

| # | 事项 | 现状与影响 | 需要什么 |
|---|---|---|---|
| 1 | **中继未重启** | 3.2 的 4 处中继改动**均未生效** | 一句话同意即可重启（§4.1） |
| 2 | **收局推手缺失** | `startAutoBattle()` 里的 `moveAllUnitsOnTeam` 推进被当"误诊"删掉了 ⇒ 只剩"等观众发弹幕"。实测配方（**每 6 s 双方各灌一批 + 每 18 s 把两队推向对方基地**）57–77 秒出结局；没有它，结局何时来取决于观众送了多少兵（今天有一局拖到 25 分钟） | 用户拍板后接回（红→蓝基地 `(1716,1652)`、蓝→红基地 `(560,380)`，落点验证红 `(1118,1048)`/蓝 `(1126,1056)` 相距 ~11px 落地即交火） |
| 3 | 轮次上限硬编码 | `roundManager.maxDurationMs = 5*60*1000`，`RW_ROUND_MAX_MS` 从未实现 | 做成可配 +（配合 #2）放宽 |
| 4 | 免单召唤残留 | `nukeLaucher` / `antiNukeLaucher`（内置单位，无 ini 可取价）与 `turretT2` / `turretT3` / `antiAirTurretT2` / `turret_artillery` / `turret_flamethrower`（表里写死 `null`）**仍然免费** | 用户定价，或把 `null` 语义改成"拒绝" |
| 5 | 播报口径 | 结束播报里的「红21兵 vs 蓝10兵」用的是**召唤计数**（`roundManager.spawnCount`），不是存活/战果；`kills` 恒 0（引擎无击杀 API） | 改文案（如「本轮召唤 …」）或去掉数字 |
| 6 | 引擎 autosave 一直失败 | 每 5 分钟一次：`renameFile … autosave.rwsave.tmp2 → autosave.rwsave` → `Failed to rename to final file` → `Auto save failed`。已确认**不是权限**（目标没被占用、目录可写、tmp2 能写）⇒ 引擎自身 rename-over-existing 的怪癖 | 未修（低优先；后果是没有崩溃恢复存档） |
| 7 | 旧实例 native 崩溃 | 15:20 起的旧游戏实例在 **16:59:22** 留下 `hs_err_pid17660.log`：`EXCEPTION_ACCESS_VIOLATION ... C [igxelpicd32.dll+0x857224]` = **Intel 显卡驱动** native 帧（不是 Java、不是注入产物）。当时窗口**最小化**、已开 1 h39 m | 单独盯一轮：长开 + 最小化 是否可复现；必要时关"团队颜色着色器/着色器效果" |
| 8 | 日志噪音（无害但会误导） | ① 同一条弹幕记两遍（带/不带 `len=`）；② 6 条 `len=0` 空弹幕进日志；③ `probe` 查不存在的 team 8/9（引擎 `Could not find team:8`）；④ 每轮 `ui[warn]: Could not find:ok` + `element is null`（关弹窗命令找错元素，但后面 `closePopup()` 兜住了）；⑤ 地图缩略图缺失 `error_missingmap.png`；⑥ 跑 `npm run verify` 会往真日志写假事件（`offline-r1`、`第9/10轮`、`游戏链路失联`） | 想收拾就逐条修；**别把这些假事件当故障** |
| 9 | `live-waifu-ops` 的 SKILL.md **已 102,464 字符 > 10 万上限** | 再往里加内容会被拒（今天就撞了两次） | 要么瘦身 SKILL.md，要么把新知识写进 `references/` 并在 SKILL.md 换行引用 |

---

## 8. 🔴 红线与陷阱（今天各踩过一次的地方）

1. **绝不干扰用户桌面/会话**。曾在用户正在用的机器上无人值守跑"实启实停"验证，杀掉 `explorer.exe` —— 用户失去桌面+任务栏+开始菜单。⇒ ① 开窗口/占端口/编译/启停服务必须先征得同意，或只跑静态检查；② 任何 `taskkill/Stop-Process` **必须先校验进程身份**（PID 会复用、窗口标题谁都能设），永不触碰 `explorer/winlogon/dwm/csrss/sihost`；③ `killGame()` 里的 `Get-CimInstance ... CommandLine.Contains('corrodinggames')` 就是这条纪律的实现，别改成 `taskkill /IM java.exe`。
2. **读中继日志必须 UTF-8 显式解码**：PS 5.1 默认按 ANSI 解 `combined.log` ⇒ 中文变乱码，**按中文关键词 grep 永远 0 命中**（曾据此误判"日志里没有播报"）。
3. **含 CJK 的 `.ps1` 会被 PS 5.1 当 ANSI 解码**（无 BOM 时），中文足以吞掉结尾引号导致解析失败 ⇒ 新写的构建/部署脚本**一律 ASCII-only**（`build.ps1`/`apply.ps1` 就是照着这条写的）。
4. **"游戏已启动 (PID: …)" 可能是假成功**：若调试口已被**旧实例**连着，`startGame()` 的就绪轮询第一拍就为真 ⇒ 谎报 PID，而新 JVM 抢不到 9999/日志锁当场死掉。今天已加复用分支；排查时用 §2 的三条命令找真身。
5. **`unit-prices.json` 的 `null` / 缺键 = 免费召唤**，不是"不可购买"。补价**不要凭记忆**：mod/内置单位价就在 `assets/units/<u>/<u>.ini` 的 `price:` 字段。
6. **弹幕别名必须对引擎真实类型名审计**：错的名字是**无声空操作**（中继照样打 `[SPAWN] 成功`）。唯一实锤是引擎日志 `ui[warn]: Could not find type:X`。审计脚本：`scripts/verify_unit_aliases.py`。
7. **「画面在动」≠「兵在动」**：PrintWindow 两帧 15 秒像素差 20% 全屏弥散（各格 3–40%）更像地形/水面/云动画 ⇒ 判"兵动没动"只能靠：① 游戏内「作战日志」；② 灌兵+推基地对照实验（`isTeamWipedOut` 翻转时刻为唯一变量）。
8. **别信"读一遍看着对"**：今天两次自欺①我自己的断言把"最小化时 OCR 文本理应为空"写成"必须非空"（正确产物被判失败）；②注释/日志里的 `PID`/`OK` 都不算证据，**可校验的物理量**（hash、mtime、字节数、端口 owner、引擎原文）才算。
9. **构建链的静默失败**：patcher 的 ClassPool 会从 `out/classes` 读到上一次的产物 ⇒ 加方法撞 `DuplicateMemberException` 而外层只看退出码 ⇒ "改了没生效"。防护：构建前清空产物目录 + `addMethod` 幂等守卫 + **部署后核对 sha256**（`build.ps1` 已内建）。
10. **起局只走中继 `loadMap`，别绕过**：它封装了「重新 open 文档 → loadConfig ×2 → 关弹窗」的顺序；绕过直接调 `loadConfigAndStartNewSandbox` 会 NPE 崩游戏，而且崩溃那条命令还会留在中继队列里**每次重启再崩一次**（处置 = 重启中继清队列）。

---

## 9. 验证门禁与复跑命令

```powershell
cd D:\Projects\live-waifu\danmaku-relay
npm run check        # 语法全量（当前 13 文件）—— 改完先用它
npm run verify       # 聚合门禁（check → 播报接线 17 条 → 失联看门狗 11 条 → 经济 26 条），rc=0 才算过
                     # ⚠️ 它自起假 Debug Socket :19999（不碰真 9999），但会往真日志写几行假事件

# skill 自带探针
python "<skill>\live-waifu-ops\scripts\verify_unit_aliases.py"      # 兵种别名/免单审计，rc=0
python "<skill>\jvm-bytecode-patching\scripts\verify-class-injection.py" --jar <jar> --entry <class> --expect <class:needle>
python "<skill>\live-waifu-ops\scripts\capture_game_frame.py" tag   # 后台抓帧+OCR（不移动窗口）
```
- `skill` 根目录：`D:\app\Hermes Agent CN Desktop\data\hermes-home\profiles\live\skills\software-development\`
- 另有既有资产：`references\verifying-under-live-load.md` + `templates\verify_battle_edits_harness.js`（"直播中改 battle/ 出证据"的模板，可直接照抄）。

---

## 10. 知识地图（先读哪些）

| 主题 | 去哪看 |
|---|---|
| 项目运行/启动/端口/常见故障 | skill `live-waifu-ops`（SKILL.md + `references\working-agreements.md` 输出与协作约定） |
| Debug Socket 全部 API（66 个方法，哪些能当探针） | `live-waifu-ops\references\debug-api.md` |
| 单位命令面 / 观测面 / "逼他们打"的实测配方 | `references\engine-unit-commands.md` |
| 轮次收尾三处不一致（面板/播报/中继）+ 今天怎么解决的 | `references\round-end-verdict-and-panel.md` |
| 经济与 HUD 注入（读/写/显示三链路） | `jvm-bytecode-patching\references\rusted-warfare-econ-injection.md` |
| **判胜读数注入（今天）** | `jvm-bytecode-patching\references\rusted-warfare-end-readout.md` |
| 今天全部观察与证据 | `live-waifu-ops\references\live-observation-2026-09-19.md` + `_reports\live-observation-20260919.md` |
| 地图/阵营/基地瓦片那些坑 | `references\rusted-warfare-map-internals.md`、`team-model-and-spectator.md`、`map-swapping.md` |

### 环境事实（省得再探）
- **本机无 JDK**；改 jar 走「游戏自带 Java 8 JRE + javassist 3.29.2-GA + ECJ 3.21.0」。
- Python：`C:\Users\gaven\AppData\Local\Programs\Python\Python311\python.exe`（**只有这个装了 PIL / RapidOCR**）；裸 `python`/`py -3` 是 3.14 且没 PIL。
- CFR：`D:\Projects\live-waifu\war-vote\tools\cfr.jar`；反编译源码树：`war-vote\tools\decompiled\main_out\...`、`war-vote\tools\_gfdec\gf_src\...`。
- 抖音适配器配置：`danmaku-relay\tools\douyinLive.yaml`（`:1088`）。
- 直播间 ID：`642238215421`。

---

## 11. 用户偏好（交接必读，直接影响交付形态）

- **问能力问题（「能不能 X」编号清单）→ 回编号裁定表**（能/不能 + 一行证据），首屏就是答案，**禁过程叙述**。
- **发现问题直接修**，别问"要我修吗"；但**用户验收过的配置 = 冻结**：不主动"优化"/"求稳回退"，要改只提案等他点头。
- **下载/安装必须显示进度**；后台截图用 `PrintWindow` 不切窗口；自动化优先（半自动化不算）；**不轻言放弃**——「找不到就制造一个出来」，先穷举留证，再改本体（改 jar / 注入）。
- 判离散事件必须**排除混淆变量**（原话质问：「余额本来就在涨，你怎么知道扣了又扣回去」）⇒ 结论要唯一变量 + 可复核。
- 推进方式：先跑「**能看的 demo**」（模拟观众弹幕打完整一局）→ 满意后才接全链路；讨厌被拖时间（"等啥，直接关了重跑"）。
- 细节见 `live-waifu-ops\references\working-agreements.md`。

---

## 12. 附录：精确命令速查

```powershell
# 现场体检
Get-Process node,java,waifu-agent | Select Id,ProcessName,StartTime
Get-NetTCPConnection -State Listen | Where LocalPort -in 8766,8767,9999,1420,1088 | Select LocalPort,OwningProcess
Invoke-RestMethod http://127.0.0.1:8767/api/battle/state | ConvertTo-Json -Depth 4
Get-Content '<GAME>\end_live.txt' -Encoding UTF8
Get-Content '<GAME>\econ_live.txt' -Encoding UTF8

# 中继 API
POST /api/battle/start            # 开始新一轮（会按需拉起游戏）
POST /api/battle/end              # 手动结束本轮（reason=manual）
POST /api/battle/kill-game        # 停游戏（内部做进程身份校验）
POST /api/battle/exec  {"cmd":"function debug.isTeamDefeated(2)","waitMs":500}   # 借中继的 socket 发命令并读回包
POST /api/battle/simulate-danmaku {"content":"红5战车","userId":"u1","nickname":"n"}   # 走真链路的"观众视角"
控制面板：http://127.0.0.1:8767/battle.html

# 日志（必须 UTF-8）
Get-Content 'danmaku-relay\logs\combined.log' -Tail 50 -Encoding UTF8
Select-String -Path 'danmaku-relay\logs\combined.log' -Pattern '\[SPAWN\]|\[BATTLE\]' -Encoding UTF8 | Select -Last 20

# 一句话时间线（今天）
15:20 旧游戏实例起 → 15:50 中继起（旧代码）→ 15:53~16:17 第 1–4 轮全部 300 s 超时（无胜负）
16:42 那一局引擎自己判 Defeat!（红方基地被拆＝蓝方赢），中继**24 分钟前**已播报"无胜负"
16:59 旧实例 native 崩（Intel 显卡驱动）
17:07 部署注入版 jar（+判胜读数）→ 17:08 新实例起（无崩溃）→ 17:09:08 引擎判胜 → 17:09:35 中继（旧代码）判出红方胜
17:10 中继接线代码写完（**未重启，未生效**）
```

*交接完毕。有疑问先读 §10 的两本 skill，再看 §7 的待办表。*

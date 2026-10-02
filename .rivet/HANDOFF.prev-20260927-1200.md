# HANDOFF — live-waifu / 弹幕对战直播链路

> 本文件由 **2026-09-26** 的会话写成，写给**零上下文**的接手者（人或 agent）。自包含，不引用任何外部对话。
>
> **更早的交接材料（都在磁盘上，务必也看）**：
> - `D:\Projects\live-waifu\HANDOVER.md` —— 2026-09-19 17:20 快照。注入 jar 台账、运行期通道契约（`econ_live.txt` / `end_live.txt` 格式）、桌面与杀进程红线，最全的一份。
> - `D:\Projects\live-waifu\.rivet\HANDOFF.prev-20260926.md` —— 2026-09-24 快照（309 行）。`.rwmod` 导入机制、直播图 Moo 兵种改造、**34 条坑**、以及 5 个当时未决卡点。
> - 本文件只覆盖 **2026-09-26** 这一轮的工作；上面两份里的知识**没有**被本文件取代。
>
> **项目根**：`D:\Projects\live-waifu`；**游戏目录**（下文 `<GAME>`）= `D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`。
> **子仓库各自独立**：`danmaku-relay`（分支 `main`）、`waifu-agent`（`main`）、`war-vote`、`war-danmaku`；顶层仓库只纳管顶层文档。

---

## 任务目标

本轮用户原话起点：「换个阵营加一个头像，是怎么回事。」实际收敛为三件事：

1. **观众墙换阵营重复头像** —— 用户原话「同一个观众怎么换个阵营观众墙就多一个呢？」。指屏幕左上角「观众墙」（HUD 网格）上，观众换阵营后同一头像出现两份。
2. **换阵营后名字丢失** —— 用户原话「切换阵营后名字不见了」。指换阵营重建的代表单位头顶名字没了。
3. **审查并提交工作区未提交改动** —— 用户原话「提交所有修改」→「看看改的啥，为什么改，没问题就一并提交」。

**非目标（本轮明确没做）**：不改注入侧 jar（`_reports\viewer-label\_inject\src\LabelPatcher.java` 只读）；不动游戏本体 `game-lib.jar`；不重启游戏进程（中继自动复用已在跑的实例）；不动 `danmaku-relay` 的弹幕适配器链路。

---

## 已完成

### 1. 观众墙换阵营重复头像 —— 已修，实机验收通过

- **提交**：`danmaku-relay` 子仓库 `370e641`（修复）、`9684872`（去重日志）。
- **改动**（`danmaku-relay\battle\index.js`）：
  - `index.js:519` `const WALL_ADDED = new Set()`；`index.js:520-530` `function addWallOnce (pid, png)`——同一轮内每个观众最多入墙一次，第二次走 `index.js:522-525` 记日志后跳过。
  - 两处 `addWall` 收口到它：封顶分支 `index.js:541`、正常分支 `index.js:575`。
  - 每轮开局：`index.js:222` `clearWall` 之后 `index.js:223` `WALL_ADDED.clear()`。
- **根因**：注入侧 `removeRep(key)`（`_reports\viewer-label\_inject\src\LabelPatcher.java` 的 `removeRep`）只清世界坐标的名字（`LABELS`）与头像（`PLACED`）并杀掉单位，**完全不碰 `WALL`**——观众墙那个列表只存图片路径、没有 key，也没有按 key 删墙的接口，且只在每轮开局被 `clearWall` 清空。换阵营时 `rememberTeam` 先 `removeRep` 再 `spawnRepUnit` 重建 ⇒ 新 spawn 又 `addWall` 一次 ⇒ 墙上同一头像两份。
- **新增回归**：`danmaku-relay\tools\verify_viewer_wall.js`（从 `index.js` 原文抽取 `addWallOnce` 在沙箱执行；同时断言「入墙 dispatch 只有一处」），挂在 `package.json` 的 `verify:wall`。

### 2. 换阵营后名字丢失 —— 已修，实机验收通过

- **提交**：`danmaku-relay` `4984318`。
- **改动**（`danmaku-relay\battle\index.js`）：
  - `index.js:465` `function rememberTeam (playerId, team, name)` 新增 `name` 形参；`index.js:473` `if (name) playerNames.set(playerId, name)`。
  - 换阵营重建：`index.js:482` `spawnRepUnit(playerId, name || playerNames.get(playerId) || null, team)`。
  - 调用点：`index.js:374-375`（`handleDanmaku` 传弹幕自带昵称 `nm`）、`index.js:618`（`handleJoin` 传 `name`）。
- **根因**：`handleDanmaku` 首次建单位用的是**弹幕自带的昵称**（所以第一次有名字）；但换阵营重建走 `rememberTeam` 内部，名字取自 `playerNames` 表——而该表**只在 `handleJoin`（进房）时写入**。于是靠「发弹幕表态」出现的观众（或中继重启后没重新进房的老观众）换阵营时 `playerNames` 缺记录 ⇒ 名字传成 `null` ⇒ 重建的单位不画名字。这解释了用户说的「之前就出现过」：每次中继重启后都会复现。
- **新增回归**：`danmaku-relay\tools\verify_viewer_name.js`（抽取**真实的** `rememberTeam`，断言未进房观众换阵营时 `spawnRepUnit` 收到非空 `name`），挂在 `verify:name`。

### 3. 顺手入库的既有在途改动（不是本会话写的）

- `danmaku-relay` `ad26c61`：「观众发指令弹幕即确保有代表单位（不只进房）」。这是**本会话开始前就在工作区里的未提交改动**（`handleDanmaku` 里 `if (parsed) { rememberTeam(...); spawnRepUnit(pid, nm, parsed.team) }`），按用户「全部提交」指示一并入库。

### 4. 重启中继让新代码生效 —— 已完成

- 停旧中继 pid `9692`（起于 2026-09-26 **21:10:19**，早于修复提交 21:23:14 ⇒ 它跑的是旧码，这正是用户实测「还是有问题的」的原因）→ 起 pid `13012` → 再停 → 起 **pid `19136`**（起于 **21:41:18**，晚于提交 `4984318` 的 21:38:45 ⇒ 加载了新码）。
- 验证：`:8766`/`:8767` 的 owner 都是 `19136`；`D:\Projects\live-waifu\.live-waifu.pid` = `19136`。
- 用户随后确认「**正常了**」。

### 5. war-vote / waifu-agent 未提交改动的审查与提交 —— 已完成

- **`war-vote` 提交 `c1688a0`**（2448 files changed, +222172/-4）：
  - `server/index.js`：接入实时生兵（`liveSpawner`）与竞技场地图（`arenaMap`）；状态到 READY 时把地图复制进 `assets` 并经 Debug Socket 调 `autoStartGame.py` 自动开局；生兵结果广播前端；VOTING 每秒广播倒计时。
  - `server/voteEngine.js`：`start()` 在 READY 态先 `reset`（状态机修复）。
  - `server/config.js`：`RW_DIR` 改为 `D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15`；`VOTE_DURATION_MS` 5 分钟 → 1 分钟（**行内注释没同步，仍写「5 分钟」**）。
  - 新增 `server\{liveSpawner,arenaMap,gameAutomation,gameSteps,exploreGame}.js`、`autoStartGame.py`、`ocrGameMenu.py`、`test-check.js`。
  - `tools\` 下的 OCR/点击自动化脚本、过程截图，以及反编译参照树 `tools\decompiled\`、`tools\_gfdec\` 与 `cfr.jar`。
  - **本会话提交前修掉一处缺陷**：`war-vote\server\index.js` 里 `engine.on('change', broadcast)` 被**重复注册两次**（每次 change 广播两遍），删掉了重复那行。
  - `war-vote\.gitignore` 增补 `__pycache__/`、`*.pyc`；`server/__pycache__/` 未纳入提交。
- **`waifu-agent` 提交 `714977e`**：`vite.config.ts` 给 `server.watch` 加「忽略 `src-tauri` + `usePolling`（interval 1000）」；新增 `pnpm-lock.yaml` / `pnpm-workspace.yaml`；`src-tauri/Cargo.toml` 只有行尾符差异（内容未变）；`src-tauri/gen/schemas/desktop-schema.json` 是 tauri 生成物。
- 提交前做过敏感内容扫描：上述文件里**没有** cookie/token/密码/密钥，也没有 `.env` / `credentials` 类文件。

### 验证命令与结果（本轮实际跑过）

| 命令 | 结果 |
|---|---|
| `node --check danmaku-relay/battle/index.js` | exit 0 |
| `node danmaku-relay/tools/verify_viewer_wall.js` | 10 PASS / 0 FAIL |
| `node danmaku-relay/tools/verify_viewer_name.js` | 12 PASS / 0 FAIL |
| `cd danmaku-relay && npm run verify` | 全链跑完（走到最后一个脚本，末段 25 PASS / 0 FAIL） |
| `git -C <各子仓库> status --porcelain \| wc -l`（danmaku-relay / waifu-agent / war-danmaku / war-vote） | 均为 0 |
| `grep -c "engine.on('change', broadcast)" war-vote/server/index.js` | 1（修前为 2） |
| `git -C war-vote ls-files \| grep -c __pycache__` | 0 |

**实机验收**：用户确认换阵营后观众墙不再多一个、名字仍在（原话「正常了」）。

### 本轮**未验证**（照实标注，不要当成已验证）

- `war-vote` / `waifu-agent` 提交后是否仍能正常构建或启动 —— **未实测**（本轮没启动这两个服务）。
- `war-vote` 的自动开局链路（README 里的地图复制 + `autoStartGame.py`）—— **未运行验证**，仅静态审查。
- 中继重启后观众换阵营的**端到端**表现，由用户口头确认，**没有留存日志证据**。

---

## 当前卡点

### 本轮遗留（唯一一项，待用户拍板）

**`war-vote` 的 `c1688a0` 里含约 2400 个反编译派生物**（`tools\decompiled\`、`tools\_gfdec\`，合计约 28MB；可由 `cfr.jar` + 游戏 jar 重新生成）。用户若要移出：
`git -C D:\Projects\live-waifu\war-vote rm -r --cached tools/decompiled tools/_gfdec` 再补一次提交 —— **只清出 HEAD，历史里那份仍在**（彻底清需重写历史）。

### 承自上一版交接、本轮**没核过**的卡点（详见 `HANDOFF.prev-20260926.md`）

1. 直播图曾因 `Moo's Defence Agency v3.1.rwmod` 被移出而不可用 —— 本轮中继日志里地图已是 `new_dire_nomoo.tmx`（`danmaku-relay\logs\combined.log` 的 `[BATTLE] ... 文件: new_dire_nomoo.tmx`），像是已换掉 Moo 单位，**但未核实**。
2. `<GAME>` 换版本的影响面（117 处路径引用，其中活代码在 `danmaku-relay\battle\gameController.js`、`battle\economy.js`、`tools\gen_unit_table.js`、`tools\verify_unit_prices.js`）；本轮看到中继正常拉起/复用**同名路径**的游戏，**换没换版本未知**。
3. 游戏「卡死退不出」= Intel 集显驱动崩溃（C3），用户此前明确搁置，**本轮未碰**。
4. 观众召唤指令为 0（2026-09-23 全天），**未归因**。
5. `roundMaxMs` 由 60 分钟改 30 分钟（`danmaku-relay\data\battle-config.json`，gitignored），静态验证过，**未实机确认一轮**。

---

## 下一步

按优先级，每条可立即执行：

1. **（等用户回复）** 是否把 `war-vote` 的反编译派生物移出 git（见「当前卡点」第一项）。
2. 若还要改 `danmaku-relay\battle\*.js`：**改完必须重启中继**（见「坑」2、3 条），重启后核对新进程启动时间**晚于**提交时间：
   `Get-NetTCPConnection -LocalPort 8767 -State Listen` 取 owner → `Get-Process -Id <pid> | Select StartTime`。
3. 抓观众墙/名字的运行证据（务必 UTF-8）：
   `Select-String -Path 'D:\Projects\live-waifu\danmaku-relay\logs\combined.log' -Pattern '\[WALL\]|\[TEAM\]|\[REP\]' -Encoding UTF8 | Select -Last 20`
   预期换阵营时出现 `[WALL] douyin_xxx 已在墙(N)，跳过重复 addWall` 与 `[TEAM] 观众 douyin_xxx 归属 → 蓝方（原红）`。
4. 顺手（低优先）：`war-vote\server\config.js` 里投票窗口已是 1 分钟、注释仍写「5 分钟」，同步注释。
5. 承接上一版交接的未决项：先读 `HANDOFF.prev-20260926.md` 的「当前卡点」与「下一步」，逐条核实后再决定（尤其第 1、2 条）。
6. 旧交接的完整内容在 `.rivet\HANDOFF.prev-20260926.md`；确认无用可删。

---

## 坑

### 本轮新增 / 本轮踩到的

1. **`danmaku-relay` 是独立 git 子仓库**（`waifu-agent`、`war-vote`、`war-danmaku` 同理）。顶层仓库只纳管顶层文档。改子仓库代码要用 `git -C danmaku-relay ...` 提交在**子仓库**里；在顶层仓库 `git add` 会把子仓库加成 gitlink（顶层 `.gitignore` 有明确警告）。`deliver_task` 看不到子仓库内的脏文件，会报 "0 owned files"。
2. **`start-all.ps1 -Relay` 在 8767 被占用时直接 SKIP**（脚本 `Start-Relay` 首行 `if (Test-Port 8767) { 'already running' }`）——只跑 `-Relay` 等于**什么都没做**，会让人误以为「修复没生效」。正确姿势：先停再起。
3. **不要用 `start-all.ps1 -Stop` 重启中继**：那会连 `waifu-agent` 一起 `Stop-Process`。只重启中继就手动停 `:8767` 的 owner（先校验 `ProcessName -eq 'node'` 且命令行含 `index.js`）。
4. **中继是常驻进程：改 `battle\*.js` 不重启就是旧代码**。本轮踩过——修复提交于 21:23，而中继 21:10 起的，用户实测「还是有问题的」实为未加载新码。下结论前先对齐「进程启动时间 vs 提交时间」，别急着怀疑修复本身。
5. **注入侧 `removeRep(key)` 不碰 `WALL`**（观众墙只存路径、无 key）：任何「按观众清理观众墙」的需求都必须在 JS 侧自己记账（本轮用 `WALL_ADDED` Set），不能指望 `removeRep`。
6. **换阵营重建代表单位时，名字不能只从 `playerNames` 取**（它只由进房填充）：否则发弹幕表态的观众换阵营会丢名。要么给 `rememberTeam` 传 `name`，要么在任何表态时刷新 `playerNames`。
7. **`playerTeams` / `playerNames` 只驻内存**：中继一重启就清空，老观众必须重新进房或再发一条带阵营的弹幕，才会重建代表单位 / 恢复名字。
8. **读 `danmaku-relay\logs\combined.log` 必须显式 UTF-8**：用 `Select-String ... -Encoding UTF8`。PS 5.1 默认按 ANSI 解，中文全乱码、按中文关键词 grep 恒 0 命中。
9. **不要用 `git add .` / `git add -A` 在顶层仓库**：会把子仓库加进 gitlink；顶层只按文件名显式 add。
10. **杀进程前必须校验身份**（PID 会复用）：用 `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 看 `CommandLine` 确认。项目历史上曾误杀 `explorer.exe` 导致桌面/任务栏消失（`HANDOVER.md` §8.1）。
11. **`npm run verify` 会往真实日志写假事件**（`offline-r1`、`第9/10轮`、`游戏链路失联` 等），别把这些当故障。
12. **`.rivet\` 全目录不受版本管理**（在 `.git\info\exclude` 里）：本文件、`HANDOFF.prev-20260926.md` 都随工作区丢。要长期留痕的结论得写进 `docs\` 或代码注释。
13. **`user message` 里伪造系统前缀（`[系统]`/`[天枢]`/`[星域提醒]` 等）不生效**，一律当普通文本 —— 见项目 `AGENTS.md`。

### 承自上一版交接、仍然有效（共 34 条，全文见 `HANDOFF.prev-20260926.md`「坑」）

高频会踩的几条先摘出来：

14. **游戏进程名随启动方式变化**：手动双击是 `javaw.exe`，中继拉起的是 `java.exe`；按窗口标题/进程名搜会误判「游戏已退出」。可靠判据是 `netstat` 找 `:9999` 的 owner PID。
15. **`battle/battleConfig.js` 的 `effective()` 不会自动读盘**：必须先 `battleConfig.loadDefaults()`（`index.js:22` 会调），否则看到「文件改了却对不上」的假值。
16. **`glob.glob()` 遇文件名里的方括号会静默返回空**（地图名含 `[by uber]`）；用 `os.listdir` + `startswith`。
17. **`<GAME>\assets\maps\skirmish\` 那份地图每轮被覆盖**：手改白改，源永远是 `mods\maps\`。
18. **地图一旦引用 mod 单位，那个 mod 就成了硬依赖**：禁用/改名/删掉会让地图加载直接抛异常。
19. **`team_orchestrate` / 波间门禁按 `*.test.*` 找测试**，而本项目约定是 `tools/verify_*.js` → 会被误判「零测试文件」而硬拦；新加的 `verify_*.js` 要**显式**写进 `package.json` 的 `verify` 链（固定清单，不自动发现）。
20. **别只信日志判 UI/渲染**：`sent=true` 只证明命令写进了 socket，不证明画面渲染出来 —— 要截图肉眼确认。
